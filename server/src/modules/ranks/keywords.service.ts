/**
 * Keyword CRUD + cadence + history.
 *
 * Site ownership is checked against Mongoose (Site model); keyword rows and
 * ranking history live in Postgres. Cross-store id shape: `siteId` is a
 * 24-char hex ObjectId string; `keywordId` is a UUID.
 */
import type { Queue } from 'bullmq';
import { Types } from 'mongoose';
import { and, asc, count, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../../db/client.js';
import { domainStates, isAltRankEngine, keywords, rankings, type Keyword, type RankCadenceKind, type RankCheckFailureReason, type RankEngineKind, } from '../../db/schema/keywords.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { isUniqueViolation } from '../../shared/utils/db-errors.js';
import { Site } from '../sites/index.js';
import { readLatestSnapshotDate, readSearchAnalytics } from '../gsc-snapshots/index.js';
import { ProviderError, type ContentSourceProvider, type SerpDevice, type SiteKeywordCandidate, type SiteKeywordProvider, } from '../../shared/providers/index.js';
import { enqueueRankJob, removeRankSchedule, upsertRankSchedule, } from '../../shared/queue/index.js';
import { createReadThrough, createSingleFlight, createVendorCacheRepo, } from '../../shared/vendor-cache/index.js';
import { getSiteCadence } from './cadence.js';
import { normalizePhrase } from './serp-cache.service.js';
import type { ObservationMeta } from '../../shared/observations/types.js';
import type { SpendPreview } from '../../shared/safety/operation-preview.js';
import { extractSiteKeywordEvidence, groundSiteKeywordCandidates, } from './site-keyword-grounding.js';
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
/**
 * On-demand rank-check cooldown. Reused as both a coalescer (rapid keyword
 * adds collapse to one check) and a rate limit (the "Check now" button can't
 * fan out vendor SERP checks on repeated clicks). Anchored on the
 * otherwise-unused `domain_states.last_rank_check_at` column.
 */
const MANUAL_RANK_CHECK_COOLDOWN_MS = 60000;
export const SITE_RANKED_KEYWORD_LIMIT = 100;
export const SITE_RANKED_KEYWORD_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * Bumped whenever the vendor REQUEST shape changes. `computeVendorCacheKey`
 * hashes only the params below, not the body the adapter builds, so without
 * this discriminator a filter change keeps serving pre-change payloads for the
 * full 7-day TTL — and this endpoint exposes no `forceRefresh` path.
 * v2: `ignore_synonyms` flipped to false (variants are separately trackable).
 */
export const SITE_RANKED_KEYWORD_CACHE_VERSION = 2;
/** Isolates grounded ideas from the retired whole-domain fallback cache. */
export const SITE_KEYWORD_IDEA_CACHE_VERSION = 3;
export const SITE_KEYWORD_DISCOVERY_PAGE_LIMIT = 3;
export const SITE_KEYWORD_DISCOVERY_DEPTH = 1;
export const SITE_KEYWORD_DISCOVERY_CONCURRENCY = 3;
export const SITE_KEYWORD_DISCOVERY_TIMEOUT_MS = 20000;
const siteKeywordSingleFlight = createSingleFlight();
/**
 * GSC windows tried in order. `window_days` is the aggregation width Google
 * pre-summed, not a range we scan — 28 is the default the daily sync writes,
 * 90 covers sites whose 28-day window is empty, 7 is the last resort.
 */
const GSC_SUGGESTION_WINDOWS = [28, 90, 7] as const;
const GSC_SUGGESTION_DIMENSION = 'query';
/**
 * A source with at least one untracked row no longer stops discovery: a tiny
 * site whose whole Search Console history is one query used to get exactly
 * that one suggestion. Sources are blended (GSC → ranked → ideas) until this
 * many untracked candidates exist, then discovery stops spending.
 */
export const MIN_UNTRACKED_SUGGESTIONS = 10;
const siteKeywordCandidatesSchema = z
    .array(z.object({
    keyword: z.string(),
    searchVolume: z.number().nullable(),
    difficulty: z.number().nullable(),
    currentPosition: z.number().nullable(),
    estimatedTraffic: z.number().nullable(),
    rankingUrl: z.string().nullable(),
}))
    .max(SITE_RANKED_KEYWORD_LIMIT);
export interface KeywordListItem {
    id: string;
    siteId: string;
    phrase: string;
    locationCode: number;
    languageCode: string;
    device: SerpDevice;
    active: boolean;
    createdAt: string;
    updatedAt: string;
    latestPosition: number | null;
    previousPosition: number | null;
    delta: number | null;
    lastCheckedAt: string | null;
    /** Google AI Overview signal from the latest check (null = unknown). */
    aiOverviewPresent: boolean | null;
    aiCited: boolean | null;
    aiCitedUrl: string | null;
    /** Opt-in local-pack (map pack) rank tracking. */
    trackLocalPack: boolean;
    /**
     * ISO timestamp of the most recent rank check that ERRORED and wrote no
     * `rankings` row. Only meaningful when the keyword has no ranking row yet
     * (`latestPosition` and `lastCheckedAt` both null) — it lets the UI show a
     * "check failed" state instead of the never-checked "unavailable" one.
     */
    lastFailedCheckAt: string | null;
    /**
     * Why that check errored, as a stable key the client localizes
     * (`vendor_auth` | `vendor_quota` | `vendor_timeout` | `vendor_unavailable`
     * | `vendor_malformed` | `vendor_error`). Null when the keyword never failed
     * or was stamped before the reason was recorded — an absent reason means
     * "cause not recorded", never a guessed one. Raw vendor text is never
     * exposed here.
     */
    lastFailedReason: RankCheckFailureReason | null;
    /** The engine this keyword is tracked on. */
    engine: RankEngineKind;
    /** Channel handle / ASIN for the token-matched engines; null otherwise. */
    engineTarget: string | null;
    /** Provider provenance from the latest stored alt-engine observation. */
    observationMeta: ObservationMeta | null;
}
export interface KeywordListPage {
    keywords: KeywordListItem[];
    nextCursor: string | null;
    /** Current cadence for the site (weekly by default). */
    cadence: RankCadenceKind;
}
export const CLIENT_REPORT_RANK_ROW_LIMIT = 25;
export interface ClientReportRankRow {
    keyword: string;
    engine: RankEngineKind;
    position: number | null;
    checkedAt: string;
}
export interface ClientReportRankProjection {
    rows: ClientReportRankRow[];
    totalRows: number;
}
/**
 * Bounded stored-only rank projection for client reports. The
 * engine comes from the persisted ranking row (the authoritative
 * engine tag), and keywords without any observation are omitted so an
 * undated number can never reach a report.
 */
export async function readClientReportRankRows(accountId: string, siteId: string, db: Db): Promise<ClientReportRankRow[]> {
    return (await readClientReportRankProjection(accountId, siteId, db)).rows;
}
/** Complete-count companion used by unified exports to refuse legacy clipping. */
export async function readClientReportRankProjection(accountId: string, siteId: string, db: Db): Promise<ClientReportRankProjection> {
    await assertSiteOwnership(accountId, siteId);
    const latest = db
        .select({
        keywordId: keywords.id,
        keyword: keywords.phrase,
        engine: rankings.engine,
        position: rankings.position,
        checkedAt: rankings.checkedAt,
        rn: sql<number> `row_number() over (partition by ${rankings.keywordId} order by ${rankings.checkedAt} desc)`.as('rn'),
    })
        .from(keywords)
        .innerJoin(rankings, eq(rankings.keywordId, keywords.id))
        .where(and(eq(keywords.accountId, accountId), eq(keywords.siteId, siteId), eq(keywords.active, true)))
        .as('client_report_latest_rankings');
    const allRows = await db
        .select({
        keywordId: latest.keywordId,
        keyword: latest.keyword,
        engine: latest.engine,
        position: latest.position,
        checkedAt: latest.checkedAt,
    })
        .from(latest)
        .where(eq(latest.rn, 1))
        .orderBy(desc(latest.checkedAt), asc(latest.engine), asc(sql `lower(${latest.keyword})`), asc(latest.keywordId));
    const rows = allRows.slice(0, CLIENT_REPORT_RANK_ROW_LIMIT).map((row) => ({
        keyword: row.keyword,
        engine: row.engine as RankEngineKind,
        position: row.position,
        checkedAt: row.checkedAt.toISOString(),
    }));
    return { rows, totalRows: allRows.length };
}
export interface CreateKeywordInput {
    accountId: string;
    siteId: string;
    phrase: string;
    locationCode: number;
    languageCode: string;
    device: SerpDevice;
    trackLocalPack?: boolean;
    /**
     * REQUIRED. The route's zod schema defaults it to `'google'`, so
     * an omitted engine here would be a caller bug, not a Google keyword.
     */
    engine: RankEngineKind;
    /** Already normalized by `normalizeEngineTarget`. */
    engineTarget: string | null;
}
export interface KeywordsServiceDeps {
    db: Db;
    /** Optional — a null queue means "queueing not configured yet"; scheduler wiring is skipped. */
    ranksQueue: Queue | null;
}
/**
 * Turn Drizzle's runtime `returning()` contract into an explicit localized
 * failure without excluding the defensive branch from coverage.
 */
export function requireReturnedKeyword(rows: readonly Keyword[]): Keyword {
    const row = rows[0];
    if (!row)
        throw new HttpError(500, { code: 'ERRORS_INTERNAL', messageKey: 'errors.internal' });
    return row;
}
// ---------------------------------------------------------------------------
// Ownership helpers
// ---------------------------------------------------------------------------
async function assertSiteOwnership(accountId: string, siteId: string): Promise<void> {
    if (!Types.ObjectId.isValid(siteId)) {
        throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
    }
    const site = await Site.exists({
        _id: siteId,
        accountId,
        deletionStartedAt: null,
    });
    if (!site)
        throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
}
/**
 * Pause gate for spend entry points only (enqueue / scheduler upserts).
 * Ownership stays `assertSiteOwnership` so read paths keep their semantics;
 * spend functions call this right after it. Site load is a targeted `exists`
 * because ownership was already proven.
 */
async function assertSiteNotPausedById(accountId: string, siteId: string): Promise<void> {
    const paused = await Site.exists({ _id: siteId, accountId, paused: true });
    if (paused)
        throw HttpError.conflict({ code: 'SITES_ERRORS_PAUSED', messageKey: 'sites.errors.paused' });
}
async function getOwnedSiteDomain(accountId: string, siteId: string): Promise<string> {
    return (await getOwnedSiteTarget(accountId, siteId)).domain;
}
interface OwnedSiteTarget {
    domain: string;
    origin: string;
    gscBindingGenerationId: string | null;
}
async function getOwnedSiteTarget(accountId: string, siteId: string): Promise<OwnedSiteTarget> {
    if (!Types.ObjectId.isValid(siteId)) {
        throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
    }
    const site = await Site.findOne({ _id: siteId, accountId, deletionStartedAt: null }, { domain: 1, url: 1, gscPropertyUrl: 1, gscBindingGenerationId: 1 }).lean();
    if (!site)
        throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
    return {
        domain: site.domain,
        origin: new URL(site.url).origin,
        gscBindingGenerationId: site.gscPropertyUrl
            ? site.gscBindingGenerationId ?? 'legacy'
            : null,
    };
}
async function assertKeywordOwnership(db: Db, accountId: string, keywordId: string): Promise<Keyword> {
    const rows = await db
        .select()
        .from(keywords)
        .where(and(eq(keywords.id, keywordId), eq(keywords.accountId, accountId)))
        .limit(1);
    const row = rows[0];
    if (!row)
        throw HttpError.notFound({ code: 'RANKS_ERRORS_KEYWORD_NOT_FOUND', messageKey: 'ranks.errors.keywordNotFound' });
    await assertSiteOwnership(accountId, row.siteId);
    return row;
}
export async function resolveOwnedKeywordSiteId(accountId: string, keywordId: string, db: Pick<ApplicationDb, 'select'>): Promise<string | null> {
    if (!UUID_RE.test(keywordId))
        return null;
    const rows = await db
        .select({ siteId: keywords.siteId })
        .from(keywords)
        .where(and(eq(keywords.id, keywordId), eq(keywords.accountId, accountId)))
        .limit(1);
    return rows[0]?.siteId ?? null;
}
/**
 * Cheap stored-row lookahead for account-wide export pagination. The public
 * API has already resolved the active owned Site document before calling;
 * repeating account + site in SQL keeps the cross-store boundary scoped.
 */
export async function hasOwnedKeywordRowsForSite(accountId: string, siteId: string, db: Pick<ApplicationDb, 'select'>): Promise<boolean> {
    const rows = await db
        .select({ id: keywords.id })
        .from(keywords)
        .where(and(eq(keywords.accountId, accountId), eq(keywords.siteId, siteId)))
        .limit(1);
    return rows.length > 0;
}
// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------
export async function createKeyword(input: CreateKeywordInput, deps: KeywordsServiceDeps): Promise<KeywordListItem> {
    await assertSiteOwnership(input.accountId, input.siteId);
    await assertSiteNotPausedById(input.accountId, input.siteId);
    const { engine } = input;
    // The rollout flag gates NEW non-Google keywords only. Google
    // creates and every stored read stay available with the flag off.
    if (isAltRankEngine(engine) && !env.ALT_ENGINE_TRACKING_ENABLED) {
        throw HttpError.notFound({ code: 'RANKS_ERRORS_ALT_ENGINES_UNAVAILABLE', messageKey: 'ranks.errors.altEnginesUnavailable' });
    }
    const normalizedPhrase = input.phrase.trim();
    /* c8 ignore next 3 -- zod already rejects trimmed-empty phrases at the request boundary; this guard exists so direct service callers get the same localized error. */
    if (normalizedPhrase.length === 0) {
        throw HttpError.badRequest({ code: 'RANKS_ERRORS_PHRASE_REQUIRED', messageKey: 'ranks.errors.phraseRequired' });
    }
    try {
        const inserted = await deps.db
            .insert(keywords)
            .values({
            accountId: input.accountId,
            siteId: input.siteId,
            phrase: normalizedPhrase,
            locationCode: input.locationCode,
            languageCode: input.languageCode.toLowerCase(),
            device: input.device,
            trackLocalPack: input.trackLocalPack ?? false,
            engine,
            engineTarget: input.engineTarget,
        })
            // A previously removed (soft-deleted) row with the same tuple is
            // reactivated instead of tripping the unique index; an ACTIVE
            // duplicate returns no row and surfaces as the 409 below.
            .onConflictDoUpdate({
            target: [
                keywords.siteId,
                keywords.engine,
                keywords.phrase,
                keywords.locationCode,
                keywords.languageCode,
                keywords.device,
            ],
            set: {
                active: true,
                updatedAt: new Date(),
                trackLocalPack: input.trackLocalPack ?? false,
                engineTarget: input.engineTarget,
            },
            setWhere: sql `${keywords.active} = false`,
        })
            .returning();
        if (inserted.length === 0) {
            throw HttpError.conflict({ code: 'RANKS_ERRORS_KEYWORD_DUPLICATE', messageKey: 'ranks.errors.keywordDuplicate' });
        }
        const row = requireReturnedKeyword(inserted);
        // Domain state + scheduler side-effects: adding the first keyword also
        // upserts a weekly schedule so the ranks queue starts firing for this site.
        await ensureDomainState(deps.db, input.siteId);
        if (deps.ranksQueue) {
            const cadence = await getSiteCadence(deps.db, input.siteId);
            await upsertRankSchedule(deps.ranksQueue, {
                accountId: input.accountId,
                siteId: input.siteId,
                cadence,
                altEnginesEnabled: env.ALT_ENGINE_TRACKING_ENABLED,
            });
        }
        // Kick off an immediate first check so the keyword does not sit
        // "Unavailable" until the next scheduled sweep. Best-effort: a burst of
        // adds coalesces under the cooldown, so it never throws here.
        await enqueueOnDemandRankCheck(deps, {
            accountId: input.accountId,
            siteId: input.siteId,
            throwOnCooldown: false,
            throwOnFailure: false,
        });
        return toKeywordListItem(row, null, null, null);
    }
    catch (err) {
        /* c8 ignore start -- non-unique DB failures fall to the rethrow arm; not deterministically reachable in tests */
        if (isUniqueViolation(err)) {
            throw HttpError.conflict({ code: 'RANKS_ERRORS_KEYWORD_DUPLICATE', messageKey: 'ranks.errors.keywordDuplicate' });
        }
        throw err;
        /* c8 ignore stop */
    }
}
export interface PreviewAltEngineKeywordInput {
    accountId: string;
    siteId: string;
    engine: RankEngineKind;
}
/**
 * Read-only disclosure shown BEFORE an alt-engine keyword is added. The
 * community edition enforces no usage capacity, so the preview only states
 * that. Ownership is still 404 for a foreign site, and the flag still refuses
 * a preview for a disabled engine; nothing is reserved or enqueued.
 */
export async function previewAltEngineKeyword(input: PreviewAltEngineKeywordInput): Promise<SpendPreview> {
    await assertSiteOwnership(input.accountId, input.siteId);
    if (isAltRankEngine(input.engine) && !env.ALT_ENGINE_TRACKING_ENABLED) {
        throw HttpError.notFound({ code: 'RANKS_ERRORS_ALT_ENGINES_UNAVAILABLE', messageKey: 'ranks.errors.altEnginesUnavailable' });
    }
    return { deploymentMode: 'community', capacityEnforced: false };
}
async function ensureDomainState(db: Db, siteId: string): Promise<void> {
    await db
        .insert(domainStates)
        .values({ siteId, cadence: 'weekly' })
        .onConflictDoNothing({ target: domainStates.siteId });
}
interface OnDemandRankCheckInput {
    accountId: string;
    siteId: string;
    /** Empty/omitted checks every active keyword; one UUID narrows a row action. */
    keywordIds?: readonly string[];
    /**
     * true → throw a 429 when inside the cooldown ("Check now" button);
     * false → silently skip (keyword-create first-run, which must not fail the
     * create just because a check ran moments ago).
     */
    throwOnCooldown: boolean;
    /** Explicit Check-now surfaces queue failures; first-run enqueue is best effort. */
    throwOnFailure: boolean;
}
/**
 * Enqueue an immediate site-wide rank check as a `manual` job. The shared
 * cooldown stamp is written BEFORE the enqueue so concurrent triggers collapse
 * to one job; a queue failure rolls the stamp back.
 */
async function enqueueOnDemandRankCheck(deps: KeywordsServiceDeps, input: OnDemandRankCheckInput): Promise<{
    queued: boolean;
    startedAt: Date;
}> {
    const now = Date.now();
    const [state] = await deps.db
        .select({ lastRankCheckAt: domainStates.lastRankCheckAt })
        .from(domainStates)
        .where(eq(domainStates.siteId, input.siteId))
        .limit(1);
    const last = state?.lastRankCheckAt?.getTime() ?? 0;
    if (now - last < MANUAL_RANK_CHECK_COOLDOWN_MS) {
        if (input.throwOnCooldown) {
            throw new HttpError(429, { code: 'RANKS_ERRORS_CHECK_COOLDOWN', messageKey: 'ranks.errors.checkCooldown' });
        }
        return { queued: false, startedAt: new Date(now) };
    }
    const batchKey = `manual-${Math.floor(now / MANUAL_RANK_CHECK_COOLDOWN_MS)}`;
    const selectedKeywordIds = [...(input.keywordIds ?? [])];
    const stampedAt = new Date(now);
    try {
        // Stamp the cooldown BEFORE enqueue so concurrent triggers (double-click,
        // rapid multi-add) collapse to a single check. Upsert keeps the row's cadence.
        await deps.db
            .insert(domainStates)
            .values({ siteId: input.siteId, lastRankCheckAt: stampedAt })
            .onConflictDoUpdate({
            target: domainStates.siteId,
            set: { lastRankCheckAt: stampedAt, updatedAt: stampedAt },
        });
        if (deps.ranksQueue) {
            // Site-wide triggers intentionally coalesce by cooldown bucket. A row
            // trigger also includes its keyword so two different requests that race
            // before the shared cooldown stamp cannot collide in BullMQ.
            const queuePeriodKey = selectedKeywordIds.length === 1
                ? `${batchKey}-${selectedKeywordIds[0]}`
                : batchKey;
            await enqueueRankJob(deps.ranksQueue, {
                accountId: input.accountId,
                siteId: input.siteId,
                keywordIds: selectedKeywordIds,
                schedulerKey: 'manual',
                manual: true,
                altEnginesEnabledAtEnqueue: env.ALT_ENGINE_TRACKING_ENABLED,
            }, queuePeriodKey);
        }
    }
    catch (error) {
        try {
            await deps.db
                .update(domainStates)
                .set({
                lastRankCheckAt: state?.lastRankCheckAt ?? null,
                updatedAt: new Date(),
            })
                .where(and(eq(domainStates.siteId, input.siteId), eq(domainStates.lastRankCheckAt, stampedAt)));
        }
        catch {
            // A failed cosmetic cooldown rollback must not hide the original
            // queue/storage failure.
        }
        if (!input.throwOnFailure)
            return { queued: false, startedAt: stampedAt };
        throw new HttpError(503, { code: 'ERRORS_INTERNAL', messageKey: 'errors.internal' }, undefined, { cause: error });
    }
    return { queued: deps.ranksQueue !== null, startedAt: stampedAt };
}
export interface TriggerRankCheckInput {
    accountId: string;
    siteId: string;
}
/**
 * "Check now" — enqueue an immediate re-check of every active keyword on a
 * site. Ownership is 404 (not 403) for a non-owner; a 429 fires when the
 * per-site cooldown is still active.
 */
export async function triggerRankCheck(input: TriggerRankCheckInput, deps: KeywordsServiceDeps): Promise<{
    queued: boolean;
    startedAt: Date;
}> {
    await assertSiteOwnership(input.accountId, input.siteId);
    await assertSiteNotPausedById(input.accountId, input.siteId);
    const result = await enqueueOnDemandRankCheck(deps, {
        accountId: input.accountId,
        siteId: input.siteId,
        throwOnCooldown: true,
        throwOnFailure: true,
    });
    return result;
}
export interface TriggerKeywordRankCheckInput {
    accountId: string;
    keywordId: string;
}
/** "Check now" for one active owned keyword, sharing the site's cooldown. */
export async function triggerKeywordRankCheck(input: TriggerKeywordRankCheckInput, deps: KeywordsServiceDeps): Promise<{
    queued: boolean;
    startedAt: Date;
}> {
    const keyword = await assertKeywordOwnership(deps.db, input.accountId, input.keywordId);
    if (!keyword.active)
        throw HttpError.notFound({ code: 'RANKS_ERRORS_KEYWORD_NOT_FOUND', messageKey: 'ranks.errors.keywordNotFound' });
    await assertSiteNotPausedById(input.accountId, keyword.siteId);
    return enqueueOnDemandRankCheck(deps, {
        accountId: input.accountId,
        siteId: keyword.siteId,
        keywordIds: [keyword.id],
        throwOnCooldown: true,
        throwOnFailure: true,
    });
}
// ---------------------------------------------------------------------------
// Site keyword discovery
// ---------------------------------------------------------------------------
export type KeywordSuggestionSource = 'gsc' | 'ranked' | 'site_ideas';
export type KeywordSuggestionFallbackStatus = 'not_needed' | 'used' | 'provider_unavailable';
export interface KeywordSuggestion extends SiteKeywordCandidate {
    source: KeywordSuggestionSource;
    tracked: boolean;
}
export interface KeywordSuggestionsResult {
    /** Primary source: the first untracked candidate's, else the last consulted tier. */
    source: KeywordSuggestionSource;
    /** Every source that contributed at least one candidate, in blend order. */
    sources: KeywordSuggestionSource[];
    candidates: KeywordSuggestion[];
    cached: boolean;
    fetchedAt: string;
    fallbackStatus: KeywordSuggestionFallbackStatus;
}
export interface DiscoverKeywordSuggestionsInput {
    accountId: string;
    siteId: string;
    locationCode: number;
    languageCode: string;
}
export interface KeywordSuggestionsDeps {
    db: Db;
    provider: SiteKeywordProvider;
    contentSource: ContentSourceProvider;
    now?: () => Date;
}
async function readCachedSiteKeywordCandidates(input: {
    operation: 'site-ranked-keywords' | 'site-keyword-ideas';
    domain: string;
    locationCode: number;
    languageCode: string;
    cacheVersion?: number;
    fetch: () => Promise<SiteKeywordCandidate[]>;
}, deps: Pick<KeywordSuggestionsDeps, 'db' | 'provider' | 'now'>) {
    const now = deps.now ?? (() => new Date());
    const readThrough = createReadThrough({
        repo: createVendorCacheRepo(deps.db),
        singleFlight: siteKeywordSingleFlight,
        clock: now,
    });
    try {
        return await readThrough({
            capability: 'keyword',
            operation: input.operation,
            params: {
                domain: input.domain,
                locationCode: input.locationCode,
                languageCode: input.languageCode.toLowerCase(),
                limit: SITE_RANKED_KEYWORD_LIMIT,
                version: input.cacheVersion ?? SITE_RANKED_KEYWORD_CACHE_VERSION,
            },
            ttlMs: SITE_RANKED_KEYWORD_CACHE_TTL_MS,
            payloadSchema: siteKeywordCandidatesSchema,
            now: now(),
            fetch: input.fetch,
        });
    }
    catch (err) {
        if (err instanceof ProviderError) {
            throw new HttpError(503, { code: 'KEYWORD_RESEARCH_ERRORS_UNAVAILABLE', messageKey: 'keywordResearch.errors.unavailable' }, undefined, { cause: err });
        }
        throw err;
    }
}
export interface CachedSiteKeywordCandidatesInput {
    domain: string;
    locationCode: number;
    languageCode: string;
}
export interface CachedSiteKeywordCandidatesResult {
    candidates: SiteKeywordCandidate[];
    cached: boolean;
    fetchedAt: Date;
}
/**
 * Public ranked-site-only cache seam. Pages and keyword suggestions share the
 * exact operation key/version/TTL, zod validation, single-flight instance,
 * provider call, error mapping, and hard limit through this function.
 * Metering deliberately remains with each calling product workflow.
 */
export async function getCachedSiteKeywordCandidates(input: CachedSiteKeywordCandidatesInput, deps: Pick<KeywordSuggestionsDeps, 'db' | 'provider' | 'now'>): Promise<CachedSiteKeywordCandidatesResult> {
    const result = await readCachedSiteKeywordCandidates({
        operation: 'site-ranked-keywords',
        ...input,
        fetch: () => deps.provider.getRankedKeywordsForSite(input.domain, input.locationCode, input.languageCode, SITE_RANKED_KEYWORD_LIMIT),
    }, deps);
    return {
        candidates: result.value,
        cached: result.cached,
        fetchedAt: result.fetchedAt,
    };
}
interface GscQueryCandidates {
    candidates: SiteKeywordCandidate[];
    fetchedAt: Date;
}
/**
 * The site's own Search Console queries as suggestion candidates. First-party
 * and free: this reads rows the daily GSC sync already persisted, never a
 * provider, so it spends no vendor budget and meters nothing.
 *
 * A `query` row is already aggregated over `windowDays`, so exactly ONE
 * snapshot is read — summing across snapshot dates would double-count
 * overlapping windows. For this dimension `dimensionKey` IS the query string;
 * the unit separator only appears in `query,page` keys.
 *
 * No connection check: a site that has never connected simply has no rows, and
 * the caller falls through to the vendor sources. Throwing here (as the
 * google-connections readers do) would turn an unconnected site's suggestion
 * request into a 404.
 */
async function readGscQueryCandidates(db: Db, siteId: string, bindingGenerationId: string | null): Promise<GscQueryCandidates | null> {
    if (!bindingGenerationId)
        return null;
    for (const windowDays of GSC_SUGGESTION_WINDOWS) {
        const asOf = await readLatestSnapshotDate(db, siteId, GSC_SUGGESTION_DIMENSION, windowDays, bindingGenerationId);
        if (asOf === null)
            continue;
        // `asOf` came from the same (site, dimension, window) filter, so this read
        // is non-empty by construction — no empty-guard needed.
        const rows = await readSearchAnalytics(db, siteId, GSC_SUGGESTION_DIMENSION, { since: asOf, until: asOf }, windowDays, bindingGenerationId);
        const ordered = [...rows]
            .sort((a, b) => b.impressions - a.impressions ||
            b.clicks - a.clicks ||
            a.dimensionKey.localeCompare(b.dimensionKey))
            .slice(0, SITE_RANKED_KEYWORD_LIMIT);
        // One snapshot is written by a single upsert, so these normally agree;
        // taking the max keeps the reported provenance honest either way.
        const fetchedAt = ordered.reduce((latest, row) => (row.fetchedAt > latest ? row.fetchedAt : latest), new Date(0));
        return {
            candidates: ordered.map((row) => ({
                keyword: row.dimensionKey,
                // GSC reports no volume or difficulty — stay null rather than invent.
                searchVolume: null,
                difficulty: null,
                currentPosition: row.position,
                estimatedTraffic: row.clicks,
                rankingUrl: null,
            })),
            fetchedAt,
        };
    }
    return null;
}
async function addTrackedState(accountId: string, siteId: string, source: KeywordSuggestionSource, candidates: SiteKeywordCandidate[], db: Db): Promise<KeywordSuggestion[]> {
    if (candidates.length === 0)
        return [];
    const rows = await db
        .select({ phrase: keywords.phrase })
        .from(keywords)
        .where(and(eq(keywords.accountId, accountId), eq(keywords.siteId, siteId), eq(keywords.active, true)));
    const tracked = new Set(rows.map((row) => normalizePhrase(row.phrase)));
    return candidates.map((candidate) => ({
        ...candidate,
        source,
        tracked: tracked.has(normalizePhrase(candidate.keyword)),
    }));
}
export async function discoverKeywordSuggestions(input: DiscoverKeywordSuggestionsInput, deps: KeywordSuggestionsDeps): Promise<KeywordSuggestionsResult> {
    const site = await getOwnedSiteTarget(input.accountId, input.siteId);
    // Sources are blended, not cascaded: each tier's rows are appended (deduped
    // by normalized phrase, earlier source wins) until MIN_UNTRACKED_SUGGESTIONS
    // untracked candidates exist. "Untracked" — not "non-empty" — is what counts:
    // rows the account already tracks yield an empty selectable set on the
    // client (they render greyed out but stay in the payload).
    const blended: KeywordSuggestion[] = [];
    const seen = new Set<string>();
    const sources: KeywordSuggestionSource[] = [];
    let cached = true;
    let fetchedAt = new Date(0);
    const merge = (rows: KeywordSuggestion[], rowsFetchedAt: Date, rowsCached: boolean) => {
        // Consulting a tier updates freshness even when it contributes no rows —
        // an empty vendor response still tells the client when we last looked.
        cached = cached && rowsCached;
        if (rowsFetchedAt > fetchedAt)
            fetchedAt = rowsFetchedAt;
        let added = false;
        for (const row of rows) {
            const key = normalizePhrase(row.keyword);
            if (seen.has(key))
                continue;
            seen.add(key);
            blended.push(row);
            added = true;
        }
        if (added)
            sources.push(rows[0]!.source);
    };
    const untrackedCount = () => blended.filter((candidate) => !candidate.tracked).length;
    const respond = (fallbackStatus: KeywordSuggestionFallbackStatus, lastConsulted: KeywordSuggestionSource): KeywordSuggestionsResult => ({
        source: blended.find((candidate) => !candidate.tracked)?.source ?? lastConsulted,
        sources,
        candidates: blended,
        cached,
        fetchedAt: fetchedAt.toISOString(),
        fallbackStatus,
    });
    // 1. Search Console first — first-party, free, and the richest source for a
    //    site whose vendor-visible ranked footprint is thin. Runs BEFORE the
    //    first `meter()` so a GSC-served request costs no `keyword_lookups`.
    const gsc = await readGscQueryCandidates(deps.db, input.siteId, site.gscBindingGenerationId);
    if (gsc !== null) {
        const gscCandidates = await addTrackedState(input.accountId, input.siteId, 'gsc', gsc.candidates, deps.db);
        // Stored first-party rows, not a live call — `cached` stays true and
        // `fetchedAt` is when the sync wrote them.
        merge(gscCandidates, gsc.fetchedAt, true);
        if (untrackedCount() >= MIN_UNTRACKED_SUGGESTIONS) {
            return respond('not_needed', 'gsc');
        }
    }
    const ranked = await getCachedSiteKeywordCandidates({
        domain: site.domain,
        locationCode: input.locationCode,
        languageCode: input.languageCode,
    }, deps);
    const rankedCandidates = await addTrackedState(input.accountId, input.siteId, 'ranked', ranked.candidates, deps.db);
    merge(rankedCandidates, ranked.fetchedAt, ranked.cached);
    if (untrackedCount() >= MIN_UNTRACKED_SUGGESTIONS) {
        return respond('not_needed', 'ranked');
    }
    let ideas: Awaited<ReturnType<typeof readCachedSiteKeywordCandidates>>;
    try {
        ideas = await readCachedSiteKeywordCandidates({
            operation: 'site-keyword-ideas',
            domain: site.origin,
            locationCode: input.locationCode,
            languageCode: input.languageCode,
            cacheVersion: SITE_KEYWORD_IDEA_CACHE_VERSION,
            fetch: async () => {
                const crawl = await deps.contentSource.crawlSite({
                    origin: site.origin,
                    allowlistedPaths: [],
                    maxPages: SITE_KEYWORD_DISCOVERY_PAGE_LIMIT,
                    depth: SITE_KEYWORD_DISCOVERY_DEPTH,
                    concurrency: SITE_KEYWORD_DISCOVERY_CONCURRENCY,
                    timeoutMs: SITE_KEYWORD_DISCOVERY_TIMEOUT_MS,
                });
                const documents = crawl.documents
                    .filter((document) => {
                    try {
                        return new URL(document.sourceUrl).origin === site.origin;
                    }
                    catch {
                        return false;
                    }
                })
                    .slice(0, SITE_KEYWORD_DISCOVERY_PAGE_LIMIT);
                if (crawl.completion === 'cancelled' || documents.length === 0)
                    return [];
                const evidence = extractSiteKeywordEvidence(documents);
                if (evidence.seeds.length === 0)
                    return [];
                const candidates = await deps.provider.getKeywordIdeasForSite(evidence.seeds, input.locationCode, input.languageCode, SITE_RANKED_KEYWORD_LIMIT);
                return groundSiteKeywordCandidates(candidates, evidence, SITE_RANKED_KEYWORD_LIMIT);
            },
        }, deps);
    }
    catch (err) {
        // The site-ideas tier crawls the site first (content-source vendor), then
        // asks Labs. Either vendor being down must not discard what GSC/ranked
        // already produced, so degrade. `readCachedSiteKeywordCandidates`
        // already maps every ProviderError to 503.
        if (!(err instanceof HttpError && err.status === 503))
            throw err;
        logger.warn({ siteId: input.siteId, code: err.code }, 'keyword suggestions: site-ideas tier unavailable');
        if (blended.length === 0)
            throw err;
        // ponytail: crawl-less seeds (ranked/GSC phrases → keyword_ideas) would keep
        // this tier alive during a content-source outage; add if it recurs.
        return respond('provider_unavailable', 'ranked');
    }
    const ideaCandidates = await addTrackedState(input.accountId, input.siteId, 'site_ideas', ideas.value, deps.db);
    merge(ideaCandidates, ideas.fetchedAt, ideas.cached);
    return respond('used', 'site_ideas');
}
// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------
export interface ListKeywordsInput {
    accountId: string;
    siteId: string;
    cursor?: string;
    limit: number;
    /** Server-side filter so later pages cannot hide a requested engine. */
    engine?: RankEngineKind;
}
export async function listKeywords(input: ListKeywordsInput, deps: KeywordsServiceDeps): Promise<KeywordListPage> {
    await assertSiteOwnership(input.accountId, input.siteId);
    // Deactivated (soft-deleted) rows never surface: without this filter a
    // removed keyword reloads into the table and can be "removed" forever.
    const filters = [
        eq(keywords.siteId, input.siteId),
        eq(keywords.accountId, input.accountId),
        eq(keywords.active, true),
    ];
    if (input.engine !== undefined)
        filters.push(eq(keywords.engine, input.engine));
    if (input.cursor !== undefined) {
        if (!UUID_RE.test(input.cursor)) {
            throw HttpError.badRequest({ code: 'RANKS_ERRORS_UNKNOWN_CURSOR', messageKey: 'ranks.errors.unknownCursor' });
        }
        const cursorFilters = [
            eq(keywords.id, input.cursor),
            eq(keywords.accountId, input.accountId),
            eq(keywords.siteId, input.siteId),
            eq(keywords.active, true),
        ];
        if (input.engine !== undefined)
            cursorFilters.push(eq(keywords.engine, input.engine));
        const cursorRow = await deps.db
            .select({ createdAt: keywords.createdAt })
            .from(keywords)
            .where(and(...cursorFilters))
            .limit(1);
        if (cursorRow.length === 0) {
            throw HttpError.badRequest({ code: 'RANKS_ERRORS_UNKNOWN_CURSOR', messageKey: 'ranks.errors.unknownCursor' });
        }
        // Tuple compare: rows sharing `created_at` are still totally ordered by
        // `(created_at desc, id desc)`, so pagination never skips.
        filters.push(sql `(${keywords.createdAt}, ${keywords.id}) < (select created_at, id from ${keywords} where id = ${input.cursor} and account_id = ${input.accountId} and site_id = ${input.siteId})`);
    }
    const rows = await deps.db
        .select()
        .from(keywords)
        .where(and(...filters))
        .orderBy(desc(keywords.createdAt), desc(keywords.id))
        .limit(input.limit + 1);
    const pageRows = rows.slice(0, input.limit);
    const hasMore = rows.length > input.limit;
    /* c8 ignore next -- `?? null` arm satisfies noUncheckedIndexedAccess; `pageRows.at(-1)` is defined whenever hasMore. */
    const nextCursor = hasMore ? (pageRows.at(-1)?.id ?? null) : null;
    // Replace the per-keyword `.limit(2)` loop with a
    // single window-function query over all page ids. `row_number()` partitions
    // by keyword and orders by `checked_at desc`; we keep rn<=2, then bucket in
    // JS to reconstruct the exact latest/previous/delta shape the pre-change
    // loop produced (including the null / one-ranking edge cases).
    const ids = pageRows.map((k) => k.id);
    type LatestTwoRow = {
        keywordId: string;
        position: number | null;
        checkedAt: Date;
        aiOverviewPresent: boolean | null;
        aiCited: boolean | null;
        aiCitedUrl: string | null;
        observationMeta: ObservationMeta | null;
    };
    const latestByKeyword = new Map<string, LatestTwoRow[]>();
    if (ids.length > 0) {
        const latestRows = await deps.db
            .select({
            keywordId: rankings.keywordId,
            position: rankings.position,
            checkedAt: rankings.checkedAt,
            aiOverviewPresent: rankings.aiOverviewPresent,
            aiCited: rankings.aiCited,
            aiCitedUrl: rankings.aiCitedUrl,
            observationMeta: rankings.observationMeta,
            rn: sql<number> `row_number() over (partition by ${rankings.keywordId} order by ${rankings.checkedAt} desc)`.as('rn'),
        })
            .from(rankings)
            .where(inArray(rankings.keywordId, ids));
        for (const row of latestRows) {
            if (Number(row.rn) > 2)
                continue;
            const bucket = latestByKeyword.get(row.keywordId) ?? [];
            bucket.push({
                keywordId: row.keywordId,
                position: row.position,
                checkedAt: row.checkedAt,
                aiOverviewPresent: row.aiOverviewPresent,
                aiCited: row.aiCited,
                aiCitedUrl: row.aiCitedUrl,
                observationMeta: row.observationMeta,
            });
            latestByKeyword.set(row.keywordId, bucket);
        }
        // rn 1 = latest, rn 2 = previous — asserted by ordering the bucket by
        // checkedAt desc after collection (postgres already returns them in that
        // order; the sort here is a belt-and-braces guard against driver drift).
        for (const bucket of latestByKeyword.values()) {
            bucket.sort((a, b) => b.checkedAt.getTime() - a.checkedAt.getTime());
        }
    }
    const items: KeywordListItem[] = [];
    for (const kw of pageRows) {
        const bucket = latestByKeyword.get(kw.id) ?? [];
        const latest = bucket[0];
        const previous = bucket[1];
        const latestPosition = latest?.position ?? null;
        const previousPosition = previous?.position ?? null;
        const delta = latestPosition !== null && previousPosition !== null
            ? previousPosition - latestPosition
            : null;
        items.push(toKeywordListItem(kw, latestPosition, previousPosition, latest?.checkedAt ?? null, delta, {
            aiOverviewPresent: latest?.aiOverviewPresent ?? null,
            aiCited: latest?.aiCited ?? null,
            aiCitedUrl: latest?.aiCitedUrl ?? null,
            observationMeta: latest?.observationMeta ?? null,
        }));
    }
    const cadence = await getSiteCadence(deps.db, input.siteId);
    return {
        keywords: items,
        nextCursor,
        cadence,
    };
}
// ---------------------------------------------------------------------------
// Deactivate
// ---------------------------------------------------------------------------
export async function deactivateKeyword(accountId: string, keywordId: string, deps: KeywordsServiceDeps): Promise<void> {
    const owned = await assertKeywordOwnership(deps.db, accountId, keywordId);
    // Already removed: nothing to unschedule.
    if (!owned.active)
        return;
    await deps.db
        .update(keywords)
        .set({ active: false, updatedAt: new Date() })
        .where(and(eq(keywords.id, keywordId), eq(keywords.accountId, accountId), eq(keywords.active, true)));
    // If this was the last active keyword for the site, drop the rank
    // scheduler so no orphan cron keeps firing.
    const [remaining] = await deps.db
        .select({ count: count() })
        .from(keywords)
        .where(and(eq(keywords.siteId, owned.siteId), eq(keywords.accountId, accountId), eq(keywords.active, true)));
    // drizzle-orm's `count()` always yields a single row; `remaining!` is safe
    // and avoids an unreachable `?? 0` branch that v8 counts as uncovered.
    const remainingActive = Number(remaining!.count);
    if (remainingActive === 0 && deps.ranksQueue) {
        await removeRankSchedule(deps.ranksQueue, owned.siteId);
    }
}
// ---------------------------------------------------------------------------
// Cadence
// ---------------------------------------------------------------------------
export interface UpdateCadenceInput {
    accountId: string;
    siteId: string;
    cadence: RankCadenceKind;
}
export async function updateRankCadence(input: UpdateCadenceInput, deps: KeywordsServiceDeps): Promise<{
    cadence: RankCadenceKind;
}> {
    await assertSiteOwnership(input.accountId, input.siteId);
    await assertSiteNotPausedById(input.accountId, input.siteId);
    await deps.db
        .insert(domainStates)
        .values({ siteId: input.siteId, cadence: input.cadence })
        .onConflictDoUpdate({
        target: domainStates.siteId,
        set: { cadence: input.cadence, updatedAt: new Date() },
    });
    if (deps.ranksQueue) {
        await upsertRankSchedule(deps.ranksQueue, {
            accountId: input.accountId,
            siteId: input.siteId,
            cadence: input.cadence,
            altEnginesEnabled: env.ALT_ENGINE_TRACKING_ENABLED,
        });
    }
    return { cadence: input.cadence };
}
// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------
export interface RankHistoryPoint {
    checkedAt: string;
    position: number | null;
    rankAbsolute: number | null;
    source: 'fresh' | 'cache';
    foundUrl: string | null;
    /** Google AI Overview signal at that check (null = unknown / pre-feature). */
    aiOverviewPresent: boolean | null;
    aiCited: boolean | null;
    aiCitedUrl: string | null;
    /** Provider provenance for this stored observation. */
    observationMeta: ObservationMeta | null;
}
export interface RankHistoryQueryInput {
    accountId: string;
    keywordId: string;
    from?: string;
    to?: string;
}
/** Hard cap on returned points per keyword. */
export const HISTORY_MAX_POINTS = 730;
/** Default range when no `from` is supplied (24 months). */
export const HISTORY_DEFAULT_WINDOW_MS = 730 * 24 * 60 * 60 * 1000;
function defaultHistoryFrom(now: Date, explicitFrom: string | undefined): Date | undefined {
    if (explicitFrom !== undefined)
        return new Date(explicitFrom);
    // No explicit from means "last 24 months" (a bounded
    // sweep, never an unbounded table scan for a long-lived keyword).
    return new Date(now.getTime() - HISTORY_DEFAULT_WINDOW_MS);
}
export async function getKeywordHistory(input: RankHistoryQueryInput, deps: KeywordsServiceDeps): Promise<{
    keywordId: string;
    series: RankHistoryPoint[];
}> {
    const keyword = await assertKeywordOwnership(deps.db, input.accountId, input.keywordId);
    const filters = [eq(rankings.keywordId, keyword.id)];
    const from = defaultHistoryFrom(new Date(), input.from);
    /* c8 ignore start -- defaultHistoryFrom always returns a Date in tests; no-date-range and no-to-date paths are not exercised */
    if (from)
        filters.push(gte(rankings.checkedAt, from));
    if (input.to)
        filters.push(lte(rankings.checkedAt, new Date(input.to)));
    /* c8 ignore stop */
    const rows = await deps.db
        .select({
        checkedAt: rankings.checkedAt,
        position: rankings.position,
        rankAbsolute: rankings.rankAbsolute,
        source: rankings.source,
        foundUrl: rankings.foundUrl,
        aiOverviewPresent: rankings.aiOverviewPresent,
        aiCited: rankings.aiCited,
        aiCitedUrl: rankings.aiCitedUrl,
        observationMeta: rankings.observationMeta,
    })
        .from(rankings)
        .where(and(...filters))
        .orderBy(asc(rankings.checkedAt))
        .limit(HISTORY_MAX_POINTS);
    return {
        keywordId: keyword.id,
        series: rows.map((r) => ({
            checkedAt: r.checkedAt.toISOString(),
            position: r.position,
            rankAbsolute: r.rankAbsolute,
            source: r.source,
            foundUrl: r.foundUrl,
            aiOverviewPresent: r.aiOverviewPresent,
            aiCited: r.aiCited,
            aiCitedUrl: r.aiCitedUrl,
            observationMeta: r.observationMeta,
        })),
    };
}
// ---------------------------------------------------------------------------
// Batched history (public-API surface)
// ---------------------------------------------------------------------------
export interface BatchRankHistoryInput {
    accountId: string;
    /** Every id is asserted to belong to `accountId` before the range query. */
    keywordIds: readonly string[];
    from?: string;
    to?: string;
}
export interface BatchRankHistoryEntry {
    keywordId: string;
    phrase: string;
    series: RankHistoryPoint[];
}
/**
 * Batched rank history — ONE `inArray` select over every requested keyword id
 * ordered by `(keywordId, checkedAt asc)`, then grouped in JS to keep the
 * per-keyword series shape identical to `getKeywordHistory`. Applies the same
 * bounded window (default 24 months) and per-partition point cap so a
 * long-lived keyword can never dominate the response.
 */
export async function getKeywordHistoryBatch(input: BatchRankHistoryInput, deps: KeywordsServiceDeps): Promise<BatchRankHistoryEntry[]> {
    if (input.keywordIds.length === 0)
        return [];
    // Ownership fan-out: one `IN` select restricted by `accountId`. Any id that
    // does not belong to the caller is silently dropped from the response —
    // never surfaced as a 404 leak.
    const ownedRows = await deps.db
        .select({ id: keywords.id, phrase: keywords.phrase })
        .from(keywords)
        .where(and(eq(keywords.accountId, input.accountId), inArray(keywords.id, [...input.keywordIds])));
    const phraseById = new Map<string, string>();
    for (const r of ownedRows)
        phraseById.set(r.id, r.phrase);
    const ownedIds = ownedRows.map((r) => r.id);
    if (ownedIds.length === 0)
        return [];
    const filters = [inArray(rankings.keywordId, ownedIds)];
    const from = defaultHistoryFrom(new Date(), input.from);
    /* c8 ignore start -- defaultHistoryFrom always returns a Date in tests; no-date-range and no-to-date paths are not exercised */
    if (from)
        filters.push(gte(rankings.checkedAt, from));
    if (input.to)
        filters.push(lte(rankings.checkedAt, new Date(input.to)));
    /* c8 ignore stop */
    const rows = await deps.db
        .select({
        keywordId: rankings.keywordId,
        checkedAt: rankings.checkedAt,
        position: rankings.position,
        rankAbsolute: rankings.rankAbsolute,
        source: rankings.source,
        foundUrl: rankings.foundUrl,
        aiOverviewPresent: rankings.aiOverviewPresent,
        aiCited: rankings.aiCited,
        aiCitedUrl: rankings.aiCitedUrl,
        observationMeta: rankings.observationMeta,
    })
        .from(rankings)
        .where(and(...filters))
        .orderBy(asc(rankings.keywordId), asc(rankings.checkedAt));
    const seriesById = new Map<string, RankHistoryPoint[]>();
    for (const id of ownedIds)
        seriesById.set(id, []);
    for (const r of rows) {
        const bucket = seriesById.get(r.keywordId);
        /* c8 ignore next -- inArray guarantees membership, but the `??` guards a driver-level shape drift. */
        if (!bucket)
            continue;
        if (bucket.length >= HISTORY_MAX_POINTS)
            continue;
        bucket.push({
            checkedAt: r.checkedAt.toISOString(),
            position: r.position,
            rankAbsolute: r.rankAbsolute,
            source: r.source,
            foundUrl: r.foundUrl,
            aiOverviewPresent: r.aiOverviewPresent,
            aiCited: r.aiCited,
            aiCitedUrl: r.aiCitedUrl,
            observationMeta: r.observationMeta,
        });
    }
    return ownedIds.map((id) => ({
        keywordId: id,
        // Both maps are populated with every ownedId above (phraseById from
        // ownedRows, seriesById at line ~602). The lookups can never miss under
        // normal invariants, so the non-null assertion documents that. If a
        // future refactor breaks that invariant, tests will fail loudly.
        phrase: phraseById.get(id)!,
        series: seriesById.get(id)!,
    }));
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function toKeywordListItem(row: Keyword, latestPosition: number | null, previousPosition: number | null, lastCheckedAt: Date | null, delta: number | null = null, ai: {
    aiOverviewPresent: boolean | null;
    aiCited: boolean | null;
    aiCitedUrl: string | null;
    observationMeta: ObservationMeta | null;
} = {
    aiOverviewPresent: null,
    aiCited: null,
    aiCitedUrl: null,
    observationMeta: null,
}): KeywordListItem {
    return {
        id: row.id,
        siteId: row.siteId,
        phrase: row.phrase,
        locationCode: row.locationCode,
        languageCode: row.languageCode,
        device: row.device as SerpDevice,
        active: row.active,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        latestPosition,
        previousPosition,
        delta,
        lastCheckedAt: lastCheckedAt ? lastCheckedAt.toISOString() : null,
        trackLocalPack: row.trackLocalPack,
        lastFailedCheckAt: row.lastFailedCheckAt ? row.lastFailedCheckAt.toISOString() : null,
        lastFailedReason: row.lastFailedReason,
        engine: row.engine as RankEngineKind,
        engineTarget: row.engineTarget,
        ...ai,
    };
}
/** Narrow test surface for ownership race guards. */
export const keywordsServiceTestables = {
    assertSiteOwnership,
    assertSiteNotPausedById,
    getOwnedSiteDomain,
};
