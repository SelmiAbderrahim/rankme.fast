import type { Request, Response } from 'express';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { requireAccountId } from '../../shared/utils/require-account-id.js';
import { appSeoSiteParamsSchema } from './app-seo.schema.js';
import { appReviewRunBodySchema, appReviewRunListQuerySchema, appReviewRunParamsSchema, } from './reviews.schema.js';
import { createAppReviewRun, getAppReviewRun, listAppReviewRuns, } from './reviews.service.js';
export const createAppReviewRunController = asyncHandler(async (req: Request, res: Response) => {
    const accountId = requireAccountId(req);
    const params = appSeoSiteParamsSchema.parse(req.params);
    const run = appReviewRunBodySchema.parse(req.body);
    const result = await createAppReviewRun({
        accountId,
        siteId: params.siteId,
        run,
        locale: req.language,
    });
    res.status(result.queued ? 202 : 200).json(result);
});
export const listAppReviewRunsController = asyncHandler(async (req: Request, res: Response) => {
    const accountId = requireAccountId(req);
    const params = appSeoSiteParamsSchema.parse(req.params);
    const query = appReviewRunListQuerySchema.parse(req.query);
    res.status(200).json(await listAppReviewRuns({
        accountId,
        siteId: params.siteId,
        ...(query.profileId ? { profileId: query.profileId } : {}),
        ...(query.store ? { store: query.store } : {}),
        limit: query.limit,
    }));
});
export const getAppReviewRunController = asyncHandler(async (req: Request, res: Response) => {
    const accountId = requireAccountId(req);
    const params = appReviewRunParamsSchema.parse(req.params);
    const run = await getAppReviewRun({ accountId, ...params });
    res.status(200).json({ run });
});
