/**
 * Content Intelligence route factories.
 *
 * Two routers — one site-scoped, one analysis-scoped. Factories (not module-
 * level `Router()` singletons) so the per-bucket rate limiters read the
 * live env values each time `createApp()` is called; this lets tests
 * override `RATE_LIMIT_CONTENT_CREATE_MAX` / `RATE_LIMIT_CONTENT_POLL_MAX`
 * inside a single test and rebuild the app to observe the effect. Mirrors
 * the `createAuthRateLimiter` / `createContactRateLimiter` pattern from
 * `shared/middleware/rate-limit.ts`.
 *
 * The `verified` (requireCsrf + requireAuth + requireVerified) chain is
 * applied at the app level; here we only layer the per-bucket rate limiters.
 * State-changing routes sit behind `content_intelligence_create`; the poll
 * endpoints sit behind the lighter `content_intelligence_poll` bucket.
 */
import { Router } from 'express';
import { createBatchRateLimiter } from '../../shared/middleware/rate-limit.js';
import { cancelAnalysisController, createAnalysisController, getAnalysisController, listAnalysesController, preflightAnalysisController, regenerateAnalysisController, saveBriefVersionController, saveDraftVersionController, acceptRecommendationController, applyRecommendationController, dismissRecommendationController, getRecommendationApplicationCheckController, listRecommendationHistoryController, undoRecommendationController, getRecommendationOutcomeController, } from './content-intelligence.controller.js';
export function createContentIntelligenceSiteRouter(): Router {
    const router = Router();
    const createLimiter = createBatchRateLimiter('content_intelligence_create');
    const pollLimiter = createBatchRateLimiter('content_intelligence_poll');
    router.post('/:siteId/content-analyses', createLimiter, createAnalysisController);
    router.post('/:siteId/content-analyses/preflight', createLimiter, preflightAnalysisController);
    router.get('/:siteId/content-analyses', pollLimiter, listAnalysesController);
    return router;
}
export function createContentIntelligenceAnalysisRouter(): Router {
    const router = Router();
    const createLimiter = createBatchRateLimiter('content_intelligence_create');
    const pollLimiter = createBatchRateLimiter('content_intelligence_poll');
    const recommendationLimiter = createBatchRateLimiter('content_recommendation_state');
    router.get('/:analysisId', pollLimiter, getAnalysisController);
    router.post('/:analysisId/cancel', createLimiter, cancelAnalysisController);
    router.post('/:analysisId/regenerate', createLimiter, regenerateAnalysisController);
    router.post('/:analysisId/brief-versions', createLimiter, saveBriefVersionController);
    router.post('/:analysisId/draft-versions', createLimiter, saveDraftVersionController);
    router.get('/:analysisId/recommendations/:recommendationId/application-check', pollLimiter, getRecommendationApplicationCheckController);
    router.get('/:analysisId/recommendations/:recommendationId/history', pollLimiter, listRecommendationHistoryController);
    router.get('/:analysisId/recommendations/:recommendationId/outcome', pollLimiter, getRecommendationOutcomeController);
    router.post('/:analysisId/recommendations/:recommendationId/accept', recommendationLimiter, acceptRecommendationController);
    router.post('/:analysisId/recommendations/:recommendationId/dismiss', recommendationLimiter, dismissRecommendationController);
    router.post('/:analysisId/recommendations/:recommendationId/apply', recommendationLimiter, applyRecommendationController);
    router.post('/:analysisId/recommendations/:recommendationId/undo', recommendationLimiter, undoRecommendationController);
    return router;
}
