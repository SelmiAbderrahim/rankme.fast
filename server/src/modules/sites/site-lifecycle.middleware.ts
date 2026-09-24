import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { Types } from 'mongoose';
import { logger } from '../../config/logger.js';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { requireAccountId } from '../../shared/utils/require-account-id.js';
import { assertTeamSiteAccess } from '../../shared/middleware/team-site-access.js';
import { SITE_WORK_LEASE_HEARTBEAT_MS, acquireSiteWorkLease, releaseSiteWorkLease, renewSiteWorkLease, runWithSiteWorkLeaseContext, } from './site-lifecycle.js';
import { Site } from './sites.model.js';
type SiteIdResolver = (req: Parameters<RequestHandler>[0]) => string | null | undefined | Promise<string | null | undefined>;
interface SiteMutationLeaseOptions {
    /** Resource-id reads use this to hide data as soon as deletion is claimed. */
    includeSafeMethods?: boolean;
    /** Only the actual `DELETE /api/sites/:siteId` lifecycle owner may bypass. */
    bypassRootDelete?: boolean;
}
/**
 * Lease boundary for `/api/sites/:siteId/**` requests. The exported site
 * middleware also leases reads: an in-flight read finishes before deletion is
 * claimed and every read arriving after the claim is hidden. The root DELETE
 * is the lifecycle owner and therefore intentionally bypasses its own lease.
 */
export function createSiteMutationLease(resolveSiteId: SiteIdResolver, options: SiteMutationLeaseOptions = {}): RequestHandler {
    return asyncHandler(async (req, res, next) => {
        if (!options.includeSafeMethods && ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
            return next();
        }
        if (options.bypassRootDelete && req.method === 'DELETE' && req.path === '/') {
            return next();
        }
        // Site scope is an authorization boundary, while the lease below is a
        // lifecycle boundary. Authorization must win first so an inaccessible
        // site is hidden before feature checks,
        // provider work, or a lease write. Check the mounted `:siteId` separately
        // because a small number of read-only preflights intentionally opt out of
        // leasing but must never opt out of team access control.
        const mountedSiteId = req.params?.siteId;
        if (typeof mountedSiteId === 'string' && Types.ObjectId.isValid(mountedSiteId)) {
            assertTeamSiteAccess(req, mountedSiteId);
        }
        const accountId = requireAccountId(req);
        const siteId = await resolveSiteId(req);
        if (!siteId)
            return next();
        if (siteId !== mountedSiteId)
            assertTeamSiteAccess(req, siteId);
        const lease = await acquireSiteWorkLease({ accountId, siteId }, `api:${req.id ?? 'request'}:${randomUUID()}`);
        if (!lease)
            return next(HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' }));
        let settled = false;
        const heartbeat = setInterval(() => {
            void renewSiteWorkLease(lease).catch((error) => {
                logger.error({ err: error, siteId }, 'site mutation lease renewal failed');
            });
        }, SITE_WORK_LEASE_HEARTBEAT_MS);
        heartbeat.unref();
        const settle = () => {
            if (settled)
                return;
            settled = true;
            clearInterval(heartbeat);
            void releaseSiteWorkLease(lease).catch((error) => {
                logger.error({ err: error, siteId }, 'site mutation lease release failed');
            });
        };
        res.once('finish', settle);
        res.once('close', settle);
        return runWithSiteWorkLeaseContext(lease, next);
    });
}
export const siteMutationLease = createSiteMutationLease((req) => {
    // Content-analysis preflight is deliberately a no-write ownership probe:
    // foreign sites return `{ok:false,reason:'not_owned'}` and malformed ids
    // are shaped by zod. It neither reserves nor enqueues, so no lease applies.
    if (req.method === 'POST' && req.path === '/content-analyses/preflight') {
        return null;
    }
    // A malformed id can never name a Site, so there is nothing to lease. Fall
    // through so the route's own zod schema shapes the documented 400 instead
    // of this middleware masking it as a 404 — same rule the body/query
    // resolvers below already apply.
    const { siteId } = req.params;
    return typeof siteId === 'string' && Types.ObjectId.isValid(siteId) ? siteId : null;
}, { includeSafeMethods: true, bypassRootDelete: true });
/** Covers legacy/non-nested product routes whose payload owns the site id. */
export const bodySiteMutationLease = createSiteMutationLease((req) => {
    const body = req.body as Record<string, unknown> | null;
    if (!body)
        return null;
    if (typeof body.siteId === 'string') {
        return Types.ObjectId.isValid(body.siteId) ? body.siteId : null;
    }
    // Review Intelligence calls the Site-backed local profile `profileId`.
    return typeof body.profileId === 'string' && Types.ObjectId.isValid(body.profileId)
        ? body.profileId
        : null;
});
/** Covers list/read routes that scope an optional Site through the query. */
export const querySiteMutationLease = createSiteMutationLease(async (req) => {
    const candidate = req.query.siteId ?? req.query.profileId;
    if (typeof candidate !== 'string' || !Types.ObjectId.isValid(candidate)) {
        return null;
    }
    // Preserve endpoints whose documented non-owned filter result is an empty
    // page rather than a 404. A claimed Site still exists and is therefore
    // passed to the atomic lease acquire, which hides it immediately.
    const accountId = requireAccountId(req);
    return (await Site.exists({ _id: candidate, accountId })) ? candidate : null;
}, { includeSafeMethods: true });
