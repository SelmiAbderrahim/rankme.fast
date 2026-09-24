import type { Request, Response } from 'express';
import { db as productionDb } from '../../db/client.js';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { requireAccountId } from '../../shared/utils/require-account-id.js';
import { getInternalLinksDb, getInternalLinksQueue, } from './internal-links.holder.js';
import { getInternalLinkRun, internalLinkRunCsv, listInternalLinkRuns, previewInternalLinkRun, startInternalLinkRun, } from './internal-links.service.js';
import { internalLinkListQuerySchema, internalLinkRunParamsSchema, internalLinkSiteParamsSchema, internalLinkStartBodySchema, } from './internal-links.schemas.js';
export function resolveInternalLinksDb() {
    return getInternalLinksDb() ?? productionDb;
}
function deps() {
    return {
        db: resolveInternalLinksDb(),
        queue: getInternalLinksQueue(),
    };
}
export const previewInternalLinkRunController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const { siteId } = internalLinkSiteParamsSchema.parse(req.params);
    internalLinkStartBodySchema.parse(req.body);
    const preview = await previewInternalLinkRun({ accountId: accountId, siteId }, deps());
    res.status(200).json(preview);
});
export const startInternalLinkRunController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const { siteId } = internalLinkSiteParamsSchema.parse(req.params);
    const body = internalLinkStartBodySchema.parse(req.body);
    const run = await startInternalLinkRun({ accountId: accountId, siteId, locale: body.locale }, deps());
    res.status(202).json(run);
});
export const listInternalLinkRunsController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const { siteId } = internalLinkSiteParamsSchema.parse(req.params);
    const query = internalLinkListQuerySchema.parse(req.query);
    const runs = await listInternalLinkRuns({
        accountId: accountId,
        siteId,
        limit: query.limit,
    });
    res.status(200).json(runs);
});
export const getInternalLinkRunController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const { runId } = internalLinkRunParamsSchema.parse(req.params);
    const run = await getInternalLinkRun({ accountId: accountId, runId });
    res.status(200).json(run);
});
export const exportInternalLinkRunController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const { runId } = internalLinkRunParamsSchema.parse(req.params);
    const run = await getInternalLinkRun({ accountId: accountId, runId });
    res
        .status(200)
        .type('text/csv; charset=utf-8')
        .set('Content-Disposition', `attachment; filename="internal-links-${run.id}.csv"`)
        .send(internalLinkRunCsv(run));
});
