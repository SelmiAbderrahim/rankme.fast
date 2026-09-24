import { Router, type RequestHandler } from 'express';
import { createAppReviewRunController, getAppReviewRunController, listAppReviewRunsController, } from './reviews.controller.js';
export function createAppReviewRouter(input: {
    createLimiter: RequestHandler;
    pollLimiter: RequestHandler;
}): Router {
    const router = Router({ mergeParams: true });
    router.post('/runs', input.createLimiter, createAppReviewRunController);
    router.get('/runs', input.pollLimiter, listAppReviewRunsController);
    router.get('/runs/:runId', input.pollLimiter, getAppReviewRunController);
    return router;
}
