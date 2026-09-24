/**
 * Audience Research API controllers.
 *
 * Five site-scoped endpoints under /api/sites/:siteId/audience-research/*:
 *   POST   .../preview                → SpendPreview (no enqueue)
 *   POST   .../runs                   → 202 { runId, status, duplicate }
 *   GET    .../runs?cursor=&limit=    → paginated status list
 *   GET    .../runs/:runId            → status view
 *   GET    .../runs/:runId/result     → sources + signals + input echo
 *
 * All five are owner-scoped via `Site.findOne({ _id, accountId })` — a
 * missing/off-account site returns 404, never 403 (existence leak rule).
 * Read endpoints never enqueue and never call vendors.
 */
import type { Request, Response } from 'express';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { requireAccountId } from '../../shared/utils/require-account-id.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { toSupportedLocale } from '../../shared/i18n/index.js';
import { db as productionDb } from '../../db/client.js';
import { getAudienceResearchDb, getAudienceResearchQueue, } from './audience-research.holders.js';
import { getAudienceResearchRun, getAudienceResearchRunResult, listAudienceResearchRuns, previewAudienceResearchRun, startAudienceResearchRun, } from './audience-research.service.js';
import { decisionBodySchema, listRunsQuerySchema, runIdParamsSchema, runInputBodySchema, signalIdParamsSchema, siteIdParamsSchema, } from './audience-research.api.schemas.js';
import { decideAudienceResearchSignal, listTerminalSignalDecisions, } from './audience-research.decisions.js';
export function resolveAudienceResearchDb() {
    return getAudienceResearchDb() ?? productionDb;
}
function requireUser(req: Request) {
    if (!req.user)
        throw HttpError.unauthorized({ code: 'ERRORS_UNAUTHORIZED', messageKey: 'errors.unauthorized' });
    return req.user;
}
/** POST /api/sites/:siteId/audience-research/preview — no spend. */
export const previewAudienceResearchController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const params = siteIdParamsSchema.parse(req.params);
    const body = runInputBodySchema.parse(req.body);
    const result = await previewAudienceResearchRun({
        accountId: accountId,
        siteId: params.siteId,
        input: body,
    });
    res.status(200).json(result);
});
/** POST /api/sites/:siteId/audience-research/runs — create + enqueue. */
export const createAudienceResearchRunController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const params = siteIdParamsSchema.parse(req.params);
    const body = runInputBodySchema.parse(req.body);
    const result = await startAudienceResearchRun({
        accountId: accountId,
        siteId: params.siteId,
        input: body,
        outputLocale: toSupportedLocale(req.language),
    }, {
        queue: getAudienceResearchQueue(),
    });
    res.status(202).json({
        runId: result.runId,
        status: result.status,
        duplicate: result.duplicate,
        outputLocale: result.outputLocale,
    });
});
/** GET /api/sites/:siteId/audience-research/runs — paginated list. */
export const listAudienceResearchRunsController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const params = siteIdParamsSchema.parse(req.params);
    const query = listRunsQuerySchema.parse(req.query);
    const page = await listAudienceResearchRuns({
        accountId: accountId,
        siteId: params.siteId,
        limit: query.limit,
        ...(query.cursor ? { cursor: query.cursor } : {}),
    });
    res.status(200).json(page);
});
/** GET /api/sites/:siteId/audience-research/runs/:runId — status view. */
export const getAudienceResearchRunController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const params = runIdParamsSchema.parse(req.params);
    const result = await getAudienceResearchRun({
        accountId: accountId,
        siteId: params.siteId,
        runId: params.runId,
    });
    res.status(200).json(result);
});
/** GET /api/sites/:siteId/audience-research/runs/:runId/result — final result. */
export const getAudienceResearchRunResultController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const params = runIdParamsSchema.parse(req.params);
    const result = await getAudienceResearchRunResult({
        accountId: accountId,
        siteId: params.siteId,
        runId: params.runId,
    });
    // Attach the account's durable terminal decisions for this run so the
    // workspace survives a reload: without them the session-local decision
    // cache was the only source and every reload reverted accepted/dismissed
    // cards to their undecided controls (re-deciding then 409'd).
    const decisions = await listTerminalSignalDecisions(resolveAudienceResearchDb(), { accountId: accountId, runId: params.runId });
    res.status(200).json({ ...result, decisions });
});
/**
 * POST /api/sites/:siteId/audience-research/runs/:runId/signals/:signalId/decision
 * — append-only terminal accept/dismiss.
 */
export const decideAudienceResearchSignalController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const user = requireUser(req);
    const params = signalIdParamsSchema.parse(req.params);
    const body = decisionBodySchema.parse(req.body);
    const result = await decideAudienceResearchSignal(resolveAudienceResearchDb(), {
        accountId: accountId,
        siteId: params.siteId,
        runId: params.runId,
        signalId: params.signalId,
        decision: body.decision,
        ...(body.decision === 'accepted' ? { destination: body.destination } : {}),
        ...(body.decision === 'dismissed' && body.reason
            ? { dismissReason: body.reason }
            : {}),
        idempotencyKey: body.idempotencyKey,
        decidedByUserId: user.id,
    });
    res.status(result.duplicate ? 200 : 201).json(result);
});
