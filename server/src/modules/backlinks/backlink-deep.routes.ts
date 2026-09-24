import { Router } from 'express';
import { createBatchRateLimiter } from '../../shared/middleware/rate-limit.js';
import { getBacklinkRunHandler, listBacklinkRunsHandler, startAnchorsHandler, startBulkRanksHandler, startHistoryHandler, startReferringDomainsHandler, } from './backlink-deep.controller.js';
import { previewBacklinkDeepHandler, previewLinkGapHandler, } from './backlink-preview.controller.js';
import { getLinkGapHandler, startLinkGapHandler, } from './link-gap.controller.js';
import { downloadToxicityDisavowHandler, getToxicityReviewHandler, listToxicityReviewsHandler, previewToxicityReviewHandler, startToxicityReviewHandler, } from './toxicity-review.controller.js';
export function createBacklinkDeepRouter(): Router {
    const router = Router();
    const mutationLimiter = createBatchRateLimiter('link_intel');
    const pollLimiter = createBatchRateLimiter('link_intel_poll');
    const toxicityCreateLimiter = createBatchRateLimiter('toxicity_create');
    router.post('/deep/preview', mutationLimiter, previewBacklinkDeepHandler);
    router.post('/gap/preview', mutationLimiter, previewLinkGapHandler);
    router.post('/deep/referring-domains', mutationLimiter, startReferringDomainsHandler);
    router.post('/deep/anchors', mutationLimiter, startAnchorsHandler);
    router.post('/deep/history', mutationLimiter, startHistoryHandler);
    router.post('/deep/bulk-ranks', mutationLimiter, startBulkRanksHandler);
    router.get('/runs', pollLimiter, listBacklinkRunsHandler);
    router.get('/runs/:id', pollLimiter, getBacklinkRunHandler);
    router.post('/gap', mutationLimiter, startLinkGapHandler);
    router.get('/gap/:runId', pollLimiter, getLinkGapHandler);
    router.post('/toxicity/preview', toxicityCreateLimiter, previewToxicityReviewHandler);
    router.post('/toxicity', toxicityCreateLimiter, startToxicityReviewHandler);
    router.get('/toxicity', pollLimiter, listToxicityReviewsHandler);
    router.get('/toxicity/:runId', pollLimiter, getToxicityReviewHandler);
    router.post('/toxicity/:runId/disavow', toxicityCreateLimiter, downloadToxicityDisavowHandler);
    return router;
}
