import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '@shared/api/client';
import {
  acceptInviteRequest,
  acceptPendingInvitationRequest,
  fetchGrantableSitesRequest,
  fetchInvitationPreviewRequest,
  fetchPendingInvitationsRequest,
  fetchTeamRequest,
  fetchWorkspacesRequest,
  inviteMemberRequest,
  rejectInviteRequest,
  rejectPendingInvitationRequest,
  removeMemberRequest,
  resendInviteRequest,
  updateTeamMemberRequest,
} from './api';

vi.mock('@shared/api/client', () => ({ apiClient: vi.fn() }));
const apiClient = vi.mocked(client.apiClient);

const member = {
  id: 'm-1', email: 'a@example.com', role: 'member', userId: null, status: 'pending',
  invitedAt: '2026-08-01T00:00:00.000Z', acceptedAt: null,
  expiresAt: '2026-08-08T00:00:00.000Z',
  siteAccess: { mode: 'selected', siteIds: ['s-1'] },
};

beforeEach(() => vi.clearAllMocks());

describe('team API contracts', () => {
  it('parses roster responses safely and defaults legacy site access', async () => {
    apiClient.mockResolvedValueOnce({
      members: [member],
      meta: { total: 1, page: 1, pageSize: 25 },
    });
    await expect(fetchTeamRequest({ query: 'ada', page: 2, pageSize: 10 })).resolves.toMatchObject({
      members: [member],
      meta: { total: 1, page: 1, pageSize: 25 },
    });
    expect(apiClient).toHaveBeenLastCalledWith('/team?query=ada&page=2&pageSize=10');

    apiClient.mockResolvedValueOnce({
      members: [{ ...member, siteAccess: undefined }],
      meta: { total: 1, page: 1, pageSize: 25 },
    });
    await expect(fetchTeamRequest()).resolves.toMatchObject({
      members: [{ siteAccess: { mode: 'all', siteIds: [] } }],
    });
    expect(apiClient).toHaveBeenLastCalledWith('/team');
  });

  it('sends role and discriminated site scope without exposing a token', async () => {
    apiClient.mockResolvedValue({ member, emailDelivered: true, outcomeUnknown: false, message: 'sent' });
    const input = {
      email: 'friend@example.com',
      role: 'admin' as const,
      siteAccess: { mode: 'selected' as const, siteIds: ['s-1'] },
    };
    await inviteMemberRequest(input);
    expect(apiClient).toHaveBeenCalledWith('/team/invite', { method: 'POST', body: input });
    expect(await resendInviteRequest('m-1')).not.toHaveProperty('inviteToken');
  });

  it('builds member mutation and removal requests', async () => {
    apiClient.mockResolvedValue({ member, message: 'ok' });
    await updateTeamMemberRequest({
      id: 'm-1', role: 'member', siteAccess: { mode: 'all' },
    });
    expect(apiClient).toHaveBeenCalledWith('/team/members/m-1', {
      method: 'PATCH', body: { role: 'member', siteAccess: { mode: 'all' } },
    });
    await removeMemberRequest('m-1');
    expect(apiClient).toHaveBeenLastCalledWith('/team/members/m-1', { method: 'DELETE' });
  });

  it('builds token and authenticated inbox decision requests', async () => {
    apiClient.mockResolvedValue({ member, message: 'ok' });
    await acceptInviteRequest('a b');
    await rejectInviteRequest('r/b');
    await acceptPendingInvitationRequest('invite 1');
    await rejectPendingInvitationRequest('invite 2');
    expect(apiClient.mock.calls).toEqual(expect.arrayContaining([
      ['/team/accept/a%20b', { method: 'POST' }],
      ['/team/reject/r%2Fb', { method: 'POST' }],
      ['/team/invitations/invite%201/accept', { method: 'POST' }],
      ['/team/invitations/invite%202/reject', { method: 'POST' }],
    ]));
  });

  it('parses actor inbox and normalizes preview site labels', async () => {
    apiClient.mockResolvedValueOnce({ invitations: [
      {
        ...member, teamId: 't-1', teamName: 'Acme', inviterName: 'Ada',
        requiresPasswordChange: false, sites: [{ id: 's-1', label: 'Main site' }],
      },
      {
        ...member, id: 'm-2', teamId: 't-2', teamName: 'Other', inviterName: 'Grace',
        requiresPasswordChange: true,
      },
    ] });
    await expect(fetchPendingInvitationsRequest()).resolves.toMatchObject({
      invitations: [
        { teamName: 'Acme', siteAccess: { sites: [{ label: 'Main site' }] } },
        { teamName: 'Other', siteAccess: { mode: 'selected', siteIds: ['s-1'] } },
      ],
    });
    apiClient.mockResolvedValueOnce({
      invitation: {
        id: 'm-1', teamId: 't-1', teamName: 'Acme', inviterName: 'Ada', role: 'member',
        siteAccess: { mode: 'selected', siteIds: ['s-1'] },
        sites: [{ id: 's-1', label: 'Main site' }], expiresAt: member.expiresAt,
      },
      action: 'accept', requiresAuthentication: true,
    });
    await expect(fetchInvitationPreviewRequest('tok')).resolves.toMatchObject({
      invitation: { teamId: 't-1', siteAccess: { sites: [{ label: 'Main site' }] } },
    });
    apiClient.mockResolvedValueOnce({
      invitation: {
        id: 'm-2', teamId: 't-2', teamName: 'Other', inviterName: 'Grace', role: 'admin',
        siteAccess: { mode: 'all', siteIds: [] }, expiresAt: member.expiresAt,
      },
      action: 'reject', requiresAuthentication: false,
    });
    await expect(fetchInvitationPreviewRequest('tok-2')).resolves.toMatchObject({
      invitation: { siteAccess: { mode: 'all', siteIds: [] } },
    });
  });

  it('loads workspace scope and every cursor page of grantable sites', async () => {
    apiClient.mockResolvedValueOnce({ workspaces: [{
      accountId: 'a', label: 'Acme', role: 'admin', isOwn: false,
      siteAccess: { mode: 'selected', siteIds: ['s-1'] },
    }] });
    await expect(fetchWorkspacesRequest()).resolves.toMatchObject({
      workspaces: [{ siteAccess: { mode: 'selected' } }],
    });
    apiClient.mockResolvedValueOnce({
      workspaces: [{ accountId: 'own', label: 'Me', role: 'owner', isOwn: true }],
    });
    await expect(fetchWorkspacesRequest()).resolves.toEqual({
      workspaces: [{ accountId: 'own', label: 'Me', role: 'owner', isOwn: true }],
    });
    apiClient
      .mockResolvedValueOnce({ sites: [{ id: 's-1', displayName: 'Main', domain: 'a.test', url: 'https://a.test' }], nextCursor: 'next' })
      .mockResolvedValueOnce({ sites: [{ id: 's-2', displayName: '', domain: 'b.test', url: 'https://b.test' }], nextCursor: null });
    await expect(fetchGrantableSitesRequest()).resolves.toEqual([
      { id: 's-1', label: 'Main', url: 'https://a.test' },
      { id: 's-2', label: 'b.test', url: 'https://b.test' },
    ]);
  });

  it('rejects a repeated cursor instead of looping forever', async () => {
    apiClient
      .mockResolvedValueOnce({ sites: [], nextCursor: 'same' })
      .mockResolvedValueOnce({ sites: [], nextCursor: 'same' });
    await expect(fetchGrantableSitesRequest()).rejects.toThrow(/cursor repeated/);
  });

  it('stops an unbounded site catalog at the pagination safety limit', async () => {
    let page = 0;
    apiClient.mockImplementation(async () => ({ sites: [], nextCursor: `page-${page += 1}` }));
    await expect(fetchGrantableSitesRequest()).rejects.toThrow(/safety limit/);
    expect(apiClient).toHaveBeenCalledTimes(100);
  });
});
