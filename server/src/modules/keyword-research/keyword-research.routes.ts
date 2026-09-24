import { Router } from 'express';
import { clustersDetailHandler, clustersListHandler, clustersRunHandler, decisionHandler, gapHandler, historyHandler, ideasHandler, longTailHandler, intentHandler, metricsHandler, overviewHandler, previewHandler, relatedHandler, trendsExploreHandler, trendsExplorePreviewHandler, trendsGetHandler, trendsHandler, trendsListHandler, } from './keyword-research.controller.js';
import { createBatchRateLimiter } from '../../shared/middleware/rate-limit.js';
/**
 * Keyword research routes. Every route sits behind the app-level
 * `[requireAuth, requireVerified]` mount; intent classification (cached) and
 * keyword ideas (uncached) share the same `keyword` provider surface.
 */
export const keywordResearchRouter: Router = Router();
keywordResearchRouter.post('/metrics', metricsHandler);
keywordResearchRouter.post('/related', relatedHandler);
keywordResearchRouter.post('/intent', intentHandler);
keywordResearchRouter.post('/ideas', ideasHandler);
keywordResearchRouter.post('/long-tail', longTailHandler);
// Gap / overview / Labs trends lookups; preview is read-only and never calls
// a provider.
keywordResearchRouter.post('/gap', gapHandler);
keywordResearchRouter.post('/overview', overviewHandler);
keywordResearchRouter.post('/trends', trendsHandler);
keywordResearchRouter.post('/preview', previewHandler);
keywordResearchRouter.get('/history', historyHandler);
// Cited AI clustering pass over stored keyword rows. `POST` runs
// (or free-reads on identical rerun); the two GET routes are free reads of
// stored run data, scoped to the calling account (cross-account 404).
keywordResearchRouter.post('/clusters', clustersRunHandler);
keywordResearchRouter.get('/clusters', clustersListHandler);
keywordResearchRouter.get('/clusters/:runId', clustersDetailHandler);
// Cluster decision routing: read/write of stored data. Accepted decisions
// delegate ONE Content Intelligence recommendation via the
// content-intelligence public API (no new action source type, no direct
// action-event write, no second store).
keywordResearchRouter.post('/clusters/:runId/clusters/:clusterId/decision', decisionHandler);
// Keyword Trends live exploration + stored reads. The explore route is rate
// limited and guarded by the `KEYWORD_TRENDS_ENABLED` kill switch inside the
// handler; stored reads (`GET /trends`, `GET /trends/:runId`) survive the flag.
keywordResearchRouter.post('/trends/explore', createBatchRateLimiter('keyword_trends'), trendsExploreHandler);
// Read-only preview endpoint: same kill switch and input normalization as the
// explore route, never reserves, calls a provider, or writes a run row.
keywordResearchRouter.post('/trends/explore/preview', trendsExplorePreviewHandler);
keywordResearchRouter.get('/trends', trendsListHandler);
keywordResearchRouter.get('/trends/:runId', trendsGetHandler);
