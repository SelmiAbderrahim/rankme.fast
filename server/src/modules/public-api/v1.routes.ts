import { Router } from 'express';
import { v1BacklinkRowsHandler, v1LatestReportHandler, v1ListKeywordsHandler, v1ListSitesHandler, v1RankHistoryHandler, v1SerpFeaturesHandler, } from './v1.controller.js';
/**
 * Read-only v1 surface. Mounted in app.ts behind
 * `createApiRateLimiter() → createApiKeyAuth(...) → requireFeature('api')` —
 * NOT behind the cookie chain.
 */
export const v1Router: Router = Router();
v1Router.get('/sites', v1ListSitesHandler);
v1Router.get('/sites/:siteId/report/latest', v1LatestReportHandler);
v1Router.get('/sites/:siteId/rank-history', v1RankHistoryHandler);
v1Router.get('/keywords', v1ListKeywordsHandler);
v1Router.get('/serp-features', v1SerpFeaturesHandler);
v1Router.get('/backlink-rows', v1BacklinkRowsHandler);
