/**
 * Competitor content intelligence — HTTP controllers.
 *
 * Thin `asyncHandler` handlers: parse (zod) → delegate to the service → JSON.
 * Every handler is owner-scoped through the service (`Site.findOne({ _id,
 * accountId })` → 404, never 403). Management reads/writes never enqueue,
 * never scrape. The kill switch lives in `startCompetitorRun` (spec-defined
 * ordering), so `cancel` stays open — an in-flight run must always be
 * cancellable.
 */
import type { Request, Response } from 'express';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { requireAccountId } from '../../shared/utils/require-account-id.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { sendLocalizedMessage } from '../../shared/i18n/localized-response.js';
import { toSupportedLocale } from '../../shared/i18n/index.js';
import { db as productionDb } from '../../db/client.js';
import { getCompetitorContentDb, getCompetitorContentQueue, } from './competitor-content.holders.js';
import { addCompetitor, archiveCompetitor, listCompetitors, restoreCompetitor, suggestCompetitors, } from './competitor-content.profiles.service.js';
import { cancelCompetitorRun, getCompetitorRun, listCompetitorRuns, startCompetitorRun, } from './competitor-content.runs.service.js';
import { addCompetitorBodySchema, competitorIdParamsSchema, listCompetitorsQuerySchema, listRunsQuerySchema, runIdParamsSchema, siteIdParamsSchema, startCompetitorRunBodySchema, } from './competitor-content.schemas.js';
export function resolveCompetitorContentDb() {
    return getCompetitorContentDb() ?? productionDb;
}
function requireUser(req: Request) {
    if (!req.user)
        throw HttpError.unauthorized({ code: 'ERRORS_UNAUTHORIZED', messageKey: 'errors.unauthorized' });
    return req.user;
}
/** GET /:siteId/competitor-content/suggestions — DataForSEO-backed candidates. */
export const suggestCompetitorsController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const params = siteIdParamsSchema.parse(req.params);
    const suggestions = await suggestCompetitors(resolveCompetitorContentDb(), {
        accountId: accountId,
        siteId: params.siteId,
    });
    res.status(200).json({ suggestions });
});
/** GET /:siteId/competitor-content/competitors — confirmed portfolio. */
export const listCompetitorsController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const params = siteIdParamsSchema.parse(req.params);
    const query = listCompetitorsQuerySchema.parse(req.query);
    const competitors = await listCompetitors(resolveCompetitorContentDb(), {
        accountId: accountId,
        siteId: params.siteId,
        status: query.status,
    });
    res.status(200).json({ competitors });
});
/** POST /:siteId/competitor-content/competitors — confirm / manual-add. */
export const addCompetitorController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const params = siteIdParamsSchema.parse(req.params);
    const body = addCompetitorBodySchema.parse(req.body);
    const result = await addCompetitor(resolveCompetitorContentDb(), {
        accountId: accountId,
        siteId: params.siteId,
        url: body.url,
        source: body.source,
    });
    res.status(result.duplicate ? 200 : 201).json(result);
});
/** POST /:siteId/competitor-content/competitors/:competitorId/archive. */
export const archiveCompetitorController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const params = competitorIdParamsSchema.parse(req.params);
    const profile = await archiveCompetitor(resolveCompetitorContentDb(), {
        accountId: accountId,
        siteId: params.siteId,
        competitorId: params.competitorId,
    });
    res.status(200).json({ profile });
});
/** POST /:siteId/competitor-content/competitors/:competitorId/restore. */
export const restoreCompetitorController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const params = competitorIdParamsSchema.parse(req.params);
    const profile = await restoreCompetitor(resolveCompetitorContentDb(), {
        accountId: accountId,
        siteId: params.siteId,
        competitorId: params.competitorId,
    });
    res.status(200).json({ profile });
});
/** POST /:siteId/competitor-content/runs — start a comparison run. */
export const startRunController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const user = requireUser(req);
    const params = siteIdParamsSchema.parse(req.params);
    const body = startCompetitorRunBodySchema.parse(req.body);
    const result = await startCompetitorRun({ accountId: accountId, ownerUserId: user.id, siteId: params.siteId, body }, { db: resolveCompetitorContentDb(), queue: getCompetitorContentQueue() });
    sendLocalizedMessage(req, res, 202, 'contentIntelligence.competitorContent.messages.started', {
        runId: result.runId,
        status: result.status,
        duplicate: result.duplicate,
    });
});
/** GET /:siteId/competitor-content/runs — paginated run list. */
export const listRunsController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const params = siteIdParamsSchema.parse(req.params);
    const query = listRunsQuerySchema.parse(req.query);
    const page = await listCompetitorRuns({
        accountId: accountId,
        siteId: params.siteId,
        limit: query.limit,
        locale: toSupportedLocale(req.language),
        ...(query.cursor ? { cursor: query.cursor } : {}),
    });
    res.setHeader('Content-Language', toSupportedLocale(req.language));
    res.status(200).json(page);
});
/** GET /:siteId/competitor-content/runs/:runId — one run + page facts. */
export const getRunController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const params = runIdParamsSchema.parse(req.params);
    const locale = toSupportedLocale(req.language);
    const run = await getCompetitorRun({ accountId: accountId, runId: params.runId, locale });
    res.setHeader('Content-Language', locale);
    res.status(200).json(run);
});
/** POST /:siteId/competitor-content/runs/:runId/cancel. */
export const cancelRunController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const params = runIdParamsSchema.parse(req.params);
    await cancelCompetitorRun({ accountId: accountId, runId: params.runId });
    res.status(202).json({ ok: true });
});
