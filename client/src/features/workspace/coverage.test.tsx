/**
 * Branch coverage for the workspace feature — `rankme-enterprise-orgs` 02.
 *
 * The paths here are the ones the happy-path suites never take: storage that
 * throws, an unknown active id, a rejected load, and the switcher rendering
 * before its own workspace list has arrived.
 */
import { configureStore } from '@reduxjs/toolkit';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@shared/i18n';
import { ApiError } from '@shared/api/client';
import type { Workspace } from '@features/team';
import { WorkspaceSwitcher } from './components/WorkspaceSwitcher';
import { readStoredWorkspaceId, writeStoredWorkspaceId } from './storage';
import { setActiveWorkspace, workspaceInitialState, workspaceReducer } from './store/slice';
import { selectActiveWorkspace } from './store/selectors';
import { loadWorkspaces } from './store/thunks';

vi.mock('@features/team', async () => ({
  fetchWorkspacesRequest: vi.fn(),
}));
const { fetchWorkspacesRequest } = await import('@features/team');
const mockedFetch = vi.mocked(fetchWorkspacesRequest);

const OWN: Workspace = { accountId: 'own-1', label: 'me@example.com', role: 'owner', isOwn: true };
const FOREIGN: Workspace = {
  accountId: 'owner-2',
  label: 'boss@example.com',
  role: 'member',
  isOwn: false,
};

const makeStore = (preloaded?: Partial<typeof workspaceInitialState>) =>
  configureStore({
    reducer: { workspace: workspaceReducer },
    ...(preloaded
      ? { preloadedState: { workspace: { ...workspaceInitialState, ...preloaded } } }
      : {}),
  });

beforeAll(() => {
  initI18n({ initialLocale: 'en' });
});

beforeEach(() => {
  vi.restoreAllMocks();
  writeStoredWorkspaceId(null);
});

describe('storage survives a hostile localStorage', () => {
  const withBrokenStorage = (fn: () => void) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('blocked in private mode');
      },
    });
    try {
      fn();
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    }
  };

  it('reads null when localStorage access throws', () => {
    withBrokenStorage(() => {
      expect(readStoredWorkspaceId()).toBeNull();
    });
  });

  it('writes without throwing when localStorage access throws', () => {
    withBrokenStorage(() => {
      expect(() => writeStoredWorkspaceId('anything')).not.toThrow();
    });
  });

  it('swallows a quota error on write', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => writeStoredWorkspaceId('x')).not.toThrow();
    setItem.mockRestore();
  });

  it('treats an empty stored value as absent', () => {
    globalThis.localStorage.setItem('rankme.activeWorkspaceId', '');
    expect(readStoredWorkspaceId()).toBeNull();
  });
});

describe('selectors and reducers on the unusual paths', () => {
  it('reports no active workspace when the id is not in the list', () => {
    const store = makeStore({ workspaces: [FOREIGN], activeWorkspaceId: 'vanished' });
    expect(selectActiveWorkspace(store.getState() as never)).toBeNull();
  });

  it('reports no active workspace when the list has no own entry', () => {
    const store = makeStore({ workspaces: [FOREIGN], activeWorkspaceId: null });
    expect(selectActiveWorkspace(store.getState() as never)).toBeNull();
  });

  it('clears the selection when set to null', () => {
    const store = makeStore({ workspaces: [OWN, FOREIGN], activeWorkspaceId: FOREIGN.accountId });
    store.dispatch(setActiveWorkspace(null));
    expect(store.getState().workspace.activeWorkspaceId).toBeNull();
    expect(readStoredWorkspaceId()).toBeNull();
  });

  it('keeps a still-valid selection after a reload', async () => {
    mockedFetch.mockResolvedValue({ workspaces: [OWN, FOREIGN] });
    const store = makeStore({ activeWorkspaceId: FOREIGN.accountId });
    await store.dispatch(loadWorkspaces());
    expect(store.getState().workspace.activeWorkspaceId).toBe(FOREIGN.accountId);
  });

  it('surfaces the server message from a rejected load', async () => {
    mockedFetch.mockRejectedValue(
      new ApiError('nope', 404, { error: { message: 'Not found.' } }),
    );
    const store = makeStore();
    await store.dispatch(loadWorkspaces());
    expect(store.getState().workspace.loadError).toBe('Not found.');
  });

  it('falls back to an empty message when the error carries no body', async () => {
    mockedFetch.mockRejectedValue(new ApiError('nope', 500, null));
    const store = makeStore();
    await store.dispatch(loadWorkspaces());
    expect(store.getState().workspace.loadError).toBe('');
  });

  it('falls back to an empty message for a non-API error', async () => {
    mockedFetch.mockRejectedValue(new Error('offline'));
    const store = makeStore();
    await store.dispatch(loadWorkspaces());
    expect(store.getState().workspace.loadError).toBe('');
  });
});

describe('WorkspaceSwitcher label fallback', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('names the own workspace when the active entry cannot be resolved', async () => {
    const user = userEvent.setup();
    // Two workspaces so the switcher renders, but neither is flagged `isOwn`
    // and nothing is selected — the trigger falls back to the generic label.
    const store = makeStore({
      workspaces: [FOREIGN, { ...FOREIGN, accountId: 'owner-3', label: 'other@example.com' }],
      activeWorkspaceId: null,
    });
    render(
      <Provider store={store}>
        <WorkspaceSwitcher />
      </Provider>,
    );
    const trigger = screen.getByLabelText('Workspace');
    expect(trigger).toHaveTextContent('My workspace');

    // Selecting an `isOwn: false` entry stores the id rather than clearing.
    const reload = vi.fn();
    vi.spyOn(globalThis, 'location', 'get').mockReturnValue({ reload } as never);
    await user.click(trigger);
    await user.click(await screen.findByText('other@example.com'));
    expect(store.getState().workspace.activeWorkspaceId).toBe('owner-3');
  });

  it('clears the selection when the own workspace is chosen', async () => {
    const user = userEvent.setup();
    const reload = vi.fn();
    vi.spyOn(globalThis, 'location', 'get').mockReturnValue({ reload } as never);
    const store = makeStore({
      workspaces: [OWN, FOREIGN],
      activeWorkspaceId: FOREIGN.accountId,
    });
    render(
      <Provider store={store}>
        <WorkspaceSwitcher />
      </Provider>,
    );
    await user.click(screen.getByLabelText('Workspace'));
    await user.click(await screen.findByText(OWN.label));
    expect(store.getState().workspace.activeWorkspaceId).toBeNull();
  });
});

describe('defensive fallbacks on the load path', () => {
  it('reports an empty error when the API body carries no message', async () => {
    mockedFetch.mockRejectedValue(new ApiError('nope', 400, {}));
    const store = makeStore();
    await store.dispatch(loadWorkspaces());
    expect(store.getState().workspace.loadError).toBe('');
  });

  it('reports an empty error when a rejection carries no payload at all', async () => {
    const store = makeStore();
    await store.dispatch(loadWorkspaces.rejected(new Error('boom'), 'r', undefined, undefined));
    expect(store.getState().workspace.status).toBe('failed');
    expect(store.getState().workspace.loadError).toBe('');
  });
});
