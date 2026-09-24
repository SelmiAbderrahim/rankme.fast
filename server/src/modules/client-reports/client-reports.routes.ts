import { Router, type RequestHandler } from 'express';
import { Types } from 'mongoose';
import { createBatchRateLimiter } from '../../shared/middleware/rate-limit.js';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { requireAccountId } from '../../shared/utils/require-account-id.js';
import { Site } from '../sites/sites.model.js';
import { createClientPortalLink, createClientReportSchedule, deleteClientReportSchedule, downloadClientReportPdf, getClientReportsOverview, getPublicClientPortal, listClientReportDeliveries, revokeClientPortalLink, updateClientReportSchedule, } from './client-reports.controller.js';
/** Resolve site ownership before any site-scoped client-report route runs. */
export const requireOwnedClientReportSite: RequestHandler = asyncHandler(async (req, _res, next) => {
    const accountId = requireAccountId(req);
    const siteId = req.params.siteId;
    if (!siteId || !Types.ObjectId.isValid(siteId)) {
        throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
    }
    const site = await Site.exists({ _id: siteId, accountId, deletionStartedAt: null });
    if (!site)
        throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
    next();
});
export function createClientReportsRouter(): Router {
    const router = Router();
    const manageLimiter = createBatchRateLimiter('client_reports_manage');
    const pollLimiter = createBatchRateLimiter('client_reports_poll');
    router.use('/sites/:siteId', requireOwnedClientReportSite);
    router.get('/sites/:siteId', pollLimiter, getClientReportsOverview);
    router.post('/sites/:siteId/pdf', manageLimiter, downloadClientReportPdf);
    router.post('/sites/:siteId/schedules', manageLimiter, createClientReportSchedule);
    router.put('/sites/:siteId/schedules/:scheduleId', manageLimiter, updateClientReportSchedule);
    router.delete('/sites/:siteId/schedules/:scheduleId', manageLimiter, deleteClientReportSchedule);
    router.get('/sites/:siteId/deliveries', pollLimiter, listClientReportDeliveries);
    router.post('/sites/:siteId/portals', manageLimiter, createClientPortalLink);
    router.post('/sites/:siteId/portals/:portalId/revoke', manageLimiter, revokeClientPortalLink);
    return router;
}
export function createPublicClientPortalRouter(): Router {
    const router = Router();
    router.get('/:token', createBatchRateLimiter('client_reports_portal'), getPublicClientPortal);
    return router;
}
