/**
 * GoogleSearchSummaryCard tests — populated / empty (404) /
 * error / retry / not-connected / RTL states + the `?view=` drill-in links.
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
import { GoogleSearchSummaryCard } from './GoogleSearchSummaryCard';
import type {
  GoogleConnection,
  GoogleConnectionState,
  GoogleSearchSummary,
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
  fetchAnalyticsSummary: vi.fn(),
  refreshAnalyticsSummary: vi.fn(),
  fetchAnalyticsDetail: vi.fn(),
  fetchAnalyticsProperties: vi.fn(),
}));

const mockedApi = vi.mocked(api);

const connected: GoogleConnection = {
  status: 'connected',
  googleAccountEmail: 'jane@example.com',
  propertyUrl: 'https://example.com/',
  connectedAt: '2026-06-01T00:00:00.000Z',
  lastUsedAt: '2026-06-15T00:00:00.000Z',
};

const summary: GoogleSearchSummary = {
  totalClicks: 1234,
  totalImpressions: 56789,
  averageCtr: 0.0217,
  averagePosition: 6.4,
  topQueries: [
    { query: 'seo audit tool', clicks: 60, impressions: 6000, ctr: 0.01, position: 4.1 },
    { query: 'rank tracker', clicks: 50, impressions: 5000, ctr: 0.01, position: 5.1 },
    { query: 'site health', clicks: 40, impressions: 4000, ctr: 0.01, position: 6.1 },
    { query: 'q4-truncated', clicks: 30, impressions: 3000, ctr: 0.01, position: 7.1 },
  ],
  topPages: [
    {
      url: 'https://example.com/',
      clicks: 90,
      impressions: 9000,
      ctr: 0.01,
      position: 3.2,
    },
  ],
  asOf: '2026-07-04',
  previousPeriod: { totalClicks: 1000, totalImpressions: 50000 },
  timeseries: [
    { date: '2026-06-08', clicks: 5, impressions: 111, ctr: 0.045, position: 8.2 },
    { date: '2026-06-09', clicks: 8, impressions: 222, ctr: 0.036, position: 9.3 },
  ],
  countries: [
    { country: 'usa', clicks: 70, impressions: 700, ctr: 0.1, position: 3 },
    { country: 'fra', clicks: 20, impressions: 400, ctr: 0.05, position: 4 },
  ],
  devices: [
    { device: 'DESKTOP', clicks: 65, impressions: 650, ctr: 0.1, position: 3 },
    { device: 'SMART_TV', clicks: 15, impressions: 150, ctr: 0.1, position: 3 },
  ],
};

const baseState = (): GoogleConnectionState =>
  googleReducer(undefined, { type: '@@init' });

const makeStore = (preloaded?: Partial<GoogleConnectionState>) =>
  configureStore({
    reducer: { google: googleReducer },
    preloadedState: {
      google: { ...baseState(), connectionSiteId: 'site-1', ...preloaded },
    },
  });

type GStore = ReturnType<typeof makeStore>;

let capturedSearch = '';

const LocationProbe = () => {
  const location = useLocation();
  capturedSearch = location.search;
  return null;
};

const renderWith = (
  store: GStore,
  siteId = 'site-1',
  initialEntry = '/sites/site-1?tab=google',
) => {
  render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <LocationProbe />
          <GoogleSearchSummaryCard siteId={siteId} />
        </MemoryRouter>
      </I18nextProvider>
    </Provider>,
  );
  return store;
};

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  vi.clearAllMocks();
});

describe('GoogleSearchSummaryCard', () => {
  it('renders nothing when there is no connected Google account', () => {
    renderWith(makeStore({ connection: null }));
    expect(
      screen.queryByTestId('google-search-summary-card'),
    ).not.toBeInTheDocument();
    expect(mockedApi.fetchSearchSummary).not.toHaveBeenCalled();
  });

  it('renders nothing for a needs_reconnect connection', () => {
    renderWith(
      makeStore({ connection: { ...connected, status: 'needs_reconnect' } }),
    );
    expect(
      screen.queryByTestId('google-search-summary-card'),
    ).not.toBeInTheDocument();
  });

  it('fetches and renders the populated summary (tiles + all queries + pages + report link)', async () => {
    mockedApi.fetchSearchSummary.mockResolvedValue({ summary });
    renderWith(makeStore({ connection: connected }));
    expect(await screen.findByText('1,234')).toBeInTheDocument();
    expect(mockedApi.fetchSearchSummary).toHaveBeenCalledWith('site-1', '28d');
    expect(screen.getByText('56,789')).toBeInTheDocument();
    expect(screen.getByText('2.2%')).toBeInTheDocument();
    expect(screen.getByText('6.4')).toBeInTheDocument();
    // ALL top queries render (no top-3 truncation any more).
    expect(screen.getByText('seo audit tool')).toBeInTheDocument();
    expect(screen.getByText('site health')).toBeInTheDocument();
    expect(screen.getByText('q4-truncated')).toBeInTheDocument();
    // The parallel top-pages list.
    const pages = screen.getByTestId('google-summary-top-pages');
    expect(within(pages).getByText('https://example.com/')).toBeInTheDocument();
    // Previous-period line + asOf date.
    expect(screen.getByTestId('google-summary-previous')).toHaveTextContent('1,000');
    expect(screen.getByText(/Data through/)).toBeInTheDocument();
    // Full-report link — report lives in the unified workspace tab.
    expect(screen.getByTestId('google-summary-report-link')).toHaveAttribute(
      'href',
      '/sites/site-1?tab=report',
    );
  });

  it('renders a quiet "View all" link per section and a sitemaps link', async () => {
    mockedApi.fetchSearchSummary.mockResolvedValue({ summary });
    renderWith(makeStore({ connection: connected }));
    expect(await screen.findByText('1,234')).toBeInTheDocument();
    for (const view of ['queries', 'pages', 'countries', 'devices', 'sitemaps']) {
      expect(screen.getByTestId(`google-summary-view-${view}`)).toBeInTheDocument();
    }
    // Each link carries a differentiated accessible name.
    expect(screen.getByTestId('google-summary-view-queries')).toHaveAttribute(
      'aria-label',
      'View all — Top searches',
    );
    expect(screen.getByTestId('google-summary-view-sitemaps')).toHaveTextContent(
      'View sitemaps',
    );
  });

  it('clicking "View all" writes ?view= while preserving ?tab=google', async () => {
    mockedApi.fetchSearchSummary.mockResolvedValue({ summary });
    const user = userEvent.setup();
    renderWith(makeStore({ connection: connected }));
    expect(await screen.findByText('1,234')).toBeInTheDocument();
    await user.click(screen.getByTestId('google-summary-view-queries'));
    await waitFor(() => expect(capturedSearch).toBe('?tab=google&view=queries'));
  });

  it('the sitemaps link sets ?view=sitemaps', async () => {
    mockedApi.fetchSearchSummary.mockResolvedValue({ summary });
    const user = userEvent.setup();
    renderWith(makeStore({ connection: connected }));
    expect(await screen.findByText('1,234')).toBeInTheDocument();
    await user.click(screen.getByTestId('google-summary-view-sitemaps'));
    await waitFor(() => expect(capturedSearch).toBe('?tab=google&view=sitemaps'));
  });

  it('renders the empty state on a 404 (no snapshot yet)', async () => {
    mockedApi.fetchSearchSummary.mockRejectedValue(
      new ApiError('No search data yet.', 404, null),
    );
    renderWith(makeStore({ connection: connected }));
    expect(await screen.findByTestId('google-summary-empty')).toHaveTextContent(
      /No search data yet/,
    );
  });

  it('renders the error state with a working retry button', async () => {
    mockedApi.fetchSearchSummary.mockRejectedValueOnce(
      new ApiError('boom', 500, null),
    );
    mockedApi.fetchSearchSummary.mockResolvedValueOnce({ summary });
    const user = userEvent.setup();
    renderWith(makeStore({ connection: connected }));
    const alert = await screen.findByTestId('google-summary-error');
    expect(alert).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Try again/ }));
    expect(await screen.findByText('1,234')).toBeInTheDocument();
    expect(mockedApi.fetchSearchSummary).toHaveBeenCalledTimes(2);
  });

  it('does not fire a second fetch while one is already in flight', () => {
    renderWith(makeStore({ connection: connected, summaryLoading: true }));
    expect(mockedApi.fetchSearchSummary).not.toHaveBeenCalled();
    expect(screen.getByTestId('google-summary-skeleton')).toBeInTheDocument();
  });

  it('does not refetch when the summary for this site + range is already loaded', async () => {
    renderWith(
      makeStore({
        connection: connected,
        summary,
        summarySiteId: 'site-1',
        summaryRange: '28d',
        summaryLoaded: true,
      }),
    );
    expect(await screen.findByText('1,234')).toBeInTheDocument();
    expect(mockedApi.fetchSearchSummary).not.toHaveBeenCalled();
  });

  it('refetches when the loaded summary belongs to another site', async () => {
    mockedApi.fetchSearchSummary.mockResolvedValue({ summary });
    renderWith(
      makeStore({
        connection: connected,
        summary,
        summarySiteId: 'other-site',
        summaryRange: '28d',
        summaryLoaded: true,
      }),
    );
    await waitFor(() =>
      expect(mockedApi.fetchSearchSummary).toHaveBeenCalledWith('site-1', '28d'),
    );
  });

  it('refetches when the loaded summary belongs to another range', async () => {
    mockedApi.fetchSearchSummary.mockResolvedValue({ summary });
    renderWith(
      makeStore({
        connection: connected,
        summary,
        summarySiteId: 'site-1',
        summaryRange: '7d',
        summaryLoaded: true,
      }),
    );
    await waitFor(() =>
      expect(mockedApi.fetchSearchSummary).toHaveBeenCalledWith('site-1', '28d'),
    );
  });

  it('hides the previous-period line and the empty lists on a first run', async () => {
    mockedApi.fetchSearchSummary.mockResolvedValue({
      summary: { ...summary, previousPeriod: null, topQueries: [], topPages: [] },
    });
    renderWith(makeStore({ connection: connected }));
    expect(await screen.findByText('1,234')).toBeInTheDocument();
    expect(screen.queryByTestId('google-summary-previous')).not.toBeInTheDocument();
    expect(screen.queryByTestId('google-summary-top-queries')).not.toBeInTheDocument();
    expect(screen.queryByTestId('google-summary-top-pages')).not.toBeInTheDocument();
    // No list → no per-list "View all" link either.
    expect(screen.queryByTestId('google-summary-view-queries')).not.toBeInTheDocument();
    expect(screen.queryByTestId('google-summary-view-pages')).not.toBeInTheDocument();
  });

  it('renders under Arabic locale (RTL) with LTR-pinned numerics', async () => {
    await changeLanguage('ar');
    mockedApi.fetchSearchSummary.mockResolvedValue({ summary });
    renderWith(makeStore({ connection: connected }));
    expect(await screen.findByTestId('google-search-summary-card')).toBeInTheDocument();
    const clicksTile = screen.getByTestId('google-summary-clicks');
    expect(clicksTile.querySelector('dd')?.getAttribute('dir')).toBe('ltr');
    await changeLanguage('en');
  });

  it('renders the time-series chart and the country / device breakdowns', async () => {
    mockedApi.fetchSearchSummary.mockResolvedValue({ summary });
    renderWith(makeStore({ connection: connected }));
    expect(await screen.findByText('1,234')).toBeInTheDocument();
    // Time-series chart (the only role=img on the card).
    expect(screen.getByRole('img')).toBeInTheDocument();
    // Countries: lowercase ISO-3166 alpha-3 uppercased for display.
    const countries = screen.getByTestId('google-summary-countries');
    expect(within(countries).getByText('USA')).toBeInTheDocument();
    expect(within(countries).getByText('FRA')).toBeInTheDocument();
    // Devices: localized known label + unknown code → "Other".
    const devices = screen.getByTestId('google-summary-devices');
    expect(within(devices).getByText('Desktop')).toBeInTheDocument();
    expect(within(devices).getByText('Other')).toBeInTheDocument();
  });

  it('shows each section empty label when the new arrays are absent (tiles still render)', async () => {
    const bare: GoogleSearchSummary = {
      ...summary,
      timeseries: undefined,
      countries: undefined,
      devices: undefined,
    };
    mockedApi.fetchSearchSummary.mockResolvedValue({ summary: bare });
    renderWith(makeStore({ connection: connected }));
    expect(await screen.findByText('1,234')).toBeInTheDocument();
    expect(screen.getByTestId('gsc-timeseries-empty')).toHaveTextContent(
      'No daily data yet.',
    );
    expect(screen.getByTestId('google-summary-countries-empty')).toHaveTextContent(
      'No country data yet.',
    );
    expect(screen.getByTestId('google-summary-devices-empty')).toHaveTextContent(
      'No device data yet.',
    );
  });

  it('refresh shows the shared spinner, re-reads through the ranged GET, and announces success', async () => {
    const user = userEvent.setup();
    let release!: (value: { summary: GoogleSearchSummary }) => void;
    mockedApi.refreshSearchSummary.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    mockedApi.fetchSearchSummary.mockResolvedValue({
      summary: { ...summary, totalClicks: 9999 },
    });
    renderWith(
      makeStore({
        connection: connected,
        summary,
        summarySiteId: 'site-1',
        summaryRange: '28d',
        summaryLoaded: true,
      }),
    );
    expect(screen.queryByText('Updated just now')).not.toBeInTheDocument();
    expect(mockedApi.fetchSearchSummary).not.toHaveBeenCalled();

    const button = screen.getByTestId('google-summary-refresh');
    await user.click(button);

    // In-flight: shared in-button spinner + disabled, old data still visible.
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button.querySelector('[data-slot="spinner"]')).toBeInTheDocument();
    expect(screen.getByText('Refreshing…')).toBeInTheDocument();
    expect(screen.getByText('1,234')).toBeInTheDocument();
    expect(mockedApi.refreshSearchSummary).toHaveBeenCalledWith('site-1');

    release({ summary });
    // The card shows the follow-up ranged GET's data.
    expect(await screen.findByText('9,999')).toBeInTheDocument();
    expect(mockedApi.fetchSearchSummary).toHaveBeenCalledWith('site-1', '28d');
    expect(await screen.findByText('Updated just now')).toBeInTheDocument();
    expect(screen.getByTestId('google-summary-refresh')).not.toBeDisabled();
  });

  it('keeps the old summary and shows a refresh-error alert when a refresh fails', async () => {
    const user = userEvent.setup();
    mockedApi.refreshSearchSummary.mockRejectedValue(new ApiError('boom', 500, null));
    renderWith(
      makeStore({
        connection: connected,
        summary,
        summarySiteId: 'site-1',
        summaryRange: '28d',
        summaryLoaded: true,
      }),
    );
    await user.click(screen.getByTestId('google-summary-refresh'));
    const alert = await screen.findByTestId('google-summary-refresh-error');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert).toHaveTextContent(
      "We couldn't refresh your search data. Try again in a moment.",
    );
    // A failed refresh must not wipe good data or falsely announce success.
    expect(screen.getByText('1,234')).toBeInTheDocument();
    expect(screen.queryByText('Updated just now')).not.toBeInTheDocument();
    // The POST failed, so the follow-up GET never fires.
    expect(mockedApi.fetchSearchSummary).not.toHaveBeenCalled();
  });

  it('reads ?range= from the URL, fetches that window, and titles accordingly', async () => {
    mockedApi.fetchSearchSummary.mockResolvedValue({ summary });
    renderWith(
      makeStore({ connection: connected }),
      'site-1',
      '/sites/site-1?tab=google&range=7d',
    );
    await waitFor(() =>
      expect(mockedApi.fetchSearchSummary).toHaveBeenCalledWith('site-1', '7d'),
    );
    expect(
      await screen.findByText('Search performance (last 7 days)'),
    ).toBeInTheDocument();
  });

  it('picking a range refetches and writes ?range= while preserving ?tab=google', async () => {
    const user = userEvent.setup();
    mockedApi.fetchSearchSummary.mockResolvedValue({ summary });
    renderWith(
      makeStore({
        connection: connected,
        summary,
        summarySiteId: 'site-1',
        summaryRange: '28d',
        summaryLoaded: true,
      }),
    );
    expect(screen.getByText('Search performance (last 28 days)')).toBeInTheDocument();
    await user.click(screen.getByTestId('google-summary-range'));
    await user.click(await screen.findByRole('option', { name: 'Last 90 days' }));
    await waitFor(() => expect(capturedSearch).toBe('?tab=google&range=90d'));
    await waitFor(() =>
      expect(mockedApi.fetchSearchSummary).toHaveBeenCalledWith('site-1', '90d'),
    );
    expect(
      await screen.findByText('Search performance (last 90 days)'),
    ).toBeInTheDocument();
  });
});
