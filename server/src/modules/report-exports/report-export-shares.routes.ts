import { Router, type RequestHandler } from 'express';
import { createReportShareIpRateLimiter, createReportShareTokenRateLimiter, } from '../../shared/middleware/rate-limit.js';
import { authenticatePublicFile, authenticatePublicView, downloadPublicShare, getPublicShare, } from './report-export-shares.controller.js';
const publicHeaders: RequestHandler = (_req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
};
export function createPublicReportSharesRouter(): Router {
    const router = Router();
    const ip = createReportShareIpRateLimiter();
    const token = createReportShareTokenRateLimiter();
    router.use(publicHeaders);
    router.get('/:token', ip, authenticatePublicView, token, getPublicShare);
    router.get('/:token/files/:format', ip, authenticatePublicFile, token, downloadPublicShare);
    return router;
}
