/**
 * Public-page change monitoring — route factory.
 *
 * One site-scoped router mounted under `/api/sites`. Factory (not a
 * module-level `Router()` singleton) so the per-bucket rate limiters read the
 * LIVE env values each time `createApp()` is called.
 *
 * Buckets (audience-research precedent — reuse the content-intelligence buckets):
 *   - create / pause / resume / delete (state-changing) → `content_intelligence_create`
 *   - list + get + change-feed reads → the lighter `content_intelligence_poll`
 *
 * The `verified` (requireCsrf + requireAuth + requireVerified) chain is applied
 * at the app level; here we layer the per-bucket rate limiters.
 * The unauthenticated webhook lives on a SEPARATE top-level mount (before
 * express.json), never under this authenticated router.
 */
import { Router } from 'express';
import { createBatchRateLimiter } from '../../shared/middleware/rate-limit.js';
import { createMonitorController, deleteMonitorController, getMonitorController, listMonitorsController, pauseMonitorController, resumeMonitorController, } from './monitoring.controller.js';
export function createContentMonitoringRouter(): Router {
    const router = Router();
    const createLimiter = createBatchRateLimiter('content_intelligence_create');
    const pollLimiter = createBatchRateLimiter('content_intelligence_poll');
    router.get('/:siteId/content-monitoring/monitors', pollLimiter, listMonitorsController);
    router.post('/:siteId/content-monitoring/monitors', createLimiter, createMonitorController);
    router.get('/:siteId/content-monitoring/monitors/:monitorId', pollLimiter, getMonitorController);
    router.post('/:siteId/content-monitoring/monitors/:monitorId/pause', createLimiter, pauseMonitorController);
    router.post('/:siteId/content-monitoring/monitors/:monitorId/resume', createLimiter, resumeMonitorController);
    router.delete('/:siteId/content-monitoring/monitors/:monitorId', createLimiter, deleteMonitorController);
    return router;
}
