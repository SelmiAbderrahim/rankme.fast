import { act, render } from '@testing-library/react';
import { Provider } from 'react-redux';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthSession, type AuthSessionState } from '@features/auth';
import { makeStore } from './store';
import { PrincipalStateBoundary } from './PrincipalStateBoundary';

vi.mock('@features/auth', () => ({ useAuthSession: vi.fn() }));

const session = (id: string | null): AuthSessionState => ({
  authenticated: id !== null,
  isPending: false,
  emailVerified: id !== null,
  user: id === null
    ? null
    : {
        id,
        email: `${id}@example.test`,
        name: id,
        emailVerified: true,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        twoFactorEnabled: false,
        role: 'Member',
        mustChangePassword: false,
        provisionalAccount: false,
      },
});

const pendingSession = (): AuthSessionState => ({
  authenticated: false,
  isPending: true,
  emailVerified: false,
  user: null,
});

describe('PrincipalStateBoundary', () => {
  beforeEach(() => {
    vi.mocked(useAuthSession).mockReturnValue(session('account-a'));
  });

  it('clears account A caches before a direct account A -> B switch can paint', () => {
    const base = makeStore().getState();
    const accountAStore = makeStore({
      sites: {
        ...base.sites,
        loaded: true,
        message: 'private-account-a-site',
      },
    });
    const view = render(
      <Provider store={accountAStore}>
        <PrincipalStateBoundary />
      </Provider>,
    );
    expect(accountAStore.getState().sites.loaded).toBe(true);

    vi.mocked(useAuthSession).mockReturnValue(session('account-b'));
    act(() => view.rerender(
      <Provider store={accountAStore}>
        <PrincipalStateBoundary />
      </Provider>,
    ));

    expect(accountAStore.getState().sites.loaded).toBe(false);
    expect(accountAStore.getState().sites.message).toBe('');
  });

  it('clears account state on session expiry or logout', () => {
    const base = makeStore().getState();
    const accountAStore = makeStore({
      sites: { ...base.sites, loaded: true, message: 'private-account-a-site' },
    });
    const view = render(
      <Provider store={accountAStore}>
        <PrincipalStateBoundary />
      </Provider>,
    );

    vi.mocked(useAuthSession).mockReturnValue(session(null));
    act(() => view.rerender(
      <Provider store={accountAStore}>
        <PrincipalStateBoundary />
      </Provider>,
    ));

    expect(accountAStore.getState().sites.loaded).toBe(false);
  });

  it('waits for principal resolution and keeps the same settled account intact', () => {
    const base = makeStore().getState();
    const store = makeStore({
      sites: { ...base.sites, loaded: true, message: 'same-account-cache' },
    });
    vi.mocked(useAuthSession).mockReturnValue(pendingSession());
    const view = render(
      <Provider store={store}>
        <PrincipalStateBoundary />
      </Provider>,
    );

    expect(store.getState().sites.message).toBe('same-account-cache');

    vi.mocked(useAuthSession).mockReturnValue(session('account-a'));
    act(() => view.rerender(
      <Provider store={store}>
        <PrincipalStateBoundary />
      </Provider>,
    ));
    expect(store.getState().sites.message).toBe('same-account-cache');

    vi.mocked(useAuthSession).mockReturnValue(pendingSession());
    act(() => view.rerender(
      <Provider store={store}>
        <PrincipalStateBoundary />
      </Provider>,
    ));
    expect(store.getState().sites.message).toBe('same-account-cache');

    vi.mocked(useAuthSession).mockReturnValue(session('account-a'));
    act(() => view.rerender(
      <Provider store={store}>
        <PrincipalStateBoundary />
      </Provider>,
    ));
    expect(store.getState().sites.message).toBe('same-account-cache');
  });

  it('treats an authenticated session without a user id as unresolved account data', () => {
    const base = makeStore().getState();
    const store = makeStore({
      sites: { ...base.sites, loaded: true, message: 'orphaned-session-cache' },
    });
    vi.mocked(useAuthSession).mockReturnValue({
      ...session(null),
      authenticated: true,
      emailVerified: true,
    });
    const view = render(
      <Provider store={store}>
        <PrincipalStateBoundary />
      </Provider>,
    );
    expect(store.getState().sites.message).toBe('orphaned-session-cache');

    vi.mocked(useAuthSession).mockReturnValue(session('account-a'));
    act(() => view.rerender(
      <Provider store={store}>
        <PrincipalStateBoundary />
      </Provider>,
    ));
    expect(store.getState().sites.message).toBe('');
  });
});
