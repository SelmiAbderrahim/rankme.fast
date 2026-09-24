import { Router } from 'express';
import { altEnginePreviewHandler, checkKeywordNowHandler, checkNowHandler, createKeywordHandler, deactivateKeywordHandler, keywordHistoryHandler, keywordSuggestionsHandler, listKeywordsHandler, updateCadenceHandler, } from './keywords.controller.js';
import { listSerpFeaturesHandler, serpFeatureDetailHandler, } from './serp-features.controller.js';
/**
 * Two routers mirror the audits module: `/api/sites/:siteId/*` for the
 * site-scoped surfaces (keyword CRUD + cadence), `/api/keywords/:id/*` for
 * keyword-scoped reads (history for the trend UI).
 */
export const ranksSiteRouter: Router = Router();
ranksSiteRouter.post('/:siteId/keyword-suggestions', keywordSuggestionsHandler);
// Read-only preview BEFORE the paid submit.
// Declared before `/:siteId/keywords` would otherwise shadow it is not an
// issue (different path), but keeping it adjacent documents the pairing.
ranksSiteRouter.post('/:siteId/keywords/preview', altEnginePreviewHandler);
ranksSiteRouter.post('/:siteId/keywords', createKeywordHandler);
ranksSiteRouter.post('/:siteId/keywords/check', checkNowHandler);
ranksSiteRouter.get('/:siteId/keywords', listKeywordsHandler);
ranksSiteRouter.patch('/:siteId/rank-cadence', updateCadenceHandler);
// Stored SERP-feature observations. Read-only and
// zero vendor spend. The kill switch gates new persistence, never stored reads.
ranksSiteRouter.get('/:siteId/serp-features', listSerpFeaturesHandler);
export const ranksKeywordRouter: Router = Router();
ranksKeywordRouter.post('/:id/check', checkKeywordNowHandler);
ranksKeywordRouter.delete('/:id', deactivateKeywordHandler);
ranksKeywordRouter.get('/:id/history', keywordHistoryHandler);
ranksKeywordRouter.get('/:id/serp-features', serpFeatureDetailHandler);
