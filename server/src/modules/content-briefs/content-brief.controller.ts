import type { RequestHandler } from 'express';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { requireAccountId } from '../../shared/utils/require-account-id.js';
import { getContentBriefAi, getContentBriefDb, getContentBriefQueue, } from './content-brief.holder.js';
import { contentBriefCreateBodySchema, contentBriefDraftBodySchema, contentBriefListQuerySchema, contentBriefPathParamsSchema, contentBriefPreviewBodySchema, contentBriefSiteParamSchema, } from './content-brief.schemas.js';
import { createContentBrief, getContentBrief, listContentBriefs, previewContentBrief, rescoreContentBriefDraft, } from './content-brief.service.js';
export const previewContentBriefHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { siteId } = contentBriefSiteParamSchema.parse(req.params);
    const body = contentBriefPreviewBodySchema.parse(req.body);
    res.status(200).json(await previewContentBrief(accountId, siteId, body, {
        db: getContentBriefDb(),
    }));
});
export const createContentBriefHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { siteId } = contentBriefSiteParamSchema.parse(req.params);
    const body = contentBriefCreateBodySchema.parse(req.body);
    res.status(202).json(await createContentBrief(accountId, siteId, body, {
        db: getContentBriefDb(),
        queue: getContentBriefQueue(),
    }));
});
export const listContentBriefsHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { siteId } = contentBriefSiteParamSchema.parse(req.params);
    const query = contentBriefListQuerySchema.parse(req.query);
    res.status(200).json(await listContentBriefs(accountId, siteId, query));
});
export const getContentBriefHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { siteId, briefId } = contentBriefPathParamsSchema.parse(req.params);
    res.status(200).json(await getContentBrief(accountId, siteId, briefId));
});
export const rescoreContentBriefDraftHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { siteId, briefId } = contentBriefPathParamsSchema.parse(req.params);
    const body = contentBriefDraftBodySchema.parse(req.body);
    const ai = getContentBriefAi();
    res.status(200).json(await rescoreContentBriefDraft(accountId, siteId, briefId, body, {
        db: getContentBriefDb(),
        ai: ai.runner,
        aiProviderOrder: ai.providerOrder,
    }));
});
