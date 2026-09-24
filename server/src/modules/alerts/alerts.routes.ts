/**
 * Alerts router. Mounted behind
 * `[requireCsrf, requireAuth, requireVerified]` from `app.ts`.
 *
 * Two named per-account buckets: `alerts_manage` on the mutation paths and
 * `alerts_poll` on the stored rule/delivery reads, so a polling client can
 * never lock itself out of the log for rules it already configured.
 */
import { Router } from 'express';
import { createBatchRateLimiter } from '../../shared/middleware/rate-limit.js';
import { createRuleController, deleteRuleController, listDeliveriesController, listRulesController, updateRuleController, } from './alerts.controller.js';
export function createAlertsRouter(): Router {
    const router = Router();
    const manageLimiter = createBatchRateLimiter('alerts_manage');
    const pollLimiter = createBatchRateLimiter('alerts_poll');
    router.get('/rules', pollLimiter, listRulesController);
    router.post('/rules', manageLimiter, createRuleController);
    router.patch('/rules/:ruleId', manageLimiter, updateRuleController);
    router.delete('/rules/:ruleId', manageLimiter, deleteRuleController);
    router.get('/rules/:ruleId/deliveries', pollLimiter, listDeliveriesController);
    return router;
}
