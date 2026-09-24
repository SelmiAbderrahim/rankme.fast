import type { Request, Response } from 'express';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { requireAccountId } from '../../shared/utils/require-account-id.js';
import { appSeoSiteParamsSchema } from './app-seo.schema.js';
import { getAppSeoDb } from './app-seo.holder.js';
import { appListingHistoryQuerySchema, appListingReadQuerySchema, appListingRunBodySchema, } from './listing.schema.js';
import { createAppListingRun, readAppListingHistory, readLatestAppListing, } from './listing.service.js';
import { toSupportedLocale } from '../../shared/i18n/index.js';
export const createAppListingRunController = asyncHandler(async (req: Request, res: Response) => {
    const accountId = requireAccountId(req);
    const params = appSeoSiteParamsSchema.parse(req.params);
    const run = appListingRunBodySchema.parse(req.body);
    const result = await createAppListingRun({ accountId, siteId: params.siteId, run });
    res.status(result.queued ? 202 : 200).json(result);
});
export const readLatestAppListingController = asyncHandler(async (req: Request, res: Response) => {
    const accountId = requireAccountId(req);
    const params = appSeoSiteParamsSchema.parse(req.params);
    const query = appListingReadQuerySchema.parse(req.query);
    const locale = toSupportedLocale(req.language);
    const result = await readLatestAppListing({ accountId, siteId: params.siteId, profileId: query.profileId, locale }, getAppSeoDb());
    res.setHeader('Content-Language', locale);
    res.status(200).json(result);
});
export const readAppListingHistoryController = asyncHandler(async (req: Request, res: Response) => {
    const accountId = requireAccountId(req);
    const params = appSeoSiteParamsSchema.parse(req.params);
    const query = appListingHistoryQuerySchema.parse(req.query);
    const result = await readAppListingHistory({
        accountId,
        siteId: params.siteId,
        profileId: query.profileId,
        limit: query.limit,
    }, getAppSeoDb());
    res.status(200).json(result);
});
