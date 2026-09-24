import { Router } from 'express';
import { requireAuth } from '../../shared/middleware/require-auth.js';
import { requireCsrf } from '../../shared/middleware/csrf.js';
import { requireTeamRole, requireWorkspaceOwner, } from '../../shared/middleware/require-team-role.js';
import { accept, acceptById, changeRole, invite, invitationPreview, invitations, list, remove, rejectById, rejectByToken, resend, updateAccess, workspaces, } from './team.controller.js';
// Auth + workspace context are applied at the mount point in app.ts:
// [requireCsrf, requireAuth, requireVerified, workspaceContext].
export const teamRouter: Router = Router();
// Reading the roster is ordinary workspace work — every accepted role sees
// the team they belong to.
teamRouter.get('/', list);
// The switcher's own contents. Actor-scoped by design, mounted before the
// parameterized routes so `workspaces` is never read as a member id.
teamRouter.get('/workspaces', workspaces);
// Team management is admin+.
teamRouter.post('/invite', requireTeamRole('admin'), invite);
// Resending rotates the token, so it is a credential-issuing action: admin+.
teamRouter.post('/invite/:id/resend', requireTeamRole('admin'), resend);
// Accepting is actor-scoped: the invitee is not yet a member of anything, so
// this route has no workspace semantics and carries no role guard.
// Owner-only: promoting a teammate to admin hands them the invite/remove
// keys, which is the owner's call alone. Ownership itself is not transferable
// — the zod schema refuses `owner` outright.
teamRouter.patch('/members/:id/role', requireWorkspaceOwner, changeRole);
teamRouter.patch('/members/:id', requireWorkspaceOwner, updateAccess);
// NOT role-gated at the router: a `member` removing THEMSELVES is a leave and
// must stay possible. The service is the authority — it admits an
// owner/admin acting on the workspace, or any member targeting their own row.
teamRouter.delete('/members/:id', remove);
/**
 * Mount at `/api/team` before the globally verified product chain. The parent
 * app must apply CSRF + auth to inbox/accept-by-id/token-accept; preview GET
 * and token rejection are intentionally public capability routes.
 */
export const teamPublicInvitationRouter: Router = Router();
teamPublicInvitationRouter.get('/invitations/preview/:token', invitationPreview);
teamPublicInvitationRouter.post('/reject/:token', requireCsrf, rejectByToken);
export const teamActorInvitationRouter: Router = Router();
teamActorInvitationRouter.get('/invitations', requireCsrf, requireAuth, invitations);
teamActorInvitationRouter.post('/invitations/:id/accept', requireCsrf, requireAuth, acceptById);
teamActorInvitationRouter.post('/invitations/:id/reject', requireCsrf, requireAuth, rejectById);
teamActorInvitationRouter.post('/accept/:token', requireCsrf, requireAuth, accept);
