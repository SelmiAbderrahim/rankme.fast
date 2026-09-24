import { Router, type RequestHandler } from 'express';
import { previewAppResearchController, readLatestAppResearchController, runAppCompetitorDiscoveryController, runAppGapResearchController, runAppKeywordResearchController, } from './research.controller.js';
export function createAppResearchRouter(input: {
    createLimiter: RequestHandler;
    pollLimiter: RequestHandler;
}): Router {
    const router = Router({ mergeParams: true });
    router.get('/keywords/preview', input.createLimiter, previewAppResearchController('keywords'));
    router.post('/keywords', input.createLimiter, runAppKeywordResearchController);
    router.get('/keywords', input.pollLimiter, readLatestAppResearchController('keywords'));
    router.get('/gap/preview', input.createLimiter, previewAppResearchController('gap'));
    router.post('/gap', input.createLimiter, runAppGapResearchController);
    router.get('/gap', input.pollLimiter, readLatestAppResearchController('gap'));
    router.get('/competitors/preview', input.createLimiter, previewAppResearchController('competitors'));
    router.post('/competitors', input.createLimiter, runAppCompetitorDiscoveryController);
    router.get('/competitors', input.pollLimiter, readLatestAppResearchController('competitors'));
    return router;
}
