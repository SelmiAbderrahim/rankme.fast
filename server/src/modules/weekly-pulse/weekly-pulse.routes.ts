/**
 * Weekly Pulse — site-scoped Express router.
 *
 * Mounted at `/api/sites` behind the shared `verified` chain (requireCsrf +
 * requireAuth + requireVerified). Cross-account access → 404 (never 403).
 */
import { Router } from 'express';
import { getPulseHistoryController, getPulseHistoryDetailController, getPulseStateController, previewPulseController, setPulseSubscriptionController, } from './weekly-pulse.controller.js';
export function createWeeklyPulseSiteRouter(): Router {
    const router = Router();
    router.get('/:siteId/weekly-pulse', getPulseStateController);
    router.post('/:siteId/weekly-pulse/preview', previewPulseController);
    router.put('/:siteId/weekly-pulse', setPulseSubscriptionController);
    router.get('/:siteId/weekly-pulse/history', getPulseHistoryController);
    router.get('/:siteId/weekly-pulse/history/:pulseId', getPulseHistoryDetailController);
    return router;
}
