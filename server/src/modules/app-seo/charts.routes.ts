import { Router, type RequestHandler } from 'express';
import { appChartHistoryController, createAppChartSubscriptionController, deleteAppChartSubscriptionController, listAppChartSubscriptionsController, recheckAppChartSubscriptionController, } from './charts.controller.js';
export function createAppChartRouter(input: {
    createLimiter: RequestHandler;
    pollLimiter: RequestHandler;
}): Router {
    const router = Router({ mergeParams: true });
    router.post('/', input.createLimiter, createAppChartSubscriptionController);
    router.get('/', input.pollLimiter, listAppChartSubscriptionsController);
    router.delete('/:subscriptionId', input.createLimiter, deleteAppChartSubscriptionController);
    router.get('/:subscriptionId/history', input.pollLimiter, appChartHistoryController);
    router.post('/:subscriptionId/recheck', input.createLimiter, recheckAppChartSubscriptionController);
    return router;
}
