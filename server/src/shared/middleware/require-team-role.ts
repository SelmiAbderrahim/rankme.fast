/**
 * Team-role guards — `rankme-enterprise-orgs` 02.
 *
 * Three guards, one convention: insufficiency is 404, never 403. A 403 would
 * confirm that the workspace and the resource exist, which is exactly the
 * signal the cross-account rule forbids leaking.
 *
 *  - `requireWorkspaceOwner`  — owner-only surfaces on the product chain.
 *  - `requireTeamRole(min)`   — minimum team rank (owner > admin > member).
 *  - `rejectForeignWorkspace` — DB-free header rejection for surfaces that
 *    sit OUTSIDE the workspace chain (data rights, bearer-key APIs). No membership can ever grant these, so there is
 *    nothing to look up: naming another account is simply not found.
 *
 * Reminder: this is the TEAM axis. The PLATFORM role on `req.user.role`
 * (Member/Admin/SuperAdmin) is a different axis — never conflate the two.
 */
import type { RequestHandler } from 'express';
import type { TeamMemberRole } from '../../db/schema/team-members.js';
import { HttpError } from '../utils/http-error.js';
import { requireUserId } from '../utils/require-user-id.js';
import { WORKSPACE_HEADER } from './workspace-context.js';
/** Most privileged first — index doubles as the rank. */
const ROLE_RANK: Record<TeamMemberRole, number> = {
    owner: 0,
    admin: 1,
    member: 2,
};
/**
 * The effective role for a request. An absent `teamRole` means
 * `workspaceContext()` did not run on this chain, so the caller is acting on
 * their OWN account and holds every right over it.
 */
function effectiveRole(role: TeamMemberRole | undefined): TeamMemberRole {
    return role ?? 'owner';
}
/**
 * Owner-only surfaces: billing management, account profile, Google
 * connections, API keys, MCP permissions, alert channels. These carry money,
 * credentials, or identity — a member working inside the workspace must never
 * reach them.
 */
export const requireWorkspaceOwner: RequestHandler = (req, _res, next) => {
    if (effectiveRole(req.teamRole) !== 'owner') {
        next(HttpError.notFound({ code: 'ERRORS_NOT_FOUND', messageKey: 'errors.notFound' }));
        return;
    }
    next();
};
/** Minimum team rank. `requireTeamRole('admin')` admits owner and admin. */
export function requireTeamRole(min: Exclude<TeamMemberRole, 'owner'>): RequestHandler {
    return (req, _res, next) => {
        if (ROLE_RANK[effectiveRole(req.teamRole)] > ROLE_RANK[min]) {
            next(HttpError.notFound({ code: 'ERRORS_NOT_FOUND', messageKey: 'errors.notFound' }));
            return;
        }
        next();
    };
}
/**
 * Reject a workspace header on a surface that has no workspace semantics.
 *
 * Used where `workspaceContext()` deliberately does not run: data rights
 * (reachable by unverified accounts), and the platform-role admin/superadmin
 * panels. No membership can grant these surfaces, so the header needs no
 * database lookup — naming another account is not found.
 *
 * Must be mounted AFTER the surface's own authentication so `req.user` is
 * populated; an unauthenticated request is rejected by that guard first.
 */
export const rejectForeignWorkspace: RequestHandler = (req, _res, next) => {
    const header = req.get(WORKSPACE_HEADER);
    const requested = typeof header === 'string' ? header.trim() : '';
    if (requested !== '' && requested !== requireUserId(req.user)) {
        next(HttpError.notFound({ code: 'ERRORS_NOT_FOUND', messageKey: 'errors.notFound' }));
        return;
    }
    next();
};
