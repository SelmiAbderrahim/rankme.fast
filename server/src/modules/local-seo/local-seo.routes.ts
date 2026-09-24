import { Router } from 'express';
import { localPackRankHandler, readLocalSeoHandler, refreshLocalSeoHandler, } from './local-seo.controller.js';
export const localSeoRouter: Router = Router();
localSeoRouter.get('/:siteId/local-seo', readLocalSeoHandler);
localSeoRouter.post('/:siteId/local-seo/refresh', refreshLocalSeoHandler);
localSeoRouter.post('/:siteId/local-seo/keywords/:keywordId/rank', localPackRankHandler);
