import type { Request, Response } from 'express';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { requireAccountId } from '../../shared/utils/require-account-id.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { sendLocalizedMessage } from '../../shared/i18n/localized-response.js';
import { toSupportedLocale } from '../../shared/i18n/index.js';
import { env } from '../../config/env.js';
import { db as productionDb } from '../../db/client.js';
import { getContentAnalysisQueue, getContentIntelligenceDb, } from './content-intelligence.holders.js';
import { cancelAnalysis, getAnalysis, listAnalyses, preflightAnalysis, regenerateAnalysis, saveBriefVersion, saveDraftVersion, startAnalysis, } from './content-intelligence.service.js';
import { analysisIdParamsSchema, createAnalysisBodySchema, getAnalysisQuerySchema, listAnalysesQuerySchema, preflightAnalysisBodySchema, regenerateAnalysisBodySchema, saveBriefVersionBodySchema, saveDraftVersionBodySchema, applyRecommendationBodySchema, recommendationMutationBodySchema, recommendationParamsSchema, siteIdParamsSchema, } from './content-intelligence.schema.js';
import { getRecommendationApplicationCheck, listRecommendationHistory, mutateRecommendation, type RecommendationAction, } from './content-recommendation.service.js';
import { getRecommendationOutcome } from './content-recommendation-outcomes.service.js';
export function resolveContentIntelligenceDb() {
    return getContentIntelligenceDb() ?? productionDb;
}
function requireUser(req: Request) {
    if (!req.user)
        throw HttpError.unauthorized({ code: 'ERRORS_UNAUTHORIZED', messageKey: 'errors.unauthorized' });
    return req.user;
}
/**
 * Kill switch: when `CONTENT_INTELLIGENCE_ENABLED=false`, the
 * NEW-RUN entry points (create, preflight, regenerate) return the localized
 * product-unavailable response. Reads, cancel, and recommendation flows stay
 * open — cancel must keep working so in-flight runs are never stranded.
 * Read from `env` at request time so tests can flip the flag (same live-read
 * style as the MCP kill switch).
 */
function requireContentIntelligenceEnabled(): void {
    if (!env.CONTENT_INTELLIGENCE_ENABLED) {
        throw new HttpError(503, { code: 'CONTENT_INTELLIGENCE_ERRORS_PRODUCT_UNAVAILABLE', messageKey: 'contentIntelligence.errors.productUnavailable' });
    }
}
/** POST /api/sites/:siteId/content-analyses — start an analysis. */
export const createAnalysisController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    requireContentIntelligenceEnabled();
    const user = requireUser(req);
    const params = siteIdParamsSchema.parse(req.params);
    const body = createAnalysisBodySchema.parse(req.body);
    const result = await startAnalysis({
        accountId: accountId,
        ownerUserId: user.id,
        siteId: params.siteId,
        ownedUrl: body.ownedUrl,
        keyword: body.keyword,
        locale: body.locale,
        reviewedPageMatches: body.reviewedPageMatches,
        ...(body.clientKey ? { clientKey: body.clientKey } : {}),
    }, {
        db: resolveContentIntelligenceDb(),
        contentAnalysisQueue: getContentAnalysisQueue(),
    });
    sendLocalizedMessage(req, res, 202, 'contentIntelligence.messages.started', {
        analysisId: result.analysisId,
        status: result.status,
        duplicate: result.duplicate,
    });
});
/** POST /api/sites/:siteId/content-analyses/preflight — no spend. */
export const preflightAnalysisController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    requireContentIntelligenceEnabled();
    const params = siteIdParamsSchema.parse(req.params);
    const body = preflightAnalysisBodySchema.parse(req.body);
    const result = await preflightAnalysis({
        accountId: accountId,
        siteId: params.siteId,
        ownedUrl: body.ownedUrl,
        keyword: body.keyword,
        locale: body.locale,
    });
    res.status(200).json(result);
});
/** GET /api/sites/:siteId/content-analyses — paginated list. */
export const listAnalysesController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const params = siteIdParamsSchema.parse(req.params);
    const query = listAnalysesQuerySchema.parse(req.query);
    const locale = toSupportedLocale(req.language);
    const page = await listAnalyses({
        accountId: accountId,
        siteId: params.siteId,
        limit: query.limit,
        locale,
        ...(query.cursor ? { cursor: query.cursor } : {}),
    });
    res.setHeader('Content-Language', locale);
    res.status(200).json(page);
});
/** GET /api/content-analyses/:analysisId — one analysis (owner-scoped). */
export const getAnalysisController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const params = analysisIdParamsSchema.parse(req.params);
    const query = getAnalysisQuerySchema.parse(req.query);
    const locale = toSupportedLocale(req.language);
    const analysis = await getAnalysis({
        accountId: accountId,
        analysisId: params.analysisId,
        ...(query.siteId ? { siteId: query.siteId } : {}),
        locale,
    });
    res.setHeader('Content-Language', locale);
    res.status(200).json(analysis);
});
/** POST /api/content-analyses/:analysisId/cancel */
export const cancelAnalysisController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const params = analysisIdParamsSchema.parse(req.params);
    await cancelAnalysis({ accountId: accountId, analysisId: params.analysisId });
    res.status(202).json({ ok: true });
});
/** POST /api/content-analyses/:analysisId/regenerate — new run. */
export const regenerateAnalysisController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    requireContentIntelligenceEnabled();
    const user = requireUser(req);
    const params = analysisIdParamsSchema.parse(req.params);
    regenerateAnalysisBodySchema.parse(req.body);
    const result = await regenerateAnalysis({
        accountId: accountId,
        ownerUserId: user.id,
        analysisId: params.analysisId,
    }, {
        db: resolveContentIntelligenceDb(),
        contentAnalysisQueue: getContentAnalysisQueue(),
    });
    sendLocalizedMessage(req, res, 202, 'contentIntelligence.messages.started', {
        analysisId: result.analysisId,
        status: result.status,
        duplicate: result.duplicate,
    });
});
/** POST /api/content-analyses/:analysisId/draft-versions — explicit save, never publish. */
export const saveDraftVersionController = asyncHandler(async (req: Request, res: Response) => {
    const accountId = requireAccountId(req);
    const user = requireUser(req);
    const params = analysisIdParamsSchema.parse(req.params);
    const body = saveDraftVersionBodySchema.parse(req.body);
    const version = await saveDraftVersion({
        accountId,
        actorUserId: user.id,
        analysisId: params.analysisId,
        markdown: body.markdown,
        clientKey: body.clientKey,
    });
    res.status(201).json({ version });
});
/** POST /api/content-analyses/:analysisId/brief-versions — explicit save, never publish. */
export const saveBriefVersionController = asyncHandler(async (req: Request, res: Response) => {
    const accountId = requireAccountId(req);
    const user = requireUser(req);
    const params = analysisIdParamsSchema.parse(req.params);
    const body = saveBriefVersionBodySchema.parse(req.body);
    const version = await saveBriefVersion({
        accountId,
        actorUserId: user.id,
        analysisId: params.analysisId,
        sections: body.sections,
        clientKey: body.clientKey,
    });
    res.status(201).json({ version });
});
function recommendationMutationController(action: RecommendationAction) {
    return asyncHandler(async (req: Request, res: Response) => {
        // Resolve the account FIRST: an unauthenticated call must 401 here,
        // never fall through to a schema parse and surface as a 400.
        const accountId = requireAccountId(req);
        const user = requireUser(req);
        const params = recommendationParamsSchema.parse(req.params);
        const body = action === 'apply'
            ? applyRecommendationBodySchema.parse(req.body)
            : recommendationMutationBodySchema.parse(req.body);
        const state = await mutateRecommendation(resolveContentIntelligenceDb(), {
            accountId: accountId,
            actorUserId: user.id,
            analysisId: params.analysisId,
            recommendationId: params.recommendationId,
            analysisVersion: body.analysisVersion,
            expectedVersion: body.expectedVersion,
            clientKey: body.clientKey,
            ...(body.note !== undefined ? { note: body.note } : {}),
            ...(action === 'apply' ? { confirm: true as const } : {}),
            action,
        });
        res.status(200).json({ state });
    });
}
export const acceptRecommendationController = recommendationMutationController('accept');
export const dismissRecommendationController = recommendationMutationController('dismiss');
export const applyRecommendationController = recommendationMutationController('apply');
export const undoRecommendationController = recommendationMutationController('undo');
export const listRecommendationHistoryController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const params = recommendationParamsSchema.parse(req.params);
    const events = await listRecommendationHistory(resolveContentIntelligenceDb(), {
        accountId: accountId,
        analysisId: params.analysisId,
        recommendationId: params.recommendationId,
    });
    res.status(200).json({ events });
});
export const getRecommendationApplicationCheckController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const params = recommendationParamsSchema.parse(req.params);
    const result = await getRecommendationApplicationCheck({
        accountId: accountId,
        analysisId: params.analysisId,
        recommendationId: params.recommendationId,
    });
    res.status(200).json(result);
});
export const getRecommendationOutcomeController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const params = recommendationParamsSchema.parse(req.params);
    const outcome = await getRecommendationOutcome(resolveContentIntelligenceDb(), {
        accountId: accountId,
        analysisId: params.analysisId,
        recommendationId: params.recommendationId,
    });
    res.status(200).json(outcome);
});
