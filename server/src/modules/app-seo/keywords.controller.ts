import type { Request, Response } from 'express';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { requireAccountId } from '../../shared/utils/require-account-id.js';
import { getAppSeoDb } from './app-seo.holder.js';
import { appKeywordHistoryQuerySchema, appKeywordParamsSchema, appKeywordRecheckBodySchema, appKeywordSiteQuerySchema, mintAppKeywordBodySchema, } from './keywords.schema.js';
import { deleteAppKeyword, getAppKeywordHistory, listAppKeywords, mintAppKeyword, previewMintAppKeyword, recheckAppKeyword, } from './keywords.service.js';
import { appSeoSiteParamsSchema } from './app-seo.schema.js';
export const mintAppKeywordController = asyncHandler(async (req: Request, res: Response) => {
    const accountId = requireAccountId(req);
    const params = appSeoSiteParamsSchema.parse(req.params);
    const query = appKeywordSiteQuerySchema.parse(req.query);
    const body = mintAppKeywordBodySchema.parse(req.body);
    if (req.query.preview === 'true') {
        const preview = await previewMintAppKeyword({ accountId, siteId: params.siteId, profileId: query.profileId, store: body.store });
        res.status(200).json(preview);
        return;
    }
    const keyword = await mintAppKeyword({ accountId, siteId: params.siteId, profileId: query.profileId, keyword: body }, getAppSeoDb());
    res.status(201).json({ keyword });
});
export const listAppKeywordsController = asyncHandler(async (req: Request, res: Response) => {
    const accountId = requireAccountId(req);
    const params = appSeoSiteParamsSchema.parse(req.params);
    const query = appKeywordSiteQuerySchema.parse(req.query);
    res.status(200).json(await listAppKeywords({ accountId, siteId: params.siteId, profileId: query.profileId }, getAppSeoDb()));
});
export const deleteAppKeywordController = asyncHandler(async (req: Request, res: Response) => {
    const accountId = requireAccountId(req);
    const params = appKeywordParamsSchema.parse(req.params);
    await deleteAppKeyword({ accountId, siteId: params.siteId, keywordId: params.keywordId }, getAppSeoDb());
    res.status(204).end();
});
export const recheckAppKeywordController = asyncHandler(async (req: Request, res: Response) => {
    const accountId = requireAccountId(req);
    const params = appKeywordParamsSchema.parse(req.params);
    const body = appKeywordRecheckBodySchema.parse(req.body);
    const result = await recheckAppKeyword({ accountId, siteId: params.siteId, keywordId: params.keywordId, confirm: body.confirm }, getAppSeoDb());
    res.status(body.confirm && result.queued ? 202 : 200).json(result);
});
export const appKeywordHistoryController = asyncHandler(async (req: Request, res: Response) => {
    const accountId = requireAccountId(req);
    const params = appKeywordParamsSchema.parse(req.params);
    const query = appKeywordHistoryQuerySchema.parse(req.query);
    const items = await getAppKeywordHistory({ accountId, siteId: params.siteId, keywordId: params.keywordId, limit: query.limit }, getAppSeoDb());
    res.status(200).json({ items });
});
