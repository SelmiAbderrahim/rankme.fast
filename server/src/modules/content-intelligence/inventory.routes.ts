/**
 * Content inventory + cannibalization route factory.
 *
 * One site-scoped router mounted under `/api/sites`. Factory (not a module-level `Router()` singleton) so the per-bucket rate
 * limiters read the LIVE env values each time `createApp()` is called.
 *
 * Buckets (pre-wired in `shared/middleware/rate-limit.ts`):
 *   - start + cancel (state-changing / vendor-spending) → `inventory_start`
 *   - list + detail reads → the lighter `content_intelligence_poll`
 *
 * The `verified` (requireCsrf + requireAuth + requireVerified) chain is applied
 * at the app level; here we only layer the per-bucket rate limiters.
 */
import { Router } from 'express';
import { createBatchRateLimiter } from '../../shared/middleware/rate-limit.js';
import { cancelInventoryController, getInventoryController, listInventoryController, startInventoryController, } from './inventory.controller.js';
export function createContentInventoryRouter(): Router {
    const router = Router();
    const startLimiter = createBatchRateLimiter('inventory_start');
    const pollLimiter = createBatchRateLimiter('content_intelligence_poll');
    router.post('/:siteId/content-intelligence/inventory', startLimiter, startInventoryController);
    router.get('/:siteId/content-intelligence/inventory', pollLimiter, listInventoryController);
    router.get('/:siteId/content-intelligence/inventory/:runId', pollLimiter, getInventoryController);
    router.post('/:siteId/content-intelligence/inventory/:runId/cancel', startLimiter, cancelInventoryController);
    return router;
}
