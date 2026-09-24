import { Router } from 'express';
import { createBatchRateLimiter, type RateLimitOverrides, } from '../../shared/middleware/rate-limit.js';
import { createGeogridScanHandler, getGeogridScanHandler, listGeogridScansHandler, previewGeogridScanHandler, } from './geogrid.controller.js';
/**
 * Geogrid routes. Mounted on `/api/sites`
 * behind `[requireAuth, requireVerified]`, so every handler already has a
 * verified session and an owner-scoped site id.
 */
export function createGeogridRouter(createOverrides: RateLimitOverrides = {}, pollOverrides: RateLimitOverrides = {}): Router {
    const router = Router();
    const createLimiter = createBatchRateLimiter('geogrid_create', createOverrides);
    const pollLimiter = createBatchRateLimiter('geogrid_poll', pollOverrides);
    router.post('/:siteId/geogrid/preview', createLimiter, previewGeogridScanHandler);
    router.post('/:siteId/geogrid/scans', createLimiter, createGeogridScanHandler);
    router.get('/:siteId/geogrid/scans', pollLimiter, listGeogridScansHandler);
    router.get('/:siteId/geogrid/scans/:scanId', pollLimiter, getGeogridScanHandler);
    return router;
}
