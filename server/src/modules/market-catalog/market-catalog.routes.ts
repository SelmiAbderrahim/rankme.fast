import { Router } from 'express';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { getMarketCatalogDeps } from './market-catalog.holder.js';
import { marketCatalogSurfaceSchema } from './market-catalog.schemas.js';
import { getMarketCatalog } from './market-catalog.service.js';
export const marketCatalogRouter = Router();
marketCatalogRouter.get('/:surface', asyncHandler(async (req, res) => {
    const surface = marketCatalogSurfaceSchema.parse(req.params.surface);
    res.status(200).json(await getMarketCatalog(surface, getMarketCatalogDeps()));
}));
