/** Authenticated route factories; app.ts owns the verified middleware chain. */
import { Router } from 'express';
import { createBatchRateLimiter } from '../../shared/middleware/rate-limit.js';
import { getKeywordClusterRunController, listKeywordClusterRunsController, previewKeywordClusterRunController, startKeywordClusterRunController, } from './keyword-clusters.controller.js';
export function createKeywordClustersSiteRouter(): Router {
    const router = Router();
    const createLimiter = createBatchRateLimiter('keyword_clusters');
    const pollLimiter = createBatchRateLimiter('keyword_clusters_poll');
    router.post('/:siteId/keyword-cluster-runs/preview', createLimiter, previewKeywordClusterRunController);
    router.post('/:siteId/keyword-cluster-runs', createLimiter, startKeywordClusterRunController);
    router.get('/:siteId/keyword-cluster-runs', pollLimiter, listKeywordClusterRunsController);
    return router;
}
export function createKeywordClustersRunRouter(): Router {
    const router = Router();
    const pollLimiter = createBatchRateLimiter('keyword_clusters_poll');
    router.get('/:runId', pollLimiter, getKeywordClusterRunController);
    return router;
}
