import { Router } from 'express';
import { clearBusinessHandler, localPackRankHandler, readLocalBusinessHandler, readLocalSeoHandler, refreshLocalSeoHandler, searchBusinessHandler, searchPlacesHandler, selectBusinessHandler, } from './local-seo.controller.js';
export const localSeoRouter: Router = Router();
localSeoRouter.get('/:siteId/local-seo', readLocalSeoHandler);
localSeoRouter.post('/:siteId/local-seo/refresh', refreshLocalSeoHandler);
localSeoRouter.post('/:siteId/local-seo/keywords/:keywordId/rank', localPackRankHandler);
// Business setup: one search, then a free selection.
localSeoRouter.get('/:siteId/local-seo/business', readLocalBusinessHandler);
localSeoRouter.post('/:siteId/local-seo/business/search', searchBusinessHandler);
localSeoRouter.put('/:siteId/local-seo/business', selectBusinessHandler);
localSeoRouter.delete('/:siteId/local-seo/business', clearBusinessHandler);
// Geogrid centre search: same lookup, nothing stored.
localSeoRouter.post('/:siteId/local-seo/places/search', searchPlacesHandler);
