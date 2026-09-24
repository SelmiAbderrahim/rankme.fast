/**
 * GoogleSearchDetailPanel tests — the `?view=` drill-in layer: all four
 * Search Analytics dimensions, client-side filter/sort/windowing, the
 * sitemaps table with status chips, 404 → empty, error → retry, and the
 * back link's URL round-trip.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { ApiError } from '@shared/api/client';
import * as api from '../api';
import { googleReducer } from '../store/slice';
import { GoogleSearchDetailPanel } from './GoogleSearchDetailPanel';
import type { GoogleSearchView } from '../lib/searchView';
import type {
  GoogleConnectionState,
  GscDetailSectionState,
  GscSearchAnalyticsRow,
  GscSearchDimension,
  GscSitemap,
} from '../types';

vi.mock('../api', () => ({
  getConnection: vi.fn(),
  completeConnection: vi.fn(),
  setConnectionProperty: vi.fn(),
  disconnectConnection: vi.fn(),
  fetchSearchSummary: vi.fn(),
  refreshSearchSummary: vi.fn(),
  fetchSearchAnalyticsDetail: vi.fn(),
  fetchSitemaps: vi.fn(),
}));

const mockedApi = vi.mocked(api);

const row = (
  key: string,
  clicks: number,
  impressions: number,
  ctr: number,
  position: number,
): GscSearchAnalyticsRow => ({ key, clicks, impressions, ctr, position });

const makeRows = (n: number): GscSearchAnalyticsRow[] =>
  Array.from({ length: n }, (_, i) =>
    row(`kw-${String(i).padStart(3, '0')}`, 1000 - i, 10000 - i, 0.4, 1 + i * 0.1),
  );

const sitemap = (patch: Partial<GscSitemap> = {}): GscSitemap => ({
  path: 'https://example.com/sitemap.xml',
  type: 'sitemap',
  lastSubmitted: '2026-07-01T00:00:00.000Z',
  lastDownloaded: '2026-07-02T00:00:00.000Z',
  isPending: false,
  isSitemapsIndex: false,
  errors: 0,
  warnings: 0,
  processed: 1200,
  ...patch,
});

const baseState = (): GoogleConnectionState =>
  googleReducer(undefined, { type: '@@init' });

const withDetailSection = (
  dimension: GscSearchDimension,
  patch: Partial<GscDetailSectionState>,
  siteId = 'site-1',
): Partial<GoogleConnectionState> => {
  const base = baseState();
  return {
    detailSiteId: siteId,
    // Preloaded sections belong to the default window — matches the URL.
    detailRange: '28d',
    detail: {
      ...base.detail,
      [dimension]: { ...base.detail[dimension], ...patch },
    },
  };
};

const makeStore = (preloaded?: Partial<GoogleConnectionState>) =>
  configureStore({
    reducer: { google: googleReducer },
    preloadedState: { google: { ...baseState(), ...preloaded } },
  });

type GStore = ReturnType<typeof makeStore>;

let capturedSearch = '';

const LocationProbe = () => {
  const location = useLocation();
  capturedSearch = location.search;
  return null;
};

const renderPanel = (
  view: GoogleSearchView,
  store: GStore = makeStore(),
  siteId = 'site-1',
) => {
  render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[`/sites/${siteId}?tab=google&view=${view}`]}>
          <LocationProbe />
          <GoogleSearchDetailPanel view={view} siteId={siteId} />
        </MemoryRouter>
      </I18nextProvider>
    </Provider>,
  );
  return store;
};

const firstCells = (): string[] =>
  screen
    .getAllByTestId('google-detail-row')
    .map((tr) => tr.querySelector('td')?.textContent ?? '');

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  vi.clearAllMocks();
});

describe('GoogleSearchDetailPanel — analytics views', () => {
  it('queries view fetches the query dimension and renders rows clicks-DESC', async () => {
    mockedApi.fetchSearchAnalyticsDetail.mockResolvedValue({
      detail: {
        asOf: '2026-07-04',
        rows: [
          row('mid keyword', 50, 20, 0.2, 1),
          row('top keyword', 100, 10, 0.5, 9),
          row('low keyword', 25, 30, 0.9, 5),
        ],
      },
    });
    renderPanel('queries');
    expect(await screen.findByText('top keyword')).toBeInTheDocument();
    expect(mockedApi.fetchSearchAnalyticsDetail).toHaveBeenCalledWith(
      'site-1',
      'query',
      '28d',
    );
    // Heading per view.
    expect(
      screen.getByRole('heading', { name: 'Top searches' }),
    ).toBeInTheDocument();
    // Default sort: clicks descending + aria-sort on the clicks header.
    expect(firstCells()).toEqual(['top keyword', 'mid keyword', 'low keyword']);
    expect(
      screen.getByTestId('google-detail-sort-clicks').closest('th'),
    ).toHaveAttribute('aria-sort', 'descending');
    // asOf line + LTR-pinned numerics.
    expect(screen.getByText(/Data through/)).toBeInTheDocument();
    const firstRow = screen.getAllByTestId('google-detail-row')[0]!;
    const numericCells = within(firstRow).getAllByText('100');
    expect(numericCells[0]!.closest('td')).toHaveAttribute('dir', 'ltr');
    expect(within(firstRow).getByTestId('google-content-analysis-cta')).toHaveAttribute(
      'href',
      '/sites/site-1?tab=content&view=analyses&prefillKeyword=top+keyword&source=gsc',
    );
  });

  it('pages view fetches the page dimension and renders raw URLs', async () => {
    mockedApi.fetchSearchAnalyticsDetail.mockResolvedValue({
      detail: {
        asOf: '2026-07-04',
        rows: [row('https://example.com/pricing', 10, 100, 0.1, 2)],
      },
    });
    renderPanel('pages');
    expect(
      await screen.findByText('https://example.com/pricing'),
    ).toBeInTheDocument();
    expect(mockedApi.fetchSearchAnalyticsDetail).toHaveBeenCalledWith(
      'site-1',
      'page',
      '28d',
    );
    expect(screen.getByRole('heading', { name: 'Top pages' })).toBeInTheDocument();
    expect(screen.getByTestId('google-content-analysis-cta')).toHaveAttribute(
      'href',
      '/sites/site-1?tab=content&view=analyses&prefillUrl=https%3A%2F%2Fexample.com%2Fpricing&source=gsc',
    );
  });

  it('countries view uppercases the ISO codes like the summary card', async () => {
    mockedApi.fetchSearchAnalyticsDetail.mockResolvedValue({
      detail: {
        asOf: '2026-07-04',
        rows: [row('usa', 70, 700, 0.1, 3), row('fra', 20, 400, 0.05, 4)],
      },
    });
    renderPanel('countries');
    expect(await screen.findByText('USA')).toBeInTheDocument();
    expect(screen.getByText('FRA')).toBeInTheDocument();
    expect(mockedApi.fetchSearchAnalyticsDetail).toHaveBeenCalledWith(
      'site-1',
      'country',
      '28d',
    );
  });

  it('devices view localizes known devices and falls back to Other', async () => {
    mockedApi.fetchSearchAnalyticsDetail.mockResolvedValue({
      detail: {
        asOf: '2026-07-04',
        rows: [row('DESKTOP', 65, 650, 0.1, 3), row('SMART_TV', 15, 150, 0.1, 3)],
      },
    });
    renderPanel('devices');
    expect(await screen.findByText('Desktop')).toBeInTheDocument();
    expect(screen.getByText('Other')).toBeInTheDocument();
    expect(mockedApi.fetchSearchAnalyticsDetail).toHaveBeenCalledWith(
      'site-1',
      'device',
      '28d',
    );
  });

  it('reads ?range= from the URL and fetches that window', async () => {
    mockedApi.fetchSearchAnalyticsDetail.mockResolvedValue({
      detail: { asOf: '2026-07-04', rows: [row('kw', 1, 10, 0.1, 1)] },
    });
    render(
      <Provider store={makeStore()}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter
            initialEntries={['/sites/site-1?tab=google&view=queries&range=90d']}
          >
            <GoogleSearchDetailPanel view="queries" siteId="site-1" />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    expect(await screen.findByText('kw')).toBeInTheDocument();
    expect(mockedApi.fetchSearchAnalyticsDetail).toHaveBeenCalledWith(
      'site-1',
      'query',
      '90d',
    );
  });

  it('the search input filters rows case-insensitively and shows a no-matches state', async () => {
    mockedApi.fetchSearchAnalyticsDetail.mockResolvedValue({
      detail: {
        asOf: '2026-07-04',
        rows: [
          row('alpha keyword', 30, 300, 0.1, 1),
          row('beta keyword', 20, 200, 0.1, 2),
          row('ALPHA second', 10, 100, 0.1, 3),
        ],
      },
    });
    const user = userEvent.setup();
    renderPanel('queries');
    expect(await screen.findByText('alpha keyword')).toBeInTheDocument();
    expect(screen.getAllByTestId('google-detail-row')).toHaveLength(3);

    const input = screen.getByTestId('google-detail-filter');
    expect(input).toHaveAccessibleName('Filter rows');
    await user.type(input, 'alpha');
    expect(screen.getAllByTestId('google-detail-row')).toHaveLength(2);
    expect(screen.queryByText('beta keyword')).not.toBeInTheDocument();

    await user.clear(input);
    await user.type(input, 'zzz');
    expect(screen.getByTestId('google-detail-no-matches')).toHaveTextContent(
      'No rows match your filter.',
    );
    expect(screen.queryAllByTestId('google-detail-row')).toHaveLength(0);

    await user.clear(input);
    expect(screen.getAllByTestId('google-detail-row')).toHaveLength(3);
  });

  it('clicking a numeric header toggles the sort and moves aria-sort', async () => {
    mockedApi.fetchSearchAnalyticsDetail.mockResolvedValue({
      detail: {
        asOf: '2026-07-04',
        rows: [
          row('a', 100, 10, 0.5, 9),
          row('b', 50, 20, 0.2, 1),
          row('c', 75, 30, 0.9, 5),
        ],
      },
    });
    const user = userEvent.setup();
    renderPanel('queries');
    expect(await screen.findByText('a')).toBeInTheDocument();
    expect(firstCells()).toEqual(['a', 'c', 'b']);

    // Same column → flips to ascending.
    await user.click(screen.getByTestId('google-detail-sort-clicks'));
    expect(firstCells()).toEqual(['b', 'c', 'a']);
    expect(
      screen.getByTestId('google-detail-sort-clicks').closest('th'),
    ).toHaveAttribute('aria-sort', 'ascending');

    // And back to descending.
    await user.click(screen.getByTestId('google-detail-sort-clicks'));
    expect(firstCells()).toEqual(['a', 'c', 'b']);
    expect(
      screen.getByTestId('google-detail-sort-clicks').closest('th'),
    ).toHaveAttribute('aria-sort', 'descending');

    // A different column starts descending on that column.
    await user.click(screen.getByTestId('google-detail-sort-position'));
    expect(firstCells()).toEqual(['a', 'c', 'b']);
    expect(
      screen.getByTestId('google-detail-sort-position').closest('th'),
    ).toHaveAttribute('aria-sort', 'descending');
    expect(
      screen.getByTestId('google-detail-sort-clicks').closest('th'),
    ).not.toHaveAttribute('aria-sort');

    // Switching to impressions starts descending on that column too.
    await user.click(screen.getByTestId('google-detail-sort-impressions'));
    expect(firstCells()).toEqual(['c', 'b', 'a']);
  });

  it('renders the first 50 rows and "Load more" appends 50 locally', async () => {
    mockedApi.fetchSearchAnalyticsDetail.mockResolvedValue({
      detail: { asOf: '2026-07-04', rows: makeRows(120) },
    });
    const user = userEvent.setup();
    renderPanel('queries');
    expect(await screen.findByText('kw-000')).toBeInTheDocument();
    expect(screen.getAllByTestId('google-detail-row')).toHaveLength(50);

    await user.click(screen.getByTestId('google-detail-load-more'));
    expect(screen.getAllByTestId('google-detail-row')).toHaveLength(100);

    await user.click(screen.getByTestId('google-detail-load-more'));
    expect(screen.getAllByTestId('google-detail-row')).toHaveLength(120);
    expect(screen.queryByTestId('google-detail-load-more')).not.toBeInTheDocument();
    // Purely local windowing — one fetch total.
    expect(mockedApi.fetchSearchAnalyticsDetail).toHaveBeenCalledTimes(1);
  });

  it('renders the summary empty-state copy on a 404 (no data yet)', async () => {
    mockedApi.fetchSearchAnalyticsDetail.mockRejectedValue(
      new ApiError('no data', 404, null),
    );
    renderPanel('queries');
    expect(await screen.findByTestId('google-detail-empty')).toHaveTextContent(
      /No search data yet/,
    );
  });

  it('renders the error state with a working retry button', async () => {
    mockedApi.fetchSearchAnalyticsDetail.mockRejectedValueOnce(
      new ApiError('boom', 500, null),
    );
    mockedApi.fetchSearchAnalyticsDetail.mockResolvedValueOnce({
      detail: { asOf: '2026-07-04', rows: [row('recovered', 5, 50, 0.1, 1)] },
    });
    const user = userEvent.setup();
    renderPanel('queries');
    const alert = await screen.findByTestId('google-detail-error');
    expect(alert).toHaveAttribute('role', 'alert');
    await user.click(screen.getByTestId('google-detail-retry'));
    expect(await screen.findByText('recovered')).toBeInTheDocument();
    expect(mockedApi.fetchSearchAnalyticsDetail).toHaveBeenCalledTimes(2);
  });

  it('shows the skeleton and skips the fetch while one is already in flight', () => {
    renderPanel('queries', makeStore(withDetailSection('query', { loading: true })));
    expect(screen.getByTestId('google-detail-skeleton')).toBeInTheDocument();
    expect(mockedApi.fetchSearchAnalyticsDetail).not.toHaveBeenCalled();
  });

  it('does not refetch when this site is already loaded (and hides a null asOf)', () => {
    renderPanel(
      'queries',
      makeStore(
        withDetailSection('query', {
          loaded: true,
          asOf: null,
          rows: [row('cached keyword', 9, 90, 0.1, 1)],
        }),
      ),
    );
    expect(screen.getByText('cached keyword')).toBeInTheDocument();
    expect(screen.queryByText(/Data through/)).not.toBeInTheDocument();
    expect(mockedApi.fetchSearchAnalyticsDetail).not.toHaveBeenCalled();
  });

  it('refetches when the loaded detail belongs to another site', async () => {
    mockedApi.fetchSearchAnalyticsDetail.mockResolvedValue({
      detail: { asOf: '2026-07-04', rows: [row('fresh', 4, 40, 0.1, 1)] },
    });
    renderPanel(
      'queries',
      makeStore(
        withDetailSection(
          'query',
          { loaded: true, rows: [row('stale', 1, 10, 0.1, 1)] },
          'other-site',
        ),
      ),
    );
    await waitFor(() =>
      expect(mockedApi.fetchSearchAnalyticsDetail).toHaveBeenCalledWith(
        'site-1',
        'query',
        '28d',
      ),
    );
    expect(await screen.findByText('fresh')).toBeInTheDocument();
  });

  it('the back link clears ?view= and keeps ?tab=google', async () => {
    mockedApi.fetchSearchAnalyticsDetail.mockResolvedValue({
      detail: { asOf: '2026-07-04', rows: [row('kw', 1, 10, 0.1, 1)] },
    });
    const user = userEvent.setup();
    renderPanel('queries');
    expect(await screen.findByText('kw')).toBeInTheDocument();
    expect(capturedSearch).toBe('?tab=google&view=queries');
    await user.click(screen.getByTestId('google-detail-back'));
    await waitFor(() => expect(capturedSearch).toBe('?tab=google'));
  });
});

describe('GoogleSearchDetailPanel — sitemaps view', () => {
  it('renders the sitemaps table with dates, processed counts and status chips', async () => {
    mockedApi.fetchSitemaps.mockResolvedValue({
      asOf: '2026-07-04',
      sitemaps: [
        sitemap({ path: 'https://example.com/ok.xml' }),
        sitemap({
          path: 'https://example.com/warn.xml',
          warnings: 2,
          lastSubmitted: null,
        }),
        sitemap({
          path: 'https://example.com/bad.xml',
          type: 'sitemapsIndex',
          errors: 3,
          warnings: 9,
        }),
      ],
    });
    renderPanel('sitemaps');
    expect(await screen.findByText('https://example.com/ok.xml')).toBeInTheDocument();
    expect(mockedApi.fetchSitemaps).toHaveBeenCalledWith('site-1');
    expect(screen.getByRole('heading', { name: 'Sitemaps' })).toBeInTheDocument();
    expect(screen.getByText(/Data through/)).toBeInTheDocument();
    expect(screen.getAllByTestId('google-sitemaps-row')).toHaveLength(3);

    const statuses = screen.getAllByTestId('google-sitemaps-status');
    expect(statuses[0]).toHaveTextContent('OK');
    expect(statuses[0]!.className).toContain('text-success');
    expect(statuses[1]).toHaveTextContent('2 warnings');
    expect(statuses[1]!.className).toContain('text-warning');
    // Errors win over warnings.
    expect(statuses[2]).toHaveTextContent('3 errors');
    expect(statuses[2]!.className).toContain('text-destructive');

    // Null lastSubmitted renders an em dash; the others a localized date.
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getAllByText('Jul 1, 2026').length).toBeGreaterThan(0);
    // Processed count formatted per locale.
    expect(screen.getAllByText('1,200').length).toBe(3);
    // Type column shows the raw type string.
    expect(screen.getByText('sitemapsIndex')).toBeInTheDocument();
  });

  it('a 200 with an empty array renders the localized no-sitemaps copy', async () => {
    mockedApi.fetchSitemaps.mockResolvedValue({ asOf: null, sitemaps: [] });
    renderPanel('sitemaps');
    expect(await screen.findByTestId('google-sitemaps-empty')).toHaveTextContent(
      'No sitemaps submitted yet.',
    );
  });

  it('maps a 404 to the same empty state', async () => {
    mockedApi.fetchSitemaps.mockRejectedValue(new ApiError('no data', 404, null));
    renderPanel('sitemaps');
    expect(await screen.findByTestId('google-sitemaps-empty')).toBeInTheDocument();
  });

  it('hides the asOf line when the snapshot date is null', async () => {
    mockedApi.fetchSitemaps.mockResolvedValue({
      asOf: null,
      sitemaps: [sitemap()],
    });
    renderPanel('sitemaps');
    expect(
      await screen.findByText('https://example.com/sitemap.xml'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Data through/)).not.toBeInTheDocument();
  });

  it('renders the error state with a working retry button', async () => {
    mockedApi.fetchSitemaps.mockRejectedValueOnce(new ApiError('boom', 500, null));
    mockedApi.fetchSitemaps.mockResolvedValueOnce({
      asOf: '2026-07-04',
      sitemaps: [sitemap()],
    });
    const user = userEvent.setup();
    renderPanel('sitemaps');
    const alert = await screen.findByTestId('google-sitemaps-error');
    expect(alert).toHaveAttribute('role', 'alert');
    await user.click(screen.getByTestId('google-sitemaps-retry'));
    expect(
      await screen.findByText('https://example.com/sitemap.xml'),
    ).toBeInTheDocument();
    expect(mockedApi.fetchSitemaps).toHaveBeenCalledTimes(2);
  });

  it('shows the skeleton and skips the fetch while one is already in flight', () => {
    const base = baseState();
    renderPanel(
      'sitemaps',
      makeStore({
        sitemapsSiteId: 'site-1',
        sitemaps: { ...base.sitemaps, loading: true },
      }),
    );
    expect(screen.getByTestId('google-sitemaps-skeleton')).toBeInTheDocument();
    expect(mockedApi.fetchSitemaps).not.toHaveBeenCalled();
  });

  it('does not refetch when this site is already loaded', () => {
    const base = baseState();
    renderPanel(
      'sitemaps',
      makeStore({
        sitemapsSiteId: 'site-1',
        sitemaps: { ...base.sitemaps, loaded: true, items: [sitemap()] },
      }),
    );
    expect(screen.getByText('https://example.com/sitemap.xml')).toBeInTheDocument();
    expect(mockedApi.fetchSitemaps).not.toHaveBeenCalled();
  });

  it('refetches when the loaded sitemaps belong to another site', async () => {
    const base = baseState();
    mockedApi.fetchSitemaps.mockResolvedValue({
      asOf: '2026-07-04',
      sitemaps: [sitemap({ path: 'https://example.com/fresh.xml' })],
    });
    renderPanel(
      'sitemaps',
      makeStore({
        sitemapsSiteId: 'other-site',
        sitemaps: { ...base.sitemaps, loaded: true, items: [sitemap()] },
      }),
    );
    await waitFor(() =>
      expect(mockedApi.fetchSitemaps).toHaveBeenCalledWith('site-1'),
    );
    expect(
      await screen.findByText('https://example.com/fresh.xml'),
    ).toBeInTheDocument();
  });
});
