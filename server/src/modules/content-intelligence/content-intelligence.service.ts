/**
 * Content Intelligence — HTTP-side service.
 *
 * Load-bearing invariants (start-order):
 *   1. zod parse + normalize (schema-layer)
 *   2. Site.findOne({ _id, accountId }) — 404 not 403 (existence leak rule)
 *   3. confirm the submitted URL shares the verified site's origin
 *   4. `assertPublicUrlSafe` (SEC-URL) — SSRF authority; runs before any
 *      record is written so a private/metadata-resolving host never reaches
 *      a vendor
 *   5. atomic idempotent `ContentAnalysis.create` — unique index catches a
 *      duplicate start
 *   6. enqueue with the deterministic `content-analysis-<id>` job id
 *   7. respond 202
 *
 * Duplicate idempotency keys return the existing analysis without starting a
 * second run. Enqueue failure marks the fresh run failed and surfaces a 503.
 */
import type { Queue } from 'bullmq';
import { Types } from 'mongoose';
import { assertPublicUrlSafe, makeIdempotencyKey, stripQueryOperators, createPaginationCursorCodec, type PaginationCursorCodec, } from '../../shared/security/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { Site } from '../sites/index.js';
import { assertSiteNotPaused } from '../sites/sites.guard.js';
import { loadFrozenReviewedPageMatch } from '../competitors/index.js';
import { enqueueContentAnalysisJob } from '../../shared/queue/index.js';
import { ContentAnalysis, isContentAnalysisCancellable, type ContentAnalysisDocument, type ContentAnalysisStatus, } from './content-analysis.model.js';
import { recordContentAnalysisEvent } from './content-analysis.events.js';
import { assertContentAnalysisTransition } from './content-analysis.state.js';
import { env } from '../../config/env.js';
import { createHash } from 'node:crypto';
import { ownedPageFactsSchema, recommendationSchema, scorecardSchema, SCHEMA_VERSION, } from './content-analysis.schemas.js';
import { toSupportedLocale, type SupportedLocale } from '../../shared/i18n/index.js';
import { localizeContentAnalysisWarning, localizeRecommendation, localizeScorecard, } from './content-analysis.copy.js';
import { isContentCodeFixEligible } from '../../shared/code-fix-eligibility.js';
/**
 * The idempotency scope binds the run to the `(accountId, siteId, url,
 * keyword, locale)` tuple. Changing ANY of them produces a new scope and
 * therefore a new key — regeneration or a different keyword is correctly a
 * brand-new run.
 */
function makeRunKey(accountId: string, siteId: string, ownedUrl: string, keyword: string, locale: string, clientKey?: string, reviewedKeys: readonly string[] = []): string {
    // Sha256 the composite so the scope + implicit-key parts land inside the
    // `[A-Za-z0-9_-]{1,128}` bound that `makeIdempotencyKey` enforces on each
    // argument. The composite content (siteId + URL + keyword + locale) is
    // still what makes each request unique — the hash is a formatting shim,
    // not a security guard.
    const composite = `content-intel:${siteId}:${ownedUrl}:${keyword}:${locale}:${[...reviewedKeys].sort().join(',')}`;
    const scope = createHash('sha256').update(composite).digest('hex');
    const clientKeyResolved = clientKey
        ? createHash('sha256').update(clientKey).digest('hex')
        : scope;
    return makeIdempotencyKey(accountId, scope, clientKeyResolved);
}
function makeInputFingerprint(input: {
    siteId: string;
    ownedUrl: string;
    keyword: string;
    locale: string;
}): string {
    const raw = `${input.siteId}|${input.ownedUrl}|${input.keyword}|${input.locale}`;
    return createHash('sha256').update(raw).digest('hex');
}
/**
 * Ownership predicate. Every read is `Site.findOne({ _id, accountId })`;
 * a missing/off-account site returns 404 (never 403 — no existence leak).
 */
async function loadOwnedSite(accountId: string, siteId: string) {
    if (!Types.ObjectId.isValid(siteId)) {
        throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
    }
    const site = await Site.findOne({ _id: siteId, accountId, deletionStartedAt: null });
    if (!site)
        throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
    return site;
}
/**
 * SEC-URL — the submitted URL must (a) share the verified site's origin
 * AND (b) pass `assertPublicUrlSafe` (SSRF authority). The
 * origin check is a fast local reject; the SSRF check hits DNS but stays
 * inside the shared resolver, so tests can inject.
 */
async function assertOwnedUrl(siteOrigin: string, ownedUrl: string): Promise<URL> {
    let parsed: URL;
    try {
        parsed = new URL(ownedUrl);
    }
    catch {
        throw HttpError.badRequest({ code: 'CONTENT_INTELLIGENCE_ERRORS_URL_INVALID', messageKey: 'contentIntelligence.errors.urlInvalid' });
    }
    if (parsed.origin !== siteOrigin) {
        throw HttpError.badRequest({ code: 'CONTENT_INTELLIGENCE_ERRORS_URL_OFF_ORIGIN', messageKey: 'contentIntelligence.errors.urlOffOrigin' });
    }
    try {
        return await assertPublicUrlSafe(ownedUrl);
    }
    catch {
        throw HttpError.badRequest({ code: 'CONTENT_INTELLIGENCE_ERRORS_URL_UNSAFE', messageKey: 'contentIntelligence.errors.urlUnsafe' });
    }
}
export interface CreateAnalysisInput {
    accountId: string;
    ownerUserId: string;
    siteId: string;
    ownedUrl: string;
    keyword: string;
    locale: string;
    clientKey?: string;
    reviewedPageMatches?: Array<{
        landscapeReportId: string;
        landscapeOpportunityId?: string | null;
        suggestionId: string;
    }>;
}
export interface CreateAnalysisDeps {
    db: ApplicationDb;
    contentAnalysisQueue: Queue | null;
    loadReviewedPageMatch?: typeof loadFrozenReviewedPageMatch;
}
export interface StartedAnalysis {
    analysisId: string;
    status: ContentAnalysisStatus;
    reservationKey: string;
    duplicate: boolean;
}
/** Serialize a Mongo doc for the wire. */
export function toPublicAnalysis(doc: ContentAnalysisDocument & {
    _id: unknown;
}, locale: SupportedLocale = toSupportedLocale(doc.locale)) {
    const recommendations = (doc.recommendations ?? []).flatMap((value) => {
        const parsed = recommendationSchema.safeParse(value);
        if (!parsed.success)
            return [];
        const recommendation = localizeRecommendation(locale, parsed.data);
        return [{
                ...recommendation,
                ...(isContentCodeFixEligible(parsed.data.ruleId)
                    ? { codeFixPromptAvailable: true as const }
                    : {}),
            }];
    });
    const recommendationStates = (doc.recommendationStates ?? []).map((state) => ({
        recommendationId: state.recommendationId,
        analysisVersion: state.analysisVersion,
        state: state.state,
        version: state.version,
        actorUserId: String(state.actorUserId),
        stateChangedAt: (state.stateChangedAt as Date).toISOString(),
        appliedAt: (state.appliedAt as Date | null)?.toISOString() ?? null,
        baselineAnchorAt: (state.baselineAnchorAt as Date | null)?.toISOString() ?? null,
        contentHash: state.contentHash ?? null,
        analysisContentHash: state.analysisContentHash ?? null,
        hashStatus: !state.contentHash || !state.analysisContentHash
            ? ('unavailable' as const)
            : state.contentHash === state.analysisContentHash
                ? ('same' as const)
                : ('changed' as const),
    }));
    const parsedScorecard = scorecardSchema.safeParse(doc.scorecardV2);
    const parsedOwned = ownedPageFactsSchema.safeParse(doc.owned);
    return {
        analysisId: String(doc._id),
        siteId: String(doc.siteId),
        ownedUrl: doc.ownedUrl,
        keyword: doc.keyword,
        locale: doc.locale,
        status: doc.status,
        stages: doc.stages ?? [],
        warnings: (doc.warnings ?? []).map((warning) => localizeContentAnalysisWarning(locale, warning)),
        scorecard: doc.scorecard ?? null,
        schemaVersion: SCHEMA_VERSION,
        scorecardV2: parsedScorecard.success ? localizeScorecard(locale, parsedScorecard.data) : null,
        owned: parsedOwned.success
            ? {
                url: parsedOwned.data.url,
                contentHash: parsedOwned.data.contentHash,
            }
            : null,
        recommendations,
        recommendationStates,
        brief: doc.brief ?? null,
        briefVersions: (doc.briefVersions ?? []).map((version) => ({
            versionId: version.versionId,
            sections: version.sections.map((section) => ({
                heading: section.heading,
                body: section.body,
            })),
            savedAt: (version.savedAt as Date).toISOString(),
        })),
        draft: doc.draft ?? null,
        draftVersions: (doc.draftVersions ?? []).map((version) => ({
            versionId: version.versionId,
            markdown: version.markdown,
            wordCount: version.wordCount,
            savedAt: (version.savedAt as Date).toISOString(),
        })),
        citations: doc.citations ?? [],
        error: doc.error ?? null,
        costMicros: Number(doc.costMicros ?? 0),
        aiCostMicros: Number(doc.aiCostMicros ?? 0),
        requestedAt: (doc.requestedAt as Date | null)?.toISOString?.() ?? null,
        startedAt: (doc.startedAt as Date | null)?.toISOString?.() ?? null,
        completedAt: (doc.completedAt as Date | null)?.toISOString?.() ?? null,
        cancelledAt: (doc.cancelledAt as Date | null)?.toISOString?.() ?? null,
    };
}
export interface SavedDraftVersion {
    versionId: string;
    markdown: string;
    wordCount: number;
    savedAt: string;
}
export interface SavedBriefVersion {
    versionId: string;
    sections: Array<{
        heading: string;
        body: string;
    }>;
    savedAt: string;
}
export async function saveBriefVersion(input: {
    accountId: string;
    actorUserId: string;
    analysisId: string;
    sections: Array<{
        heading: string;
        body: string;
    }>;
    clientKey: string;
}): Promise<SavedBriefVersion> {
    if (!Types.ObjectId.isValid(input.analysisId)) {
        throw HttpError.notFound({ code: 'CONTENT_INTELLIGENCE_ERRORS_NOT_FOUND', messageKey: 'contentIntelligence.errors.notFound' });
    }
    const doc = await ContentAnalysis.findOne({
        _id: input.analysisId,
        accountId: input.accountId,
    });
    if (!doc)
        throw HttpError.notFound({ code: 'CONTENT_INTELLIGENCE_ERRORS_NOT_FOUND', messageKey: 'contentIntelligence.errors.notFound' });
    await loadOwnedSite(input.accountId, String(doc.siteId));
    if (!doc.brief) {
        throw HttpError.conflict({ code: 'CONTENT_INTELLIGENCE_ERRORS_BRIEF_UNAVAILABLE', messageKey: 'contentIntelligence.errors.briefUnavailable' });
    }
    const scopedClientKey = makeIdempotencyKey(input.accountId, `content-brief-${input.analysisId}`, input.clientKey);
    const prior = doc.briefVersions.find((version) => version.clientKey === scopedClientKey);
    if (prior) {
        return {
            versionId: prior.versionId,
            sections: prior.sections.map((section) => ({
                heading: section.heading,
                body: section.body,
            })),
            savedAt: (prior.savedAt as Date).toISOString(),
        };
    }
    const savedAt = new Date();
    const versionId = `user-${createHash('sha256')
        .update(`${input.analysisId}:${scopedClientKey}`)
        .digest('hex')
        .slice(0, 16)}`;
    const sections = input.sections.map((section) => ({
        heading: section.heading.trim(),
        body: section.body.trim(),
    }));
    doc.brief.versionId = versionId;
    doc.set('brief.sections', sections);
    doc.brief.text = sections
        .map((section) => `${section.heading}\n\n${section.body}`)
        .join('\n\n');
    doc.briefVersions.push({
        versionId,
        sections,
        savedAt,
        actorUserId: input.actorUserId,
        clientKey: scopedClientKey,
    });
    await doc.save();
    return { versionId, sections, savedAt: savedAt.toISOString() };
}
export async function saveDraftVersion(input: {
    accountId: string;
    actorUserId: string;
    analysisId: string;
    markdown: string;
    clientKey: string;
}): Promise<SavedDraftVersion> {
    if (!Types.ObjectId.isValid(input.analysisId)) {
        throw HttpError.notFound({ code: 'CONTENT_INTELLIGENCE_ERRORS_NOT_FOUND', messageKey: 'contentIntelligence.errors.notFound' });
    }
    const doc = await ContentAnalysis.findOne({
        _id: input.analysisId,
        accountId: input.accountId,
    });
    if (!doc)
        throw HttpError.notFound({ code: 'CONTENT_INTELLIGENCE_ERRORS_NOT_FOUND', messageKey: 'contentIntelligence.errors.notFound' });
    await loadOwnedSite(input.accountId, String(doc.siteId));
    if (!doc.draft) {
        throw HttpError.conflict({ code: 'CONTENT_INTELLIGENCE_ERRORS_DRAFT_UNAVAILABLE', messageKey: 'contentIntelligence.errors.draftUnavailable' });
    }
    const scopedClientKey = makeIdempotencyKey(input.accountId, `content-draft-${input.analysisId}`, input.clientKey);
    const prior = doc.draftVersions.find((version) => version.clientKey === scopedClientKey);
    if (prior) {
        return {
            versionId: prior.versionId,
            markdown: prior.markdown,
            wordCount: prior.wordCount,
            savedAt: (prior.savedAt as Date).toISOString(),
        };
    }
    const savedAt = new Date();
    const versionId = `user-${createHash('sha256')
        .update(`${input.analysisId}:${scopedClientKey}`)
        .digest('hex')
        .slice(0, 16)}`;
    const trimmed = input.markdown.trim();
    const wordCount = trimmed.length === 0 ? 0 : trimmed.split(/\s+/u).length;
    doc.draft.markdown = input.markdown;
    doc.draft.wordCount = wordCount;
    doc.draftVersions.push({
        versionId,
        markdown: input.markdown,
        wordCount,
        savedAt,
        actorUserId: input.actorUserId,
        clientKey: scopedClientKey,
    });
    await doc.save();
    return { versionId, markdown: input.markdown, wordCount, savedAt: savedAt.toISOString() };
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
export interface PreflightInput {
    accountId: string;
    siteId: string;
    ownedUrl: string;
    keyword: string;
    locale: string;
}
export interface PreflightResult {
    ok: boolean;
    reason: null | 'not_owned' | 'off_origin' | 'url_unsafe' | 'url_invalid';
}
/**
 * Preflight — parse + ownership + SSRF-safe. Never writes, never enqueues,
 * never spends. Used by the UI to disable the create button early.
 */
export async function preflightAnalysis(input: PreflightInput): Promise<PreflightResult> {
    if (!Types.ObjectId.isValid(input.siteId)) {
        return { ok: false, reason: 'not_owned' };
    }
    const site = await Site.findOne({
        _id: input.siteId,
        accountId: input.accountId,
        deletionStartedAt: null,
    });
    if (!site)
        return { ok: false, reason: 'not_owned' };
    let parsed: URL;
    try {
        parsed = new URL(input.ownedUrl);
    }
    catch {
        return { ok: false, reason: 'url_invalid' };
    }
    if (parsed.origin !== site.url)
        return { ok: false, reason: 'off_origin' };
    try {
        await assertPublicUrlSafe(input.ownedUrl);
    }
    catch {
        return { ok: false, reason: 'url_unsafe' };
    }
    return { ok: true, reason: null };
}
/** START — the load-bearing 8-step ordering above. */
export async function startAnalysis(input: CreateAnalysisInput, deps: CreateAnalysisDeps): Promise<StartedAnalysis> {
    const queue = deps.contentAnalysisQueue;
    if (!queue) {
        // A run record with no consumer would never finish — refuse loudly.
        throw new HttpError(503, { code: 'CONTENT_INTELLIGENCE_ERRORS_QUEUE_UNAVAILABLE', messageKey: 'contentIntelligence.errors.queueUnavailable' });
    }
    // (2) Ownership.
    const site = await loadOwnedSite(input.accountId, input.siteId);
    assertSiteNotPaused(site);
    // (3) + (4) Origin + SSRF-safe.
    await assertOwnedUrl(site.url, input.ownedUrl);
    // Focused landscape handoff: resolve approved reviews server-side. The URL
    // query string is only a prefill; it never becomes source authority.
    const loadReviewedPageMatch = deps.loadReviewedPageMatch ?? loadFrozenReviewedPageMatch;
    const reviewedMatches = await Promise.all((input.reviewedPageMatches ?? []).map((reference) => loadReviewedPageMatch(deps.db, {
        accountId: input.accountId,
        siteId: input.siteId,
        reportId: reference.landscapeReportId,
        suggestionId: reference.suggestionId,
        opportunityId: reference.landscapeOpportunityId ?? null,
    })));
    const reservationKey = makeRunKey(input.accountId, input.siteId, input.ownedUrl, input.keyword, input.locale, input.clientKey, reviewedMatches.map((match) => `${match.landscapeReportId}:${match.suggestionId}`));
    // Idempotent short-circuit — a duplicate key returns the existing run
    // before any write. The unique index below is the authoritative dedup;
    // this pre-read is a fast path.
    const existing = await ContentAnalysis.findOne({
        accountId: input.accountId,
        siteId: input.siteId,
        idempotencyKey: reservationKey,
    });
    if (existing) {
        return {
            analysisId: String(existing._id),
            status: existing.status,
            reservationKey,
            duplicate: true,
        };
    }
    const fingerprint = makeInputFingerprint({
        siteId: input.siteId,
        ownedUrl: input.ownedUrl,
        keyword: input.keyword,
        locale: input.locale,
    });
    // (5) Create the domain record.
    let doc;
    try {
        doc = await ContentAnalysis.create({
            accountId: input.accountId,
            ownerUserId: input.ownerUserId,
            siteId: input.siteId,
            ownedUrl: input.ownedUrl,
            keyword: input.keyword,
            reviewedCompetitorUrls: reviewedMatches.map((match) => match.selectedUrl),
            reviewedPageMatches: reviewedMatches.map((match) => ({
                landscapeReportId: match.landscapeReportId,
                landscapeOpportunityId: match.landscapeOpportunityId,
                suggestionId: match.suggestionId,
                competitorProfileId: match.competitorProfileId,
            })),
            locale: input.locale,
            status: 'queued',
            stages: [
                {
                    name: 'queued',
                    startedAt: new Date(),
                    completedAt: null,
                    error: null,
                },
            ],
            inputFingerprint: fingerprint,
            idempotencyKey: reservationKey,
            providerRefs: { snapshotIds: [] },
            requestedAt: new Date(),
        });
    }
    catch (err) {
        // A duplicate can be a legitimate concurrent winner; all other errors
        // are re-thrown.
        if (isDuplicateKeyError(err)) {
            // A parallel writer beat us to it; return its analysis when visible.
            const existingRace = await ContentAnalysis.findOne({
                accountId: input.accountId,
                siteId: input.siteId,
                idempotencyKey: reservationKey,
            });
            if (existingRace) {
                return {
                    analysisId: String(existingRace._id),
                    status: existingRace.status,
                    reservationKey,
                    duplicate: true,
                };
            }
        }
        throw err;
    }
    // (6) Enqueue with the deterministic job id.
    try {
        await enqueueContentAnalysisJob(queue, {
            accountId: input.accountId,
            siteId: input.siteId,
            analysisId: String(doc._id),
            reservationKey,
        });
    }
    catch (err) {
        // Enqueue failure BEFORE any processor takes ownership — mark the run
        // failed, record the terminal event, and re-raise as 503.
        doc.status = 'failed';
        doc.error = {
            category: 'unexpected',
            messageKey: 'contentIntelligence.errors.queueUnavailable',
            retryable: true,
            terminal: true,
        };
        doc.completedAt = new Date();
        await doc.save();
        await recordContentAnalysisEvent(deps.db, {
            accountId: input.accountId,
            siteId: input.siteId,
            analysisId: String(doc._id),
            reservationKey,
            kind: 'failed',
            errorCategory: 'unexpected',
        });
        throw new HttpError(503, { code: 'CONTENT_INTELLIGENCE_ERRORS_QUEUE_UNAVAILABLE', messageKey: 'contentIntelligence.errors.queueUnavailable' }, undefined, {
            cause: err,
        });
    }
    return {
        analysisId: String(doc._id),
        status: doc.status,
        reservationKey,
        duplicate: false,
    };
}
/**
 * Regenerate — a brand-new run. The client key is derived server-side
 * from the source analysis + the current timestamp so it cannot collide
 * with the original. The source URL / keyword / locale carry over, so any
 * change must go through the create endpoint.
 */
export async function regenerateAnalysis(input: {
    accountId: string;
    ownerUserId: string;
    analysisId: string;
}, deps: CreateAnalysisDeps): Promise<StartedAnalysis> {
    if (!Types.ObjectId.isValid(input.analysisId)) {
        throw HttpError.notFound({ code: 'CONTENT_INTELLIGENCE_ERRORS_NOT_FOUND', messageKey: 'contentIntelligence.errors.notFound' });
    }
    const source = await ContentAnalysis.findOne({
        _id: input.analysisId,
        accountId: input.accountId,
    });
    if (!source)
        throw HttpError.notFound({ code: 'CONTENT_INTELLIGENCE_ERRORS_NOT_FOUND', messageKey: 'contentIntelligence.errors.notFound' });
    await loadOwnedSite(input.accountId, String(source.siteId));
    // Only completed / partial / failed / cancelled analyses can be
    // regenerated — an in-flight run keeps its slot.
    if (isContentAnalysisCancellable(source.status)) {
        throw HttpError.conflict({ code: 'CONTENT_INTELLIGENCE_ERRORS_REGENERATE_IN_FLIGHT', messageKey: 'contentIntelligence.errors.regenerateInFlight' });
    }
    const clientKey = createHash('sha256')
        .update(`${source._id}:${Date.now()}:${Math.random()}`)
        .digest('hex')
        .slice(0, 32);
    return startAnalysis({
        accountId: input.accountId,
        ownerUserId: input.ownerUserId,
        siteId: String(source.siteId),
        ownedUrl: source.ownedUrl,
        keyword: source.keyword,
        locale: source.locale,
        clientKey,
    }, deps);
}
export interface CancelAnalysisInput {
    accountId: string;
    analysisId: string;
}
/**
 * Cancel a cancellable run. Terminal runs return 409.
 */
export async function cancelAnalysis(input: CancelAnalysisInput): Promise<void> {
    if (!Types.ObjectId.isValid(input.analysisId)) {
        throw HttpError.notFound({ code: 'CONTENT_INTELLIGENCE_ERRORS_NOT_FOUND', messageKey: 'contentIntelligence.errors.notFound' });
    }
    const doc = await ContentAnalysis.findOne({
        _id: input.analysisId,
        accountId: input.accountId,
    });
    if (!doc)
        throw HttpError.notFound({ code: 'CONTENT_INTELLIGENCE_ERRORS_NOT_FOUND', messageKey: 'contentIntelligence.errors.notFound' });
    await loadOwnedSite(input.accountId, String(doc.siteId));
    if (!isContentAnalysisCancellable(doc.status)) {
        throw HttpError.conflict({ code: 'CONTENT_INTELLIGENCE_ERRORS_NOT_CANCELLABLE', messageKey: 'contentIntelligence.errors.notCancellable' });
    }
    assertContentAnalysisTransition(doc.status, 'cancelled');
    doc.status = 'cancelled';
    doc.cancelledAt = new Date();
    doc.completedAt = new Date();
    doc.error = {
        category: 'cancelled',
        messageKey: 'contentIntelligence.errors.cancelledByUser',
        retryable: false,
        terminal: true,
    };
    await doc.save();
}
export interface ListAnalysesInput {
    accountId: string;
    siteId: string;
    limit: number;
    cursor?: string;
    locale?: SupportedLocale;
}
export interface ListAnalysesResult {
    items: ReturnType<typeof toPublicAnalysis>[];
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
export async function listAnalyses(input: ListAnalysesInput): Promise<ListAnalysesResult> {
    // Ownership.
    const site = await loadOwnedSite(input.accountId, input.siteId);
    // The Mongo filter is composed only from typed values above — but for
    // future-proofing (a client body ever influencing the filter) run the
    // filter shape through the strip-operators helper.
    const filter = stripQueryOperators({
        accountId: input.accountId,
        siteId: String(site._id),
    }) as {
        accountId: string;
        siteId: string;
    };
    const query: Record<string, unknown> = { ...filter };
    if (input.cursor) {
        let decoded: CursorPayload;
        try {
            const raw = getCursorCodec().decode(input.cursor);
            decoded = JSON.parse(raw) as CursorPayload;
        }
        catch {
            throw HttpError.badRequest({ code: 'CONTENT_INTELLIGENCE_ERRORS_CURSOR_INVALID', messageKey: 'contentIntelligence.errors.cursorInvalid' });
        }
        query.requestedAt = { $lt: new Date(decoded.ts) };
    }
    const rows = await ContentAnalysis.find(query)
        .sort({ requestedAt: -1, _id: -1 })
        .limit(input.limit + 1);
    const hasMore = rows.length > input.limit;
    const page = hasMore ? rows.slice(0, input.limit) : rows;
    const items = page.map((r) => {
        const plain = r.toObject() as ContentAnalysisDocument & {
            _id: unknown;
        };
        return toPublicAnalysis(plain, input.locale ?? toSupportedLocale(plain.locale));
    });
    let nextCursor: string | null = null;
    if (hasMore) {
        const last = page[page.length - 1]!;
        const ts = (last.requestedAt as Date).getTime();
        nextCursor = getCursorCodec().encode(JSON.stringify({ ts, id: String(last._id) } satisfies CursorPayload));
    }
    return { items, nextCursor };
}
export async function getAnalysis(input: {
    accountId: string;
    analysisId: string;
    siteId?: string;
    locale?: SupportedLocale;
}) {
    if (!Types.ObjectId.isValid(input.analysisId)) {
        throw HttpError.notFound({ code: 'CONTENT_INTELLIGENCE_ERRORS_NOT_FOUND', messageKey: 'contentIntelligence.errors.notFound' });
    }
    const doc = await ContentAnalysis.findOne({
        _id: input.analysisId,
        accountId: input.accountId,
        ...(input.siteId ? { siteId: input.siteId } : {}),
    });
    if (!doc)
        throw HttpError.notFound({ code: 'CONTENT_INTELLIGENCE_ERRORS_NOT_FOUND', messageKey: 'contentIntelligence.errors.notFound' });
    await loadOwnedSite(input.accountId, String(doc.siteId));
    return toPublicAnalysis(doc.toObject() as never, input.locale ?? toSupportedLocale(doc.locale));
}
/** Resolve an analysis URL id to its owned Site without exposing foreign ids. */
export async function resolveOwnedAnalysisSiteId(accountId: string, analysisId: string): Promise<string | null> {
    if (!Types.ObjectId.isValid(analysisId))
        return null;
    const doc = await ContentAnalysis.findOne({ _id: analysisId, accountId }, { siteId: 1 }).lean();
    return doc ? String(doc.siteId) : null;
}
