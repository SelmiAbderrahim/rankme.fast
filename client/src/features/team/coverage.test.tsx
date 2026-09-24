/** Defensive branch coverage for the team roster state machine. */
import { configureStore } from '@reduxjs/toolkit';
import { beforeAll, describe, expect, it } from 'vitest';
import { initI18n } from '@shared/i18n';
import { initialState, setTeamPage, setTeamQuery, teamReducer } from './store/slice';
import {
  acceptTeamInvite,
  inviteTeammate,
  removeTeamMember,
  resendTeamInvite,
  updateTeamMember,
} from './store/thunks';
import {
  selectTeamAcceptError,
  selectTeamAccepting,
  selectTeamInviteError,
  selectTeamInviting,
  selectTeamLoadError,
  selectTeamLoaded,
  selectTeamLoading,
  selectTeamMessage,
  selectTeamMeta,
  selectTeamPage,
  selectTeamQuery,
  selectTeamRemoveError,
  selectTeamRemovingId,
  selectTeamResendError,
  selectTeamResendingId,
  selectTeamRoleChangingId,
  selectTeamRoleError,
  selectTeamUpdatingId,
  selectTeamUpdateError,
} from './store/selectors';
import type { RootState } from '@app/store';
import type { TeamMember, TeamOverview } from './types';

const member = (over: Partial<TeamMember> = {}): TeamMember => ({
  id: 'm-1',
  email: 'member@example.com',
  role: 'member',
  userId: 'u-1',
  status: 'accepted',
  invitedAt: '2026-08-01T00:00:00.000Z',
  acceptedAt: '2026-08-02T00:00:00.000Z',
  expiresAt: '2099-08-08T00:00:00.000Z',
  siteAccess: { mode: 'all', siteIds: [] },
  ...over,
});

const teamOverview = (members: TeamMember[] = [member()]): TeamOverview => ({
  members,
  meta: { total: members.length, page: 1, pageSize: 25 },
});

const makeStore = (overview: TeamOverview | null = null) => configureStore({
  reducer: { team: teamReducer },
  preloadedState: { team: { ...initialState, loaded: overview !== null, overview } },
});

const updateInput = {
  id: 'm-1',
  role: 'admin' as const,
  siteAccess: { mode: 'selected' as const, siteIds: ['site-1'] },
};

beforeAll(() => {
  initI18n({ initialLocale: 'en' });
});

describe('team slice defensive branches', () => {
  it('normalizes query pagination and exercises every public selector', () => {
    const store = makeStore(teamOverview());
    store.dispatch(setTeamPage(-4));
    expect(store.getState().team.page).toBe(1);
    store.dispatch(setTeamQuery('ada'));
    const state = store.getState() as RootState;
    expect([
      selectTeamLoading(state),
      selectTeamLoaded(state),
      selectTeamLoadError(state),
      selectTeamInviting(state),
      selectTeamInviteError(state),
      selectTeamRemovingId(state),
      selectTeamRemoveError(state),
      selectTeamAccepting(state),
      selectTeamAcceptError(state),
      selectTeamMessage(state),
      selectTeamQuery(state),
      selectTeamPage(state),
      selectTeamMeta(state),
      selectTeamResendingId(state),
      selectTeamResendError(state),
      selectTeamUpdatingId(state),
      selectTeamUpdateError(state),
      selectTeamRoleChangingId(state),
      selectTeamRoleError(state),
    ]).toBeDefined();
  });

  it('handles resend and access results when the roster is absent or off-page', () => {
    const absent = makeStore();
    absent.dispatch(resendTeamInvite.fulfilled({
      id: 'm-1', member: member(), emailDelivered: true, outcomeUnknown: false, message: 'resent',
    }, 'r1', 'm-1'));
    absent.dispatch(updateTeamMember.fulfilled({
      id: 'm-1', member: member({ role: 'admin' }), message: 'saved',
    }, 'r2', updateInput));
    expect(absent.getState().team).toMatchObject({ overview: null, message: 'saved' });

    const offPage = makeStore(teamOverview([member({ id: 'visible' })]));
    offPage.dispatch(resendTeamInvite.fulfilled({
      id: 'elsewhere', member: member({ id: 'elsewhere' }),
      emailDelivered: true, outcomeUnknown: false, message: 'resent',
    }, 'r3', 'elsewhere'));
    offPage.dispatch(updateTeamMember.fulfilled({
      id: 'elsewhere', member: member({ id: 'elsewhere', role: 'admin' }), message: 'saved',
    }, 'r4', { ...updateInput, id: 'elsewhere' }));
    expect(offPage.getState().team.overview?.members[0]?.id).toBe('visible');
  });

  it('mutates the loaded roster on invite and removal, and ignores an absent roster', () => {
    const invited = member({ id: 'new', status: 'pending', acceptedAt: null });
    const absent = makeStore();
    absent.dispatch(inviteTeammate.fulfilled({
      member: invited, emailDelivered: true, outcomeUnknown: false, message: 'invited',
    }, 'r0', { email: invited.email, role: 'member', siteAccess: { mode: 'all' } }));
    absent.dispatch(removeTeamMember.fulfilled({ id: 'new', message: 'removed' }, 'r0b', 'new'));
    expect(absent.getState().team).toMatchObject({ overview: null, message: 'removed' });

    const store = makeStore(teamOverview());
    store.dispatch(inviteTeammate.fulfilled({
      member: invited, emailDelivered: true, outcomeUnknown: false, message: 'invited',
    }, 'r1', { email: invited.email, role: 'member', siteAccess: { mode: 'all' } }));
    expect(store.getState().team.overview?.members).toHaveLength(2);
    store.dispatch(removeTeamMember.fulfilled({ id: 'new', message: 'removed' }, 'r2', 'new'));
    expect(store.getState().team.overview?.members).toHaveLength(1);
  });

  it('covers pending flags and payload-less failure fallbacks', () => {
    let state = teamReducer(initialState, acceptTeamInvite.pending('r1', 'token'));
    expect(state.accepting).toBe(true);
    state = teamReducer(state, resendTeamInvite.rejected(null, 'r2', 'm-1', undefined));
    state = teamReducer(state, updateTeamMember.rejected(null, 'r3', updateInput, undefined));
    state = teamReducer(state, inviteTeammate.rejected(null, 'r4', {
      email: 'a@example.com', role: 'member', siteAccess: { mode: 'all' },
    }, undefined));
    expect(state).toMatchObject({ resendError: '', updateError: '', inviteError: '' });
  });
});
