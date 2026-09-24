/**
 * Review Intelligence router. Mounted at `/api/local-seo` behind
 * `[requireAuth, requireVerified]`.
 *
 * The named `review_sync` per-account bucket sits on the mutation routes
 * only — source CRUD and the sync submit. Stored-result reads (runs, run
 * detail, inventory, source list, CSV) stay unthrottled and ungated so a kill
 * switch cannot hide data already retained for the account.
 */
import { Router } from 'express';
import { createBatchRateLimiter, type RateLimitOverrides, } from '../../shared/middleware/rate-limit.js';
import { createReviewSourceHandler, createReviewSyncHandler, deleteReviewSourceHandler, exportReviewInventoryHandler, getReviewRunHandler, getReviewStatsHandler, getReviewThemesHandler, listReviewInventoryHandler, listReviewRunsHandler, listReviewSourcesHandler, previewReviewSyncHandler, } from './review-sync.controller.js';
export function createReviewSyncRouter(rateLimitOverrides: RateLimitOverrides = {}): Router {
    const router = Router();
    const mutationLimiter = createBatchRateLimiter('review_sync', rateLimitOverrides);
    router.post('/reviews/sources', mutationLimiter, createReviewSourceHandler);
    router.delete('/reviews/sources/:id', mutationLimiter, deleteReviewSourceHandler);
    router.get('/reviews/sources', listReviewSourcesHandler);
    router.post('/reviews/preview', previewReviewSyncHandler);
    router.post('/reviews/sync', mutationLimiter, createReviewSyncHandler);
    router.get('/reviews/runs', listReviewRunsHandler);
    router.get('/reviews/runs/:id', getReviewRunHandler);
    router.get('/reviews/stats/:id', getReviewStatsHandler);
    router.get('/reviews/themes/:id', getReviewThemesHandler);
    router.get('/reviews/export.csv', exportReviewInventoryHandler);
    router.get('/reviews/reviews', listReviewInventoryHandler);
    return router;
}
