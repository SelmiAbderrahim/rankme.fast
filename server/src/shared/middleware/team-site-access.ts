import type { Request, RequestHandler } from 'express';
import { Types } from 'mongoose';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import type { TranslationKey } from '../i18n/errors.js';
export type TeamSiteAccessResolver = (req: Request) => string | null | undefined | Promise<string | null | undefined>;
/**
 * Returns null for an unrestricted workspace actor, otherwise the exact Site
 * ids visible to the selected-scope membership. Unknown/missing scope fails
 * closed for a foreign workspace but remains unrestricted on routes mounted
 * outside workspaceContext (public API/MCP use their own authorization).
 */
export function allowedTeamSiteIds(req: Request): readonly string[] | null {
    if (req.teamRole === undefined || req.teamRole === 'owner')
        return null;
    if (req.teamSiteAccessMode === 'all')
        return null;
    if (req.teamSiteAccessMode === 'selected') {
        return [...(req.teamSiteIds ?? new Set<string>())];
    }
    // A foreign-workspace actor with a missing/unknown scope must never fall
    // back to the unrestricted aggregate path.
    return [];
}
/**
 * Assert a team member may reach a Site. Every denial deliberately uses the
 * ordinary site 404 so a grant cannot become a resource-enumeration oracle.
 */
export function assertTeamSiteAccess(req: Request, siteId: string): void {
    if (req.teamRole === undefined && req.teamSiteAccessMode === undefined)
        return;
    if (req.teamRole === 'owner' || req.teamSiteAccessMode === 'all')
        return;
    if (req.teamSiteAccessMode !== 'selected' ||
        !req.teamSiteIds?.has(siteId)) {
        throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
    }
}
/**
 * Standalone guard for paths that do not also participate in the site work
 * lease. Invalid identifiers are left to the route schema so existing 400/404
 * contracts are preserved; a valid inaccessible Site is hidden immediately.
 */
export function requireTeamSiteAccess(resolveSiteId: TeamSiteAccessResolver): RequestHandler {
    return asyncHandler(async (req, _res, next) => {
        const siteId = await resolveSiteId(req);
        if (typeof siteId === 'string' && Types.ObjectId.isValid(siteId)) {
            assertTeamSiteAccess(req, siteId);
        }
        next();
    });
}
/**
 * Guard a stored resource whose owning Site is resolved asynchronously.
 * `undefined` means the resource was not found (the route shapes that 404),
 * while `null` means an account-wide resource. Selected-scope memberships
 * cannot access account-wide aggregates because those may span denied Sites.
 */
export function requireTeamResourceSiteAccess(resolveSiteId: TeamSiteAccessResolver, notFoundKey: TranslationKey = 'errors.notFound'): RequestHandler {
    return asyncHandler(async (req, _res, next) => {
        if (req.teamRole === undefined ||
            req.teamRole === 'owner' ||
            req.teamSiteAccessMode === 'all') {
            next();
            return;
        }
        const siteId = await resolveSiteId(req);
        if (siteId === undefined) {
            next();
            return;
        }
        if (siteId === null)
            throw HttpError.notFound({ code: 'NOT_FOUND', messageKey: notFoundKey });
        assertTeamSiteAccess(req, siteId);
        next();
    });
}
