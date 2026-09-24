import { Router, type RequestHandler } from 'express';
import { createBatchRateLimiter } from '../../shared/middleware/rate-limit.js';
import { requireTeamRole } from '../../shared/middleware/require-team-role.js';
import { requireAccountId } from '../../shared/utils/require-account-id.js';
import { requireTeamResourceSiteAccess } from '../../shared/middleware/team-site-access.js';
import { capabilities, create, download, inspect, list, listAllShares, remove, } from './report-exports.controller.js';
import { createShare, listShares, revokeShare, } from './report-export-shares.controller.js';
import { resolveOwnedReportExportSiteId } from './report-exports.service.js';
const noStore: RequestHandler = (_req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
};
export function createReportExportsRouter(): Router {
    const router = Router();
    const createLimiter = createBatchRateLimiter('report_exports_create');
    const manageLimiter = createBatchRateLimiter('report_exports_manage');
    const downloadLimiter = createBatchRateLimiter('report_exports_download');
    router.use(noStore);
    router.use('/:snapshotId', requireTeamResourceSiteAccess((req) => resolveOwnedReportExportSiteId(requireAccountId(req), String(req.params.snapshotId)), 'reportExports.errors.notFound'));
    router.get('/capabilities', manageLimiter, capabilities);
    router.get('/shares', manageLimiter, listAllShares);
    router.post('/', createLimiter, create);
    router.get('/', manageLimiter, list);
    router.post('/:snapshotId/shares', manageLimiter, requireTeamRole('admin'), createShare);
    router.get('/:snapshotId/shares', manageLimiter, requireTeamRole('admin'), listShares);
    router.post('/:snapshotId/shares/:shareId/revoke', manageLimiter, requireTeamRole('admin'), revokeShare);
    router.get('/:snapshotId/download', downloadLimiter, download);
    router.get('/:snapshotId', manageLimiter, inspect);
    router.delete('/:snapshotId', manageLimiter, remove);
    return router;
}
