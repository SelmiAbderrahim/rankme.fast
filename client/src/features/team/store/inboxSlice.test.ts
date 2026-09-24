import { configureStore } from '@reduxjs/toolkit';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@shared/i18n';
import * as api from '../api';
import {
  acceptPendingInvitation,
  clearInvitationInboxMessage,
  loadPendingInvitations,
  rejectPendingInvitation,
  selectInvitationInboxActionId,
  selectInvitationInboxError,
  selectInvitationInboxMessage,
  selectInvitationInboxStatus,
  selectPendingInvitationCount,
  selectPendingInvitations,
  teamInboxInitialState,
  teamInboxReducer,
} from './inboxSlice';
import type { PendingInvitation } from '../types';
import type { RootState } from '@app/store';

vi.mock('../api', () => ({
  fetchPendingInvitationsRequest: vi.fn(),
  acceptPendingInvitationRequest: vi.fn(),
  rejectPendingInvitationRequest: vi.fn(),
}));
const mocked = vi.mocked(api);
const invitation: PendingInvitation = {
  id: 'i-1', email: 'me@example.com', role: 'member', userId: 'u-1', status: 'pending',
  invitedAt: '2026-08-01T00:00:00.000Z', acceptedAt: null,
  expiresAt: '2099-08-08T00:00:00.000Z', siteAccess: { mode: 'all', siteIds: [] },
  teamId: 't-1', teamName: 'Acme', inviterName: 'Ada', requiresPasswordChange: false,
};
const makeStore = () => configureStore({ reducer: { teamInbox: teamInboxReducer } });

beforeAll(() => {
  initI18n({ initialLocale: 'en' });
});

beforeEach(() => vi.clearAllMocks());

describe('team invitation inbox state', () => {
  it('loads, accepts, and rejects invitations as terminal transitions', async () => {
    mocked.fetchPendingInvitationsRequest.mockResolvedValue({ invitations: [invitation] });
    mocked.acceptPendingInvitationRequest.mockResolvedValue({
      member: { ...invitation, status: 'accepted', acceptedAt: '2026-08-02T00:00:00.000Z' },
      message: 'joined',
    });
    const store = makeStore();
    await store.dispatch(loadPendingInvitations());
    expect(store.getState().teamInbox.status).toBe('loaded');
    await store.dispatch(acceptPendingInvitation('i-1'));
    expect(store.getState().teamInbox).toMatchObject({ invitations: [], message: 'joined', actionId: null });

    mocked.fetchPendingInvitationsRequest.mockResolvedValue({ invitations: [invitation] });
    mocked.rejectPendingInvitationRequest.mockResolvedValue({ message: 'declined' });
    await store.dispatch(loadPendingInvitations());
    await store.dispatch(rejectPendingInvitation('i-1'));
    expect(store.getState().teamInbox).toMatchObject({ invitations: [], message: 'declined' });
  });

  it('surfaces each transport failure and clears feedback', async () => {
    mocked.fetchPendingInvitationsRequest.mockRejectedValue(new TypeError('offline'));
    mocked.acceptPendingInvitationRequest.mockRejectedValue(new TypeError('offline'));
    mocked.rejectPendingInvitationRequest.mockRejectedValue(new TypeError('offline'));
    const store = makeStore();
    await store.dispatch(loadPendingInvitations());
    expect(store.getState().teamInbox.status).toBe('failed');
    await store.dispatch(acceptPendingInvitation('i-1'));
    expect(store.getState().teamInbox.error).toBeTruthy();
    await store.dispatch(rejectPendingInvitation('i-1'));
    expect(store.getState().teamInbox.error).toBeTruthy();
    store.dispatch(clearInvitationInboxMessage());
    expect(store.getState().teamInbox).toMatchObject({ error: '', message: '' });
  });

  it('selectors are safe before the eager reducer materializes', () => {
    const bare = {} as RootState;
    expect(selectPendingInvitations(bare)).toEqual([]);
    expect(selectPendingInvitationCount(bare)).toBe(0);
    expect(selectInvitationInboxStatus(bare)).toBe('idle');
    expect(selectInvitationInboxActionId(bare)).toBeNull();
    expect(selectInvitationInboxError(bare)).toBe('');
    expect(selectInvitationInboxMessage(bare)).toBe('');
    expect(teamInboxInitialState.invitations).toEqual([]);
  });

  it('keeps loaded data visible during refresh and handles payload-less failures', () => {
    const loaded = {
      ...teamInboxInitialState,
      status: 'loaded' as const,
      invitations: [invitation],
      error: 'old',
    };
    let state = teamInboxReducer(loaded, loadPendingInvitations.pending('load'));
    expect(state).toMatchObject({ status: 'loaded', error: '', invitations: [invitation] });
    state = teamInboxReducer(state, loadPendingInvitations.rejected(null, 'load', undefined, undefined));
    expect(state.error).toBe('');
    state = teamInboxReducer(state, acceptPendingInvitation.pending('accept', 'i-1'));
    expect(state.actionId).toBe('i-1');
    state = teamInboxReducer(state, acceptPendingInvitation.rejected(null, 'accept', 'i-1', undefined));
    expect(state).toMatchObject({ actionId: null, error: '' });
    state = teamInboxReducer(state, rejectPendingInvitation.pending('reject', 'i-1'));
    expect(state.actionId).toBe('i-1');
    state = teamInboxReducer(state, rejectPendingInvitation.rejected(null, 'reject', 'i-1', undefined));
    expect(state).toMatchObject({ actionId: null, error: '' });
  });
});
