/**
 * Competitor content intelligence — run HTTP-side service.
 *
 * Load-bearing invariants for `startCompetitorRun` (start-order):
 *   1. zod parse (controller layer)
 *   2. queue present — else 503 (a run would never be consumed)
 *   3. Site.findOne({ _id, accountId }) — 404 not 403 (existence leak rule)
 *   4. `env.COMPETITOR_CONTENT_INTELLIGENCE_ENABLED` false → 503 (kill switch)
 *   5. resolve the selected competitor profiles → at least one active, owned
 *      profile, else 400
 *   6. `assertPublicUrlSafe(ownedUrl)` + same-origin check (SEC-URL) — runs
 *      BEFORE the run is created so an unsafe/off-origin page is never scraped
 *   7. idempotent short-circuit — a duplicate idempotency key returns the
 *      existing run BEFORE the active-run check
 *   8. single-active-run guard — a DIFFERENT non-terminal run → 409
 *   9. atomic idempotent `CompetitorContentRun.create`
 *  10. enqueue with the deterministic `competitor-content-<runId>` job id
 *  11. respond 202
 *
 * Compensation: enqueue failure marks the run failed so no run stays queued
 * without a job. Read endpoints never enqueue, never scrape.
 */
import type { Queue } from 'bullmq';
import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import { assertPublicUrlSafe, createPaginationCursorCodec, makeIdempotencyKey, type PaginationCursorCodec, } from '../../shared/security/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { env } from '../../config/env.js';
import { Site } from '../sites/index.js';
import { assertSiteNotPaused } from '../sites/sites.guard.js';
import { enqueueCompetitorContentJob } from '../../shared/queue/index.js';
import { CompetitorContentRun, CompetitorPageFacts, COMPETITOR_CONTENT_TERMINAL_STATUSES, type CompetitorContentRunDocument, type CompetitorContentStatus, } from './competitor-content.model.js';
import { isCompetitorContentCancellable, assertCompetitorContentTransition, } from './competitor-content.state.js';
import { loadActiveCompetitorProfiles } from './competitor-content.profiles.service.js';
import { registrableDomainKey } from './competitor-content.profiles.service.js';
import { loadFrozenReviewedPageMatch } from '../competitors/index.js';
import { competitorContentFindingsSchema, competitorPageFactsSchema, COMPETITOR_CONTENT_THRESHOLDS_VERSION, type StartCompetitorRunBody, type FrozenCompetitorPageMatch, } from './competitor-content.schemas.js';
import { localizeCompetitorContentFindings, localizeCompetitorContentWarning, } from './competitor-content.copy.js';
import { toSupportedLocale, type SupportedLocale } from '../../shared/i18n/index.js';
function makeRunIdempotencyKey(accountId: string, siteId: string, body: StartCompetitorRunBody): string {
    const composite = JSON.stringify({
        siteId,
        ownedUrl: body.ownedUrl,
        competitorIds: [...body.competitorIds].sort(),
        reviewedPageMatches: [...body.reviewedPageMatches].sort((a, b) => `${a.landscapeReportId}:${a.suggestionId}`.localeCompare(`${b.landscapeReportId}:${b.suggestionId}`)),
        competitorUrls: [...body.competitorUrls].sort((a, b) => `${a.competitorId}:${a.url}`.localeCompare(`${b.competitorId}:${b.url}`)),
        keyword: body.keyword ?? null,
        pageLimit: body.pageLimit,
        locale: body.locale,
    });
    const scope = createHash('sha256').update(composite).digest('hex');
    const clientKeyResolved = body.clientKey
        ? createHash('sha256').update(body.clientKey).digest('hex')
        : scope;
    return makeIdempotencyKey(accountId, scope, clientKeyResolved);
}
function makeInputFingerprint(siteId: string, idempotencyKey: string): string {
    return createHash('sha256').update(`${siteId}|${idempotencyKey}`).digest('hex');
}
function sameRegistrableHost(a: string, b: string): boolean {
    return registrableDomainKey(a) === registrableDomainKey(b);
}
async function resolveFrozenPageMatches(input: StartCompetitorRunInput, deps: StartCompetitorRunDeps, siteOrigin: string): Promise<{
    matches: FrozenCompetitorPageMatch[];
    compatibilityMode: 'reviewed_pages' | 'legacy_explicit';
}> {
    if (input.body.reviewedPageMatches.length === 0 && input.body.competitorUrls.length === 0) {
        throw HttpError.badRequest({ code: 'CONTENT_INTELLIGENCE_COMPETITOR_CONTENT_ERRORS_REVIEWED_PAGES_REQUIRED', messageKey: 'contentIntelligence.competitorContent.errors.reviewedPagesRequired' });
    }
    const loadReviewedPageMatch = deps.loadReviewedPageMatch ?? loadFrozenReviewedPageMatch;
    const reviewed = await Promise.all(input.body.reviewedPageMatches.map(async (reference) => {
        const frozen = await loadReviewedPageMatch(deps.db, {
            accountId: input.accountId,
            siteId: input.siteId,
            reportId: reference.landscapeReportId,
            suggestionId: reference.suggestionId,
            opportunityId: reference.landscapeOpportunityId ?? null,
        });
        return frozen;
    }));
    const profileIds = reviewed.length > 0
        ? reviewed.map((match) => match.competitorProfileId)
        : input.body.competitorUrls.map((entry) => entry.competitorId);
    const uniqueProfileIds = [...new Set(profileIds)];
    if (uniqueProfileIds.length !== profileIds.length && reviewed.length > 0) {
        const uniqueLegs = new Set(reviewed.map((match) => `${match.landscapeReportId}:${match.suggestionId}`));
        if (uniqueLegs.size !== reviewed.length) {
            throw HttpError.badRequest({ code: 'CONTENT_INTELLIGENCE_COMPETITOR_CONTENT_ERRORS_DUPLICATE_PAGE_MATCH', messageKey: 'contentIntelligence.competitorContent.errors.duplicatePageMatch' });
        }
    }
    const profiles = await loadActiveCompetitorProfiles(deps.db, {
        accountId: input.accountId,
        siteId: input.siteId,
        competitorIds: uniqueProfileIds,
    });
    if (profiles.length !== uniqueProfileIds.length) {
        throw HttpError.notFound({ code: 'CONTENT_INTELLIGENCE_COMPETITOR_CONTENT_ERRORS_PROFILE_INACTIVE', messageKey: 'contentIntelligence.competitorContent.errors.profileInactive' });
    }
    const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
    const ownedSiteOrigin = new URL(siteOrigin).origin;
    const rawMatches: FrozenCompetitorPageMatch[] = reviewed.length > 0
        ? reviewed.map((match) => {
            const profile = profileById.get(match.competitorProfileId)!;
            return {
                source: 'landscape_review',
                landscapeReportId: match.landscapeReportId,
                landscapeOpportunityId: match.landscapeOpportunityId,
                suggestionId: match.suggestionId,
                competitorProfileId: match.competitorProfileId,
                competitorDomain: profile.registrableDomain,
                suggestedRankingUrl: match.suggestedUrl,
                selectedUrl: match.selectedUrl,
                ownedUrl: match.ownedUrl,
                keywordEvidence: match.keywordEvidence,
            };
        })
        : input.body.competitorUrls.map((entry) => {
            const profile = profileById.get(entry.competitorId)!;
            return {
                source: 'legacy_explicit',
                landscapeReportId: null,
                landscapeOpportunityId: null,
                suggestionId: null,
                competitorProfileId: entry.competitorId,
                competitorDomain: profile.registrableDomain,
                suggestedRankingUrl: entry.url,
                selectedUrl: entry.url,
                ownedUrl: input.body.ownedUrl ?? null,
                keywordEvidence: [],
            };
        });
    // The non-empty input guard above guarantees at least one raw match.
    if (rawMatches.length > input.body.pageLimit) {
        throw HttpError.badRequest({ code: 'CONTENT_INTELLIGENCE_COMPETITOR_CONTENT_ERRORS_PAGE_LIMIT_EXCEEDED', messageKey: 'contentIntelligence.competitorContent.errors.pageLimitExceeded' });
    }
    const normalized: FrozenCompetitorPageMatch[] = [];
    for (const match of rawMatches) {
        if (!match.ownedUrl) {
            throw HttpError.badRequest({ code: 'CONTENT_INTELLIGENCE_COMPETITOR_CONTENT_ERRORS_OWNED_URL_REQUIRED', messageKey: 'contentIntelligence.competitorContent.errors.ownedUrlRequired' });
        }
        let selected: URL;
        let owned: URL;
        try {
            [selected, owned] = await Promise.all([
                assertPublicUrlSafe(match.selectedUrl),
                assertPublicUrlSafe(match.ownedUrl),
            ]);
        }
        catch {
            throw HttpError.badRequest({ code: 'CONTENT_INTELLIGENCE_COMPETITOR_CONTENT_ERRORS_URL_UNSAFE', messageKey: 'contentIntelligence.competitorContent.errors.urlUnsafe' });
        }
        if (!sameRegistrableHost(selected.hostname, match.competitorDomain)) {
            throw HttpError.badRequest({ code: 'CONTENT_INTELLIGENCE_COMPETITOR_CONTENT_ERRORS_COMPETITOR_URL_OFF_DOMAIN', messageKey: 'contentIntelligence.competitorContent.errors.competitorUrlOffDomain' });
        }
        if (owned.origin !== ownedSiteOrigin) {
            throw HttpError.badRequest({ code: 'CONTENT_INTELLIGENCE_COMPETITOR_CONTENT_ERRORS_OWNED_URL_OFF_ORIGIN', messageKey: 'contentIntelligence.competitorContent.errors.ownedUrlOffOrigin' });
        }
        normalized.push({ ...match, selectedUrl: selected.toString(), ownedUrl: owned.toString() });
    }
    return {
        matches: normalized,
        compatibilityMode: reviewed.length > 0 ? 'reviewed_pages' : 'legacy_explicit',
    };
}
async function loadOwnedSite(accountId: string, siteId: string) {
    if (!Types.ObjectId.isValid(siteId)) {
        throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
    }
    const site = await Site.findOne({ _id: siteId, accountId, deletionStartedAt: null });
    if (!site)
        throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
    return site;
}
function isDuplicateKeyError(err: unknown): boolean {
    if (typeof err !== 'object' || err === null)
        return false;
    const anyErr = err as {
        code?: number;
        name?: string;
    };
    return anyErr.code === 11000 || anyErr.name === 'MongoServerError';
}
export interface StartCompetitorRunInput {
    accountId: string;
    ownerUserId: string;
    siteId: string;
    body: StartCompetitorRunBody;
}
export interface StartCompetitorRunDeps {
    db: ApplicationDb;
    queue: Queue | null;
    loadReviewedPageMatch?: typeof loadFrozenReviewedPageMatch;
}
export interface StartedCompetitorRun {
    runId: string;
    status: CompetitorContentStatus;
    duplicate: boolean;
}
/** START — the load-bearing ordering above. */
export async function startCompetitorRun(input: StartCompetitorRunInput, deps: StartCompetitorRunDeps): Promise<StartedCompetitorRun> {
    const queue = deps.queue;
    if (!queue) {
        throw new HttpError(503, { code: 'CONTENT_INTELLIGENCE_COMPETITOR_CONTENT_ERRORS_QUEUE_UNAVAILABLE', messageKey: 'contentIntelligence.competitorContent.errors.queueUnavailable' });
    }
    // (3) Ownership.
    const site = await loadOwnedSite(input.accountId, input.siteId);
    assertSiteNotPaused(site);
    const origin = site.url;
    // (4) Kill switch.
    if (!env.COMPETITOR_CONTENT_INTELLIGENCE_ENABLED) {
        throw new HttpError(503, { code: 'CONTENT_INTELLIGENCE_COMPETITOR_CONTENT_ERRORS_UNAVAILABLE', messageKey: 'contentIntelligence.competitorContent.errors.unavailable' });
    }
    // (5-6) Freeze reviewed ranking pages (or explicit compatibility URLs), then
    // repeat profile ownership and public-URL authority before creating the run.
    const frozen = await resolveFrozenPageMatches(input, deps, origin);
    const profiles = await loadActiveCompetitorProfiles(deps.db, {
        accountId: input.accountId,
        siteId: String(site._id),
        competitorIds: [...new Set(frozen.matches.map((match) => match.competitorProfileId))],
    });
    const competitorDomains = frozen.matches.map((match) => match.competitorDomain);
    const ownedSafe = new URL(frozen.matches[0]!.ownedUrl!);
    const idempotencyKey = makeRunIdempotencyKey(input.accountId, input.siteId, input.body);
    // (7) Idempotent short-circuit — same request returns the existing run.
    const existing = await CompetitorContentRun.findOne({
        accountId: input.accountId,
        siteId: input.siteId,
        idempotencyKey,
    });
    if (existing) {
        return {
            runId: String(existing._id),
            status: existing.status,
            duplicate: true,
        };
    }
    // (8) Single-active-run guard — a DIFFERENT non-terminal run blocks a new one.
    // Exclude this request's own idempotency key so a concurrent identical resend
    // (same key) is resolved to the existing run by the idempotent create instead
    // of racing into a false 409 against its own twin.
    const active = await CompetitorContentRun.findOne({
        accountId: input.accountId,
        siteId: input.siteId,
        status: { $nin: COMPETITOR_CONTENT_TERMINAL_STATUSES as unknown as string[] },
        idempotencyKey: { $ne: idempotencyKey },
    });
    if (active) {
        throw HttpError.conflict({ code: 'CONTENT_INTELLIGENCE_COMPETITOR_CONTENT_ERRORS_RUN_IN_FLIGHT', messageKey: 'contentIntelligence.competitorContent.errors.runInFlight' });
    }
    // (9) Create the domain record.
    let doc;
    try {
        doc = await CompetitorContentRun.create({
            accountId: input.accountId,
            ownerUserId: input.ownerUserId,
            siteId: input.siteId,
            origin,
            ownedUrl: ownedSafe.toString(),
            keyword: input.body.keyword ?? null,
            locale: input.body.locale,
            status: 'queued',
            input: {
                competitorIds: profiles.map((p) => p.id),
                competitorDomains,
                pageLimit: input.body.pageLimit,
                pageMatches: frozen.matches,
                compatibilityMode: frozen.compatibilityMode,
            },
            progress: {
                competitorsRequested: profiles.length,
                competitorsProcessed: 0,
                competitorsFailed: 0,
                pagesScraped: 0,
            },
            stages: [{ name: 'queued', startedAt: new Date(), completedAt: null, error: null }],
            warnings: [],
            error: null,
            inputFingerprint: makeInputFingerprint(input.siteId, idempotencyKey),
            idempotencyKey,
            thresholdsVersion: COMPETITOR_CONTENT_THRESHOLDS_VERSION,
            findings: null,
            costMicros: 0,
            aiCostMicros: 0,
            requestedAt: new Date(),
        });
    }
    catch (err) {
        if (isDuplicateKeyError(err)) {
            const race = await CompetitorContentRun.findOne({
                accountId: input.accountId,
                siteId: input.siteId,
                idempotencyKey,
            });
            if (race) {
                return {
                    runId: String(race._id),
                    status: race.status,
                    duplicate: true,
                };
            }
        }
        throw err;
    }
    // (10) Enqueue with the deterministic job id.
    try {
        await enqueueCompetitorContentJob(queue, {
            accountId: input.accountId,
            siteId: input.siteId,
            runId: String(doc._id),
            reservationKey: idempotencyKey,
        });
    }
    catch (err) {
        doc.status = 'failed';
        doc.error = {
            category: 'unexpected',
            messageKey: 'contentIntelligence.competitorContent.errors.queueUnavailable',
            retryable: true,
            terminal: true,
        };
        doc.completedAt = new Date();
        await doc.save();
        throw new HttpError(503, { code: 'CONTENT_INTELLIGENCE_COMPETITOR_CONTENT_ERRORS_QUEUE_UNAVAILABLE', messageKey: 'contentIntelligence.competitorContent.errors.queueUnavailable' }, undefined, { cause: err });
    }
    return { runId: String(doc._id), status: doc.status, duplicate: false };
}
// ---------------------------------------------------------------------------
// Serialization + reads
// ---------------------------------------------------------------------------
export function toPublicCompetitorRun(doc: CompetitorContentRunDocument & {
    _id: unknown;
}, locale: SupportedLocale = toSupportedLocale(doc.locale)) {
    const findings = competitorContentFindingsSchema.safeParse(doc.findings);
    return {
        runId: String(doc._id),
        siteId: String(doc.siteId),
        origin: doc.origin,
        ownedUrl: doc.ownedUrl,
        keyword: doc.keyword ?? null,
        locale: doc.locale,
        status: doc.status,
        input: {
            competitorIds: doc.input?.competitorIds ?? [],
            competitorDomains: doc.input?.competitorDomains ?? [],
            pageLimit: doc.input?.pageLimit ?? 0,
            pageMatches: doc.input?.pageMatches ?? [],
            compatibilityMode: doc.input?.compatibilityMode ?? 'historical_origin',
        },
        progress: {
            competitorsRequested: doc.progress?.competitorsRequested ?? 0,
            competitorsProcessed: doc.progress?.competitorsProcessed ?? 0,
            competitorsFailed: doc.progress?.competitorsFailed ?? 0,
            pagesScraped: doc.progress?.pagesScraped ?? 0,
        },
        warnings: (doc.warnings ?? []).map((warning) => localizeCompetitorContentWarning(locale, warning)),
        error: doc.error ?? null,
        thresholdsVersion: doc.thresholdsVersion ?? null,
        findings: findings.success
            ? localizeCompetitorContentFindings(locale, findings.data)
            : null,
        costMicros: Number(doc.costMicros ?? 0),
        aiCostMicros: Number(doc.aiCostMicros ?? 0),
        requestedAt: (doc.requestedAt as Date | null)?.toISOString?.() ?? null,
        startedAt: (doc.startedAt as Date | null)?.toISOString?.() ?? null,
        completedAt: (doc.completedAt as Date | null)?.toISOString?.() ?? null,
        cancelledAt: (doc.cancelledAt as Date | null)?.toISOString?.() ?? null,
    };
}
export interface ListCompetitorRunsInput {
    accountId: string;
    siteId: string;
    limit: number;
    cursor?: string;
    locale?: SupportedLocale;
}
export interface ListCompetitorRunsResult {
    items: ReturnType<typeof toPublicCompetitorRun>[];
    nextCursor: string | null;
}
interface CursorPayload {
    ts: number;
    id: string;
}
let cursorCodec: PaginationCursorCodec | null = null;
function getCursorCodec(): PaginationCursorCodec {
    if (cursorCodec)
        return cursorCodec;
    cursorCodec = createPaginationCursorCodec(env.BETTER_AUTH_SECRET);
    return cursorCodec;
}
export async function listCompetitorRuns(input: ListCompetitorRunsInput): Promise<ListCompetitorRunsResult> {
    const site = await loadOwnedSite(input.accountId, input.siteId);
    const query: Record<string, unknown> = {
        accountId: input.accountId,
        siteId: String(site._id),
    };
    if (input.cursor) {
        let decoded: CursorPayload;
        try {
            decoded = JSON.parse(getCursorCodec().decode(input.cursor)) as CursorPayload;
        }
        catch {
            throw HttpError.badRequest({ code: 'CONTENT_INTELLIGENCE_ERRORS_CURSOR_INVALID', messageKey: 'contentIntelligence.errors.cursorInvalid' });
        }
        query.requestedAt = { $lt: new Date(decoded.ts) };
    }
    const rows = await CompetitorContentRun.find(query)
        .sort({ requestedAt: -1, _id: -1 })
        .limit(input.limit + 1);
    const hasMore = rows.length > input.limit;
    const page = hasMore ? rows.slice(0, input.limit) : rows;
    const items = page.map((r) => {
        const plain = r.toObject() as CompetitorContentRunDocument & {
            _id: unknown;
        };
        return toPublicCompetitorRun(plain, input.locale ?? toSupportedLocale(plain.locale));
    });
    let nextCursor: string | null = null;
    if (hasMore) {
        const last = page[page.length - 1]!;
        const ts = (last.requestedAt as Date).getTime();
        nextCursor = getCursorCodec().encode(JSON.stringify({ ts, id: String(last._id) } satisfies CursorPayload));
    }
    return { items, nextCursor };
}
export async function getCompetitorRun(input: {
    accountId: string;
    runId: string;
    locale?: SupportedLocale;
}) {
    if (!Types.ObjectId.isValid(input.runId)) {
        throw HttpError.notFound({ code: 'CONTENT_INTELLIGENCE_COMPETITOR_CONTENT_ERRORS_NOT_FOUND', messageKey: 'contentIntelligence.competitorContent.errors.notFound' });
    }
    const doc = await CompetitorContentRun.findOne({
        _id: input.runId,
        accountId: input.accountId,
    });
    if (!doc)
        throw HttpError.notFound({ code: 'CONTENT_INTELLIGENCE_COMPETITOR_CONTENT_ERRORS_NOT_FOUND', messageKey: 'contentIntelligence.competitorContent.errors.notFound' });
    const pageRows = await CompetitorPageFacts.find({
        runId: doc._id,
        accountId: input.accountId,
    }).sort({ role: 1, url: 1 });
    const pages = pageRows.flatMap((row) => {
        const parsed = competitorPageFactsSchema.safeParse(row.facts);
        return parsed.success ? [{ url: row.url, role: row.role, facts: parsed.data }] : [];
    });
    return {
        ...toPublicCompetitorRun(doc.toObject() as never, input.locale ?? toSupportedLocale(doc.locale)),
        pages,
    };
}
export interface CancelCompetitorRunInput {
    accountId: string;
    runId: string;
}
/**
 * Cancel a cancellable run. Terminal runs return 409. The worker re-checks the
 * status at every stage boundary and stops without further vendor calls.
 */
export async function cancelCompetitorRun(input: CancelCompetitorRunInput): Promise<void> {
    if (!Types.ObjectId.isValid(input.runId)) {
        throw HttpError.notFound({ code: 'CONTENT_INTELLIGENCE_COMPETITOR_CONTENT_ERRORS_NOT_FOUND', messageKey: 'contentIntelligence.competitorContent.errors.notFound' });
    }
    const doc = await CompetitorContentRun.findOne({
        _id: input.runId,
        accountId: input.accountId,
    });
    if (!doc)
        throw HttpError.notFound({ code: 'CONTENT_INTELLIGENCE_COMPETITOR_CONTENT_ERRORS_NOT_FOUND', messageKey: 'contentIntelligence.competitorContent.errors.notFound' });
    if (!isCompetitorContentCancellable(doc.status)) {
        throw HttpError.conflict({ code: 'CONTENT_INTELLIGENCE_COMPETITOR_CONTENT_ERRORS_NOT_CANCELLABLE', messageKey: 'contentIntelligence.competitorContent.errors.notCancellable' });
    }
    assertCompetitorContentTransition(doc.status, 'cancelled');
    doc.status = 'cancelled';
    doc.cancelledAt = new Date();
    doc.completedAt = new Date();
    doc.error = {
        category: 'cancelled',
        messageKey: 'contentIntelligence.competitorContent.errors.cancelledByUser',
        retryable: false,
        terminal: true,
    };
    await doc.save();
}
