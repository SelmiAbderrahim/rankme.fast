import type { Request, Response } from 'express';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { requireAccountId } from '../../shared/utils/require-account-id.js';
import { appSeoSiteParamsSchema } from './app-seo.schema.js';
import { getAppSeoDb } from './app-seo.holder.js';
import { appResearchCompetitorsBodySchema, appResearchGapBodySchema, appResearchKeywordsBodySchema, appResearchPreviewQuerySchema, appResearchStoredQuerySchema, } from './research.schema.js';
import { previewAppResearch, readLatestAppResearch, runAppCompetitorDiscovery, runAppGapResearch, runAppKeywordResearch, } from './research.service.js';
const paramsFor = (req: Request) => appSeoSiteParamsSchema.parse(req.params);
export const previewAppResearchController = (surface: 'keywords' | 'gap' | 'competitors') => asyncHandler(async (req: Request, res: Response) => {
    const accountId = requireAccountId(req);
    const params = paramsFor(req);
    const query = appResearchPreviewQuerySchema.parse(req.query);
    const appIds = query.appIds
        ? query.appIds.split(',').map((value) => value.trim()).filter(Boolean)
        : undefined;
    const preview = await previewAppResearch({
        accountId,
        siteId: params.siteId,
        profileId: query.profileId,
        store: query.store,
        surface,
        locationCode: query.locationCode,
        languageCode: query.languageCode,
        ...(appIds ? { appIds } : {}),
    }, getAppSeoDb());
    res.status(200).json({ preview });
});
export const runAppKeywordResearchController = asyncHandler(async (req: Request, res: Response) => {
    const accountId = requireAccountId(req);
    const params = paramsFor(req);
    const input = appResearchKeywordsBodySchema.parse(req.body);
    const result = await runAppKeywordResearch({ accountId, siteId: params.siteId, input }, getAppSeoDb());
    res.status(200).json({ result });
});
export const runAppGapResearchController = asyncHandler(async (req: Request, res: Response) => {
    const accountId = requireAccountId(req);
    const params = paramsFor(req);
    const input = appResearchGapBodySchema.parse(req.body);
    const result = await runAppGapResearch({ accountId, siteId: params.siteId, input }, getAppSeoDb());
    res.status(200).json({ result });
});
export const runAppCompetitorDiscoveryController = asyncHandler(async (req: Request, res: Response) => {
    const accountId = requireAccountId(req);
    const params = paramsFor(req);
    const input = appResearchCompetitorsBodySchema.parse(req.body);
    const result = await runAppCompetitorDiscovery({ accountId, siteId: params.siteId, input }, getAppSeoDb());
    res.status(200).json({ result });
});
export const readLatestAppResearchController = (surface: 'keywords' | 'gap' | 'competitors') => asyncHandler(async (req: Request, res: Response) => {
    const accountId = requireAccountId(req);
    const params = paramsFor(req);
    const query = appResearchStoredQuerySchema.parse(req.query);
    const response = await readLatestAppResearch({
        accountId,
        siteId: params.siteId,
        profileId: query.profileId,
        store: query.store,
        surface,
    }, getAppSeoDb());
    res.status(200).json(response);
});
