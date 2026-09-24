import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { I18nextProvider } from 'react-i18next';
import { createMemoryRouter, RouterProvider, type LoaderFunctionArgs } from 'react-router-dom';
import { i18n, initI18n } from '@shared/i18n';
import type { PublicReport } from './types';

vi.mock('@shared/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/api/client')>();
  return {
    ...actual,
    apiContextHeaders: vi.fn(() => new Headers({ 'x-context': 'public-share' })),
  };
});

vi.mock('@shared/components/ThemeToggle', () => ({
  ThemeToggle: () => <button type="button">Theme</button>,
}));

import { apiContextHeaders, LANGUAGE_HEADER } from '@shared/api/client';
import { authenticatedReportExportRoutes, publicReportLoader, publicReportRoutes } from './routes';
import { PublicReportNotFound, PublicReportPage } from './components/PublicReportPage';

const mockedContextHeaders = vi.mocked(apiContextHeaders);

function loaderArgs(
  pathname: string,
  token: string | undefined,
  context?: { apiOrigin?: string },
): LoaderFunctionArgs {
  return {
    request: new Request(`https://rankme.test${pathname}`),
    params: token === undefined ? {} : { token },
    context,
  } as LoaderFunctionArgs;
}

function report(overrides: Partial<PublicReport> = {}): PublicReport {
  return {
    schemaVersion: 1,
    kindVersion: 2,
    kind: 'audit.run',
    locale: 'en',
    title: 'Immutable audit',
    subject: [{ label: 'Site', value: 'example.test' }],
    selection: [{ label: 'Pages', value: '42' }],
    sourceDates: [
      {
        id: 'observed',
        label: 'Crawler',
        kind: 'recorded',
        observedAt: '2026-08-01T12:00:00.000Z',
      },
      {
        id: 'window',
        label: 'Search Console',
        kind: 'provider',
        from: '2026-07-01T00:00:00.000Z',
        to: 'not-a-date',
      },
      {
        id: 'unknown-window',
        label: 'Unknown window',
        kind: 'manual',
      },
    ],
    completeness: {
      state: 'complete',
      selectedItems: 42,
      representedItems: 42,
      bound: 'all selected pages',
    },
    branding: {
      mode: 'white_label',
      companyName: 'Acme',
      accentColor: '#123abc',
      logo: {
        mediaType: 'image/png',
        bytesBase64: 'iVBORw0KGgo=',
        width: 64,
        height: 32,
      },
    },
    formats: ['view', 'pdf', 'csv'],
    blocks: [
      { type: 'heading', id: 'h2', level: 2, text: 'Overview' },
      { type: 'heading', level: 3, text: 'Details' },
      { type: 'prose', tone: 'neutral', text: 'Plain evidence, not HTML.' },
      {
        type: 'kpi_group',
        items: [
          { id: 'number', label: 'Score', value: { type: 'number', value: 12_345 }, unit: 'pts' },
          { label: 'Boolean true', value: { type: 'boolean', value: true } },
          { label: 'Boolean false', value: { type: 'boolean', value: false } },
          { label: 'Null', value: { type: 'null', value: null } },
          {
            label: 'Unavailable',
            value: { type: 'unavailable', value: null, reason: 'Provider paused' },
          },
          { label: 'Fallback unavailable', value: { type: 'unavailable', value: null } },
          { label: 'Date', value: { type: 'date', value: '2026-08-02T00:00:00.000Z' } },
          { label: 'Text', value: { type: 'string', value: 'literal <script>' } },
          { label: 'Missing text', value: { type: 'string', value: null } },
        ],
      },
      {
        type: 'key_value',
        items: [
          { label: 'Safe URL', value: { type: 'url', value: 'https://example.test/a?q=1' } },
          { label: 'Unsafe URL', value: { type: 'url', value: 'javascript:alert(1)' } },
        ],
      },
      {
        type: 'findings',
        items: [
          {
            id: 'finding',
            ruleKey: 'title',
            bucket: 'metadata',
            severity: 'high',
            title: 'Fix the title',
            why: 'The title is missing.',
            fix: 'Add one.',
            pass: 'A unique title exists.',
            affectedUrls: ['https://example.test/page', 'data:text/html,unsafe'],
            evidence: ['Recorded response'],
          },
          {
            ruleKey: 'description',
            bucket: 'metadata',
            severity: 'low',
            title: 'Description check',
            why: 'No additional details.',
            affectedUrls: [],
            evidence: [],
          },
        ],
      },
      {
        type: 'table',
        columns: [
          { key: 'page', label: 'Page' },
          { key: 'value', label: 'Value' },
        ],
        rows: [
          {
            id: 'row-one',
            cells: [
              { columnKey: 'page', value: { type: 'string', value: 'Home' } },
              { columnKey: 'value', value: { type: 'number', value: 10 } },
            ],
          },
          {
            cells: [
              { columnKey: 'page', value: { type: 'string', value: 'About' } },
              { columnKey: 'value', value: { type: 'number', value: 5 } },
            ],
          },
        ],
      },
      { type: 'table', columns: [{ key: 'empty', label: 'Empty' }], rows: [] },
      {
        type: 'time_series',
        series: [{ label: 'Visibility' }],
        tableFallback: {
          columns: [{ key: 'month', label: 'Month' }],
          rows: [{ cells: [{ columnKey: 'month', value: { type: 'string', value: 'August' } }] }],
        },
      },
      {
        type: 'source_note',
        methodology: 'Recorded provider fixture.',
        coverageWarning: 'Partial window.',
      },
      { type: 'source_note', methodology: 'Complete window.' },
      { type: 'state', state: 'unavailable', reason: 'No historical sample.' },
      { type: 'native_artifact', artifactId: 'opaque' },
    ],
    expiresAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderPublic(value: PublicReport, entry = '/share/token%2Fvalue') {
  const router = createMemoryRouter(
    [{ path: '/share/:token', element: <PublicReportPage />, loader: () => value }],
    { initialEntries: [entry] },
  );
  return render(
    <I18nextProvider i18n={i18n}>
      <HelmetProvider>
        <RouterProvider router={router} />
      </HelmetProvider>
    </I18nextProvider>,
  );
}

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await i18n.changeLanguage('en');
  mockedContextHeaders.mockClear();
  vi.restoreAllMocks();
});

describe('public report loader', () => {
  it('registers every localized route and the authenticated export center', async () => {
    expect(publicReportRoutes.map((item) => item.path)).toEqual([
      'share/:token',
      'ar/share/:token',
      'fr/share/:token',
      'de/share/:token',
      'es/share/:token',
      'ru/share/:token',
      'zh/share/:token',
    ]);
    expect(authenticatedReportExportRoutes).toHaveLength(1);
    expect(authenticatedReportExportRoutes[0]?.path).toBe('exports');
    const lazyResult = await authenticatedReportExportRoutes[0]?.lazy?.();
    expect(lazyResult).toHaveProperty('element');
  });

  it('uses the SSR API origin, encoded token, locale header, context headers, and request signal', async () => {
    const payload = report({ locale: 'fr' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ report: payload }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const args = loaderArgs('/fr/share/token', 'token/+', { apiOrigin: 'http://api:8080' });
    await expect(publicReportLoader(args)).resolves.toEqual(payload);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe('http://api:8080/api/report-shares/token%2F%2B');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const headers = init?.headers as Headers;
    expect(headers.get(LANGUAGE_HEADER)).toBe('fr');
    expect(headers.get('x-workspace-id')).toBeNull();
    expect(headers.get('accept')).toBe('application/json');
  });

  it.each(['/share/token', '/en/share/token', '/xx/share/token', '/'])(
    'falls back to English for %s',
    async (pathname) => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ report: report() }), { status: 200 }),
      );
      await publicReportLoader(loaderArgs(pathname, 'token'));
      const headers = vi.mocked(fetch).mock.calls[0]?.[1]?.headers as Headers;
      expect(headers.get(LANGUAGE_HEADER)).toBe('en');
    },
  );

  it('returns constant transport errors for missing, rejected, malformed, and failed responses', async () => {
    await expect(
      publicReportLoader(loaderArgs('/share/no-token', undefined)),
    ).rejects.toMatchObject({ status: 404 });

    vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response('{', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));

    await expect(publicReportLoader(loaderArgs('/share/token', 'network'))).rejects.toMatchObject({
      status: 502,
    });
    await expect(publicReportLoader(loaderArgs('/share/token', 'missing'))).rejects.toMatchObject({
      status: 404,
    });
    await expect(publicReportLoader(loaderArgs('/share/token', 'private'))).rejects.toMatchObject({
      status: 502,
    });
    await expect(publicReportLoader(loaderArgs('/share/token', 'malformed'))).rejects.toMatchObject(
      { status: 502 },
    );
    await expect(publicReportLoader(loaderArgs('/share/token', 'empty'))).rejects.toMatchObject({
      status: 502,
    });
  });
});

describe('public immutable report rendering', () => {
  it('renders every block using inert text, safe links, provenance, immutable downloads, and semantic fallbacks', async () => {
    const { container } = renderPublic(report());

    expect(await screen.findByRole('heading', { name: 'Immutable audit', level: 1 })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Overview', level: 2 })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Details', level: 3 })).toBeVisible();
    expect(screen.getByText('literal <script>')).toBeVisible();
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByText('12,345 pts')).toBeVisible();
    expect(screen.getByText('Provider paused')).toBeVisible();
    expect(screen.getAllByText('Unavailable')).toHaveLength(2);
    expect(screen.getByText('✓')).toBeVisible();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    for (const list of container.querySelectorAll('dl')) {
      for (const group of list.children) {
        expect(Array.from(group.children, (child) => child.tagName)).toEqual(['DT', 'DD']);
      }
    }

    const safe = screen.getByRole('link', { name: 'https://example.test/a?q=1' });
    expect(safe).toHaveAttribute('href', 'https://example.test/a?q=1');
    expect(safe).toHaveAttribute('rel', 'nofollow ugc noopener noreferrer');
    expect(screen.getByRole('link', { name: 'javascript:alert(1)' })).toHaveAttribute('href', '#');
    expect(screen.getByRole('link', { name: 'data:text/html,unsafe' })).toHaveAttribute(
      'href',
      '#',
    );

    expect(screen.getByText('Add one.')).toBeVisible();
    expect(screen.getByText('A unique title exists.')).toBeVisible();
    expect(screen.getAllByRole('table')).toHaveLength(2);
    expect(screen.getByText('No rows are available for this section.')).toBeVisible();
    expect(screen.getByText('Partial window.')).toBeVisible();
    expect(screen.getByText('Complete window.')).toBeVisible();
    expect(screen.getByText('No historical sample.')).toBeVisible();
    expect(screen.getByText(/Observed Aug 1, 2026/)).toBeVisible();
    expect(screen.getByText(/not-a-date/)).toBeVisible();

    expect(screen.getByRole('link', { name: 'Download PDF' })).toHaveAttribute(
      'href',
      '/api/report-shares/token%2Fvalue/files/pdf',
    );
    expect(screen.getByRole('link', { name: 'Download CSV' })).toHaveAttribute(
      'href',
      '/api/report-shares/token%2Fvalue/files/csv',
    );
    expect(screen.getByRole('region', { name: 'Report scope' })).toBeVisible();
    const logo = container.querySelector('img');
    expect(logo).toHaveAttribute('alt', '');
    expect(logo).toHaveAttribute('src', 'data:image/png;base64,iVBORw0KGgo=');
    expect(container.querySelector('header')).toHaveStyle({ borderTopColor: '#123abc' });
    await waitFor(() => expect(document.title).toContain('Immutable audit'));
  });

  it('renders Arabic RTL without unsafe branding or ungranted downloads', async () => {
    const rtlReport = report({
      locale: 'ar',
      title: 'تقرير ثابت',
      branding: {
        mode: 'rankmefast',
        companyName: 'RankMeFast',
        accentColor: 'red; background:url(javascript:1)',
        logo: null,
      },
      formats: ['view'],
      sourceDates: [],
      blocks: [],
    });
    const { container } = renderPublic(rtlReport, '/share/arabic');
    const heading = await screen.findByRole('heading', { name: 'تقرير ثابت' });
    expect(heading.closest('[dir="rtl"]')).not.toBeNull();
    expect(container.querySelector('header')).not.toHaveAttribute('style');
    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByRole('link', { name: /Download/ })).toBeNull();
    await waitFor(() => expect(i18n.language).toBe('ar'));
  });

  it('provides a constant, accessible not-found surface', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <PublicReportNotFound />
      </I18nextProvider>,
    );
    const alert = screen.getByRole('alert');
    expect(
      within(alert).getByRole('heading', { name: 'This report link is unavailable' }),
    ).toBeVisible();
    expect(within(alert).getByText(/expired, been revoked/)).toBeVisible();
  });

  it.each(['ExportCenterPage', 'PublicReportPage', 'ReportExportControl', 'ReportShareDialog'])(
    '%s keeps directional styling logical for RTL',
    async (component) => {
      const source = (await import(`./components/${component}.tsx?raw`)) as { default: string };
      expect(source.default).not.toMatch(/\btext-(?:left|right)\b/u);
      expect(source.default).not.toMatch(/(?:^|["' \t]|:)[mp][lr]-\d/u);
      expect(source.default).not.toMatch(/(?:^|["' \t]|:)(?:left|right)-\d/u);
    },
  );
});
