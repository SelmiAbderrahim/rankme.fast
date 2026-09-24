/**
 * Role-aware nav gating and the owner-only page state —
 * `rankme-enterprise-orgs` 02.
 */
import { configureStore } from '@reduxjs/toolkit';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, describe, expect, it } from 'vitest';
import { initI18n } from '@shared/i18n';
import { WORKSPACE_HEADER, apiClient, setWorkspaceIdProvider } from '@shared/api/client';
import { vi } from 'vitest';
import { WorkspaceRouteGuard } from './components/WorkspaceRouteGuard';
import { ADMIN_ONLY_ROUTES, OWNER_ONLY_ROUTES, canOpenRoute } from './navPolicy';
import { workspaceInitialState, workspaceReducer } from './store/slice';

beforeAll(() => {
  initI18n({ initialLocale: 'en' });
});

describe('canOpenRoute', () => {
  it('allows everything in the user own workspace, whatever the role name', () => {
    for (const route of [...OWNER_ONLY_ROUTES, ...ADMIN_ONLY_ROUTES, '/sites']) {
      expect(canOpenRoute(route, 'member', false)).toBe(true);
      expect(canOpenRoute(route, 'admin', false)).toBe(true);
      expect(canOpenRoute(route, 'owner', false)).toBe(true);
    }
  });

  it.each(OWNER_ONLY_ROUTES)('reserves %s to the owner inside a foreign workspace', (route) => {
    expect(canOpenRoute(route, 'owner', true)).toBe(true);
    expect(canOpenRoute(route, 'admin', true)).toBe(false);
    expect(canOpenRoute(route, 'member', true)).toBe(false);
  });

  it.each(ADMIN_ONLY_ROUTES)('reserves %s to admin and above', (route) => {
    expect(canOpenRoute(route, 'owner', true)).toBe(true);
    expect(canOpenRoute(route, 'admin', true)).toBe(true);
    expect(canOpenRoute(route, 'member', true)).toBe(false);
  });

  it('gates nested paths under a guarded route', () => {
    expect(canOpenRoute('/settings/api-keys/new', 'member', true)).toBe(false);
    expect(canOpenRoute('/settings/team/anything', 'member', true)).toBe(false);
  });

  it('does not gate a route that merely shares a prefix string', () => {
    expect(canOpenRoute('/settings/api-keys-history', 'member', true)).toBe(true);
  });

  it('leaves ordinary product work open to every accepted role', () => {
    for (const route of ['/dashboard', '/sites', '/keyword-research', '/dashboard/alerts']) {
      expect(canOpenRoute(route, 'member', true)).toBe(true);
    }
  });

  it('leaves actor-scoped account surfaces open — they are about the human', () => {
    for (const route of ['/profile', '/settings/notifications', '/settings/security']) {
      expect(canOpenRoute(route, 'member', true)).toBe(true);
    }
  });
});

describe('WorkspaceRouteGuard', () => {
  const renderAt = (pathname: string, role: 'owner' | 'admin' | 'member', foreign: boolean) => {
    const store = configureStore({
      reducer: { workspace: workspaceReducer },
      preloadedState: {
        workspace: {
          ...workspaceInitialState,
          workspaces: [
            {
              accountId: 'own-1',
              label: 'me@example.com',
              role: 'owner' as const,
              isOwn: true,
            },
            { accountId: 'owner-2', label: 'boss@example.com', role, isOwn: false },
          ],
          activeWorkspaceId: foreign ? 'owner-2' : null,
        },
      },
    });
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={[pathname]}>
          <WorkspaceRouteGuard>
            <p>page body</p>
          </WorkspaceRouteGuard>
        </MemoryRouter>
      </Provider>,
    );
  };

  it('renders the page in the user own workspace', () => {
    renderAt('/settings/api-keys', 'owner', false);
    expect(screen.getByText('page body')).toBeInTheDocument();
  });

  it('renders a localized not-available state instead of an owner-only page', () => {
    renderAt('/settings/api-keys', 'member', true);
    expect(screen.queryByText('page body')).not.toBeInTheDocument();
    expect(screen.getByText('Not available in this workspace')).toBeInTheDocument();
  });

  it('lets an admin member open the team page inside a foreign workspace', () => {
    renderAt('/settings/team', 'admin', true);
    expect(screen.getByText('page body')).toBeInTheDocument();
  });

  it('blocks a plain member from the team page', () => {
    renderAt('/settings/team', 'member', true);
    expect(screen.queryByText('page body')).not.toBeInTheDocument();
  });

  it('lets a plain member do ordinary product work', () => {
    renderAt('/sites', 'member', true);
    expect(screen.getByText('page body')).toBeInTheDocument();
  });
});

describe('actor-scoped endpoints never carry the workspace header', () => {
  const jsonResponse = () =>
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  it.each([
    ['data rights', '/legal/account-deletion'],
    ['the switcher own reader', '/team/workspaces'],
    ['the csrf token', '/security/csrf-token'],
  ])('omits the header for %s', async (_label, path) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse());
    setWorkspaceIdProvider(() => 'owner-2');
    try {
      await apiClient(path);
      const headers = new Headers((fetchSpy.mock.calls[0]![1] as RequestInit).headers);
      expect(headers.has(WORKSPACE_HEADER)).toBe(false);
    } finally {
      setWorkspaceIdProvider(null);
      fetchSpy.mockRestore();
    }
  });

  it('still sends it for ordinary product paths', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse());
    setWorkspaceIdProvider(() => 'owner-2');
    try {
      await apiClient('/team');
      const headers = new Headers((fetchSpy.mock.calls[0]![1] as RequestInit).headers);
      expect(headers.get(WORKSPACE_HEADER)).toBe('owner-2');
    } finally {
      setWorkspaceIdProvider(null);
      fetchSpy.mockRestore();
    }
  });
});
