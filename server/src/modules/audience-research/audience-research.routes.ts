/**
 * Audience Research route factory.
 *
 * One site-scoped router. Factory (not a module-level `Router()` singleton)
 * so per-bucket rate limiters read the LIVE env values each time
 * `createApp()` is called; this lets tests override the shared
 * `RATE_LIMIT_CONTENT_*` buckets inside a single test and rebuild the app
 * to observe the effect. Mirrors the content-intelligence pattern.
 *
 * The `verified` (requireCsrf + requireAuth + requireVerified) chain is
 * applied at the app level; here we only layer the per-bucket rate limiters.
 * Read + preview paths sit behind the lighter `content_intelligence_poll`
 * bucket; the state-changing `POST runs` sits behind `content_intelligence_create`.
 * A dedicated `audience_research_*` env bucket lands in a follow-up —
 * reusing the content-intelligence buckets keeps the
 * blast-radius contained for this ship.
 */
import { Router } from 'express';
import { createBatchRateLimiter } from '../../shared/middleware/rate-limit.js';
import { createAudienceResearchRunController, decideAudienceResearchSignalController, getAudienceResearchRunController, getAudienceResearchRunResultController, listAudienceResearchRunsController, previewAudienceResearchController, } from './audience-research.controller.js';
export function createAudienceResearchSiteRouter(): Router {
    const router = Router();
    const createLimiter = createBatchRateLimiter('content_intelligence_create');
    const pollLimiter = createBatchRateLimiter('content_intelligence_poll');
    // Preview is a read w.r.t. spend — no enqueue — so it
    // shares the lighter poll bucket.
    router.post('/:siteId/audience-research/preview', pollLimiter, previewAudienceResearchController);
    router.post('/:siteId/audience-research/runs', createLimiter, createAudienceResearchRunController);
    router.get('/:siteId/audience-research/runs', pollLimiter, listAudienceResearchRunsController);
    router.get('/:siteId/audience-research/runs/:runId', pollLimiter, getAudienceResearchRunController);
    router.get('/:siteId/audience-research/runs/:runId/result', pollLimiter, getAudienceResearchRunResultController);
    // Signal decision endpoint. Reuses the `create` bucket so
    // the mutation path shares the tighter DoS envelope while reads/preview
    // stay on the lighter poll bucket.
    router.post('/:siteId/audience-research/runs/:runId/signals/:signalId/decision', createLimiter, decideAudienceResearchSignalController);
    return router;
}
