/**
 * Rank job processor — runs in the WORKER deployable only.
 *
 * Failure contract (release gate): on `ProviderError` for a single keyword,
 * the job records NO `rankings` row for that (keywordId, period). The
 * absence of a row is the "unavailable" signal — a stored null position is
 * "not found in depth", distinct from "check unavailable". That keyword —
 * and ONLY that keyword — is stamped with `last_failed_check_at` plus a
 * `last_failed_reason` naming the provider error class, so the list endpoint
 * can say why. Keywords the batch never reached are never stamped: they have
 * not failed, they have not been tried.
 *
 * Whether one failure ends the batch depends on the CAUSE, not on
 * `err.retryable`. Account-wide causes (`VendorAuthError`, `VendorQuotaError`)
 * bubble up so BullMQ retries the whole job — every remaining keyword would
 * hit the same wall, and for quota each attempt still costs. Keyword-scoped
 * causes (timeout, in-queue exhaustion, malformed payload) count into
 * `errors` and the loop continues to the next keyword, so one slow or broken
 * phrase cannot blank an entire site's check. Inserts are idempotent per
 * `(keywordId, checkedAt)` so a retry never duplicates.
 *
 * Cache is scanned FIRST for every keyword — a domain-independent lookup —
 * so one recorded SERP serves every user tracking that phrase in the same
 * (location, language, device). A local-pack-tracked keyword issues one
 * additional maps/live call per sweep alongside its organic SERP task.
 * Replays are suppressed per `(keywordId, checkedAt)`: a BullMQ retry that
 * finds an existing `rankings` row for the pair skips the vendor/cache work.
 *
 * The non-Google engines (Bing / YouTube / Amazon) run alongside that Google
 * path WITHOUT changing it. They are always stamped at the weekly period floor
 * (so the existing `(keywordId, checkedAt)` replay filter caps them at one
 * check per keyword per week).
 */
import { UnrecoverableError, type Job } from 'bullmq';
import type { Logger } from 'pino';
import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { isAltRankEngine, keywords as keywordsTable, rankings as rankingsTable, domainStates, type RankCheckFailureReason, type RankEngineKind, type SerpTopResult, } from '../../db/schema/keywords.js';
import { localPackRankSnapshots } from '../../db/schema/local-seo.js';
import { captureVendorCost, matchHostInRows, matchTokenInRows, ProviderError, type AltEngineRankRow, type AltRankEngine, type RankCheckInput, type RankCheckResult, type RankProvider, type SerpDevice, type SerpFeatureSnapshot, matchDomainInAiOverview, matchDomainInSerp, normalizeSerpDomain, type SerpAiOverview as ProviderSerpAiOverview, type SerpItem, } from '../../shared/providers/index.js';
import { VendorAuthError, VendorMalformedError, VendorQuotaError, VendorTimeoutError, VendorUnavailableError, } from '../../shared/providers/errors.js';
import { parseConsumedPayload, rankJobSchema, type RankJob } from '../../shared/queue/payloads.js';
import { rankPeriodKey } from '../../shared/queue/queues.js';
import { Site } from '../sites/index.js';
import { computeSerpCacheKey, type SerpCacheRepo } from './serp-cache.service.js';
import { recordObservation } from './serp-observations.repo.js';
import { env } from '../../config/env.js';
import type { VendorArchiver } from '../../shared/vendor-cache/index.js';
import { detectRankDrop, type RankDropHandler } from './rank-drop.service.js';
import type { ConfirmationCandidate } from './rank-drop-confirmations.service.js';
import type { ObservationMeta } from '../../shared/observations/types.js';
export interface RankTargetContext {
    payload: RankJob;
    domain: string;
}
export type ResolveRankTargets = (ctx: RankTargetContext) => Promise<ResolvedTarget[]>;
/**
 * A resolved target pairs the vendor-neutral RankCheckInput with the storage
 * id (keywordId) so the processor can write the resulting `rankings` row.
 */
export interface ResolvedTarget {
    keywordId: string;
    input: RankCheckInput;
    /**
     * Opt-in per-keyword local-pack (map pack) tracking. When
     * true, the processor issues an ADDITIONAL `checkLocalPackRank` call
     * alongside the normal organic check on this keyword's cadence — organic
     * and local-pack are parallel signals, not a replacement.
     */
    trackLocalPack?: boolean;
    /**
     * The engine this keyword is tracked on.
     * REQUIRED: every stored keyword row carries one (column default
     * `'google'`), so a resolver that omitted it would be hiding a bug rather
     * than describing a real target. `'google'` is the shipped path; every
     * other value runs on a weekly cadence.
     */
    engine: RankEngineKind;
    /** Exact-match token for `youtube` / `amazon`; `null` for google/bing. */
    engineTarget: string | null;
}
/** Default resolver: pull all active keywords for the site. */
export function createPostgresRankTargetsResolver(db: Db): ResolveRankTargets {
    return async ({ payload, domain }) => {
        const filters = [
            eq(keywordsTable.siteId, payload.siteId),
            eq(keywordsTable.accountId, payload.accountId),
            eq(keywordsTable.active, true),
        ];
        if (payload.keywordIds.length > 0) {
            filters.push(inArray(keywordsTable.id, payload.keywordIds));
        }
        const rows = await db
            .select()
            .from(keywordsTable)
            .where(and(...filters));
        return rows.map((row) => ({
            keywordId: row.id,
            input: {
                keyword: row.phrase,
                domain,
                locationCode: row.locationCode,
                languageCode: row.languageCode,
                device: row.device as SerpDevice,
            },
            trackLocalPack: row.trackLocalPack,
            engine: row.engine as RankEngineKind,
            engineTarget: row.engineTarget,
        }));
    };
}
/** Monday 00:00 UTC of the week containing `now` — the alt-engine period floor. */
export function altEngineWeeklyStamp(now: Date): Date {
    const stamp = new Date(now.getTime());
    const day = stamp.getUTCDay() || 7;
    stamp.setUTCHours(0, 0, 0, 0);
    stamp.setUTCDate(stamp.getUTCDate() - (day - 1));
    return stamp;
}
export interface RankProcessorDeps {
    provider: RankProvider & {
        /**
         * Synchronous single-call SERP (DataForSEO live). Used only when a
         * provider does not expose the depth-100 standard task API; live depth is
         * intentionally smaller because its per-page price is higher.
         */
        liveSerp?: (input: RankCheckInput) => Promise<{
            items: SerpItem[];
            costUsd: number | null;
            aiOverview?: ProviderSerpAiOverview | null;
            /** SERP features from the SAME payload; absent = no signal. */
            features?: SerpFeatureSnapshot | null;
        }>;
        postSerpTask?: (input: RankCheckInput) => Promise<{
            vendorTaskId: string;
        }>;
        fetchSerpResult?: (taskId: string) => Promise<{
            items: SerpItem[];
            costUsd: number | null;
            /** Optional for older/custom providers — absent = no signal. */
            aiOverview?: ProviderSerpAiOverview | null;
            /** SERP features from the SAME payload; absent = no signal. */
            features?: SerpFeatureSnapshot | null;
        }>;
    };
    db?: Db;
    cache?: SerpCacheRepo;
    logger: Logger;
    resolveTargets: ResolveRankTargets;
    /** Injectable clock for idempotent `checkedAt` stamping (jobs use the scheduled period). */
    clock?: () => Date;
    /** SERP cache TTL. Defaults to 24h (SERP_CACHE_TTL_HOURS). */
    cacheTtlMs?: number;
    /**
     * Rank-drop hook (email alert + auto audit re-run). Fired only when the
     * `rankings` insert actually landed (a retried period never double-fires)
     * AND a prior row exists AND `detectRankDrop` says so. The hook is called
     * inside its own catch — it can NEVER fail the rank job.
     */
    onRankDrop?: RankDropHandler;
    /**
     * Production path: turn an inserted candidate into durable two-observation
     * confirmation before any rank-drop effect. When present it takes
     * precedence over the legacy `onRankDrop` compatibility hook.
     */
    confirmRankDrop?: (candidate: ConfirmationCandidate) => Promise<unknown>;
    /**
     * Save-everything archiver for the local-pack maps call — the organic SERP
     * lands in the read-through cache, but the maps/live call bypasses it, so
     * without this the tracked-local-pack spend is invisible to the superadmin
     * vendor-usage ledger.
     */
    archive?: VendorArchiver;
}
export interface RankJobOutcome {
    siteId: string;
    checked: number;
    positions: Array<number | null>;
    fromCache: number;
    fromFresh: number;
    errors: number;
    /**
     * Targets skipped as replays (a prior `rankings` row for the same
     * `(keywordId, checkedAt)` pair already exists — the BullMQ retry
     * suppression path).
     */
    skipped: number;
}
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export function createRankProcessor(deps: RankProcessorDeps) {
    const resolveTargets = deps.resolveTargets;
    const clock = deps.clock ?? (() => new Date());
    const cacheTtlMs = deps.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    return async (job: Job): Promise<RankJobOutcome> => {
        const payload = parseConsumedPayload(rankJobSchema, job.data);
        const site = await Site.findOne({
            _id: payload.siteId,
            accountId: payload.accountId,
            deletionStartedAt: null,
        });
        if (!site) {
            // Site deleted after scheduling — permanent; retries cannot help.
            throw new UnrecoverableError('site not found for rank job');
        }
        if (site.paused === true) {
            // Paused site: a stale scheduler tick (or a job enqueued just before
            // the pause landed) must not spend. Soft-complete — the site exists,
            // and DLQ noise would help no one.
            return {
                siteId: payload.siteId,
                checked: 0,
                positions: [],
                fromCache: 0,
                fromFresh: 0,
                errors: 0,
                skipped: 0,
            };
        }
        const resolvedTargets = await resolveTargets({ payload, domain: site.domain });
        // New jobs carry the producer's flag snapshot. A false snapshot excludes
        // alternate-engine work even if the flag is re-enabled before consumption;
        // true (or a legacy missing field) lets accepted work finish after rollback.
        const targets = payload.altEnginesEnabledAtEnqueue === false
            ? resolvedTargets.filter((target) => !isAltRankEngine(target.engine))
            : resolvedTargets;
        const now = clock();
        const cadence = deps.db ? await loadCadence(deps.db, payload.siteId) : 'weekly';
        const periodKey = rankPeriodKey(cadence, now);
        // Scheduled jobs floor `checkedAt` to the period start so a retry within
        // the period is idempotent. On-demand ("manual") jobs — the keyword-create
        // first run and the "Check now" button — stamp the exact trigger time so
        // they always write a fresh row, even inside an already-checked period.
        const checkedAt = payload.manual ? now : deriveCheckedAt(cadence, now);
        // Non-Google keywords are WEEKLY, always:
        // they stamp the Monday-00:00-UTC period floor even on a daily-cadence
        // site and even for a manual "Check now". The shipped
        // `(keywordId, checkedAt)` replay filter then suppresses every further
        // alt-engine check inside the same week, so one check per keyword per
        // week is structural — no second scheduler, no separate cooldown.
        const altCheckedAt = altEngineWeeklyStamp(now);
        // Idempotency filter: a BullMQ retry after a partial completion re-runs
        // the whole keyword loop. Any target whose `(keywordId, checkedAt)` row
        // already exists is a REPLAY — it is excluded from the vendor/cache
        // work. `persistRanking` uses the same conflict target
        // (`.onConflictDoNothing({ target: [keywordId, checkedAt] })`), so the
        // two checks stay in lockstep.
        const googleTargets = targets.filter((t) => !isAltRankEngine(t.engine));
        const altTargets = targets.filter((t) => isAltRankEngine(t.engine));
        const existingReplayed = deps.db && googleTargets.length > 0
            ? await loadExistingRankingKeywordIds(deps.db, googleTargets.map((t) => t.keywordId), checkedAt)
            : new Set<string>();
        // Alt engines carry their own period stamp, so their replay set is a
        // separate lookup against the weekly floor.
        if (deps.db && altTargets.length > 0) {
            for (const id of await loadExistingRankingKeywordIds(deps.db, altTargets.map((t) => t.keywordId), altCheckedAt)) {
                existingReplayed.add(id);
            }
        }
        const pending: ResolvedTarget[] = [];
        let skipped = 0;
        for (const target of targets) {
            if (existingReplayed.has(target.keywordId)) {
                skipped += 1;
                deps.logger.info({ siteId: payload.siteId, keywordId: target.keywordId }, 'rank check skipped — replay (row already exists for period)');
                continue;
            }
            pending.push(target);
        }
        const positions: Array<number | null> = [];
        let fromCache = 0;
        let fromFresh = 0;
        let errors = 0;
        for (let i = 0; i < pending.length; i += 1) {
            const target = pending[i]!;
            const targetEngine = target.engine;
            if (isAltRankEngine(targetEngine)) {
                const outcome = await runAltEngineTarget({
                    target,
                    engine: targetEngine,
                    deps,
                    payload,
                    siteUrl: site.url,
                    checkedAt: altCheckedAt,
                    now,
                    cacheTtlMs,
                });
                if (outcome.kind === 'error') {
                    errors += 1;
                    if (outcome.rethrow)
                        throw outcome.rethrow;
                    continue;
                }
                positions.push(outcome.position);
                if (outcome.source === 'cache')
                    fromCache += 1;
                else
                    fromFresh += 1;
                continue;
            }
            try {
                const outcome = await checkOne(target, payload.accountId, deps, checkedAt, cacheTtlMs);
                positions.push(outcome.result.position);
                if (outcome.source === 'cache')
                    fromCache += 1;
                else
                    fromFresh += 1;
                /* c8 ignore next -- deps.db is always provided in production and all integration tests; the no-db code path is an optional performance mode. */
                if (deps.db) {
                    // Load the prior position BEFORE persisting so the drop compare
                    // never sees the row we are about to insert.
                    const previous = deps.onRankDrop === undefined && deps.confirmRankDrop === undefined
                        ? undefined
                        : await loadPreviousPosition(deps.db, target.keywordId, checkedAt);
                    const { inserted, rankingId } = await persistRanking(deps.db, {
                        keywordId: target.keywordId,
                        result: outcome.result,
                        checkedAt,
                        source: outcome.source,
                    });
                    // Durable SERP-feature + top-100
                    // capture. A pure BYPRODUCT of the payload this check already
                    // fetched: no extra vendor task, no depth change, no metric. Gated
                    // by `SERP_FEATURE_TRACKING_ENABLED`; a `null` snapshot (provider
                    // without the capability, or a cache row recorded before the
                    // feature) writes NOTHING rather than a fabricated empty
                    // observation. Failure here can never fail the rank job — same
                    // "hook can't fail the job" contract as `onRankDrop`.
                    if (env.SERP_FEATURE_TRACKING_ENABLED && outcome.features) {
                        try {
                            await recordObservation(deps.db, {
                                accountId: payload.accountId,
                                siteId: payload.siteId,
                                keywordId: target.keywordId,
                                checkedAt,
                                source: outcome.source,
                                features: outcome.features,
                                topResults: outcome.topResults,
                            }, now);
                        }
                        catch {
                            deps.logger.warn({
                                siteId: payload.siteId,
                                keywordId: target.keywordId,
                            }, 'serp observation persistence failed — rank job continues');
                        }
                    }
                    // ONE engine-agnostic drop-detection path, shared with the
                    // alt-engine branch. No per-engine fork lives below this line.
                    await maybeFireRankDrop(deps, {
                        accountId: payload.accountId,
                        siteId: payload.siteId,
                        keywordId: target.keywordId,
                        keyword: target.input.keyword,
                        siteUrl: site.url,
                        previous,
                        inserted,
                        rankingId,
                        currentPosition: outcome.result.position,
                        candidateObservedAt: checkedAt,
                        input: target.input,
                        engine: target.engine,
                        engineTarget: target.engineTarget,
                    });
                    // Opt-in local-pack (map pack) rank check, parallel to
                    // the organic check above, NOT a replacement. A local-pack
                    // failure never fails the organic rank job (same "hook can't
                    // fail the job" contract as `onRankDrop`).
                    if (target.trackLocalPack === true) {
                        try {
                            const { value: localPack, costMicros: localPackCostMicros } = await captureVendorCost(() => deps.provider.checkLocalPackRank({
                                keyword: target.input.keyword,
                                domain: target.input.domain,
                                locationCode: target.input.locationCode,
                                languageCode: target.input.languageCode,
                            }));
                            await deps.db.insert(localPackRankSnapshots).values({
                                accountId: payload.accountId,
                                siteId: payload.siteId,
                                keywordId: target.keywordId,
                                position: localPack.position,
                                totalPackSize: localPack.totalPackSize,
                                capturedAt: localPack.checkedAt,
                            });
                            // The maps call bypasses the serp read-through cache, so archive
                            // it here or the spend never reaches the vendor-usage ledger.
                            if (deps.archive) {
                                await deps.archive({
                                    capability: 'rank',
                                    operation: 'local-pack',
                                    params: {
                                        keyword: target.input.keyword,
                                        domain: target.input.domain,
                                        locationCode: target.input.locationCode,
                                        languageCode: target.input.languageCode,
                                    },
                                    payload: localPack,
                                    accountId: payload.accountId,
                                    costMicros: localPackCostMicros,
                                    fetchedAt: localPack.checkedAt,
                                });
                            }
                        }
                        catch (localPackErr) {
                            deps.logger.warn({
                                siteId: payload.siteId,
                                keywordId: target.keywordId,
                                err: (localPackErr as Error).message,
                            }, 'local-pack rank check failed — organic rank job continues');
                        }
                    }
                }
            }
            catch (err) {
                if (err instanceof ProviderError) {
                    errors += 1;
                    const reason = rankFailureReason(err);
                    const batchWide = isBatchWideFailure(err);
                    deps.logger.warn({
                        siteId: payload.siteId,
                        keywordId: target.keywordId,
                        retryable: err.retryable,
                        reason,
                        batchWide,
                        err: err.message,
                    }, 'rank check failed for keyword — no row written');
                    /* c8 ignore next -- deps.db is always provided in production and every integration test; the no-db mode is a perf-only path. */
                    if (deps.db) {
                        // Record the failed attempt so the list endpoint can render a
                        // "check failed" state, with its cause, instead of the
                        // indistinguishable never-checked "unavailable" one. ONLY this
                        // keyword is stamped: the remaining pending keywords have not been
                        // attempted, and marking them would report failures that never
                        // happened (and, on a batch-wide abort, would be re-stamped by
                        // every BullMQ retry).
                        await markCheckFailed(deps.db, [target.keywordId], now, reason);
                    }
                    if (batchWide) {
                        // Credentials rejected or vendor quota exhausted — every remaining
                        // keyword would hit the same wall, and for quota each attempt still
                        // costs. Bubble up so BullMQ retries the whole job; inserts are
                        // idempotent per (keywordId, checkedAt) so a retry never duplicates.
                        throw err;
                    }
                    // Keyword-scoped failure (timeout, in-queue exhaustion, malformed
                    // payload): the next keyword is independent, so keep going. The
                    // batch reports it in `errors` and the job still completes.
                    continue;
                }
                throw err;
            }
        }
        deps.logger.info({
            siteId: payload.siteId,
            schedulerKey: payload.schedulerKey,
            periodKey,
            checked: positions.length,
            fromCache,
            fromFresh,
            errors,
            skipped,
        }, 'rank job processed');
        return {
            siteId: payload.siteId,
            checked: positions.length,
            positions,
            fromCache,
            fromFresh,
            errors,
            skipped,
        };
    };
}
/**
 * Map a `ProviderError` to the stable reason key persisted on the keyword.
 * `vendor_error` is the honest fallback for a subclass this path does not
 * name (e.g. `GscReconnectRequiredError`): it claims the provider failed and
 * nothing more.
 */
export function rankFailureReason(err: ProviderError): RankCheckFailureReason {
    if (err instanceof VendorAuthError)
        return 'vendor_auth';
    if (err instanceof VendorQuotaError)
        return 'vendor_quota';
    if (err instanceof VendorTimeoutError)
        return 'vendor_timeout';
    if (err instanceof VendorUnavailableError)
        return 'vendor_unavailable';
    if (err instanceof VendorMalformedError)
        return 'vendor_malformed';
    return 'vendor_error';
}
/**
 * A provider failure that is a property of the ACCOUNT, not of one keyword:
 * continuing the batch would repeat the same failure for every remaining
 * keyword and, for quota, keep spending to do it. These abort the batch;
 * everything else is keyword-scoped and the loop moves on.
 */
function isBatchWideFailure(err: ProviderError): boolean {
    return err instanceof VendorAuthError || err instanceof VendorQuotaError;
}
/**
 * Stamp `keywords.last_failed_check_at` + `last_failed_reason` for keywords
 * whose rank check errored and wrote no `rankings` row, so the list endpoint
 * can render a "check failed" state — with its cause — distinct from the
 * never-checked "unavailable" one. No success marker is written: a later
 * ranking row supersedes this by its presence.
 *
 * Only keywords that were ACTUALLY ATTEMPTED are passed here. Stamping a
 * keyword the batch never reached would report a failure that never happened.
 */
async function markCheckFailed(db: Db, keywordIds: string[], at: Date, reason: RankCheckFailureReason): Promise<void> {
    await db
        .update(keywordsTable)
        .set({ lastFailedCheckAt: at, lastFailedReason: reason })
        .where(inArray(keywordsTable.id, keywordIds));
}
async function loadExistingRankingKeywordIds(db: Db, keywordIds: string[], checkedAt: Date): Promise<Set<string>> {
    // Caller gates this via `targets.length > 0` — no empty-array branch here.
    const rows = await db
        .select({ keywordId: rankingsTable.keywordId })
        .from(rankingsTable)
        .where(and(inArray(rankingsTable.keywordId, keywordIds), eq(rankingsTable.checkedAt, checkedAt)));
    return new Set(rows.map((r) => r.keywordId));
}
async function loadCadence(db: Db, siteId: string): Promise<'weekly' | 'daily'> {
    const rows = await db
        .select({ cadence: domainStates.cadence })
        .from(domainStates)
        .where(eq(domainStates.siteId, siteId))
        .limit(1);
    return rows[0]?.cadence ?? 'weekly';
}
/** Period-based `checkedAt`: midnight-UTC of the period start. */
function deriveCheckedAt(cadence: 'weekly' | 'daily', now: Date): Date {
    if (cadence === 'daily') {
        const y = now.getUTCFullYear();
        const m = now.getUTCMonth();
        const d = now.getUTCDate();
        return new Date(Date.UTC(y, m, d));
    }
    // Weekly period: floor to Monday 00:00 UTC.
    const cloned = new Date(now.getTime());
    const day = cloned.getUTCDay() || 7;
    cloned.setUTCHours(0, 0, 0, 0);
    cloned.setUTCDate(cloned.getUTCDate() - (day - 1));
    return cloned;
}
interface CheckOutcome {
    result: RankCheckResult;
    source: 'fresh' | 'cache';
    /** Alt-engine provider provenance; absent on the byte-identical Google path. */
    observationMeta?: ObservationMeta;
    /**
     * Domain-independent SERP-feature snapshot from the SAME payload
     * this check already fetched (or the cache row that served it). `null` =
     * no signal available for this check; the processor then writes NO
     * observation rather than a fabricated empty one.
     */
    features: SerpFeatureSnapshot | null;
    /** Top-organic set backing the observation; `[]` when the path had none. */
    topResults: SerpTopResult[];
}
async function checkOne(target: ResolvedTarget, accountId: string, deps: RankProcessorDeps, checkedAt: Date, cacheTtlMs: number): Promise<CheckOutcome> {
    // The vendor-neutral `checkRank` seam returns a result that is already
    // matched to this caller's domain. It cannot safely populate or join the
    // domain-independent SERP cache. Keep the fallback live and archive its
    // spend privately, but never let one domain poison another domain's read.
    if (!deps.provider.liveSerp &&
        !(deps.provider.postSerpTask && deps.provider.fetchSerpResult)) {
        const { value: fetched, costMicros } = await captureVendorCost(() => callProviderForItems(target.input, deps));
        // The provider capability guard above makes checkRank the only possible
        // branch in callProviderForItems, where `direct` is always populated.
        const direct = fetched.direct!;
        const topResults = serpItemsToTopResults(fetched.items);
        if (deps.archive) {
            await deps.archive({
                capability: 'rank',
                operation: 'serp-direct',
                params: {
                    keyword: target.input.keyword,
                    domain: target.input.domain,
                    locationCode: target.input.locationCode,
                    languageCode: target.input.languageCode,
                    device: target.input.device,
                },
                payload: direct,
                accountId,
                costMicros,
                fetchedAt: direct.checkedAt,
            });
        }
        return {
            // This branch is selected only for the direct provider seam.
            result: direct,
            source: 'fresh',
            features: fetched.featuresBlock,
            topResults,
        };
    }
    const cacheKey = computeSerpCacheKey({
        phrase: target.input.keyword,
        locationCode: target.input.locationCode,
        languageCode: target.input.languageCode,
        device: target.input.device,
    });
    const now = checkedAt;
    if (deps.cache) {
        const cached = await deps.cache.read(cacheKey, now);
        if (cached) {
            const items = topResultsToSerpItems(cached.topResults);
            const result: RankCheckResult = {
                ...matchDomainInSerp(items, target.input.domain, cached.fetchedAt),
                aiOverview: matchDomainInAiOverview(cached.aiOverview, target.input.domain),
            };
            return {
                result,
                source: 'cache',
                features: cached.features,
                topResults: cached.topResults,
            };
        }
    }
    // Miss: single-flight the vendor fetch. Fetch, write cache, derive position.
    return singleFlightFetch(target, deps, cacheKey, now, cacheTtlMs);
}
interface SharedSerpFlightOutcome {
    topResults: SerpTopResult[];
    aiOverview: ProviderSerpAiOverview | null;
    features: SerpFeatureSnapshot | null;
    fetchedAt: Date;
    origin: 'fresh' | 'cache';
}
function deriveGoogleCheckOutcome(target: ResolvedTarget, shared: SharedSerpFlightOutcome, source: 'fresh' | 'cache'): CheckOutcome {
    const items = topResultsToSerpItems(shared.topResults);
    return {
        result: {
            ...matchDomainInSerp(items, target.input.domain, shared.fetchedAt),
            aiOverview: matchDomainInAiOverview(shared.aiOverview, target.input.domain),
        },
        source,
        features: shared.features,
        topResults: shared.topResults,
    };
}
async function singleFlightFetch(target: ResolvedTarget, deps: RankProcessorDeps, cacheKey: string, now: Date, cacheTtlMs: number): Promise<CheckOutcome> {
    const doFetch = async (): Promise<SharedSerpFlightOutcome> => {
        // Re-read inside the lock. The shipped in-process single-flight shares
        // one Promise between concurrent callers, while this repository seam also
        // supports a future distributed lock where another worker can populate
        // the row between the outer miss and lock acquisition. Preserve that
        // late hit as cache provenance instead of misreporting avoided spend as a
        // fresh vendor request.
        if (deps.cache) {
            const cached = await deps.cache.read(cacheKey, now);
            if (cached) {
                return {
                    aiOverview: cached.aiOverview,
                    features: cached.features,
                    topResults: cached.topResults,
                    fetchedAt: cached.fetchedAt,
                    origin: 'cache',
                };
            }
        }
        // Capture spans both provider branches (two-step task API and the
        // checkRank fallback) — the DataForSEO choke point records into it.
        const { value: fetched, costMicros } = await captureVendorCost(() => callProviderForItems(target.input, deps));
        const topResults = serpItemsToTopResults(fetched.items);
        if (deps.cache) {
            const expiresAt = new Date(now.getTime() + cacheTtlMs);
            await deps.cache.write({
                cacheKey,
                topResults,
                aiOverview: fetched.aiOverviewBlock,
                features: fetched.featuresBlock,
                costMicros,
                fetchedAt: now,
                expiresAt,
                params: {
                    phrase: target.input.keyword,
                    locationCode: target.input.locationCode,
                    languageCode: target.input.languageCode,
                    device: target.input.device,
                },
            });
        }
        return {
            aiOverview: fetched.aiOverviewBlock,
            features: fetched.featuresBlock,
            topResults,
            fetchedAt: now,
            origin: 'fresh',
        };
    };
    if (deps.cache) {
        const flight = await deps.cache.withSingleFlightLockLeaderAware(cacheKey, doFetch);
        return deriveGoogleCheckOutcome(target, flight.value, flight.joined ? 'cache' : flight.value.origin);
    }
    const fetched = await doFetch();
    return deriveGoogleCheckOutcome(target, fetched, fetched.origin);
}
interface ProviderFetch {
    items: SerpItem[];
    /** Domain-independent AI Overview block — cacheable. `null` = no signal. */
    aiOverviewBlock: ProviderSerpAiOverview | null;
    /**
     * Domain-independent SERP-feature snapshot from the SAME vendor
     * response. `null` = the provider path carried no feature signal.
     */
    featuresBlock: SerpFeatureSnapshot | null;
    /**
     * Set when the vendor-neutral checkRank() fallback ran: the provider
     * already produced the per-domain result (including its own per-domain
     * `aiOverview`), so the caller returns it as-is instead of re-deriving.
     */
    direct?: RankCheckResult;
}
async function callProviderForItems(input: RankCheckInput, deps: RankProcessorDeps): Promise<ProviderFetch> {
    // DataForSEO's standard task path returns the configured depth-100 result
    // at the standard-queue page price. Prefer it whenever available: the
    // synchronous live endpoint is capped at 20–30 because its per-page price
    // is higher and therefore cannot truthfully provide top-100 rank tracking
    // at the same vendor cost.
    if (deps.provider.postSerpTask && deps.provider.fetchSerpResult) {
        const { vendorTaskId } = await deps.provider.postSerpTask(input);
        const { items, aiOverview, features } = await deps.provider.fetchSerpResult(vendorTaskId);
        return {
            items,
            aiOverviewBlock: aiOverview ?? null,
            featuresBlock: features ?? null,
        };
    }
    // Providers without the standard task pair may still offer a synchronous
    // domain-independent SERP. It remains cacheable, but its configured depth
    // defines the honest observation bound.
    if (deps.provider.liveSerp) {
        const { items, aiOverview, features } = await deps.provider.liveSerp(input);
        return {
            items,
            aiOverviewBlock: aiOverview ?? null,
            featuresBlock: features ?? null,
        };
    }
    // The vendor-neutral fallback cannot participate in cross-user caching.
    const result = await deps.provider.checkRank(input);
    if (result.serpTopUrls && result.serpTopUrls.length > 0) {
        return {
            items: result.serpTopUrls.map((url, i) => ({
                domain: hostOf(url),
                url,
                rankGroup: i + 1,
                rankAbsolute: i + 1,
            })),
            // Per-domain signal cannot be reversed into the domain-independent
            // block — cache carries no AI signal on this path.
            aiOverviewBlock: null,
            featuresBlock: result.serpFeatures ?? null,
            direct: result,
        };
    }
    /* c8 ignore next 15 -- degenerate fallback: only reached when a fake/custom RankProvider returns a position + foundUrl but no serpTopUrls (never the case for the shipped DataForSEO adapter). Kept so the cache still gets a single-hit seed instead of being skipped entirely. */
    if (result.position !== null && result.foundUrl) {
        return {
            items: [
                {
                    domain: hostOf(result.foundUrl),
                    url: result.foundUrl,
                    rankGroup: result.position,
                    rankAbsolute: result.position,
                },
            ],
            aiOverviewBlock: null,
            featuresBlock: result.serpFeatures ?? null,
            direct: result,
        };
    }
    return {
        items: [],
        aiOverviewBlock: null,
        featuresBlock: result.serpFeatures ?? null,
        direct: result,
    };
}
/* c8 ignore next 8 -- only called from the degenerate cache-seed fallback above (also c8-ignored); kept co-located so both survive together if the fallback ever ships. */
function hostOf(url: string): string {
    try {
        return normalizeSerpDomain(new URL(url).hostname);
    }
    catch {
        return normalizeSerpDomain(url);
    }
}
function serpItemsToTopResults(items: SerpItem[]): SerpTopResult[] {
    return items.slice(0, 100).map((it) => ({
        domain: it.domain,
        url: it.url,
        rankGroup: it.rankGroup,
        rankAbsolute: it.rankAbsolute,
    }));
}
function topResultsToSerpItems(top: SerpTopResult[]): SerpItem[] {
    return top.map((t) => ({
        domain: t.domain,
        url: t.url,
        rankGroup: t.rankGroup,
        rankAbsolute: t.rankAbsolute,
    }));
}
/**
 * Latest ranking strictly BEFORE `before` for the keyword. `undefined` =
 * no prior row (first check ever) — distinct from a prior null position
 * ("checked, not ranked").
 */
async function loadPreviousPosition(db: Db, keywordId: string, before: Date): Promise<{
    position: number | null;
} | undefined> {
    const rows = await db
        .select({ position: rankingsTable.position })
        .from(rankingsTable)
        .where(and(eq(rankingsTable.keywordId, keywordId), lt(rankingsTable.checkedAt, before)))
        .orderBy(desc(rankingsTable.checkedAt))
        .limit(1);
    return rows[0];
}
async function persistRanking(db: Db, input: {
    keywordId: string;
    result: RankCheckResult;
    checkedAt: Date;
    source: 'fresh' | 'cache';
    /** Denormalized engine tag. Defaults to the shipped `google`. */
    engine?: RankEngineKind;
    /** Provider provenance for alt engines; null on Google/legacy rows. */
    observationMeta?: ObservationMeta | null;
}): Promise<{
    inserted: boolean;
    rankingId: string | null;
}> {
    const rows = await db
        .insert(rankingsTable)
        .values({
        engine: input.engine ?? 'google',
        keywordId: input.keywordId,
        position: input.result.position,
        rankAbsolute: extractAbsolute(input.result),
        foundUrl: input.result.foundUrl ?? null,
        aiOverviewPresent: input.result.aiOverview?.present ?? null,
        aiCited: input.result.aiOverview?.cited ?? null,
        aiCitedUrl: input.result.aiOverview?.citedUrl ?? null,
        checkedAt: input.checkedAt,
        source: input.source,
        observationMeta: input.observationMeta ?? null,
    })
        .onConflictDoNothing({
        target: [rankingsTable.keywordId, rankingsTable.checkedAt],
    })
        .returning({ id: rankingsTable.id });
    return { inserted: rows.length > 0, rankingId: rows[0]?.id ?? null };
}
function extractAbsolute(result: RankCheckResult): number | null {
    return result.position;
}
// ---------------------------------------------------------------------------
// Rank-drop detection — ONE engine-agnostic path
// ---------------------------------------------------------------------------
interface RankDropContext {
    accountId: string;
    siteId: string;
    keywordId: string;
    keyword: string;
    siteUrl: string;
    /** `undefined` = no prior row (first check ever) — never a drop. */
    previous: {
        position: number | null;
    } | undefined;
    /** Only a row we actually inserted can fire the hook (retries never re-fire). */
    inserted: boolean;
    /** Present iff `inserted` is true. */
    rankingId: string | null;
    currentPosition: number | null;
    candidateObservedAt: Date;
    input: RankCheckInput;
    engine: RankEngineKind;
    engineTarget: string | null;
}
/**
 * Fire the rank-drop hook when — and only when — a freshly inserted row is a
 * genuine drop from a prior observation. Engine-agnostic by construction: it
 * reads the same `detectRankDrop` predicate over whichever engine's rows the
 * caller just wrote, and the hook can never fail the rank job.
 */
async function maybeFireRankDrop(deps: RankProcessorDeps, ctx: RankDropContext): Promise<void> {
    if ((!deps.confirmRankDrop && !deps.onRankDrop) ||
        !ctx.inserted ||
        ctx.previous === undefined ||
        !detectRankDrop(ctx.previous.position, ctx.currentPosition)) {
        return;
    }
    try {
        const event = {
            accountId: ctx.accountId,
            siteId: ctx.siteId,
            keywordId: ctx.keywordId,
            keyword: ctx.keyword,
            previousPosition: ctx.previous.position as number,
            currentPosition: ctx.currentPosition,
            siteUrl: ctx.siteUrl,
        };
        if (deps.confirmRankDrop) {
            // `inserted` guarantees the RETURNING id is present. Keep the guard
            // explicit so a future repository regression fails closed.
            if (ctx.rankingId === null)
                return;
            await deps.confirmRankDrop({
                accountId: ctx.accountId,
                siteId: ctx.siteId,
                siteUrl: ctx.siteUrl,
                keywordId: ctx.keywordId,
                keyword: ctx.keyword,
                rankingId: ctx.rankingId,
                previousPosition: ctx.previous.position as number,
                candidatePosition: ctx.currentPosition,
                candidateObservedAt: ctx.candidateObservedAt,
                locationCode: ctx.input.locationCode,
                languageCode: ctx.input.languageCode,
                device: ctx.input.device,
                domain: ctx.input.domain,
                engine: ctx.engine,
                engineTarget: ctx.engineTarget,
            });
        }
        else {
            await deps.onRankDrop!(event);
        }
    }
    catch (hookErr) {
        deps.logger.warn({
            siteId: ctx.siteId,
            keywordId: ctx.keywordId,
            err: (hookErr as Error).message,
        }, 'rank-drop hook failed — job continues');
    }
}
// ---------------------------------------------------------------------------
// Alt engines — Bing / YouTube / Amazon
// ---------------------------------------------------------------------------
interface AltTargetRunArgs {
    target: ResolvedTarget;
    engine: AltRankEngine;
    deps: RankProcessorDeps;
    payload: RankJob;
    siteUrl: string;
    checkedAt: Date;
    now: Date;
    cacheTtlMs: number;
}
type AltTargetOutcome = {
    kind: 'error';
    rethrow?: ProviderError;
} | {
    kind: 'ok';
    position: number | null;
    source: 'fresh' | 'cache';
};
/**
 * Run ONE accepted non-Google target: cache-or-vendor check → persist → drop
 * detection.
 *
 * A `ProviderError` retains nothing (no `rankings` row, no cache write). A
 * batch-wide error still bubbles so BullMQ retries the job.
 */
async function runAltEngineTarget(args: AltTargetRunArgs): Promise<AltTargetOutcome> {
    const { target, engine, deps, payload, checkedAt, now, cacheTtlMs } = args;
    try {
        const outcome = await checkAltEngineOne(target, engine, deps, checkedAt, cacheTtlMs);
        if (deps.db) {
            const previous = deps.onRankDrop === undefined && deps.confirmRankDrop === undefined
                ? undefined
                : await loadPreviousPosition(deps.db, target.keywordId, checkedAt);
            const { inserted, rankingId } = await persistRanking(deps.db, {
                keywordId: target.keywordId,
                result: outcome.result,
                checkedAt,
                source: outcome.source,
                engine,
                observationMeta: outcome.observationMeta ?? null,
            });
            await maybeFireRankDrop(deps, {
                accountId: payload.accountId,
                siteId: payload.siteId,
                keywordId: target.keywordId,
                keyword: target.input.keyword,
                siteUrl: args.siteUrl,
                previous,
                inserted,
                rankingId,
                currentPosition: outcome.result.position,
                candidateObservedAt: checkedAt,
                input: target.input,
                engine,
                engineTarget: target.engineTarget,
            });
        }
        return {
            kind: 'ok',
            position: outcome.result.position,
            source: outcome.source,
        };
    }
    catch (err) {
        if (err instanceof ProviderError) {
            const reason = rankFailureReason(err);
            const batchWide = isBatchWideFailure(err);
            deps.logger.warn({
                siteId: payload.siteId,
                keywordId: target.keywordId,
                engine,
                retryable: err.retryable,
                reason,
                batchWide,
                err: err.message,
            }, 'alt-engine rank check failed — no row written');
            if (deps.db) {
                // Only the attempted target — see `markCheckFailed`. Targets after
                // this one were never checked and must keep their true state.
                await markCheckFailed(deps.db, [target.keywordId], now, reason);
            }
            return batchWide ? { kind: 'error', rethrow: err } : { kind: 'error' };
        }
        throw err;
    }
}
/** Cache-or-vendor alt-engine check. */
async function checkAltEngineOne(target: ResolvedTarget, engine: AltRankEngine, deps: RankProcessorDeps, checkedAt: Date, cacheTtlMs: number): Promise<CheckOutcome> {
    const cacheKey = computeSerpCacheKey({
        phrase: target.input.keyword,
        locationCode: target.input.locationCode,
        languageCode: target.input.languageCode,
        device: target.input.device,
        engine,
    });
    const engineTarget = target.engineTarget ?? null;
    const matchRows = (rows: AltEngineRankRow[]): {
        position: number | null;
        foundUrl: string | null;
    } => engine === 'bing'
        ? matchHostInRows(rows, target.input.domain)
        : matchTokenInRows(rows, engineTarget);
    const cachedToShared = (cached: NonNullable<Awaited<ReturnType<SerpCacheRepo['read']>>>): SharedAltEngineFlightOutcome => ({
        topResults: cached.topResults,
        fetchedAt: cached.fetchedAt,
        origin: 'cache',
        ...(cached.observationMeta ? { observationMeta: cached.observationMeta } : {}),
    });
    const usableCacheRow = (cached: Awaited<ReturnType<SerpCacheRepo['read']>>): cached is NonNullable<typeof cached> => Boolean(cached &&
        (engine !== 'amazon' ||
            cached.observationMeta?.coverageNoteKey ===
                'observations.coverage.providerIndexRanking'));
    const deriveOutcome = (shared: SharedAltEngineFlightOutcome, source: 'fresh' | 'cache'): CheckOutcome => {
        const matched = matchRows(shared.topResults.map(toAltEngineRow));
        return {
            result: {
                position: matched.position,
                ...(matched.foundUrl === null ? {} : { foundUrl: matched.foundUrl }),
                checkedAt: shared.fetchedAt,
            },
            source,
            ...(shared.observationMeta ? { observationMeta: shared.observationMeta } : {}),
            features: null,
            topResults: shared.topResults,
        };
    };
    if (deps.cache) {
        const cached = await deps.cache.read(cacheKey, checkedAt, engine);
        if (usableCacheRow(cached)) {
            return deriveOutcome(cachedToShared(cached), 'cache');
        }
    }
    const doFetch = async (): Promise<SharedAltEngineFlightOutcome> => {
        // Re-read after acquiring leadership. This is required for a future
        // distributed lock and also preserves the correct cache provenance when
        // another writer fills the row between the outer miss and this task.
        if (deps.cache) {
            const cached = await deps.cache.read(cacheKey, checkedAt, engine);
            if (usableCacheRow(cached)) {
                return cachedToShared(cached);
            }
        }
        const { value: fetched, costMicros } = await captureVendorCost(() => deps.provider.checkAltEngineRank({
            engine,
            keyword: target.input.keyword,
            domain: target.input.domain,
            engineTarget,
            locationCode: target.input.locationCode,
            languageCode: target.input.languageCode,
            device: target.input.device,
        }));
        const topResults: SerpTopResult[] = fetched.rows.map((row) => ({
            domain: row.domain,
            url: row.url,
            rankGroup: row.rankGroup,
            rankAbsolute: row.rankAbsolute,
            matchToken: row.matchToken,
        }));
        if (deps.cache) {
            await deps.cache.write({
                cacheKey,
                topResults,
                aiOverview: null,
                features: null,
                costMicros,
                fetchedAt: checkedAt,
                expiresAt: new Date(checkedAt.getTime() + cacheTtlMs),
                engine,
                params: {
                    phrase: target.input.keyword,
                    locationCode: target.input.locationCode,
                    languageCode: target.input.languageCode,
                    device: target.input.device,
                    engine,
                },
                observationMeta: fetched.observationMeta,
            });
        }
        return {
            fetchedAt: fetched.checkedAt,
            origin: 'fresh',
            observationMeta: fetched.observationMeta,
            topResults,
        };
    };
    if (deps.cache) {
        const flight = await deps.cache.withSingleFlightLockLeaderAware(cacheKey, doFetch);
        return deriveOutcome(flight.value, flight.joined ? 'cache' : flight.value.origin);
    }
    const fetched = await doFetch();
    return deriveOutcome(fetched, fetched.origin);
}
interface SharedAltEngineFlightOutcome {
    topResults: SerpTopResult[];
    observationMeta?: ObservationMeta;
    fetchedAt: Date;
    origin: 'fresh' | 'cache';
}
function toAltEngineRow(row: SerpTopResult): AltEngineRankRow {
    return {
        domain: row.domain,
        url: row.url,
        rankGroup: row.rankGroup,
        rankAbsolute: row.rankAbsolute,
        matchToken: row.matchToken ?? null,
    };
}
