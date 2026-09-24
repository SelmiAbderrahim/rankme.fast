import type { RequestHandler } from 'express';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { requireAccountId } from '../../shared/utils/require-account-id.js';
import { getBacklinkDeepQueue, getBacklinksDb } from './backlinks.holder.js';
import { linkGapBodySchema, linkGapParamsSchema } from './link-gap.schema.js';
import { getLinkGapRun, startLinkGapRun } from './link-gap.service.js';
export const startLinkGapHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const body = linkGapBodySchema.parse(req.body);
    const result = await startLinkGapRun({ accountId, siteId: body.siteId, competitors: body.competitors }, { queue: getBacklinkDeepQueue() });
    res.status(202).json(result);
});
export const getLinkGapHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { runId } = linkGapParamsSchema.parse(req.params);
    res.status(200).json(await getLinkGapRun(accountId, runId, getBacklinksDb()));
});
