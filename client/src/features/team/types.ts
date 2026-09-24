/** Team roles, most privileged first — mirrors the server's relational schema. */
export const TEAM_ROLES = ['owner', 'admin', 'member'] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export const ASSIGNABLE_TEAM_ROLES = ['admin', 'member'] as const;
export type AssignableTeamRole = (typeof ASSIGNABLE_TEAM_ROLES)[number];

export interface TeamSiteSummary {
  id: string;
  label: string;
}

/** Normalized response shape. `siteIds` is always present, including for All. */
export type TeamSiteAccess =
  | { mode: 'all'; siteIds: string[]; sites?: TeamSiteSummary[] }
  | { mode: 'selected'; siteIds: string[]; sites?: TeamSiteSummary[] };

/** Write contract: All-sites intentionally carries no redundant identifiers. */
export type TeamSiteAccessInput =
  | { mode: 'all' }
  | { mode: 'selected'; siteIds: string[] };

export interface InviteTeamMemberInput {
  email: string;
  role: AssignableTeamRole;
  siteAccess: TeamSiteAccessInput;
}

export interface UpdateTeamMemberInput {
  id: string;
  role: AssignableTeamRole;
  siteAccess: TeamSiteAccessInput;
}

export interface TeamMember {
  id: string;
  email: string;
  role: TeamRole;
  userId: string | null;
  status: 'accepted' | 'pending';
  invitedAt: string;
  acceptedAt: string | null;
  expiresAt: string;
  siteAccess: TeamSiteAccess;
}

export interface TeamOverview {
  members: TeamMember[];
  meta: { total: number; page: number; pageSize: number };
}

export interface TeamListQuery {
  query?: string;
  page?: number;
  pageSize?: number;
}

export interface Workspace {
  accountId: string;
  label: string;
  role: TeamRole;
  isOwn: boolean;
  /** Older deployments may omit this; callers default foreign workspaces closed. */
  siteAccess?: TeamSiteAccess;
}

export interface WorkspacesResponse {
  workspaces: Workspace[];
}

export interface InviteResponse {
  member: TeamMember;
  emailDelivered: boolean;
  outcomeUnknown: boolean;
  message: string;
}

export type ResendInviteResponse = InviteResponse;

export interface UpdateMemberResponse {
  member: TeamMember;
  message: string;
}

/** Kept as a source-compatible alias for consumers of the previous name. */
export type ChangeRoleResponse = UpdateMemberResponse;

export interface DeleteMemberResponse {
  message: string;
}

export interface AcceptInviteResponse {
  member: TeamMember;
  message: string;
}

export interface RejectInviteResponse {
  message: string;
}

export interface PendingInvitation extends TeamMember {
  teamId: string;
  teamName: string;
  inviterName: string;
  requiresPasswordChange: boolean;
}

export interface PendingInvitationsResponse {
  invitations: PendingInvitation[];
}

export interface InvitationPreviewDetails {
  id: string;
  teamId: string;
  teamName: string;
  inviterName: string;
  role: AssignableTeamRole;
  siteAccess: TeamSiteAccess;
  sites?: TeamSiteSummary[];
  expiresAt: string;
}

export interface InvitationPreviewResponse {
  invitation: InvitationPreviewDetails;
  action: 'accept' | 'reject';
  requiresAuthentication: boolean;
}

export interface TeamSiteOption {
  id: string;
  label: string;
  url: string;
}

export interface TeamState {
  overview: TeamOverview | null;
  query: string;
  page: number;
  resendingId: string | null;
  resendError: string;
  updatingId: string | null;
  updateError: string;
  loading: boolean;
  loaded: boolean;
  loadError: string;
  inviting: boolean;
  inviteError: string;
  removingId: string | null;
  removeError: string;
  accepting: boolean;
  acceptError: string;
  message: string;
}

export interface TeamInboxState {
  invitations: PendingInvitation[];
  status: 'idle' | 'loading' | 'loaded' | 'failed';
  actionId: string | null;
  error: string;
  message: string;
}
