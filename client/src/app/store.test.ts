import { describe, expect, it } from 'vitest';
import { clearTeamMessages, teamReducer } from '@features/team';
import { resetAccountState, rootReducer, store, makeStore } from './store';
import { presentationLocaleChanged } from '@shared/i18n/requestIdentity';

describe('store after Better Auth migration', () => {
  const state = store.getState();

  it('registers sites and traffic snapshot slices', () => {
    expect(state).toHaveProperty('sites');
    expect(state).toHaveProperty('trafficSnapshots');
  });

  it('does NOT register removed slices (auth lives in the session hook; dashboard has no state)', () => {
    expect(state).not.toHaveProperty('auth');
    expect(state).not.toHaveProperty('projects');
    expect(state).not.toHaveProperty('snapshots');
    expect(state).not.toHaveProperty('dashboard');
    expect(state).not.toHaveProperty('billing');
  });

  it('does NOT eagerly register lazy slices', () => {
    expect(state).not.toHaveProperty('team');
    expect(state).not.toHaveProperty('settings');
    expect(state).not.toHaveProperty('weeklyPulse');
  });

  it('inject registers a lazy slice and selectors read it', () => {
    rootReducer.inject({ reducerPath: 'team', reducer: teamReducer });
    const injected = makeStore();
    injected.dispatch({ type: 'team/load/rejected', payload: 'boom' });
    expect(injected.getState().team.loadError).toBe('boom');
    injected.dispatch(clearTeamMessages());
    expect(injected.getState().team.loadError).toBe('');
  });

  it('double inject of the same reducerPath is a no-op', () => {
    const once = rootReducer.inject({ reducerPath: 'team', reducer: teamReducer });
    const twice = rootReducer.inject({ reducerPath: 'team', reducer: teamReducer });
    expect(twice).toBe(once);
  });

  it('makeStore accepts and applies preloadedState', () => {
    const hydrated = makeStore({
      sites: { ...state.sites, message: 'restored' },
    });
    expect(hydrated.getState().sites.message).toBe('restored');
  });

  it('makeStore works without preloadedState', () => {
    expect(makeStore().getState().sites).toEqual(state.sites);
  });

  it('clears transient presentation messages while preserving machine/source caches', () => {
    const items = [
      {
        id: 's-1',
        url: 'https://example.com',
        domain: 'example.com',
        displayName: 'Example',
        paused: false,
        pausedAt: null,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      },
    ];
    const localized = makeStore({
      sites: {
        ...state.sites,
        items,
        message: 'Old English success',
        error: 'Old English error',
        addError: 'Old English add error',
      },
    });

    localized.dispatch(
      presentationLocaleChanged({
        locale: 'ar',
        generation: 1,
        refreshGeneration: 1,
        reason: 'language-changed',
      }),
    );

    expect(localized.getState().sites.message).toBe('');
    expect(localized.getState().sites.error).toBe('');
    expect(localized.getState().sites.addError).toBe('');
    expect(localized.getState().sites.items).toEqual(items);
  });

  it('leaves primitive machine-only lazy state untouched during presentation invalidation', () => {
    rootReducer.inject({
      reducerPath: 'weeklyPulse',
      reducer: ((state = 'machine-only') => state) as never,
    });
    const localized = makeStore();

    localized.dispatch(
      presentationLocaleChanged({
        locale: 'ar',
        generation: 1,
        refreshGeneration: 1,
        reason: 'language-changed',
      }),
    );

    expect(localized.getState().weeklyPulse).toBe('machine-only');
  });

  it('resets eager and injected account-scoped slices as one atomic action', () => {
    rootReducer.inject({ reducerPath: 'team', reducer: teamReducer });
    const accountA = makeStore({
      sites: {
        ...state.sites,
        loaded: true,
        message: 'account-a-site-cache',
      },
    });
    accountA.dispatch({ type: 'team/load/rejected', payload: 'account-a-team-cache' });

    accountA.dispatch(resetAccountState());

    expect(accountA.getState().sites.loaded).toBe(false);
    expect(accountA.getState().sites.message).toBe('');
    expect(accountA.getState().team.loadError).toBe('');
  });
});
