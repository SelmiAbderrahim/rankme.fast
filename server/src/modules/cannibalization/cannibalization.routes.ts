/**
 * Cannibalization routers. Mounted behind
 * `[requireCsrf, requireAuth, requireVerified]` from `app.ts`.
 *
 * Two named per-account buckets: `cannibalization` on the generate/preview
 * path, `cannibalization_poll` on the stored-report reads, so a polling client
 * can never lock itself out of reports it already paid for.
 */
import { Router } from 'express';
import { createBatchRateLimiter } from '../../shared/middleware/rate-limit.js';
import { generateReportController, getReportController, listReportsController, previewReportController, } from './cannibalization.controller.js';
/** Site-scoped: mounted under `/api/sites`. */
export function createCannibalizationSiteRouter(): Router {
    const router = Router();
    const createLimiter = createBatchRateLimiter('cannibalization');
    const pollLimiter = createBatchRateLimiter('cannibalization_poll');
    router.post('/:siteId/cannibalization-reports/preview', createLimiter, previewReportController);
    router.post('/:siteId/cannibalization-reports', createLimiter, generateReportController);
    router.get('/:siteId/cannibalization-reports', pollLimiter, listReportsController);
    return router;
}
/** Report-scoped: mounted at `/api/cannibalization-reports`. */
export function createCannibalizationReportRouter(): Router {
    const router = Router();
    const pollLimiter = createBatchRateLimiter('cannibalization_poll');
    router.get('/:reportId', pollLimiter, getReportController);
    return router;
}
