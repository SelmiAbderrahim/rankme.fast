import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom';
import { i18n, initI18n } from '@shared/i18n';
import { rootReducer } from './store';

vi.mock('@shared/components/AppLayout', () => ({
  AppLayout: () => <Outlet />,
}));

vi.mock('@shared/components/MinimalLayout', () => ({
  MinimalLayout: () => <Outlet />,
}));

vi.mock('@shared/components/PublicLayout', () => ({
  PublicLayout: () => <Outlet />,
}));

vi.mock('@features/auth', () => ({
  authRoutes: [],
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  RequirePasswordCurrent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  RequireVerified: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  RequiredPasswordChangePage: () => <h1>Change password</h1>,
}));

vi.mock('@features/settings/components/NotificationPreferences', () => ({
  NotificationPreferences: () => <h1>Settings lazy screen</h1>,
}));

const renderRouter = (router: ReturnType<typeof createMemoryRouter>) =>
  render(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} fallbackElement={<LazyRouteFallback />} />
    </I18nextProvider>,
  );

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await i18n.changeLanguage('en');
});

describe('app lazy routes', () => {
  it('lazy route resolves and renders its screen', async () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/settings/notifications'] });
    renderRouter(router);
    expect(await screen.findByRole('heading', { name: 'Settings lazy screen' })).toBeInTheDocument();
  });

  it('shows the loading affordance while a lazy chunk is pending', async () => {
    const router = createMemoryRouter(
      [
        {
          path: '/',
          lazy: () => new Promise(() => {}),
        },
      ],
      { initialEntries: ['/'] },
    );

    renderRouter(router);

    expect(await screen.findByText('Loading dashboard…')).toBeInTheDocument();
    expect(screen.getAllByText('', { selector: '[data-slot="skeleton"]' })).toHaveLength(3);
  });

  it('a failed lazy chunk surfaces the errorElement, not a blank screen', async () => {
    const router = createMemoryRouter(
      [
        {
          path: '/',
          errorElement: <RouteErrorBoundary />,
          lazy: async () => {
            throw new Error('chunk failed');
          },
        },
      ],
      { initialEntries: ['/'] },
    );

    renderRouter(router);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Something went wrong on our end. Please try again.');
    expect(screen.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute(
      'href',
      '/dashboard',
    );
    expect(screen.getByRole('link', { name: 'Report this problem' })).toHaveAttribute(
      'target',
      '_blank',
    );
    expect(alert.querySelectorAll('[data-slot="button"][data-variant="default"]')).toHaveLength(1);
  });

  it('passes the matched declared error route to the secondary bug-report action', async () => {
    const router = createMemoryRouter(
      [
        {
          path: '/sites/:siteId',
          errorElement: <RouteErrorBoundary />,
          children: [
            {
              path: 'audits/:auditId',
              loader: () => {
                throw new Error('audit loader failed');
              },
              element: <p>unreachable</p>,
            },
          ],
        },
      ],
      { initialEntries: ['/sites/507f1f77bcf86cd799439011/audits/507f191e810c19729de860ea'] },
    );
    renderRouter(router);
    const report = await screen.findByRole('link', { name: 'Report this problem' });
    expect(decodeURIComponent(report.getAttribute('href') ?? '')).toContain(
      'route: /sites/:siteId/audits/:auditId',
    );
  });

  it.each([
    ['assistant', assistantRoutes[0], 'assistant'],
    ['report', reportRoutes[0], 'report'],
    ['backlinks', backlinksRoutes[0], 'backlinks'],
    ['keyword research', keywordResearchRoutes[0], 'keywordResearch'],
    // The standalone Starter live-trends surface sits between the
    // workspace root and the history route, so all three loaders are pinned.
    ['keyword research live trends', keywordResearchRoutes[1], 'keywordResearch'],
    ['keyword research history', keywordResearchRoutes[2], 'keywordResearch'],
    ['team settings', teamRoutes[0], 'team'],
    ['settings', settingsRoutes[0], 'settings'],
  ])('resolves the %s route module and injects its slice', async (_name, route, stateKey) => {
    const lazyRoute = route!;
    expect(lazyRoute.lazy).toBeDefined();
    const resolved = await lazyRoute.lazy!();
    expect(resolved.element).toBeTruthy();
    const state = rootReducer(undefined, { type: '@@routes/test' });
    expect(state).toHaveProperty(stateKey);
  });

  it('mounts invitation decisions and provisional-account recovery outside the app shell', () => {
    expect(teamActionRoutes.map((route) => route.path)).toEqual([
      'team/invitations',
      'team/accept/:token',
      'team/reject/:token',
      'team/change-password',
    ]);
    expect(appShellRoutes[0]?.children).toEqual(expect.arrayContaining(teamActionRoutes));
  });

  it('composes localSeoRoutes into the app shell (regression: was defined but never spread into routes.tsx, so `sites/:siteId/local-seo` matched nothing)', () => {
    const hasPath = (nodes: typeof routes, target: string): boolean =>
      nodes.some(
        (node) => node.path === target || (node.children ? hasPath(node.children, target) : false),
      );
    expect(hasPath(routes, 'sites/:siteId/local-seo')).toBe(true);
  });

  it('registers a catch-all `*` route in the tree (both public and authed shell)', () => {
    const collectSplats = (nodes: typeof routes): number =>
      nodes.reduce(
        (count, node) =>
          count + (node.path === '*' ? 1 : 0) + (node.children ? collectSplats(node.children) : 0),
        0,
      );
    // One under the public layout (drives SSR 404) + one under the authed shell.
    expect(collectSplats(routes)).toBeGreaterThanOrEqual(2);
  });

  it('renders the shared NotFound for an unknown path in the public tree (real 404 via loader)', async () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/totally-nonexistent-xyz'] });
    renderRouter(router);
    expect(await screen.findByText('Page not found')).toBeInTheDocument();
  });

  it.each([
    ['/', '/login', ''],
    ['/ar', '/login', '?lng=ar'],
  ])('sends the landing root %s straight to sign-in', async (root, pathname, search) => {
    const router = createMemoryRouter(
      [...routes, { path: '/login', element: <h1>Sign in screen</h1> }],
      { initialEntries: [root] },
    );
    renderRouter(router);
    await waitFor(() => expect(router.state.location.pathname).toBe(pathname));
    expect(router.state.location.search).toBe(search);
  });

  it('renders the shared NotFound for an unmatched path inside the authed shell', async () => {
    const router = createMemoryRouter(appShellRoutes, {
      initialEntries: ['/sites/abc/no-such-subpage'],
    });
    renderRouter(router);
    expect(await screen.findByText('Page not found')).toBeInTheDocument();
  });

  /** Removed global surfaces have no redirect aliases and must fall through
   * to the authenticated catch-all, including account-global Google settings.
   */
  it.each(['/keyword-clusters', '/cannibalization', '/internal-links', '/settings/google'])(
    'renders NotFound for the removed top-level route %s',
    async (path) => {
      const router = createMemoryRouter(appShellRoutes, { initialEntries: [path] });
      renderRouter(router);
      expect(await screen.findByText('Page not found')).toBeInTheDocument();
    },
  );

  it.each([
    ['competitors', competitorsRoutes, '/sites/s1/competitors', '?tab=competitors&view=overview'],
    ['ai-visibility', aiVisibilityRoutes, '/sites/s1/ai-visibility', '?tab=ai-visibility'],
    ['local-seo', localSeoRoutes, '/sites/s1/local-seo', '?tab=local-seo'],
  ])(
    'standalone %s route redirects into the unified workspace tab',
    async (_name, routeArr, from, search) => {
      const router = createMemoryRouter(
        [...routeArr, { path: 'sites/:siteId', element: <div data-testid="ws" /> }],
        { initialEntries: [from] },
      );
      renderRouter(router);
      await waitFor(() => expect(screen.getByTestId('ws')).toBeInTheDocument());
      expect(router.state.location.pathname).toBe('/sites/s1');
      expect(router.state.location.search).toBe(search);
    },
  );
});

import { routes, appShellRoutes, LazyRouteFallback, RouteErrorBoundary } from './routes';
import { aiVisibilityRoutes } from '@features/ai-visibility/routes';
import { assistantRoutes } from '@features/assistant/routes';
import { backlinksRoutes } from '@features/backlinks/routes';
import { competitorsRoutes } from '@features/competitors/routes';
import { keywordResearchRoutes } from '@features/keyword-research/routes';
import { localSeoRoutes } from '@features/local-seo/routes';
import { reportRoutes } from '@features/report/routes';
import { settingsRoutes } from '@features/settings/routes';
import { teamActionRoutes, teamRoutes } from '@features/team/routes';
