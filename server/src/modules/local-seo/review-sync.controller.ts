import type { RequestHandler } from 'express';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { requireAccountId } from '../../shared/utils/require-account-id.js';
import { toSupportedLocale } from '../../shared/i18n/index.js';
import { getReviewSyncQueue } from './local-seo.holder.js';
import { previewReviewSyncSpend } from './review-sync.preview.js';
import { createReviewSourceSchema, reviewInventoryExportQuerySchema, reviewInventoryQuerySchema, reviewPreviewSchema, reviewRunListQuerySchema, reviewRunParamsSchema, reviewSourceListQuerySchema, reviewSourceParamsSchema, reviewSyncSchema, } from './review-sync.schema.js';
import { createReviewSource, deleteReviewSource, enqueueReviewSync, getReviewRun, getReviewStats, listReviewInventory, listReviewRuns, listReviewSources, openReviewInventoryCsv, } from './review-sync.service.js';
import { getReviewThemes } from './review-themes.service.js';
export const createReviewSourceHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const body = createReviewSourceSchema.parse(req.body);
    res.status(201).json(await createReviewSource(accountId, body));
});
export const deleteReviewSourceHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { id } = reviewSourceParamsSchema.parse(req.params);
    res.status(200).json(await deleteReviewSource(accountId, id));
});
export const listReviewSourcesHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { profileId } = reviewSourceListQuerySchema.parse(req.query);
    res.status(200).json(await listReviewSources(accountId, profileId));
});
export const previewReviewSyncHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const body = reviewPreviewSchema.parse(req.body);
    res.status(200).json(await previewReviewSyncSpend(accountId, body));
});
export const createReviewSyncHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const body = reviewSyncSchema.parse(req.body);
    const result = await enqueueReviewSync(accountId, {
        ...body,
        outputLocale: toSupportedLocale(req.language),
    }, {
        queue: getReviewSyncQueue(),
    });
    res.status(202).json(result);
});
export const listReviewRunsHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const query = reviewRunListQuerySchema.parse(req.query);
    res.status(200).json(await listReviewRuns(accountId, query));
});
export const getReviewRunHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { id } = reviewRunParamsSchema.parse(req.params);
    res.status(200).json(await getReviewRun(accountId, id));
});
/**
 * Stored themes for one run. Citation enforcement and the
 * 300-character excerpt clamp happen at THIS boundary, not in the UI.
 */
export const getReviewThemesHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { id } = reviewRunParamsSchema.parse(req.params);
    res.status(200).json(await getReviewThemes(accountId, id));
});
/**
 * Deterministic stats for the run's profile. Pure math over the
 * rows currently stored; no AI, no vendor call, no kill-switch gate.
 */
export const getReviewStatsHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { id } = reviewRunParamsSchema.parse(req.params);
    res.status(200).json(await getReviewStats(accountId, id));
});
export const listReviewInventoryHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const query = reviewInventoryQuerySchema.parse(req.query);
    res.status(200).json(await listReviewInventory(accountId, query));
});
export const exportReviewInventoryHandler: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const query = reviewInventoryExportQuerySchema.parse(req.query);
    // Ownership is checked before this returns, so a cross-account request can
    // still produce the normal JSON 404 rather than a half-open CSV response.
    const chunks = await openReviewInventoryCsv(accountId, query);
    res.status(200);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="reviews.csv"');
    for await (const chunk of chunks) {
        res.write(chunk);
    }
    res.end();
});
