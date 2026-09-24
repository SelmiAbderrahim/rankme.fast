import { apiClient } from '@shared/api/client';
import { z } from 'zod';
import { ASSIGNABLE_TEAM_ROLES, TEAM_ROLES } from './types';
import type {
  AcceptInviteResponse,
  ChangeRoleResponse,
  DeleteMemberResponse,
  InvitationPreviewResponse,
  InviteResponse,
  InviteTeamMemberInput,
  PendingInvitationsResponse,
  RejectInviteResponse,
  ResendInviteResponse,
  TeamListQuery,
  TeamOverview,
  TeamSiteOption,
  UpdateTeamMemberInput,
  WorkspacesResponse,
} from './types';

const siteSummarySchema = z.object({ id: z.string(), label: z.string() });

const siteAccessSchema = z.object({
  mode: z.enum(['all', 'selected']),
  siteIds: z.array(z.string()).default([]),
  sites: z.array(siteSummarySchema).optional(),
});

const teamMemberSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  role: z.enum(TEAM_ROLES),
  userId: z.string().nullable(),
  status: z.enum(['accepted', 'pending']),
  invitedAt: z.string(),
  acceptedAt: z.string().nullable(),
  expiresAt: z.string(),
  // The default is migration-safe for a rolling deploy: previous rows were
  // unrestricted, so a temporarily old API response must not become selected/empty.
  siteAccess: siteAccessSchema.default({ mode: 'all', siteIds: [] }),
});

const teamOverviewSchema = z.object({
  members: z.array(teamMemberSchema),
  meta: z.object({
    total: z.number().int().nonnegative().finite(),
    page: z.number().int().positive().finite(),
    pageSize: z.number().int().positive().finite(),
  }),
});

const pendingInvitationSchema = teamMemberSchema.extend({
  teamId: z.string(),
  teamName: z.string(),
  inviterName: z.string(),
  requiresPasswordChange: z.boolean(),
  sites: z.array(siteSummarySchema).optional(),
});

const pendingInvitationsSchema = z.object({
  invitations: z.array(pendingInvitationSchema),
});

const invitationPreviewSchema = z.object({
  invitation: z.object({
    id: z.string(),
    teamId: z.string(),
    teamName: z.string(),
    inviterName: z.string(),
    role: z.enum(ASSIGNABLE_TEAM_ROLES),
    siteAccess: siteAccessSchema,
    sites: z.array(siteSummarySchema).optional(),
    expiresAt: z.string(),
  }),
  action: z.enum(['accept', 'reject']),
  requiresAuthentication: z.boolean(),
});

const siteListPageSchema = z.object({
  sites: z.array(z.object({
    id: z.string(),
    displayName: z.string(),
    domain: z.string(),
    url: z.string(),
  })),
  nextCursor: z.string().nullable(),
});

export const fetchTeamRequest = async (query: TeamListQuery = {}): Promise<TeamOverview> => {
  const params = new URLSearchParams();
  if (query.query) params.set('query', query.query);
  if (query.page) params.set('page', String(query.page));
  if (query.pageSize) params.set('pageSize', String(query.pageSize));
  const search = params.toString();
  const response = await apiClient<unknown>(search ? `/team?${search}` : '/team');
  return teamOverviewSchema.parse(response);
};

export const fetchWorkspacesRequest = async (): Promise<WorkspacesResponse> => {
  const response = await apiClient<WorkspacesResponse>('/team/workspaces');
  return {
    workspaces: response.workspaces.map((workspace) => ({
      ...workspace,
      ...(workspace.siteAccess
        ? { siteAccess: siteAccessSchema.parse(workspace.siteAccess) }
        : {}),
    })),
  };
};

export const fetchPendingInvitationsRequest = async (): Promise<PendingInvitationsResponse> => {
  const parsed = pendingInvitationsSchema.parse(
    await apiClient<unknown>('/team/invitations'),
  );
  return {
    invitations: parsed.invitations.map(({ sites, ...invitation }) => ({
      ...invitation,
      siteAccess: sites
        ? { ...invitation.siteAccess, sites }
        : invitation.siteAccess,
    })),
  };
};

export const fetchInvitationPreviewRequest = async (
  token: string,
): Promise<InvitationPreviewResponse> => {
  const parsed = invitationPreviewSchema.parse(
    await apiClient<unknown>(`/team/invitations/preview/${encodeURIComponent(token)}`),
  );
  return parsed.invitation.sites
    ? {
        ...parsed,
        invitation: {
          ...parsed.invitation,
          siteAccess: { ...parsed.invitation.siteAccess, sites: parsed.invitation.sites },
        },
      }
    : parsed;
};

export const resendInviteRequest = (id: string): Promise<ResendInviteResponse> =>
  apiClient<ResendInviteResponse>(`/team/invite/${id}/resend`, { method: 'POST' });

export const updateTeamMemberRequest = (
  input: UpdateTeamMemberInput,
): Promise<ChangeRoleResponse> =>
  apiClient<ChangeRoleResponse>(`/team/members/${input.id}`, {
    method: 'PATCH',
    body: { role: input.role, siteAccess: input.siteAccess },
  });

export const inviteMemberRequest = (input: InviteTeamMemberInput): Promise<InviteResponse> =>
  apiClient<InviteResponse>('/team/invite', {
    method: 'POST',
    body: input,
  });

export const removeMemberRequest = (id: string): Promise<DeleteMemberResponse> =>
  apiClient<DeleteMemberResponse>(`/team/members/${id}`, { method: 'DELETE' });

export const acceptInviteRequest = (token: string): Promise<AcceptInviteResponse> =>
  apiClient<AcceptInviteResponse>(`/team/accept/${encodeURIComponent(token)}`, {
    method: 'POST',
  });

export const rejectInviteRequest = (token: string): Promise<RejectInviteResponse> =>
  apiClient<RejectInviteResponse>(`/team/reject/${encodeURIComponent(token)}`, {
    method: 'POST',
  });

export const acceptPendingInvitationRequest = (id: string): Promise<AcceptInviteResponse> =>
  apiClient<AcceptInviteResponse>(`/team/invitations/${encodeURIComponent(id)}/accept`, {
    method: 'POST',
  });

export const rejectPendingInvitationRequest = (id: string): Promise<RejectInviteResponse> =>
  apiClient<RejectInviteResponse>(`/team/invitations/${encodeURIComponent(id)}/reject`, {
    method: 'POST',
  });

/** Load the complete grantable site catalog, not just the first cursor page. */
export const fetchGrantableSitesRequest = async (): Promise<TeamSiteOption[]> => {
  const sites = new Map<string, TeamSiteOption>();
  const seenCursors = new Set<string>();
  let cursor: string | null = null;

  for (let page = 0; page < 100; page += 1) {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    const response = siteListPageSchema.parse(await apiClient<unknown>(`/sites${query}`));
    for (const site of response.sites) {
      sites.set(site.id, {
        id: site.id,
        label: site.displayName || site.domain,
        url: site.url,
      });
    }
    if (response.nextCursor === null) return [...sites.values()];
    if (seenCursors.has(response.nextCursor)) {
      throw new Error('The sites cursor repeated while loading invitation access.');
    }
    seenCursors.add(response.nextCursor);
    cursor = response.nextCursor;
  }

  throw new Error('The grantable sites catalog exceeded the pagination safety limit.');
};
