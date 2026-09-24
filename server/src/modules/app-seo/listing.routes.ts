import { Router, type RequestHandler } from 'express';
import { createAppListingRunController, readAppListingHistoryController, readLatestAppListingController, } from './listing.controller.js';
export function createAppListingRouter(input: {
    createLimiter: RequestHandler;
    pollLimiter: RequestHandler;
}): Router {
    const router = Router({ mergeParams: true });
    router.post('/runs', input.createLimiter, createAppListingRunController);
    router.get('/latest', input.pollLimiter, readLatestAppListingController);
    router.get('/history', input.pollLimiter, readAppListingHistoryController);
    return router;
}
