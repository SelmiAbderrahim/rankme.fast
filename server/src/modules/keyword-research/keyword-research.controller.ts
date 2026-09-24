import type { SpendPreview } from '../../shared/safety/operation-preview.js';
import type { RequestHandler } from 'express';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { env } from '../../config/env.js';
import { requireAccountId } from '../../shared/utils/require-account-id.js';
import { clusterListQuerySchema, clusterRunRequestSchema, decisionRequestSchema, gapRequestSchema, historyQuerySchema, ideasRequestSchema, intentRequestSchema, metricsRequestSchema, longTailRequestSchema, overviewRequestSchema, previewRequestSchema, relatedRequestSchema, runIdClusterIdParamSchema, runIdParamSchema, trendsExplorePreviewRequestSchema, trendsExploreRequestSchema, trendsListQuerySchema, trendsRequestSchema, trendsRunIdParamSchema, } from './keyword-research.schema.js';
import { applyClusterDecision, serializeDecision, } from './keyword-research.decisions.js';
import { getKeywordProvider, getKeywordResearchAiProviderOrder, getKeywordResearchAiRunner, getKeywordResearchCompetitorProvider, getKeywordResearchDb, getKeywordResearchTrendsProvider, } from './keyword-research.holder.js';
import { computeClusterRunId, findClusterRunForAccount, listClusterRunsForAccount, runClustering, sortedNormalizedPhrases, type ClusterRunSummary, } from './keyword-research.clustering.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { allowedTeamSiteIds, assertTeamSiteAccess, } from '../../shared/middleware/team-site-access.js';
import { classifyIntentCached, dedupeKeywordPhrases, exploreTrendsLive, findTrendsRun, getGapCached, getIdeasCached, getLongTailSuggestionsCached, getMetricsCached, getOverviewCached, getRelatedCached, getTrendsCached, listTrendsRunsForAccount, serializeStoredRun, } from './keyword-research.service.js';
import { computeGapCacheKey, computeKeywordCacheKey, createKeywordCacheRepo, normalizeCacheDomain, normalizeCachePhrase, } from './keyword-research.cache.js';
import { listResearchHistory, recordResearchHistory, } from './keyword-research.history.js';
import { getSite } from '../sites/index.js';
import { assertSiteNotPaused } from '../sites/sites.guard.js';
export const metricsHandler: RequestHandler = asyncHandler(async (req, res) => {
    const body = metricsRequestSchema.parse(req.body);
    const accountId = requireAccountId(req);
    const dedupedPhrases = dedupeKeywordPhrases(body.keywords);
    const results = await getMetricsCached(body, {
        db: getKeywordResearchDb(),
        provider: getKeywordProvider(),
        ttlDays: env.KEYWORD_CACHE_TTL_DAYS,
    });
    // Successes only reach this point — a 503 above never logs history. The
    // client's mount-time probe is excluded; real searches are recorded even
    // on cache hits (history = "what did I search").
    if (!body.probe) {
        await recordResearchHistory(getKeywordResearchDb(), {
            accountId,
            kind: 'metrics',
            phrases: dedupedPhrases,
            locationCode: body.locationCode,
            languageCode: body.languageCode,
            resultCount: results.length,
            // zod guarantees ≥1 phrase and the service returns one row per deduped
            // phrase, so `results` is never empty here.
            cached: results.every((r) => r.cached),
        });
    }
    res.status(200).json({ keywords: results });
});
export const relatedHandler: RequestHandler = asyncHandler(async (req, res) => {
    const body = relatedRequestSchema.parse(req.body);
    const accountId = requireAccountId(req);
    const result = await getRelatedCached(body, {
        db: getKeywordResearchDb(),
        provider: getKeywordProvider(),
        ttlDays: env.KEYWORD_CACHE_TTL_DAYS,
    });
    await recordResearchHistory(getKeywordResearchDb(), {
        accountId,
        kind: 'related',
        phrases: [result.keyword],
        locationCode: body.locationCode,
        languageCode: body.languageCode,
        resultCount: result.related.length,
        cached: result.cached,
    });
    res.status(200).json(result);
});
export const intentHandler: RequestHandler = asyncHandler(async (req, res) => {
    const body = intentRequestSchema.parse(req.body);
    const accountId = requireAccountId(req);
    const dedupedPhrases = dedupeKeywordPhrases(body.keywords);
    const results = await classifyIntentCached(body, {
        db: getKeywordResearchDb(),
        provider: getKeywordProvider(),
        ttlDays: env.KEYWORD_CACHE_TTL_DAYS,
    });
    await recordResearchHistory(getKeywordResearchDb(), {
        accountId,
        kind: 'intent',
        phrases: dedupedPhrases,
        locationCode: body.locationCode,
        languageCode: body.languageCode,
        resultCount: results.length,
        // Never empty — same guarantee as the metrics handler above.
        cached: results.every((r) => r.cached),
    });
    res.status(200).json({ intents: results });
});
export const ideasHandler: RequestHandler = asyncHandler(async (req, res) => {
    const body = ideasRequestSchema.parse(req.body);
    const accountId = requireAccountId(req);
    const result = await getIdeasCached(body, {
        db: getKeywordResearchDb(),
        provider: getKeywordProvider(),
        ttlDays: env.KEYWORD_CACHE_TTL_DAYS,
    });
    await recordResearchHistory(getKeywordResearchDb(), {
        accountId,
        kind: 'ideas',
        phrases: [result.seed],
        locationCode: body.locationCode,
        languageCode: body.languageCode,
        resultCount: result.ideas.length,
        cached: result.cached,
    });
    res.status(200).json(result);
});
export const longTailHandler: RequestHandler = asyncHandler(async (req, res) => {
    const body = longTailRequestSchema.parse(req.body);
    const accountId = requireAccountId(req);
    const result = await getLongTailSuggestionsCached(body, {
        db: getKeywordResearchDb(),
        provider: getKeywordProvider(),
        ttlDays: env.KEYWORD_CACHE_TTL_DAYS,
    });
    await recordResearchHistory(getKeywordResearchDb(), {
        accountId,
        kind: 'long_tail',
        phrases: [result.seed],
        locationCode: body.locationCode,
        languageCode: body.languageCode,
        resultCount: result.suggestions.length,
        cached: result.cached,
    });
    res.status(200).json(result);
});
export const historyHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const query = historyQuerySchema.parse(req.query);
    const page = await listResearchHistory(getKeywordResearchDb(), {
        accountId,
        ...query,
    });
    res.status(200).json(page);
});
// ---------------------------------------------------------------------------
// Keyword gap / overview / trends / preview
// ---------------------------------------------------------------------------
/**
 * Normalize competitor domains coming in from an already-validated request.
 * Zod (see `refineGapCompetitors` in `.schema.ts`) rejects duplicates and
 * the own-domain-as-competitor conflict BEFORE this runs, so the input is
 * always unique — this helper is a thin normalization pass, kept as a named
 * function so the controller reads left-to-right.
 */
function normalizeCompetitors(list: readonly string[]): string[] {
    return list.map(normalizeCacheDomain);
}
export const gapHandler: RequestHandler = asyncHandler(async (req, res) => {
    const body = gapRequestSchema.parse(req.body);
    const accountId = requireAccountId(req);
    const dedupedCompetitors = normalizeCompetitors(body.competitors);
    const result = await getGapCached({
        ownDomain: body.ownDomain,
        competitors: dedupedCompetitors,
        locationCode: body.locationCode,
        languageCode: body.languageCode,
    }, {
        db: getKeywordResearchDb(),
        provider: getKeywordProvider(),
        competitorProvider: getKeywordResearchCompetitorProvider(),
        ttlDays: env.KEYWORD_CACHE_TTL_DAYS,
    });
    // Success-only history write. Store the deduped competitor list as phrases
    // so the history UI can label the row without a JSON payload lookup.
    await recordResearchHistory(getKeywordResearchDb(), {
        accountId,
        kind: 'gap',
        phrases: dedupedCompetitors,
        locationCode: body.locationCode,
        languageCode: body.languageCode,
        resultCount: result.pairs.reduce((sum, p) => sum + p.rows.length, 0),
        cached: result.pairs.every((p) => p.cached),
    });
    res.status(200).json({ ownDomain: body.ownDomain, pairs: result.pairs });
});
export const overviewHandler: RequestHandler = asyncHandler(async (req, res) => {
    const body = overviewRequestSchema.parse(req.body);
    const accountId = requireAccountId(req);
    const dedupedPhrases = dedupeKeywordPhrases(body.keywords);
    const results = await getOverviewCached(body, {
        db: getKeywordResearchDb(),
        provider: getKeywordProvider(),
        ttlDays: env.KEYWORD_CACHE_TTL_DAYS,
    });
    await recordResearchHistory(getKeywordResearchDb(), {
        accountId,
        kind: 'overview',
        phrases: dedupedPhrases,
        locationCode: body.locationCode,
        languageCode: body.languageCode,
        resultCount: results.length,
        cached: results.every((r) => r.cached),
    });
    res.status(200).json({ keywords: results });
});
export const trendsHandler: RequestHandler = asyncHandler(async (req, res) => {
    const body = trendsRequestSchema.parse(req.body);
    const accountId = requireAccountId(req);
    const dedupedPhrases = dedupeKeywordPhrases(body.keywords);
    const results = await getTrendsCached(body, {
        db: getKeywordResearchDb(),
        provider: getKeywordProvider(),
        ttlDays: env.KEYWORD_CACHE_TTL_DAYS,
    });
    await recordResearchHistory(getKeywordResearchDb(), {
        accountId,
        kind: 'trends',
        phrases: dedupedPhrases,
        locationCode: body.locationCode,
        languageCode: body.languageCode,
        resultCount: results.length,
        cached: results.every((r) => r.cached),
    });
    res.status(200).json({ keywords: results });
});
/**
 * Preview — READ-ONLY cache probe. Same dedupe/normalize path as the
 * provider-backed routes; probes the vendor_cache under `keyword`/`<op>` for
 * a cached/fresh split. NEVER calls a provider or writes to
 * `keyword_research_history`.
 */
export const previewHandler: RequestHandler = asyncHandler(async (req, res) => {
    const body = previewRequestSchema.parse(req.body);
    requireAccountId(req);
    const repo = createKeywordCacheRepo(getKeywordResearchDb());
    const now = new Date();
    let keys: string[];
    if (body.operation === 'gap') {
        const ownDomain = normalizeCacheDomain(body.ownDomain);
        keys = normalizeCompetitors(body.competitors).map((competitor) => computeGapCacheKey({
            ownDomain,
            competitorDomain: competitor,
            locationCode: body.locationCode,
            languageCode: body.languageCode,
        }));
    }
    else {
        keys = dedupeKeywordPhrases(body.keywords).map((phrase) => computeKeywordCacheKey({
            phrase: normalizeCachePhrase(phrase),
            locationCode: body.locationCode,
            languageCode: body.languageCode,
        }));
    }
    const hits = body.operation === 'gap'
        ? await repo.readGapMany(keys, now)
        : body.operation === 'overview'
            ? await repo.readOverviewMany(keys, now)
            : await repo.readTrendsMany(keys, now);
    const cachedUnits = keys.filter((key) => hits.has(key)).length;
    const preview: SpendPreview = { deploymentMode: 'community', capacityEnforced: false };
    res.status(200).json({
        ...preview,
        cachedUnits,
        freshUnits: keys.length - cachedUnits,
    });
});
// ---------------------------------------------------------------------------
// Cited AI clustering pipeline
// ---------------------------------------------------------------------------
function serializeRunSummary(run: ClusterRunSummary): unknown {
    return {
        runId: run.runId,
        market: run.market,
        memberRefs: run.memberRefs.map((ref) => ({
            keyword: ref.keyword,
            source: ref.source,
            observedAt: ref.observedAt.toISOString(),
        })),
        clusters: run.clusters.map((c) => ({
            clusterId: c.clusterId,
            label: c.label,
            memberKeywords: c.memberKeywords,
            suggestedRoute: c.suggestedRoute,
            confidence: c.confidence,
            summedSearchVolume: c.summedSearchVolume,
        })),
        aiProfile: run.aiProfile,
        costMicros: run.costMicros,
        createdAt: run.createdAt.toISOString(),
        cached: run.cached,
    };
}
export const clustersRunHandler: RequestHandler = asyncHandler(async (req, res) => {
    const body = clusterRunRequestSchema.parse(req.body);
    const accountId = requireAccountId(req);
    const db = getKeywordResearchDb();
    // Identity-first: an identical rerun returns the stored run as a free
    // read (no charge, no AI call).
    const normalizedPhrases = sortedNormalizedPhrases(body.phrases);
    const runId = computeClusterRunId({
        accountId,
        locationCode: body.locationCode,
        languageCode: body.languageCode,
        phrases: normalizedPhrases,
    });
    const existing = await findClusterRunForAccount(accountId, runId);
    if (existing) {
        res.status(200).json(serializeRunSummary(existing));
        return;
    }
    const run = await runClustering({
        accountId,
        locationCode: body.locationCode,
        languageCode: body.languageCode,
        phrases: normalizedPhrases,
        // `languageMiddleware` always sets req.language (defaults to
        // env.DEFAULT_LOCALE); this cast avoids a defensive nullish branch.
        locale: req.language as string,
    }, {
        db,
        aiRunner: getKeywordResearchAiRunner(),
        providerOrder: getKeywordResearchAiProviderOrder(),
    });
    // Success-only history entry (matches gap/overview/trends pattern).
    await recordResearchHistory(db, {
        accountId,
        kind: 'clusters',
        phrases: normalizedPhrases,
        locationCode: body.locationCode,
        languageCode: body.languageCode,
        resultCount: run.clusters.length,
        cached: false,
    });
    res.status(200).json(serializeRunSummary(run));
});
export const clustersListHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const query = clusterListQuerySchema.parse(req.query);
    let cursor: {
        createdAt: Date;
        id: string;
    } | null = null;
    if (query.cursor) {
        try {
            const decoded = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')) as {
                createdAt: string;
                id: string;
            };
            const createdAt = new Date(decoded.createdAt);
            if (Number.isNaN(createdAt.getTime()) || typeof decoded.id !== 'string' || !/^[a-f0-9]{24}$/.test(decoded.id)) {
                throw new Error('bad_cursor');
            }
            cursor = { createdAt, id: decoded.id };
        }
        catch {
            throw HttpError.badRequest({ code: 'KEYWORD_RESEARCH_ERRORS_UNKNOWN_CURSOR', messageKey: 'keywordResearch.errors.unknownCursor' });
        }
    }
    const { runs, nextCursor } = await listClusterRunsForAccount(accountId, {
        limit: query.limit,
        cursor,
    });
    const encodedCursor = nextCursor
        ? Buffer.from(JSON.stringify(nextCursor), 'utf8').toString('base64url')
        : null;
    res.status(200).json({
        runs: runs.map(serializeRunSummary),
        nextCursor: encodedCursor,
    });
});
export const clustersDetailHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { runId } = runIdParamSchema.parse(req.params);
    const run = await findClusterRunForAccount(accountId, runId);
    if (!run)
        throw HttpError.notFound({ code: 'KEYWORD_RESEARCH_ERRORS_RUN_NOT_FOUND', messageKey: 'keywordResearch.errors.runNotFound' });
    res.status(200).json(serializeRunSummary(run));
});
// ---------------------------------------------------------------------------
// Cluster decision routing
// ---------------------------------------------------------------------------
//
// Read/write of stored data — no provider call. Every
// operation is scoped to the calling account (cross-account 404). Repeats
// with the same idempotency key + kind → 200 no-op; conflicting kind → 409.
// ---------------------------------------------------------------------------
// Keyword Trends live exploration + stored reads
// ---------------------------------------------------------------------------
//
// The routes below are a DISTINCT surface from the Labs `POST /trends`
// handler (`trendsHandler`), which reads `KeywordProvider.getHistoricalVolume`.
// The live-exploration path reads `TrendsProvider.explore`.
export const trendsExploreHandler: RequestHandler = asyncHandler(async (req, res) => {
    // Kill switch is checked BEFORE any work — a disabled feature must NOT
    // reach the provider. Stored reads (GET /trends, GET /trends/:runId) survive
    // the flag so a customer can still see their historical exploration.
    if (!env.KEYWORD_TRENDS_ENABLED) {
        throw new HttpError(503, { code: 'KEYWORD_RESEARCH_TRENDS_ERRORS_UNAVAILABLE', messageKey: 'keywordResearch.trends.errors.unavailable' }, {
            reason: 'disabled',
        });
    }
    const body = trendsExploreRequestSchema.parse(req.body);
    const accountId = requireAccountId(req);
    if (allowedTeamSiteIds(req) !== null && !body.siteId) {
        throw HttpError.notFound({ code: 'KEYWORD_RESEARCH_TRENDS_ERRORS_NOT_FOUND', messageKey: 'keywordResearch.trends.errors.notFound' });
    }
    if (body.siteId) {
        assertTeamSiteAccess(req, body.siteId);
        const site = await getSite(accountId, body.siteId);
        assertSiteNotPaused(site);
    }
    const dto = await exploreTrendsLive({
        accountId,
        siteId: body.siteId ?? null,
        keywords: body.keywords,
        ...(body.geo !== undefined ? { geo: body.geo } : {}),
        ...(body.language !== undefined ? { language: body.language } : {}),
    }, {
        db: getKeywordResearchDb(),
        provider: getKeywordResearchTrendsProvider(),
        ttlDays: env.KEYWORD_CACHE_TTL_DAYS,
    });
    res.status(200).json(dto);
});
/**
 * Read-only preview endpoint. Never calls a provider or writes a run row.
 * Same site-scope and kill-switch checks as the explore path.
 */
export const trendsExplorePreviewHandler: RequestHandler = asyncHandler(async (req, res) => {
    const body = trendsExplorePreviewRequestSchema.parse(req.body);
    const accountId = requireAccountId(req);
    if (allowedTeamSiteIds(req) !== null && !body.siteId) {
        throw HttpError.notFound({ code: 'KEYWORD_RESEARCH_TRENDS_ERRORS_NOT_FOUND', messageKey: 'keywordResearch.trends.errors.notFound' });
    }
    if (body.siteId) {
        assertTeamSiteAccess(req, body.siteId);
        await getSite(accountId, body.siteId);
    }
    if (!env.KEYWORD_TRENDS_ENABLED) {
        throw new HttpError(503, { code: 'TRENDS_PREVIEW_UNAVAILABLE', messageKey: 'keywordResearch.trends.errors.unavailable' }, {
            reason: 'disabled',
        });
    }
    const preview: SpendPreview = { deploymentMode: 'community', capacityEnforced: false };
    res.status(200).json(preview);
});
export const trendsGetHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { runId } = trendsRunIdParamSchema.parse(req.params);
    const run = await findTrendsRun({ accountId, runId });
    if (!run)
        throw HttpError.notFound({ code: 'KEYWORD_RESEARCH_TRENDS_ERRORS_NOT_FOUND', messageKey: 'keywordResearch.trends.errors.notFound' });
    res.status(200).json(serializeStoredRun(run));
});
export const trendsListHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const query = trendsListQuerySchema.parse(req.query);
    let cursor: {
        createdAt: Date;
        id: string;
    } | null = null;
    if (query.cursor) {
        try {
            const decoded = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')) as {
                createdAt: string;
                id: string;
            };
            const createdAt = new Date(decoded.createdAt);
            if (Number.isNaN(createdAt.getTime()) ||
                typeof decoded.id !== 'string' ||
                !/^[a-f0-9]{24}$/.test(decoded.id)) {
                throw new Error('bad_cursor');
            }
            cursor = { createdAt, id: decoded.id };
        }
        catch {
            throw HttpError.badRequest({ code: 'KEYWORD_RESEARCH_ERRORS_UNKNOWN_CURSOR', messageKey: 'keywordResearch.errors.unknownCursor' });
        }
    }
    const { runs, nextCursor } = await listTrendsRunsForAccount({
        accountId,
        allowedSiteIds: allowedTeamSiteIds(req),
        ...(query.siteId !== undefined ? { siteId: query.siteId } : {}),
        limit: query.limit,
        cursor,
    });
    const encodedCursor = nextCursor
        ? Buffer.from(JSON.stringify(nextCursor), 'utf8').toString('base64url')
        : null;
    res.status(200).json({
        runs: runs.map(serializeStoredRun),
        nextCursor: encodedCursor,
    });
});
export const decisionHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { runId, clusterId } = runIdClusterIdParamSchema.parse(req.params);
    const body = decisionRequestSchema.parse(req.body);
    const result = await applyClusterDecision(getKeywordResearchDb(), {
        accountId,
        runId,
        clusterId,
        kind: body.kind,
        idempotencyKey: body.idempotencyKey,
        note: body.note,
        siteId: body.siteId,
    });
    res.status(result.isNew ? 201 : 200).json(serializeDecision(result.row));
});
