import { Router } from 'express';
import type { RequestHandler } from 'express';
import { appKeywordHistoryController, deleteAppKeywordController, listAppKeywordsController, mintAppKeywordController, recheckAppKeywordController, } from './keywords.controller.js';
export function createAppKeywordRouter(input: {
    createLimiter: RequestHandler;
    pollLimiter: RequestHandler;
}): Router {
    const router = Router({ mergeParams: true });
    router.post('/', input.createLimiter, mintAppKeywordController);
    router.get('/', input.pollLimiter, listAppKeywordsController);
    router.delete('/:keywordId', input.createLimiter, deleteAppKeywordController);
    router.post('/:keywordId/recheck', input.createLimiter, recheckAppKeywordController);
    router.get('/:keywordId/history', input.pollLimiter, appKeywordHistoryController);
    return router;
}
