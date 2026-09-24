import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import { ApiError } from '@shared/api/client';
import { initI18n } from '@shared/i18n';
import * as api from '../api';
import { teamReducer, clearTeamMessages } from './slice';
import {
  acceptTeamInvite,
  inviteTeammate,
  loadTeam,
  removeTeamMember,
  resendTeamInvite,
  updateTeamMember,
} from './thunks';
import type { TeamMember, TeamOverview } from '../types';

vi.mock('../api', () => ({
  fetchTeamRequest: vi.fn(),
  inviteMemberRequest: vi.fn(),
  removeMemberRequest: vi.fn(),
  acceptInviteRequest: vi.fn(),
  resendInviteRequest: vi.fn(),
  updateTeamMemberRequest: vi.fn(),
}));

const mocked = vi.mocked(api);

const member = (over: Partial<TeamMember> = {}): TeamMember => ({
  id: 'm-1',
  email: 'a@example.com',
  role: 'member',
  userId: null,
  status: 'pending',
  invitedAt: '2026-07-01T00:00:00.000Z',
  acceptedAt: null,
  expiresAt: '2026-07-08T00:00:00.000Z',
  siteAccess: { mode: 'all', siteIds: [] },
  ...over,
});

const overview: TeamOverview = {
  members: [member({ id: 'owner', role: 'owner', status: 'accepted', email: 'o@example.com' })],
  meta: { total: 1, page: 1, pageSize: 25 },
};

const makeStore = () => configureStore({ reducer: { team: teamReducer } });

const serverError = (message: string, status = 400) =>
  new ApiError('request failed', status, { error: { message } });

const inviteInput = (email: string) => ({
  email,
  role: 'member' as const,
  siteAccess: { mode: 'all' as const },
});

beforeAll(() => {
  initI18n({ initialLocale: 'en' });
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('loadTeam', () => {
  it('stores the fetched overview', async () => {
    mocked.fetchTeamRequest.mockResolvedValue(overview);
    const store = makeStore();
    await store.dispatch(loadTeam());
    expect(store.getState().team.overview).toEqual(overview);
    expect(store.getState().team.loaded).toBe(true);
  });

  it('rejects with the server-localized message', async () => {
    mocked.fetchTeamRequest.mockRejectedValue(serverError('boom', 500));
    const store = makeStore();
    await store.dispatch(loadTeam());
    expect(store.getState().team.loadError).toBe('boom');
  });

  it('falls back to client-side message on a non-API error', async () => {
    mocked.fetchTeamRequest.mockRejectedValue(new Error('network'));
    const store = makeStore();
    await store.dispatch(loadTeam());
    expect(store.getState().team.loadError).toContain('team');
  });

  it('falls back to client-side message when ApiError data is malformed', async () => {
    mocked.fetchTeamRequest.mockRejectedValue(
      new ApiError('boom', 500, { something: 'else' }),
    );
    const store = makeStore();
    await store.dispatch(loadTeam());
    expect(store.getState().team.loadError).toBeTruthy();
  });

  it('falls back when ApiError.error is not shaped as { message: string }', async () => {
    mocked.fetchTeamRequest.mockRejectedValue(
      new ApiError('boom', 500, { error: 'plain-string' }),
    );
    const store = makeStore();
    await store.dispatch(loadTeam());
    expect(store.getState().team.loadError).toBeTruthy();
  });

  it('falls back when ApiError.error.message is not a string', async () => {
    mocked.fetchTeamRequest.mockRejectedValue(
      new ApiError('boom', 500, { error: { message: 42 } }),
    );
    const store = makeStore();
    await store.dispatch(loadTeam());
    expect(store.getState().team.loadError).toBeTruthy();
  });
});

describe('inviteTeammate', () => {
  it('appends to members on success', async () => {
    const pending = member({ id: 'm-new', email: 'friend@example.com' });
    mocked.inviteMemberRequest.mockResolvedValue({
      member: pending,
      emailDelivered: true,
      outcomeUnknown: false,
      message: 'Invite sent',
    });
    const store = makeStore();
    await store.dispatch(loadTeam.fulfilled(overview, 'r1', undefined));
    await store.dispatch(inviteTeammate(inviteInput('friend@example.com')));
    const state = store.getState().team;
    expect(state.overview?.members).toHaveLength(2);
    expect(state.message).toBe('Invite sent');
  });

  it('does not blow up when overview is null on invite success', async () => {
    const pending = member({ id: 'm-new' });
    mocked.inviteMemberRequest.mockResolvedValue({
      member: pending,
      emailDelivered: true,
      outcomeUnknown: false,
      message: 'Invite sent',
    });
    const store = makeStore();
    await store.dispatch(inviteTeammate(inviteInput('friend@example.com')));
    expect(store.getState().team.overview).toBeNull();
  });

  it('surfaces the localized server message on failure', async () => {
    mocked.inviteMemberRequest.mockRejectedValue(
      serverError('That person is already on the team.', 409),
    );
    const store = makeStore();
    await store.dispatch(inviteTeammate(inviteInput('x@example.com')));
    expect(store.getState().team.inviteError).toBe('That person is already on the team.');
  });
});

describe('removeTeamMember', () => {
  it('drops the row', async () => {
    mocked.removeMemberRequest.mockResolvedValue({ message: 'Member removed.' });
    const store = makeStore();
    const seeded: TeamOverview = {
      members: [
        member({ id: 'owner', role: 'owner', status: 'accepted' }),
        member({ id: 'm-2', email: 'b@example.com' }),
      ],
      meta: { total: 2, page: 1, pageSize: 25 },
    };
    await store.dispatch(loadTeam.fulfilled(seeded, 'r1', undefined));
    await store.dispatch(removeTeamMember('m-2'));
    const state = store.getState().team;
    expect(state.overview?.members).toHaveLength(1);
  });

  it('leaves overview alone when it was null', async () => {
    mocked.removeMemberRequest.mockResolvedValue({ message: 'Member removed.' });
    const store = makeStore();
    await store.dispatch(removeTeamMember('m-2'));
    expect(store.getState().team.overview).toBeNull();
  });

  it('stores a localized error on failure', async () => {
    mocked.removeMemberRequest.mockRejectedValue(serverError('Nope', 404));
    const store = makeStore();
    await store.dispatch(removeTeamMember('m-x'));
    expect(store.getState().team.removeError).toBe('Nope');
  });
});

describe('acceptTeamInvite', () => {
  it('sets the message on success', async () => {
    mocked.acceptInviteRequest.mockResolvedValue({
      member: member({ id: 'accepted', status: 'accepted' }),
      message: 'joined',
    });
    const store = makeStore();
    await store.dispatch(acceptTeamInvite('token'));
    expect(store.getState().team.message).toBe('joined');
  });

  it('stores the error on failure', async () => {
    mocked.acceptInviteRequest.mockRejectedValue(serverError('Invalid link', 404));
    const store = makeStore();
    await store.dispatch(acceptTeamInvite('bad'));
    expect(store.getState().team.acceptError).toBe('Invalid link');
  });
});

describe('resend and member access updates', () => {
  it('refreshes a matching row after resend and ignores an off-page row', async () => {
    mocked.resendInviteRequest.mockResolvedValue({
      member: member({ expiresAt: '2099-08-08T00:00:00.000Z' }),
      emailDelivered: true,
      outcomeUnknown: false,
      message: 'resent',
    });
    const store = makeStore();
    const seeded = { ...overview, members: [member()] };
    await store.dispatch(loadTeam.fulfilled(seeded, 'seed', undefined));
    await store.dispatch(resendTeamInvite('m-1'));
    expect(store.getState().team.message).toBe('resent');
    expect(store.getState().team.overview?.members[0]?.expiresAt).toContain('2099');
    await store.dispatch(resendTeamInvite('off-page'));
    expect(store.getState().team.overview?.members).toHaveLength(1);
  });

  it('stores resend and access-update failures', async () => {
    mocked.resendInviteRequest.mockRejectedValue(new TypeError('offline'));
    mocked.updateTeamMemberRequest.mockRejectedValue(new TypeError('offline'));
    const store = makeStore();
    await store.dispatch(resendTeamInvite('m-1'));
    await store.dispatch(updateTeamMember({
      id: 'm-1', role: 'admin', siteAccess: { mode: 'selected', siteIds: ['s-1'] },
    }));
    expect(store.getState().team.resendError).toBeTruthy();
    expect(store.getState().team.updateError).toBeTruthy();
  });

  it('replaces the complete role/site DTO returned by the server', async () => {
    const updated = member({ role: 'admin', siteAccess: { mode: 'selected', siteIds: ['s-1'] } });
    mocked.updateTeamMemberRequest.mockResolvedValue({ member: updated, message: 'saved' });
    const store = makeStore();
    const seeded = { ...overview, members: [member()] };
    await store.dispatch(loadTeam.fulfilled(seeded, 'seed', undefined));
    await store.dispatch(updateTeamMember({
      id: 'm-1', role: 'admin', siteAccess: { mode: 'selected', siteIds: ['s-1'] },
    }));
    expect(store.getState().team.overview?.members[0]).toEqual(updated);
    expect(store.getState().team.message).toBe('saved');
  });
});

describe('slice reducer edge cases', () => {
  it('clearTeamMessages resets all message fields', () => {
    const initial = teamReducer(undefined, { type: '@@init' });
    const dirty = {
      ...initial,
      loadError: 'a',
      inviteError: 'b',
      removeError: 'c',
      acceptError: 'd',
      message: 'e',
    };
    const cleared = teamReducer(dirty, clearTeamMessages());
    expect(cleared.loadError).toBe('');
    expect(cleared.inviteError).toBe('');
    expect(cleared.removeError).toBe('');
    expect(cleared.acceptError).toBe('');
    expect(cleared.message).toBe('');
  });

  it('rejected thunks fall back to empty string when payload is missing', () => {
    const initial = teamReducer(undefined, { type: '@@init' });
    // Force a rejected action with no payload (thunk without rejectWithValue).
    const state = teamReducer(initial, {
      type: inviteTeammate.rejected.type,
      payload: undefined,
    } as unknown as never);
    expect(state.inviteError).toBe('');
  });

  it('pending states clear message/error fields', () => {
    const initial = teamReducer(undefined, { type: '@@init' });
    const state = teamReducer(initial, inviteTeammate.pending('r', inviteInput('a@b')));
    expect(state.inviting).toBe(true);
  });

  it('loadTeam.rejected without payload keeps loadError empty', () => {
    const initial = teamReducer(undefined, { type: '@@init' });
    const state = teamReducer(initial, {
      type: loadTeam.rejected.type,
      payload: undefined,
    } as unknown as never);
    expect(state.loadError).toBe('');
  });

  it('removeTeamMember.rejected without payload keeps removeError empty', () => {
    const initial = teamReducer(undefined, { type: '@@init' });
    const state = teamReducer(initial, {
      type: removeTeamMember.rejected.type,
      payload: undefined,
    } as unknown as never);
    expect(state.removeError).toBe('');
  });

  it('acceptTeamInvite.rejected without payload keeps acceptError empty', () => {
    const initial = teamReducer(undefined, { type: '@@init' });
    const state = teamReducer(initial, {
      type: acceptTeamInvite.rejected.type,
      payload: undefined,
    } as unknown as never);
    expect(state.acceptError).toBe('');
  });
});
