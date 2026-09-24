/** Authenticated route factories; app.ts owns the verified middleware chain. */
import { Router } from 'express';
import { createBatchRateLimiter } from '../../shared/middleware/rate-limit.js';
import { exportInternalLinkRunController, getInternalLinkRunController, listInternalLinkRunsController, previewInternalLinkRunController, startInternalLinkRunController, } from './internal-links.controller.js';
export function createInternalLinksSiteRouter(): Router {
    const router = Router();
    const createLimiter = createBatchRateLimiter('internal_links');
    const pollLimiter = createBatchRateLimiter('internal_links_poll');
    router.post('/:siteId/internal-link-runs/preview', createLimiter, previewInternalLinkRunController);
    router.post('/:siteId/internal-link-runs', createLimiter, startInternalLinkRunController);
    router.get('/:siteId/internal-link-runs', pollLimiter, listInternalLinkRunsController);
    return router;
}
export function createInternalLinksRunRouter(): Router {
    const router = Router();
    const pollLimiter = createBatchRateLimiter('internal_links_poll');
    router.get('/:runId/export.csv', pollLimiter, exportInternalLinkRunController);
    router.get('/:runId', pollLimiter, getInternalLinkRunController);
    return router;
}
