/**
 * Workspace context — `rankme-enterprise-orgs` 02.
 *
 * An accepted team member works INSIDE the owner's workspace by sending
 * `x-workspace-id: <ownerAccountId>`. This middleware is the single place
 * that turns that header into an authorization decision; every downstream
 * module reads the resolved account through `requireAccountId(req)`.
 *
 * Fail-closed by construction:
 *  - no header / empty / the caller's own id  -> own workspace, role `owner`
 *  - malformed header                         -> 404 (never touches the DB)
 *  - pending, expired-pending, revoked, or
 *    non-existent membership                  -> 404
 *
 * 404 rather than 403 everywhere: a 403 would confirm that the workspace
 * exists, turning the header into an account-enumeration oracle. This
 * matches the cross-account convention in `.claude/rules/better-auth-
 * integration.md`.
 *
 * Removal enforcement lives here and nowhere else. Revoking a membership
 * (or a member leaving) takes effect on the member's NEXT request because
 * this lookup runs per request — there is deliberately no session surgery
 * and therefore no session-invalidation state to reason about.
 *
 * Mount order matters: this runs after `requireAuth`/`requireVerified` and
 * BEFORE any entitlement middleware, so tier/feature/cap resolution keys off
 * the WORKSPACE OWNER rather than the calling member.
 */
import type { RequestHandler } from 'express';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { teamMembers, teamMemberSiteGrants, } from '../../db/schema/team-members.js';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import { requireUserId } from '../utils/require-user-id.js';
import type { ApplicationDb } from '../types/application-db.js';
/** Request header carrying the workspace (owner account) id. The client
 * mirrors this literal in `client/src/shared/api/client.ts`. */
export const WORKSPACE_HEADER = 'x-workspace-id';
/** Account ids are Better Auth ObjectId-compatible hex; the bound is generous
 * so a future id format still fits, but it keeps an attacker from pushing a
 * megabyte of header text into a database predicate. */
const MAX_WORKSPACE_ID_LENGTH = 64;
const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9_-]+$/u;
export function workspaceContext(resolveDb: () => ApplicationDb): RequestHandler {
    return asyncHandler(async (req, _res, next) => {
        const userId = requireUserId(req.user);
        const header = req.get(WORKSPACE_HEADER);
        const requested = typeof header === 'string' ? header.trim() : '';
        if (requested === '' || requested === userId) {
            req.workspaceAccountId = userId;
            req.teamRole = 'owner';
            req.teamSiteAccessMode = 'all';
            next();
            return;
        }
        if (requested.length > MAX_WORKSPACE_ID_LENGTH ||
            !WORKSPACE_ID_PATTERN.test(requested)) {
            // Shape-validate before the header reaches a query predicate.
            throw HttpError.notFound({ code: 'ERRORS_NOT_FOUND', messageKey: 'errors.notFound' });
        }
        const rows = await resolveDb()
            .select({
            id: teamMembers.id,
            role: teamMembers.role,
            siteAccessMode: teamMembers.siteAccessMode,
        })
            .from(teamMembers)
            .where(and(eq(teamMembers.teamId, requested), eq(teamMembers.userId, userId), isNotNull(teamMembers.acceptedAt), isNull(teamMembers.revokedAt)))
            .limit(1);
        const membership = rows[0];
        if (!membership)
            throw HttpError.notFound({ code: 'ERRORS_NOT_FOUND', messageKey: 'errors.notFound' });
        req.workspaceAccountId = requested;
        req.teamMembershipId = membership.id;
        req.teamRole = membership.role;
        req.teamSiteAccessMode = membership.siteAccessMode;
        if (membership.siteAccessMode === 'selected') {
            const grants = await resolveDb()
                .select({ siteId: teamMemberSiteGrants.siteId })
                .from(teamMemberSiteGrants)
                .where(eq(teamMemberSiteGrants.teamMemberId, membership.id));
            req.teamSiteIds = new Set(grants.map((grant) => grant.siteId));
        }
        next();
    });
}
