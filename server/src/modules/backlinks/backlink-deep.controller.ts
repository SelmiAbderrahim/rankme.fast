import type { RequestHandler } from 'express';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { requireAccountId } from '../../shared/utils/require-account-id.js';
import { getBacklinkDeepQueue, getBacklinksDb, } from './backlinks.holder.js';
import { anchorsBodySchema, backlinkRunParamsSchema, backlinkRunsQuerySchema, bulkRanksBodySchema, historyBodySchema, referringDomainsBodySchema, } from './backlink-deep.schema.js';
import { getBacklinkDeepRun, listBacklinkDeepRuns, startBacklinkDeepPull, } from './backlink-deep.service.js';
function startHandler(type: 'refDomains' | 'anchors' | 'history' | 'bulkRanks', schema: typeof referringDomainsBodySchema | typeof historyBodySchema | typeof bulkRanksBodySchema): RequestHandler {
    return asyncHandler(async (req, res) => {
        const accountId = requireAccountId(req);
        const body = schema.parse(req.body);
        const result = await startBacklinkDeepPull({
            accountId,
            type,
            siteId: body.siteId,
            ...('limit' in body ? { limit: body.limit } : {}),
            ...('domains' in body ? { domains: body.domains } : {}),
        }, { queue: getBacklinkDeepQueue() });
        res.status(202).json(result);
    });
}
export const startReferringDomainsHandler = startHandler('refDomains', referringDomainsBodySchema);
export const startAnchorsHandler = startHandler('anchors', anchorsBodySchema);
export const startHistoryHandler = startHandler('history', historyBodySchema);
export const startBulkRanksHandler = startHandler('bulkRanks', bulkRanksBodySchema);
export const listBacklinkRunsHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const query = backlinkRunsQuerySchema.parse(req.query);
    res.status(200).json(await listBacklinkDeepRuns(accountId, query));
});
export const getBacklinkRunHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { id } = backlinkRunParamsSchema.parse(req.params);
    res.status(200).json(await getBacklinkDeepRun(accountId, id, getBacklinksDb()));
});
