/**
 * Workspace slice, header injection, and switcher —
 * `rankme-enterprise-orgs` 02.
 */
import { configureStore } from '@reduxjs/toolkit';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@shared/i18n';
import {
  WORKSPACE_HEADER,
  apiClient,
  setWorkspaceIdProvider,
  __resetCsrfTokenCacheForTests,
} from '@shared/api/client';
import type { Workspace } from '@features/team';
import { WorkspaceSwitcher } from './components/WorkspaceSwitcher';
import { readStoredWorkspaceId, writeStoredWorkspaceId } from './storage';
import { setActiveWorkspace, workspaceInitialState, workspaceReducer } from './store/slice';
import {
  selectActiveWorkspace,
  selectActiveWorkspaceId,
  selectActiveWorkspaceRole,
  selectHasMultipleWorkspaces,
  selectIsForeignWorkspace,
  selectWorkspaceLoadError,
  selectWorkspaceStatus,
  selectWorkspaces,
} from './store/selectors';
import { loadWorkspaces } from './store/thunks';

vi.mock('@features/team', async () => ({
  fetchWorkspacesRequest: vi.fn(),
}));
const { fetchWorkspacesRequest } = await import('@features/team');
const mockedFetch = vi.mocked(fetchWorkspacesRequest);

const OWN: Workspace = {
  accountId: 'own-1',
  label: 'me@example.com',
  role: 'owner',
  isOwn: true,
};
const FOREIGN: Workspace = {
  accountId: 'owner-2',
  label: 'boss@example.com',
  role: 'member',
  isOwn: false,
};

const makeStore = () => configureStore({ reducer: { workspace: workspaceReducer } });

beforeAll(() => {
  initI18n({ initialLocale: 'en' });
});

beforeEach(() => {
  writeStoredWorkspaceId(null);
  setWorkspaceIdProvider(null);
  __resetCsrfTokenCacheForTests();
  vi.restoreAllMocks();
});

afterEach(() => {
  setWorkspaceIdProvider(null);
});

describe('workspace slice', () => {
  it('starts empty with no active workspace', () => {
    const state = makeStore().getState().workspace;
    expect(state).toEqual({ ...workspaceInitialState, activeWorkspaceId: null });
  });

  it('records the workspaces the server returned', async () => {
    mockedFetch.mockResolvedValue({ workspaces: [OWN, FOREIGN] });
    const store = makeStore();
    await store.dispatch(loadWorkspaces());
    expect(selectWorkspaces(store.getState() as never)).toEqual([OWN, FOREIGN]);
    expect(selectWorkspaceStatus(store.getState() as never)).toBe('loaded');
  });

  it('records a load failure without clearing the active selection', async () => {
    mockedFetch.mockRejectedValue(new Error('offline'));
    const store = makeStore();
    await store.dispatch(loadWorkspaces());
    expect(selectWorkspaceStatus(store.getState() as never)).toBe('failed');
    expect(selectWorkspaceLoadError(store.getState() as never)).toBe('');
  });

  it('persists a selected foreign workspace', async () => {
    mockedFetch.mockResolvedValue({ workspaces: [OWN, FOREIGN] });
    const store = makeStore();
    await store.dispatch(loadWorkspaces());
    store.dispatch(setActiveWorkspace(FOREIGN.accountId));
    expect(selectActiveWorkspaceId(store.getState() as never)).toBe(FOREIGN.accountId);
    expect(readStoredWorkspaceId()).toBe(FOREIGN.accountId);
  });

  it('resolves the own workspace to null so no header is sent', async () => {
    mockedFetch.mockResolvedValue({ workspaces: [OWN, FOREIGN] });
    const store = makeStore();
    await store.dispatch(loadWorkspaces());
    store.dispatch(setActiveWorkspace(FOREIGN.accountId));
    store.dispatch(setActiveWorkspace(OWN.accountId));
    expect(selectActiveWorkspaceId(store.getState() as never)).toBeNull();
    expect(readStoredWorkspaceId()).toBeNull();
  });

  it('refuses an unknown workspace id', async () => {
    mockedFetch.mockResolvedValue({ workspaces: [OWN, FOREIGN] });
    const store = makeStore();
    await store.dispatch(loadWorkspaces());
    store.dispatch(setActiveWorkspace('never-heard-of-it'));
    expect(selectActiveWorkspaceId(store.getState() as never)).toBeNull();
  });

  it('resets a stored id whose membership is gone, instead of 404ing forever', async () => {
    writeStoredWorkspaceId('revoked-workspace');
    // Rehydration is read at slice construction, so build a store whose
    // preloaded state carries the stale id.
    const store = configureStore({
      reducer: { workspace: workspaceReducer },
      preloadedState: {
        workspace: { ...workspaceInitialState, activeWorkspaceId: 'revoked-workspace' },
      },
    });
    mockedFetch.mockResolvedValue({ workspaces: [OWN] });
    await store.dispatch(loadWorkspaces());
    expect(selectActiveWorkspaceId(store.getState() as never)).toBeNull();
    expect(readStoredWorkspaceId()).toBeNull();
  });
});

describe('workspace selectors', () => {
  it('fall back to the initial state when the slice is absent', () => {
    const bare = {} as never;
    expect(selectWorkspaces(bare)).toEqual([]);
    expect(selectActiveWorkspaceId(bare)).toBeNull();
    expect(selectActiveWorkspace(bare)).toBeNull();
    expect(selectActiveWorkspaceRole(bare)).toBe('owner');
    expect(selectIsForeignWorkspace(bare)).toBe(false);
    expect(selectHasMultipleWorkspaces(bare)).toBe(false);
    expect(selectWorkspaceStatus(bare)).toBe('idle');
    expect(selectWorkspaceLoadError(bare)).toBe('');
  });

  it('reports the active workspace and role', async () => {
    mockedFetch.mockResolvedValue({ workspaces: [OWN, FOREIGN] });
    const store = makeStore();
    await store.dispatch(loadWorkspaces());
    expect(selectActiveWorkspace(store.getState() as never)).toEqual(OWN);
    expect(selectActiveWorkspaceRole(store.getState() as never)).toBe('owner');
    expect(selectIsForeignWorkspace(store.getState() as never)).toBe(false);

    store.dispatch(setActiveWorkspace(FOREIGN.accountId));
    expect(selectActiveWorkspace(store.getState() as never)).toEqual(FOREIGN);
    expect(selectActiveWorkspaceRole(store.getState() as never)).toBe('member');
    expect(selectIsForeignWorkspace(store.getState() as never)).toBe(true);
  });
});

describe('workspace header parity with the server', () => {
  it('uses the exact literal the server middleware reads', async () => {
    // `import.meta.url` is an http URL under jsdom, so resolve from cwd —
    // which is the repo root locally and the package dir in some CI shells,
    // hence both candidates. The client suite already requires the repo root
    // to be present (see the docs-serving tests), so one of these resolves.
    const { existsSync, readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const relative = 'server/src/shared/middleware/workspace-context.ts';
    const candidates = [
      resolve(process.cwd(), relative),
      resolve(process.cwd(), '..', relative),
    ];
    const found = candidates.find((candidate) => existsSync(candidate));
    expect(found, `server middleware not found in ${candidates.join(', ')}`).toBeDefined();
    const source = readFileSync(found!, 'utf8');
    const match = /export const WORKSPACE_HEADER = '([^']+)'/u.exec(source);
    expect(match?.[1]).toBe(WORKSPACE_HEADER);
  });
});

describe('workspace header injection', () => {
  const jsonResponse = () =>
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  it('sends no workspace header by default', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse());
    await apiClient('/sites');
    const headers = new Headers((fetchSpy.mock.calls[0]![1] as RequestInit).headers);
    expect(headers.has(WORKSPACE_HEADER)).toBe(false);
  });

  it('attaches the header once a workspace is active', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse());
    setWorkspaceIdProvider(() => 'owner-2');
    await apiClient('/sites');
    const headers = new Headers((fetchSpy.mock.calls[0]![1] as RequestInit).headers);
    expect(headers.get(WORKSPACE_HEADER)).toBe('owner-2');
  });

  it('lets an explicit per-call header win over the provider', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse());
    setWorkspaceIdProvider(() => 'owner-2');
    await apiClient('/sites', { headers: { [WORKSPACE_HEADER]: 'explicit' } });
    const headers = new Headers((fetchSpy.mock.calls[0]![1] as RequestInit).headers);
    expect(headers.get(WORKSPACE_HEADER)).toBe('explicit');
  });

  it('omits the header when the provider returns null', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse());
    setWorkspaceIdProvider(() => null);
    await apiClient('/sites');
    const headers = new Headers((fetchSpy.mock.calls[0]![1] as RequestInit).headers);
    expect(headers.has(WORKSPACE_HEADER)).toBe(false);
  });
});

describe('WorkspaceSwitcher', () => {
  const renderWith = async (workspaces: Workspace[]) => {
    mockedFetch.mockResolvedValue({ workspaces });
    const store = makeStore();
    await store.dispatch(loadWorkspaces());
    render(
      <Provider store={store}>
        <WorkspaceSwitcher />
      </Provider>,
    );
    return store;
  };

  it('stays hidden for a user with a single workspace', async () => {
    await renderWith([OWN]);
    expect(screen.queryByLabelText('Workspace')).not.toBeInTheDocument();
  });

  it('shows the active workspace label', async () => {
    await renderWith([OWN, FOREIGN]);
    expect(screen.getByLabelText('Workspace')).toHaveTextContent('me@example.com');
  });

  it('lists every workspace with its role, and switches with a reload', async () => {
    const reload = vi.fn();
    vi.spyOn(globalThis, 'location', 'get').mockReturnValue({ reload } as never);
    const user = userEvent.setup();
    const store = await renderWith([OWN, FOREIGN]);

    await user.click(screen.getByLabelText('Workspace'));
    expect(await screen.findByText('boss@example.com')).toBeInTheDocument();
    expect(screen.getByText('Member')).toBeInTheDocument();

    await user.click(screen.getByText('boss@example.com'));
    await waitFor(() => {
      expect(selectActiveWorkspaceId(store.getState() as never)).toBe(FOREIGN.accountId);
    });
    expect(reload).toHaveBeenCalledOnce();
  });

  it('is operable from the keyboard', async () => {
    const reload = vi.fn();
    vi.spyOn(globalThis, 'location', 'get').mockReturnValue({ reload } as never);
    const user = userEvent.setup();
    await renderWith([OWN, FOREIGN]);
    await user.tab();
    expect(screen.getByLabelText('Workspace')).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(await screen.findByText('boss@example.com')).toBeInTheDocument();
  });
});
