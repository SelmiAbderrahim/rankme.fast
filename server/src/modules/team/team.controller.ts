import type { Request, RequestHandler } from 'express';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { requireAccountId } from '../../shared/utils/require-account-id.js';
import { requireUserId } from '../../shared/utils/require-user-id.js';
import { HttpError } from '../../shared/utils/http-error.js';
import type { SupportedLocale } from '../../shared/i18n/index.js';
import { sendLocalizedMessage } from '../../shared/i18n/localized-response.js';
import { extractIp, recordAudit } from '../audit/index.js';
import { User } from '../users/index.js';
import { acceptInviteParamsSchema, changeMemberRoleSchema, invitationTokenParamsSchema, inviteMemberSchema, listTeamQuerySchema, memberIdParamsSchema, updateMemberAccessSchema, } from './team.schema.js';
import { acceptInvite, acceptInvitationById, changeMemberRole, inviteMember, listPendingInvitations, listTeam, listWorkspaces, previewInvitation, rejectInvitationById, rejectInvitationByToken, removeMember, resendInvite, updateMemberAccess, type TeamSiteAccess, } from './team.service.js';
interface TeamContextSource {
    readonly teamRole?: 'owner' | 'admin' | 'member';
    readonly teamSiteAccessMode?: 'all' | 'selected';
    readonly teamSiteIds?: ReadonlySet<string>;
}
function teamContextFrom(source: TeamContextSource): {
    actorRole: 'owner' | 'admin' | 'member';
    actorSiteAccess: TeamSiteAccess;
} {
    return {
        actorRole: source.teamRole ?? 'owner',
        actorSiteAccess: {
            mode: source.teamSiteAccessMode ?? 'all',
            siteIds: [...(source.teamSiteIds ?? new Set<string>())],
        },
    };
}
/** The request locale. One guard, shared by every mail-sending handler. */
function resolveLocale(req: Request): SupportedLocale {
    /* c8 ignore next -- language middleware always sets req.language; fallback is a defensive default. */
    return req.language ?? 'en';
}
async function readInviterName(userId: string): Promise<string> {
    const doc = await User.findById(userId, { profile: 1, email: 1 }).lean();
    if (!doc)
        throw HttpError.unauthorized({ code: 'ERRORS_USER_NOT_FOUND', messageKey: 'errors.userNotFound' });
    /* c8 ignore start -- Mongoose schema defaults profile.firstName/lastName to '' — the ?? fallbacks are defensive for legacy docs */
    const first = doc.profile?.firstName ?? '';
    const last = doc.profile?.lastName ?? '';
    /* c8 ignore stop */
    const joined = `${first} ${last}`.trim();
    return joined.length > 0 ? joined : doc.email;
}
export const list: RequestHandler = asyncHandler(async (req, res) => {
    // Workspace-scoped: an accepted member sees the team they belong to.
    const accountId = requireAccountId(req);
    const query = listTeamQuerySchema.parse(req.query);
    res.status(200).json(await listTeam(accountId, query));
});
export const workspaces: RequestHandler = asyncHandler(async (req, res) => {
    // ALWAYS actor-scoped, even under a workspace header: this answers "who am
    // I", and letting the header steer it would make the switcher rewrite its
    // own contents on every switch.
    res.status(200).json({ workspaces: await listWorkspaces(requireUserId(req.user)) });
});
export const invite: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const actorUserId = requireUserId(req.user);
    const body = inviteMemberSchema.parse(req.body);
    // The seat is charged to the WORKSPACE, but the invitation email is signed
    // by the HUMAN who sent it — an admin inviting on the owner's behalf should
    // not appear to the invitee as the owner.
    const inviterName = await readInviterName(actorUserId);
    const locale = resolveLocale(req);
    const context = teamContextFrom(req);
    const result = await inviteMember(accountId, {
        email: body.email,
        role: body.role,
        siteAccess: body.siteAccess,
        inviterName,
        locale,
        actorUserId,
        ...context,
    });
    await recordAudit({
        actorUserId,
        action: 'team.invite',
        targetType: 'team_member',
        targetId: result.member.id,
        ip: extractIp(req),
    });
    sendLocalizedMessage(req, res, 201, 'team.invited', {
        member: result.member,
        emailDelivered: result.emailDelivered,
        outcomeUnknown: result.outcomeUnknown ?? false,
    }, { email: result.member.email });
});
export const accept: RequestHandler = asyncHandler(async (req, res) => {
    // Purely actor-scoped: the invitee is not a member of anything yet, so this
    // route has no workspace semantics and deliberately ignores the header.
    const actorUserId = requireUserId(req.user);
    const { token } = acceptInviteParamsSchema.parse(req.params);
    const member = await acceptInvite(actorUserId, token);
    await recordAudit({
        actorUserId,
        action: 'team.accept',
        targetType: 'team_member',
        targetId: member.id,
        ip: extractIp(req),
    });
    sendLocalizedMessage(req, res, 200, 'team.accepted', { member });
});
export const invitations: RequestHandler = asyncHandler(async (req, res) => {
    res.status(200).json({ invitations: await listPendingInvitations(requireUserId(req.user)) });
});
export const invitationPreview: RequestHandler = asyncHandler(async (req, res) => {
    const { token } = invitationTokenParamsSchema.parse(req.params);
    res.status(200).json(await previewInvitation(token));
});
export const acceptById: RequestHandler = asyncHandler(async (req, res) => {
    const { id } = memberIdParamsSchema.parse(req.params);
    const actorUserId = requireUserId(req.user);
    const member = await acceptInvitationById(actorUserId, id);
    await recordAudit({
        actorUserId,
        action: 'team.accept',
        targetType: 'team_member',
        targetId: member.id,
        ip: extractIp(req),
    });
    sendLocalizedMessage(req, res, 200, 'team.accepted', { member });
});
export const rejectById: RequestHandler = asyncHandler(async (req, res) => {
    const { id } = memberIdParamsSchema.parse(req.params);
    const actorUserId = requireUserId(req.user);
    await rejectInvitationById(actorUserId, id);
    await recordAudit({
        actorUserId,
        action: 'team.reject',
        targetType: 'team_member',
        targetId: id,
        ip: extractIp(req),
    });
    sendLocalizedMessage(req, res, 200, 'team.rejected', {});
});
export const rejectByToken: RequestHandler = asyncHandler(async (req, res) => {
    const { token } = invitationTokenParamsSchema.parse(req.params);
    await rejectInvitationByToken(token);
    sendLocalizedMessage(req, res, 200, 'team.rejected', {});
});
export const resend: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const actorUserId = requireUserId(req.user);
    const { id } = memberIdParamsSchema.parse(req.params);
    const locale = resolveLocale(req);
    const context = teamContextFrom(req);
    const result = await resendInvite(accountId, id, {
        inviterName: await readInviterName(actorUserId),
        locale,
        ...context,
    });
    await recordAudit({
        actorUserId,
        action: 'team.invite_resend',
        targetType: 'team_member',
        targetId: id,
        ip: extractIp(req),
    });
    sendLocalizedMessage(req, res, 200, 'team.inviteResent', {
        member: result.member,
        emailDelivered: result.emailDelivered,
        outcomeUnknown: result.outcomeUnknown ?? false,
    }, { email: result.member.email });
});
export const changeRole: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { id } = memberIdParamsSchema.parse(req.params);
    const { role } = changeMemberRoleSchema.parse(req.body);
    const member = await changeMemberRole(accountId, id, role);
    await recordAudit({
        actorUserId: requireUserId(req.user),
        action: 'team.role_change',
        targetType: 'team_member',
        targetId: id,
        ip: extractIp(req),
        metadata: { role },
    });
    sendLocalizedMessage(req, res, 200, 'team.roleChanged', { member });
});
export const updateAccess: RequestHandler = asyncHandler(async (req, res) => {
    const accountId = requireAccountId(req);
    const { id } = memberIdParamsSchema.parse(req.params);
    const body = updateMemberAccessSchema.parse(req.body);
    const member = await updateMemberAccess(accountId, id, body);
    await recordAudit({
        actorUserId: requireUserId(req.user),
        action: 'team.access_change',
        targetType: 'team_member',
        targetId: id,
        ip: extractIp(req),
        metadata: { role: body.role, siteAccessMode: body.siteAccess.mode },
    });
    sendLocalizedMessage(req, res, 200, 'team.roleChanged', { member });
});
export const remove: RequestHandler = asyncHandler(async (req, res) => {
    const { id } = memberIdParamsSchema.parse(req.params);
    const context = teamContextFrom(req);
    await removeMember({
        workspaceAccountId: requireAccountId(req),
        actorUserId: requireUserId(req.user),
        // Absent context means the caller is acting on their own account.
        teamRole: context.actorRole,
        teamSiteAccess: context.actorSiteAccess,
    }, id);
    await recordAudit({
        actorUserId: requireUserId(req.user),
        action: 'team.remove',
        targetType: 'team_member',
        targetId: id,
        ip: extractIp(req),
    });
    sendLocalizedMessage(req, res, 200, 'team.removed', {});
});
export const teamControllerTestables = Object.freeze({ teamContextFrom });
