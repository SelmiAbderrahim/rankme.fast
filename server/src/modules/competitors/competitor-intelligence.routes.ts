import { Router, type Request } from 'express';
import { db as productionDb } from '../../db/client.js';
import { logger } from '../../config/logger.js';
import { createBatchRateLimiter } from '../../shared/middleware/rate-limit.js';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { requireAccountId } from '../../shared/utils/require-account-id.js';
import { toSupportedLocale } from '../../shared/i18n/index.js';
import { addCompetitor, archiveCompetitor, getCompetitorContentDb, listCompetitors, restoreCompetitor, } from '../competitor-content/index.js';
import { addCompetitorProfileBodySchema, competitorIntelligenceSiteParamsSchema, competitorPortfolioQuerySchema, competitorProfileParamsSchema, emptyMutationBodySchema, emptyQuerySchema, idempotencyHeadersSchema, landscapeDetailQuerySchema, landscapeListQuerySchema, landscapeOpportunityParamsSchema, landscapePageMatchParamsSchema, landscapePageMatchReviewBodySchema, landscapePreviewBodySchema, landscapeRunParamsSchema, landscapeStartBodySchema, } from './competitor-intelligence.schemas.js';
import { getLatestCompetitorDiscovery, previewCompetitorDiscovery, refreshCompetitorDiscovery, } from './competitor-discovery.service.js';
import { getCompetitorProvider } from './competitors.holder.js';
import { acceptLandscapeOpportunity, cancelLandscape, getCompetitorLandscapeDb, getCompetitorLandscapeQueue, getFilteredLandscapeRun, listLandscapeRuns, previewLandscape, startLandscape, reviewLandscapePageMatch, } from './landscape/index.js';
function resolveDb() {
    return getCompetitorLandscapeDb() ?? getCompetitorContentDb() ?? productionDb;
}
function idempotencyKey(req: Request): string {
    const parsed = idempotencyHeadersSchema.safeParse({
        'idempotency-key': req.get('Idempotency-Key'),
    });
    if (!parsed.success) {
        throw HttpError.badRequest({ code: 'COMPETITORS_LANDSCAPE_ERRORS_IDEMPOTENCY_INVALID', messageKey: 'competitors.landscape.errors.idempotencyInvalid' });
    }
    return parsed.data['idempotency-key'];
}
function userId(req: Pick<Request, 'user'>): string {
    if (!req.user)
        throw HttpError.unauthorized({ code: 'ERRORS_UNAUTHORIZED', messageKey: 'errors.unauthorized' });
    return req.user.id;
}
function mutationBody(req: {
    readonly body?: unknown;
}): unknown {
    return req.body ?? {};
}
export const competitorIntelligenceRouteTestables = Object.freeze({
    mutationBody,
    resolveDb,
    userId,
});
/** Canonical site-scoped API. The legacy competitors router remains mounted independently. */
export function createCompetitorIntelligenceRouter(): Router {
    const router = Router({ mergeParams: true });
    const mutate = createBatchRateLimiter('competitor_manage');
    const poll = createBatchRateLimiter('content_intelligence_poll');
    router.get('/competitors', poll, asyncHandler(async (req, res) => {
        const accountId = requireAccountId(req);
        const { siteId } = competitorIntelligenceSiteParamsSchema.parse(req.params);
        const query = competitorPortfolioQuerySchema.parse(req.query);
        const items = await listCompetitors(resolveDb(), { accountId, siteId, status: query.status });
        res.status(200).json({ items });
    }));
    router.post('/competitors', mutate, asyncHandler(async (req, res) => {
        const accountId = requireAccountId(req);
        const { siteId } = competitorIntelligenceSiteParamsSchema.parse(req.params);
        const body = addCompetitorProfileBodySchema.parse(req.body);
        idempotencyKey(req);
        const result = await addCompetitor(resolveDb(), {
            accountId,
            siteId,
            url: body.url,
            source: body.source,
        });
        res.status(result.duplicate ? 200 : 201).json(result);
    }));
    router.put('/landscapes/:runId/page-matches/:suggestionId', mutate, asyncHandler(async (req, res) => {
        const accountId = requireAccountId(req);
        const { siteId, runId, suggestionId } = landscapePageMatchParamsSchema.parse(req.params);
        const body = landscapePageMatchReviewBodySchema.parse(req.body);
        const result = await reviewLandscapePageMatch({
            accountId,
            siteId,
            reportId: runId,
            suggestionId,
            reviewedByUserId: userId(req),
            idempotencyKey: idempotencyKey(req),
            ...body,
        }, { db: resolveDb() });
        res.status(result.replayed ? 200 : 201).json(result);
    }));
    for (const [suffix, mutateProfile] of [
        ['archive', archiveCompetitor],
        ['restore', restoreCompetitor],
    ] as const) {
        router.post(`/competitors/:competitorId/${suffix}`, mutate, asyncHandler(async (req, res) => {
            const accountId = requireAccountId(req);
            const { siteId, competitorId } = competitorProfileParamsSchema.parse(req.params);
            emptyMutationBodySchema.parse(mutationBody(req));
            idempotencyKey(req);
            const profile = await mutateProfile(resolveDb(), { accountId, siteId, competitorId });
            res.status(200).json({ profile });
        }));
    }
    router.post('/discovery/preview', mutate, asyncHandler(async (req, res) => {
        const accountId = requireAccountId(req);
        const { siteId } = competitorIntelligenceSiteParamsSchema.parse(req.params);
        emptyMutationBodySchema.parse(mutationBody(req));
        const preview = await previewCompetitorDiscovery({ db: resolveDb(), accountId, siteId });
        res.status(200).json(preview);
    }));
    router.get('/discovery', poll, asyncHandler(async (req, res) => {
        const accountId = requireAccountId(req);
        const { siteId } = competitorIntelligenceSiteParamsSchema.parse(req.params);
        emptyQuerySchema.parse(req.query);
        const discovery = await getLatestCompetitorDiscovery({
            db: resolveDb(),
            accountId,
            siteId,
            locale: toSupportedLocale(req.language),
        });
        res.setHeader('Content-Language', toSupportedLocale(req.language));
        res.status(200).json({ discovery });
    }));
    router.post('/discovery/refresh', mutate, asyncHandler(async (req, res) => {
        const accountId = requireAccountId(req);
        const { siteId } = competitorIntelligenceSiteParamsSchema.parse(req.params);
        emptyMutationBodySchema.parse(mutationBody(req));
        const result = await refreshCompetitorDiscovery({
            db: resolveDb(),
            provider: getCompetitorProvider(),
            accountId,
            siteId,
            idempotencyKey: idempotencyKey(req),
            locale: toSupportedLocale(req.language),
        });
        res.setHeader('Content-Language', toSupportedLocale(req.language));
        res.status(200).json(result);
    }));
    router.post('/landscapes/preview', mutate, asyncHandler(async (req, res) => {
        const accountId = requireAccountId(req);
        const { siteId } = competitorIntelligenceSiteParamsSchema.parse(req.params);
        const body = landscapePreviewBodySchema.parse(req.body);
        const preview = await previewLandscape(body, { accountId, siteId }, { db: resolveDb() });
        logger.info({
            event: 'competitor_landscape_preview',
            enabled: preview.enabled,
            unitsRequired: preview.unitsRequired,
            competitorCount: preview.competitorCount,
            maxRows: preview.maxRows,
        }, 'competitor landscape previewed');
        res.status(200).json(preview);
    }));
    router.post('/landscapes', mutate, asyncHandler(async (req, res) => {
        const accountId = requireAccountId(req);
        const { siteId } = competitorIntelligenceSiteParamsSchema.parse(req.params);
        const body = landscapeStartBodySchema.parse(req.body);
        const run = await startLandscape({ ...body, idempotencyKey: idempotencyKey(req) }, { accountId, requestedByUserId: userId(req), siteId }, { db: resolveDb(), queue: getCompetitorLandscapeQueue() });
        logger.info({
            event: 'competitor_landscape_enqueued',
            runId: run.runId,
            state: run.state,
            duplicate: run.duplicate,
            enabled: true,
        }, 'competitor landscape accepted');
        res.status(run.duplicate ? 200 : 202).json({ run });
    }));
    router.get('/landscapes', poll, asyncHandler(async (req, res) => {
        const accountId = requireAccountId(req);
        const { siteId } = competitorIntelligenceSiteParamsSchema.parse(req.params);
        const query = landscapeListQuerySchema.parse(req.query);
        const result = await listLandscapeRuns({ accountId, siteId, ...query });
        res.status(200).json(result);
    }));
    router.get('/landscapes/:runId', poll, asyncHandler(async (req, res) => {
        const accountId = requireAccountId(req);
        const { siteId, runId } = landscapeRunParamsSchema.parse(req.params);
        const query = landscapeDetailQuerySchema.parse(req.query);
        const result = await getFilteredLandscapeRun({
            accountId,
            siteId,
            runId,
            db: resolveDb(),
            locale: toSupportedLocale(req.language),
            ...query,
        });
        res.status(200).json(result);
    }));
    router.post('/landscapes/:runId/cancel', mutate, asyncHandler(async (req, res) => {
        const accountId = requireAccountId(req);
        const { siteId, runId } = landscapeRunParamsSchema.parse(req.params);
        emptyMutationBodySchema.parse(mutationBody(req));
        idempotencyKey(req);
        const run = await cancelLandscape({ accountId, siteId, runId });
        res.status(200).json({ run });
    }));
    router.post('/landscapes/:runId/opportunities/:opportunityId/accept', mutate, asyncHandler(async (req, res) => {
        const accountId = requireAccountId(req);
        const { siteId, runId, opportunityId } = landscapeOpportunityParamsSchema.parse(req.params);
        emptyMutationBodySchema.parse(mutationBody(req));
        const acceptance = await acceptLandscapeOpportunity(resolveDb(), {
            accountId,
            siteId,
            reportId: runId,
            opportunityId,
            acceptedByUserId: userId(req),
            idempotencyKey: idempotencyKey(req),
        });
        res.status(acceptance.replayed ? 200 : 201).json({ acceptance });
    }));
    return router;
}
