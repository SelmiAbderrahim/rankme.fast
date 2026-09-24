import { Router } from 'express';
import { intersectionHandler, listHandler, refreshHandler, techStackHandler, } from './competitors.controller.js';
import { createTrafficSnapshotsRouter } from './traffic-snapshots.routes.js';
/**
 * Competitor research routes, open to every verified account. The app mounts
 * this router behind `[requireAuth, requireVerified]`.
 */
export const competitorsRouter: Router = Router();
// Traffic Insights keeps its own POST limiter and kill switch inside.
competitorsRouter.use('/traffic-snapshots', createTrafficSnapshotsRouter());
competitorsRouter.get('/:siteId/competitors', listHandler);
competitorsRouter.get('/:siteId/competitors/intersection', intersectionHandler);
// On-demand tech-stack lookup for one competitor (the `/tech-stack` suffix
// disambiguates from the `/intersection` and `/refresh` sub-routes).
competitorsRouter.get('/:siteId/competitors/:domain/tech-stack', techStackHandler);
// POST — a refresh spends real vendor budget.
competitorsRouter.post('/:siteId/competitors/refresh', refreshHandler);
