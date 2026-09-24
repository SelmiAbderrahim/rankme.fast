import { Router } from 'express';
import { createBatchRateLimiter, type RateLimitOverrides, } from '../../shared/middleware/rate-limit.js';
import { createContentBriefHandler, getContentBriefHandler, listContentBriefsHandler, previewContentBriefHandler, rescoreContentBriefDraftHandler, } from './content-brief.controller.js';
export function createContentBriefRouter(createOverrides: RateLimitOverrides = {}, pollOverrides: RateLimitOverrides = {}, rescoreOverrides: RateLimitOverrides = {}): Router {
    const router = Router();
    const createLimiter = createBatchRateLimiter('content_brief_create', createOverrides);
    const pollLimiter = createBatchRateLimiter('content_brief_poll', pollOverrides);
    const rescoreLimiter = createBatchRateLimiter('content_brief_rescore', rescoreOverrides);
    router.post('/:siteId/content-briefs/preview', createLimiter, previewContentBriefHandler);
    router.post('/:siteId/content-briefs', createLimiter, createContentBriefHandler);
    router.get('/:siteId/content-briefs', pollLimiter, listContentBriefsHandler);
    router.get('/:siteId/content-briefs/:briefId', pollLimiter, getContentBriefHandler);
    router.post('/:siteId/content-briefs/:briefId/drafts', rescoreLimiter, rescoreContentBriefDraftHandler);
    return router;
}
