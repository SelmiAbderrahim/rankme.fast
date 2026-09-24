import type { RequestHandler } from 'express';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { requireAccountId } from '../../shared/utils/require-account-id.js';
import { keywordIdParamsSchema, siteIdParamsSchema } from './keywords.schema.js';
import { getRanksDb } from './ranks.queue-holder.js';
import { getSerpFeatureDetail, listSerpFeatures } from './serp-features.service.js';
/**
 * GET /api/sites/:siteId/serp-features — latest observation per active
 * keyword. Stored data only; no vendor call, no metric, no preview.
 */
export const listSerpFeaturesHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { siteId } = siteIdParamsSchema.parse(req.params);
    const result = await listSerpFeatures({ accountId, siteId }, { db: getRanksDb() });
    res.status(200).json(result);
});
/** GET /api/keywords/:id/serp-features — per-keyword history + stored top-100. */
export const serpFeatureDetailHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { id } = keywordIdParamsSchema.parse(req.params);
    const result = await getSerpFeatureDetail({ accountId, keywordId: id }, { db: getRanksDb() });
    res.status(200).json(result);
});
