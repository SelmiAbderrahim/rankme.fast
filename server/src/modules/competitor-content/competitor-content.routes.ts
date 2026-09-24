/**
 * Competitor content intelligence route factory.
 *
 * One site-scoped router mounted under `/api/sites`, open to every verified
 * account. Factory (not a module-level `Router()` singleton) so the
 * per-bucket rate limiters read the LIVE env values each time `createApp()` is
 * called.
 *
 * Buckets (pre-wired in `shared/middleware/rate-limit.ts` — `/competitor-content`
 * maps to `competitor_manage`):
 *   - management writes + run start/cancel (state-changing / vendor-spending) →
 *     `competitor_manage`
 *   - suggestion + list + detail reads → the lighter `content_intelligence_poll`
 *
 * The `verified` (requireCsrf + requireAuth + requireVerified) chain is applied
 * at the app level; here we layer the per-bucket rate limiters.
 */
import { Router } from 'express';
import { createBatchRateLimiter } from '../../shared/middleware/rate-limit.js';
import { addCompetitorController, archiveCompetitorController, cancelRunController, getRunController, listCompetitorsController, listRunsController, restoreCompetitorController, startRunController, suggestCompetitorsController, } from './competitor-content.controller.js';
export function createCompetitorContentRouter(): Router {
    const router = Router();
    const manageLimiter = createBatchRateLimiter('competitor_manage');
    const pollLimiter = createBatchRateLimiter('content_intelligence_poll');
    // Suggestions + portfolio reads.
    router.get('/:siteId/competitor-content/suggestions', pollLimiter, suggestCompetitorsController);
    router.get('/:siteId/competitor-content/competitors', pollLimiter, listCompetitorsController);
    // Confirm / manual-add + archive / restore.
    router.post('/:siteId/competitor-content/competitors', manageLimiter, addCompetitorController);
    router.post('/:siteId/competitor-content/competitors/:competitorId/archive', manageLimiter, archiveCompetitorController);
    router.post('/:siteId/competitor-content/competitors/:competitorId/restore', manageLimiter, restoreCompetitorController);
    // Runs.
    router.post('/:siteId/competitor-content/runs', manageLimiter, startRunController);
    router.get('/:siteId/competitor-content/runs', pollLimiter, listRunsController);
    router.get('/:siteId/competitor-content/runs/:runId', pollLimiter, getRunController);
    router.post('/:siteId/competitor-content/runs/:runId/cancel', manageLimiter, cancelRunController);
    return router;
}
