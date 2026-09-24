import { Router } from 'express';
import { listHandler, refreshHandler, summaryHandler, } from './backlinks.controller.js';
/**
 * Mounted at `/api/sites` — routes are `/:siteId/backlinks/*`.
 */
export const backlinksRouter: Router = Router();
backlinksRouter.get('/:siteId/backlinks/summary', summaryHandler);
backlinksRouter.get('/:siteId/backlinks', listHandler);
// POST — a refresh spends real vendor budget.
backlinksRouter.post('/:siteId/backlinks/refresh', refreshHandler);
