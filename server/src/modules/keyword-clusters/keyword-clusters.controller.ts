import type { Request, Response } from 'express';
import { db as productionDb } from '../../db/client.js';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { requireAccountId } from '../../shared/utils/require-account-id.js';
import { getKeywordClustersDb, getKeywordClustersQueue, } from './keyword-clusters.holder.js';
import { getKeywordClusterRun, listKeywordClusterRuns, previewKeywordClusterRun, startKeywordClusterRun, } from './keyword-clusters.service.js';
import { keywordClusterListQuerySchema, keywordClusterRunParamsSchema, keywordClusterSiteParamsSchema, keywordClusterStartBodySchema, } from './keyword-clusters.schemas.js';
function deps() {
    return {
        db: getKeywordClustersDb() ?? productionDb,
        queue: getKeywordClustersQueue(),
    };
}
export const previewKeywordClusterRunController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const { siteId } = keywordClusterSiteParamsSchema.parse(req.params);
    const body = keywordClusterStartBodySchema.parse(req.body);
    const preview = await previewKeywordClusterRun({
        accountId: accountId,
        siteId,
        keywordIds: body.keywordIds,
        locale: body.locale,
    }, deps());
    res.status(200).json(preview);
});
export const startKeywordClusterRunController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const { siteId } = keywordClusterSiteParamsSchema.parse(req.params);
    const body = keywordClusterStartBodySchema.parse(req.body);
    const run = await startKeywordClusterRun({
        accountId: accountId,
        siteId,
        keywordIds: body.keywordIds,
        locale: body.locale,
    }, deps());
    res.status(202).json(run);
});
export const listKeywordClusterRunsController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const { siteId } = keywordClusterSiteParamsSchema.parse(req.params);
    const query = keywordClusterListQuerySchema.parse(req.query);
    const runs = await listKeywordClusterRuns({
        accountId: accountId,
        siteId,
        limit: query.limit,
    });
    res.status(200).json(runs);
});
export const getKeywordClusterRunController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const { runId } = keywordClusterRunParamsSchema.parse(req.params);
    const run = await getKeywordClusterRun({ accountId: accountId, runId });
    res.status(200).json(run);
});
