import type { RequestHandler } from 'express';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { requireAccountId } from '../../shared/utils/require-account-id.js';
import { getBacklinksDb } from './backlinks.holder.js';
import { backlinkDeepPreviewBodySchema, linkGapPreviewBodySchema, } from './backlink-preview.schema.js';
import { previewBacklinkDeepSpend, previewLinkGapSpend, } from './backlink-preview.service.js';
export const previewBacklinkDeepHandler: RequestHandler = asyncHandler(async (req, res) => {
    requireAccountId(req);
    const body = backlinkDeepPreviewBodySchema.parse(req.body);
    res.status(200).json(await previewBacklinkDeepSpend(body, { db: getBacklinksDb() }));
});
export const previewLinkGapHandler: RequestHandler = asyncHandler(async (req, res) => {
    requireAccountId(req);
    const body = linkGapPreviewBodySchema.parse(req.body);
    res.status(200).json(await previewLinkGapSpend(body, { db: getBacklinksDb() }));
});
