import { Router, type Request, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { requireAccountId } from '../../shared/utils/require-account-id.js';
import { appSeoSiteParamsSchema } from './app-seo.schema.js';
import { getAppSeoDb } from './app-seo.holder.js';
import { readAppSeoComparison } from './compare.service.js';
import { toSupportedLocale } from '../../shared/i18n/index.js';
// Keep resource ids opaque at the edge. The owner-scoped service deliberately
// collapses malformed, missing, and foreign profile ids to the same 404.
const compareQuerySchema = z.object({
    profileId: z.string().trim().min(1).max(64),
});
export const getAppSeoComparisonController = asyncHandler(async (req: Request, res: Response) => {
    const accountId = requireAccountId(req);
    const params = appSeoSiteParamsSchema.parse(req.params);
    const query = compareQuerySchema.parse(req.query);
    const locale = toSupportedLocale(req.language);
    const comparison = await readAppSeoComparison({
        accountId,
        siteId: params.siteId,
        profileId: query.profileId,
        locale,
    }, getAppSeoDb());
    res.setHeader('Content-Language', locale);
    res.status(200).json(comparison);
});
export function createAppSeoCompareRouter(pollLimiter: RequestHandler): Router {
    const router = Router({ mergeParams: true });
    router.get('/', pollLimiter, getAppSeoComparisonController);
    return router;
}
