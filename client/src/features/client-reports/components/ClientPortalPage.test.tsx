import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HelmetProvider } from 'react-helmet-async';
import { I18nextProvider } from 'react-i18next';
import {
  MemoryRouter,
  RouterProvider,
  createMemoryRouter,
  type LoaderFunctionArgs,
  type RouteObject,
} from 'react-router-dom';
import { DirectionProvider } from '@radix-ui/react-direction';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { clientPortalLoader, clientPortalRoutes } from '../routes';
import type { ClientPortalReport } from '../types';
import { ClientPortalNotFound, ClientPortalPage } from './ClientPortalPage';

vi.mock('@shared/components/ThemeToggle', () => ({
  ThemeToggle: () => <button type="button" aria-label="Toggle theme" />,
}));

const report = (overrides: Partial<ClientPortalReport> = {}): ClientPortalReport => ({
  locale: 'en',
  site: { label: '<img src=x onerror=alert(1)>' },
  branding: {
    companyName: '<script>secretToken</script>',
    accentColor: '#3366ff',
    logoDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
  },
  sections: {
    audit: {
      snapshotDate: '2026-08-01T00:00:00.000Z',
      counts: { fixNow: 2, watch: 1, passed: 7 },
      findings: [
        {
          ruleId: 'critical-rule',
          bucket: 'fix-now',
          severity: 'critical',
          affectedUrls: ['https://example.com/<script>'],
          title: '<b>Unsafe title</b>',
          why: 'A dated explanation.',
          fix: 'A safe fix.',
        },
        {
          ruleId: 'watch-rule',
          bucket: 'watch',
          severity: 'warning',
          affectedUrls: [],
          title: 'Watch item',
          why: 'Watch this.',
          fix: 'Review it.',
        },
        {
          ruleId: 'passed-rule',
          bucket: 'passed',
          severity: 'info',
          affectedUrls: [],
          title: 'Passed item',
          why: 'Looks good.',
          fix: 'Keep it.',
        },
      ],
    },
    ranks: {
      snapshotDate: '2026-08-02T00:00:00.000Z',
      rows: [
        { keyword: '<svg onload=alert(1)>', engine: 'google', position: 3, checkedAt: '2026-08-02T00:00:00.000Z' },
        { keyword: 'unranked', engine: 'bing', position: null, checkedAt: '2026-08-02T00:00:00.000Z' },
      ],
    },
    gsc: {
      snapshotDate: '2026-08-03T00:00:00.000Z',
      windowDays: 28,
      totalClicks: 41,
      totalImpressions: 820,
      averageCtr: 0.05,
      averagePosition: 7.25,
      topQueries: [
        {
          query: '<iframe src=evil>',
          clicks: 12,
          impressions: 200,
          ctr: 0.06,
          position: 4.2,
          snapshotDate: '2026-08-03T00:00:00.000Z',
        },
      ],
    },
  },
  ...overrides,
});

function wrap(children: React.ReactNode) {
  return (
    <HelmetProvider>
      <I18nextProvider i18n={i18n}>
        <DirectionProvider dir={i18n.language === 'ar' ? 'rtl' : 'ltr'}>
          {children}
        </DirectionProvider>
      </I18nextProvider>
    </HelmetProvider>
  );
}

function renderHydrated(payload: ClientPortalReport, path = '/portal/token-value') {
  const routes: RouteObject[] = [
    {
      id: 'portal',
      path: 'portal/:token',
      loader: () => payload,
      element: <ClientPortalPage />,
    },
    {
      id: 'portal-ar',
      path: 'ar/portal/:token',
      loader: () => payload,
      element: <ClientPortalPage />,
    },
  ];
  const routeId = path.startsWith('/ar/') ? 'portal-ar' : 'portal';
  const router = createMemoryRouter(routes, {
    initialEntries: [path],
    hydrationData: { loaderData: { [routeId]: payload } },
  });
  return render(wrap(<RouterProvider router={router} />));
}

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  vi.clearAllMocks();
});

afterEach(() => {
  document.documentElement.removeAttribute('lang');
  document.documentElement.removeAttribute('dir');
  vi.restoreAllMocks();
});

describe('ClientPortalPage', () => {
  it('renders the strict report DTO inertly with dated audit, engine-tagged ranks, and GSC data', async () => {
    renderHydrated(report());
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      '<img src=x onerror=alert(1)>',
    );
    expect(screen.getByText('<script>secretToken</script>')).toBeInTheDocument();
    expect(screen.getByText('<b>Unsafe title</b>')).toBeInTheDocument();
    expect(screen.getByText('<svg onload=alert(1)>')).toBeInTheDocument();
    expect(screen.getByText('<iframe src=evil>')).toBeInTheDocument();
    expect(document.querySelector('script[src="secretToken"]')).toBeNull();
    expect(document.querySelector('iframe')).toBeNull();
    expect(document.querySelector('header img')).toHaveAttribute(
      'src',
      'data:image/png;base64,iVBORw0KGgo=',
    );
    expect(screen.getByText('google')).toBeInTheDocument();
    expect(screen.getByText('bing')).toBeInTheDocument();
    expect(screen.getByText('Not in tracked results')).toBeInTheDocument();
    expect(screen.getAllByText('Fix now').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Watch').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Passed').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('[data-snapshot-date]').length).toBeGreaterThanOrEqual(4);
    await waitFor(() => {
      expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute(
        'content',
        'noindex, nofollow',
      );
    });
  });

  it('renders empty section variants, blank branding, and ignores an invalid accent', async () => {
    const view = renderHydrated(report({
      branding: { companyName: '', accentColor: 'url(javascript:alert(1))', logoDataUrl: null },
      sections: {
        audit: {
          snapshotDate: 'bad-date',
          counts: { fixNow: 0, watch: 0, passed: 0 },
          findings: [],
        },
        ranks: { snapshotDate: '2026-08-02', rows: [] },
        gsc: {
          snapshotDate: '2026-08-03',
          windowDays: 28,
          totalClicks: 0,
          totalImpressions: 0,
          averageCtr: 0,
          averagePosition: 0,
          topQueries: [],
        },
      },
    }));
    expect(await screen.findAllByText('No dated data is available for this section.')).toHaveLength(2);
    expect(view.container.querySelector('header')).not.toHaveAttribute('style');
    expect(view.container.querySelector('header img')).toBeNull();
    expect(screen.getByText('Snapshot: bad-date')).toBeInTheDocument();
  });

  it('omits every report section when the allowlist DTO contains null sections', async () => {
    renderHydrated(report({
      sections: { audit: null, ranks: null, gsc: null },
    }));
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'SEO audit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Rank summary' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Search Console summary' })).not.toBeInTheDocument();
  });

  it('changes the live request locale without rewriting the frozen artifact locale', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify(report()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const router = createMemoryRouter(clientPortalRoutes, {
      initialEntries: ['/portal/token-value-that-is-long-enough-123456'],
    });
    render(wrap(<RouterProvider router={router} />));
    await screen.findByRole('heading', { level: 1 });
    const language = screen.getByRole('combobox', { name: 'Language' });
    await userEvent.click(language);
    await userEvent.click(await screen.findByRole('option', { name: 'العربية' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(
      '/ar/portal/token-value-that-is-long-enough-123456',
    ));
    await waitFor(() => expect(document.documentElement).toHaveAttribute('dir', 'ltr'));
    expect(screen.getByRole('heading', { name: 'SEO audit' })).toBeInTheDocument();
    expect(fetch).toHaveBeenLastCalledWith(
      expect.stringContaining('locale=ar'),
      expect.objectContaining({ credentials: 'include' }),
    );

    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(await screen.findByRole('option', { name: 'English' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(
      '/portal/token-value-that-is-long-enough-123456',
    ));
  });

  it('renders a localized noindex not-found surface', async () => {
    await changeLanguage('ar');
    render(wrap(
      <MemoryRouter initialEntries={['/ar/portal/revoked-token']}>
        <ClientPortalNotFound />
      </MemoryRouter>,
    ));
    expect(screen.getByRole('main')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('heading')).toHaveTextContent('رابط التقرير غير متاح');
    await waitFor(() => {
      expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute(
        'content',
        'noindex, nofollow',
      );
    });
  });
});

describe('clientPortalLoader', () => {
  function args(
    path: string,
    token: string | undefined = 'token-value-that-is-long-enough-123456',
    context: unknown = undefined,
  ): LoaderFunctionArgs {
    return {
      request: new Request(`https://public.test${path}`),
      params: token ? { token } : {},
      context,
    };
  }

  it('fetches the allowlist DTO from same-origin in English', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(report()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await expect(clientPortalLoader(args('/portal/token'))).resolves.toEqual(report());
    expect(fetch).toHaveBeenCalledWith(
      'https://public.test/api/client-portal/token-value-that-is-long-enough-123456?locale=en',
      expect.objectContaining({ credentials: 'include' }),
    );
    const headers = vi.mocked(fetch).mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get('Accept')).toBe('application/json');
    expect(headers.get('x-lang')).toBe('en');
  });

  it('uses the SSR API origin and localized path', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(report()), { status: 200 }),
    );
    await clientPortalLoader(args(
      '/ar/portal/token',
      'token/value',
      { apiOrigin: 'http://api:8080' },
    ));
    expect(fetch).toHaveBeenCalledWith(
      'http://api:8080/api/client-portal/token%2Fvalue?locale=ar',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('maps missing tokens, revoked links, and upstream failures to opaque responses', async () => {
    await expect(clientPortalLoader(args('/portal/no-token', ''))).rejects.toMatchObject({ status: 404 });
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockRejectedValueOnce(new Error('offline'));
    await expect(clientPortalLoader(args('/portal/token'))).rejects.toMatchObject({ status: 404 });
    await expect(clientPortalLoader(args('/portal/token'))).rejects.toMatchObject({ status: 502 });
    await expect(clientPortalLoader(args('/portal/token'))).rejects.toMatchObject({ status: 502 });
  });

  it('maps malformed successful JSON to an upstream failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{bad', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    await expect(clientPortalLoader(args('/portal/token'))).rejects.toMatchObject({ status: 502 });
  });

  it('never places an upstream error object into SSR hydration errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          name: 'Function',
          message: 'constructor-shaped attacker payload',
          stack: 'must not be serialized',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    try {
      await clientPortalLoader(args('/portal/token'));
      throw new Error('expected loader to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
      expect((error as Response).status).toBe(502);
      expect(await (error as Response).text()).toBe('');
    }
  });
});
