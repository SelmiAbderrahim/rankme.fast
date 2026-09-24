/**
 * Brand Radar routers (site-scoped).
 * Both are mounted behind `[requireCsrf, requireAuth, requireVerified]` from
 * `app.ts`.
 *
 * Two mounts, mirroring the cannibalization split:
 *   • site-scoped preview / create / list under `/api/sites/:siteId/brand-radar`
 *     — the `/api/sites/:siteId` param-level site-mutation lease covers these,
 *     so no body/query lease is needed (or wanted: `siteId` never arrives in a
 *     Brand Radar body).
 *   • scan-scoped stored reads under `/api/brand-radar/scans/:id`, behind
 *     `leaseOwnedResource(resolveOwnedBrandRadarScanSiteId)`.
 *
 * Two named per-account buckets, unchanged and following their routes:
 * `brand_radar_create` on the create path (preview shares it — it is the
 * pre-flight of the same action) and `brand_radar_poll` on every stored read,
 * so a polling client can never lock itself out of scans it already ran.
 */
import { Router } from 'express';
import { createBatchRateLimiter, type RateLimitOverrides, } from '../../shared/middleware/rate-limit.js';
import { createBrandRadarScanHandler, getBrandRadarScanHandler, listBrandRadarMentionsHandler, listBrandRadarScansHandler, previewBrandRadarScanHandler, } from './brand-radar.controller.js';
/** Site-scoped: mounted under `/api/sites`. */
export function createBrandRadarSiteRouter(createOverrides: RateLimitOverrides = {}, pollOverrides: RateLimitOverrides = {}): Router {
    const router = Router();
    const createLimiter = createBatchRateLimiter('brand_radar_create', createOverrides);
    const pollLimiter = createBatchRateLimiter('brand_radar_poll', pollOverrides);
    router.post('/:siteId/brand-radar/preview', createLimiter, previewBrandRadarScanHandler);
    router.post('/:siteId/brand-radar/scans', createLimiter, createBrandRadarScanHandler);
    router.get('/:siteId/brand-radar/scans', pollLimiter, listBrandRadarScansHandler);
    return router;
}
/** Scan-scoped stored reads: mounted at `/api/brand-radar`. */
export function createBrandRadarRouter(pollOverrides: RateLimitOverrides = {}): Router {
    const router = Router();
    const pollLimiter = createBatchRateLimiter('brand_radar_poll', pollOverrides);
    router.get('/scans/:id', pollLimiter, getBrandRadarScanHandler);
    // Stored mention inventory — same stored-read bucket, no new spend.
    router.get('/scans/:id/mentions', pollLimiter, listBrandRadarMentionsHandler);
    return router;
}
