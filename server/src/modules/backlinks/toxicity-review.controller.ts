import type { Request, RequestHandler } from 'express';
import { DEFAULT_LOCALE, isSupportedLocale } from '../../shared/i18n/locales.js';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { requireAccountId } from '../../shared/utils/require-account-id.js';
import { getBacklinkDeepQueue, getBacklinksDb } from './backlinks.holder.js';
import { disavowBuildBodySchema, toxicityDetailQuerySchema, toxicityPreviewBodySchema, toxicityRunParamsSchema, toxicityRunsQuerySchema, toxicityStartBodySchema, } from './toxicity-review.schema.js';
import { buildToxicityDisavow, getToxicityReview, listToxicityReviews, previewToxicityReviewSpend, startToxicityReview, } from './toxicity-review.service.js';
export function resolveToxicityLocale(req: Request) {
    if (isSupportedLocale(req.language))
        return req.language;
    return DEFAULT_LOCALE;
}
export const previewToxicityReviewHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const body = toxicityPreviewBodySchema.parse(req.body);
    res.status(200).json(await previewToxicityReviewSpend(accountId, body.siteId, {
        queue: getBacklinkDeepQueue(),
    }));
});
export const startToxicityReviewHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const body = toxicityStartBodySchema.parse(req.body);
    res.status(202).json(await startToxicityReview({
        accountId,
        siteId: body.siteId,
        locale: body.locale ?? resolveToxicityLocale(req),
    }, { queue: getBacklinkDeepQueue() }));
});
export const listToxicityReviewsHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const query = toxicityRunsQuerySchema.parse(req.query);
    res.status(200).json(await listToxicityReviews(accountId, query));
});
export const getToxicityReviewHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { runId } = toxicityRunParamsSchema.parse(req.params);
    const query = toxicityDetailQuerySchema.parse(req.query);
    res.status(200).json(await getToxicityReview(accountId, runId, query, getBacklinksDb()));
});
export const downloadToxicityDisavowHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { runId } = toxicityRunParamsSchema.parse(req.params);
    const body = disavowBuildBodySchema.parse(req.body);
    const file = await buildToxicityDisavow(accountId, runId, body, getBacklinksDb(), new Date());
    res.status(200);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.send(file.text);
});
