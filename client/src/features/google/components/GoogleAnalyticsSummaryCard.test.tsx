/**
 * GoogleAnalyticsSummaryCard tests — the full GA4 state ladder:
 * enable CTA (linkSocial args), inline property
 * picker (with explicit selection), skeleton, hard error + retry, empty (404),
 * populated (tiles / engagement / previous / chart toggle / breakdowns),
 * refresh (live region + follow-up GET), range select refetch, and RTL.
 */
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
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
import { GoogleAnalyticsSummaryCard } from './GoogleAnalyticsSummaryCard';
import type { GoogleAnalyticsSummary, GoogleConnection, GoogleConnectionState } from '../types';

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

vi.mock('@features/auth', () => ({
  authClient: { linkSocial: vi.fn() },
  RequireVerified: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const mockedApi = vi.mocked(api);
const { authClient } = await import('@features/auth');
const linkSocial = authClient.linkSocial as unknown as Mock;

const GSC = 'https://www.googleapis.com/auth/webmasters.readonly';
const GA4 = 'https://www.googleapis.com/auth/analytics.readonly';

const baseConnection: GoogleConnection = {
  status: 'connected',
  googleAccountEmail: 'jane@example.com',
  propertyUrl: 'https://example.com/',
  connectedAt: '2026-06-01T00:00:00.000Z',
  lastUsedAt: '2026-06-15T00:00:00.000Z',
};

/** Fully configured: GA4 scope granted + property chosen. */
const configured: GoogleConnection = {
  ...baseConnection,
  scopes: [GSC, GA4],
  ga4PropertyId: 'properties/123',
  ga4PropertyDisplayName: 'Example site',
};

const summary: GoogleAnalyticsSummary = {
  totalSessions: 400,
  totalActiveUsers: 300,
  totalEngagedSessions: 240,
  totalKeyEvents: 12,
  engagementRate: 0.6,
  timeseries: [
    { date: '2026-07-01', sessions: 10, activeUsers: 8, engagedSessions: 6, keyEvents: 1 },
    { date: '2026-07-02', sessions: 14, activeUsers: 11, engagedSessions: 9, keyEvents: 2 },
  ],
  channels: [
    {
      channel: 'Organic Search',
      sessions: 200,
      activeUsers: 150,
      engagedSessions: 120,
      keyEvents: 6,
    },
  ],
  topPages: [
    {
      url: 'https://example.com/pricing',
      sessions: 100,
      activeUsers: 80,
      engagedSessions: 60,
      keyEvents: 3,
    },
  ],
  countries: [
    {
      country: 'United States',
      sessions: 150,
      activeUsers: 110,
      engagedSessions: 90,
      keyEvents: 4,
    },
  ],
  devices: [
    { device: 'desktop', sessions: 250, activeUsers: 190, engagedSessions: 150, keyEvents: 8 },
    { device: 'smart_tv', sessions: 5, activeUsers: 4, engagedSessions: 2, keyEvents: 0 },
  ],
  asOf: '2026-07-10',
  previousPeriod: {
    totalSessions: 300,
    totalActiveUsers: 250,
    totalEngagedSessions: 180,
    totalKeyEvents: 9,
  },
};

const baseState = (): GoogleConnectionState => googleReducer(undefined, { type: '@@init' });

const makeStore = (preloaded?: Partial<GoogleConnectionState>) =>
  configureStore({
    reducer: { google: googleReducer },
    preloadedState: {
      google: { ...baseState(), connectionSiteId: 'site-1', ...preloaded },
    },
  });

type GStore = ReturnType<typeof makeStore>;

/** Populated-and-settled analytics preload for the default 28d window. */
const loadedAnalytics = (
  patch: Partial<GoogleConnectionState['analytics']> = {},
): GoogleConnectionState['analytics'] => ({
  ...baseState().analytics,
  summary,
  siteId: 'site-1',
  range: '28d',
  loaded: true,
  ...patch,
});

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
          <GoogleAnalyticsSummaryCard siteId={siteId} />
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
  linkSocial.mockResolvedValue({ error: null });
  window.history.replaceState(null, '', '/sites/site-1?tab=google');
});

describe('GoogleAnalyticsSummaryCard — guards', () => {
  it('renders nothing when there is no connected Google account', () => {
    renderWith(makeStore({ connection: null }));
    expect(screen.queryByTestId('google-analytics-summary-card')).not.toBeInTheDocument();
    expect(mockedApi.fetchAnalyticsSummary).not.toHaveBeenCalled();
  });

  it('renders nothing for a needs_reconnect connection', () => {
    renderWith(makeStore({ connection: { ...configured, status: 'needs_reconnect' } }));
    expect(screen.queryByTestId('google-analytics-summary-card')).not.toBeInTheDocument();
  });

  it('does not fire a second fetch while one is already in flight', () => {
    renderWith(
      makeStore({
        connection: configured,
        analytics: { ...baseState().analytics, loading: true },
      }),
    );
    expect(mockedApi.fetchAnalyticsSummary).not.toHaveBeenCalled();
    expect(screen.getByTestId('google-analytics-skeleton')).toBeInTheDocument();
  });

  it('does not refetch when the summary for this site + range is already loaded', () => {
    renderWith(makeStore({ connection: configured, analytics: loadedAnalytics() }));
    expect(screen.getByText('400')).toBeInTheDocument();
    expect(mockedApi.fetchAnalyticsSummary).not.toHaveBeenCalled();
  });

  it('refetches when the loaded summary belongs to another site', async () => {
    mockedApi.fetchAnalyticsSummary.mockResolvedValue({ summary });
    renderWith(
      makeStore({
        connection: configured,
        analytics: loadedAnalytics({ siteId: 'other-site' }),
      }),
    );
    await waitFor(() =>
      expect(mockedApi.fetchAnalyticsSummary).toHaveBeenCalledWith('site-1', '28d'),
    );
  });
});

describe('GoogleAnalyticsSummaryCard — enable CTA (scope missing)', () => {
  const gscOnly: GoogleConnection = { ...baseConnection, scopes: [GSC] };

  beforeEach(() => {
    mockedApi.fetchAnalyticsSummary.mockRejectedValue(new ApiError('not enabled', 404, null));
  });

  it('shows ONE enable button when the GA4 scope is missing', async () => {
    renderWith(makeStore({ connection: gscOnly }));
    const enable = await screen.findByTestId('google-analytics-enable');
    expect(enable).toHaveTextContent('Google Analytics is not enabled');
    expect(screen.getByTestId('google-analytics-enable-cta')).toHaveTextContent(
      'Enable Google Analytics',
    );
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('fires linkSocial with BOTH scopes and marker callback URLs on the current page', async () => {
    const user = userEvent.setup();
    renderWith(makeStore({ connection: gscOnly }));
    await user.click(await screen.findByTestId('google-analytics-enable-cta'));
    expect(linkSocial).toHaveBeenCalledWith({
      provider: 'google',
      scopes: [GSC, GA4],
      callbackURL: '/sites/site-1?tab=google&google_linked=1',
      errorCallbackURL: '/sites/site-1?tab=google&google_error=1',
    });
  });

  it('shows the in-button spinner while the link handshake is in flight', async () => {
    const user = userEvent.setup();
    let release!: (value: { error: null }) => void;
    linkSocial.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    renderWith(makeStore({ connection: gscOnly }));
    const cta = await screen.findByTestId('google-analytics-enable-cta');
    await user.click(cta);
    expect(cta).toBeDisabled();
    expect(cta).toHaveAttribute('aria-busy', 'true');
    expect(cta.querySelector('[data-slot="spinner"]')).toBeInTheDocument();
    release({ error: null });
    // On success the browser navigates away — the button stays busy here.
    await waitFor(() => expect(linkSocial).toHaveBeenCalledTimes(1));
  });

  it('surfaces an inline error and re-enables the button when linkSocial fails', async () => {
    const user = userEvent.setup();
    linkSocial.mockResolvedValue({ error: { message: 'link failed' } });
    renderWith(makeStore({ connection: gscOnly }));
    await user.click(await screen.findByTestId('google-analytics-enable-cta'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "We couldn't reach Google Search Console. Try again in a moment.",
    );
    expect(screen.getByTestId('google-analytics-enable-cta')).not.toBeDisabled();
  });
});

describe('GoogleAnalyticsSummaryCard — property picker (scope granted, no property)', () => {
  const scopeNoProperty: GoogleConnection = {
    ...baseConnection,
    scopes: [GSC, GA4],
    ga4PropertyId: null,
  };

  beforeEach(() => {
    mockedApi.fetchAnalyticsSummary.mockRejectedValue(new ApiError('not enabled', 404, null));
  });

  it('renders the inline picker fed by the properties endpoint', async () => {
    mockedApi.fetchAnalyticsProperties.mockResolvedValue({
      properties: [
        { propertyId: 'properties/1', displayName: 'Site one' },
        { propertyId: 'properties/2', displayName: 'Site two' },
      ],
    });
    renderWith(makeStore({ connection: scopeNoProperty }));
    expect(await screen.findByTestId('google-analytics-picker')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('ga4-property-select')).toBeInTheDocument());
    expect(mockedApi.fetchAnalyticsProperties).toHaveBeenCalledTimes(1);
  });

  it('keeps the picker open when the account has only one property', async () => {
    mockedApi.fetchAnalyticsProperties.mockResolvedValue({
      properties: [{ propertyId: 'properties/9', displayName: 'Only site' }],
    });
    renderWith(makeStore({ connection: scopeNoProperty }));
    expect(await screen.findByTestId('ga4-property-select')).toHaveTextContent('Select a property');
    await Promise.resolve();
    expect(mockedApi.setConnectionProperty).not.toHaveBeenCalled();
    expect(screen.getByTestId('google-analytics-picker')).toBeInTheDocument();
  });

  it('shows a semantic status while GA4 automatic matching is active', () => {
    renderWith(
      makeStore({
        connection: { ...scopeNoProperty, ga4Status: 'matching' },
        analytics: loadedAnalytics({
          summary: null,
          propertiesLoaded: true,
          properties: [],
        }),
      }),
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      'Matching this site to its Google properties…',
    );
  });

  it.each(['bound', 'unbound'] as const)(
    'does not show a transient auto-match status for %s GA4 bindings',
    (ga4Status) => {
      renderWith(
        makeStore({
          connection: { ...scopeNoProperty, ga4Status },
          analytics: loadedAnalytics({
            summary: null,
            propertiesLoaded: true,
            properties: [],
          }),
        }),
      );

      expect(
        screen.queryByText('Matching this site to its Google properties…'),
      ).not.toBeInTheDocument();
    },
  );
});

describe('GoogleAnalyticsSummaryCard — data states', () => {
  it('shows the skeleton on first load, then the populated card', async () => {
    mockedApi.fetchAnalyticsSummary.mockResolvedValue({ summary });
    renderWith(makeStore({ connection: configured }));
    expect(await screen.findByText('400')).toBeInTheDocument();
    expect(mockedApi.fetchAnalyticsSummary).toHaveBeenCalledWith('site-1', '28d');
  });

  it('renders the four tiles, engagement line, previous period, and asOf', () => {
    renderWith(makeStore({ connection: configured, analytics: loadedAnalytics() }));
    const sessions = screen.getByTestId('google-analytics-sessions');
    expect(within(sessions).getByText('Sessions')).toBeInTheDocument();
    expect(within(sessions).getByText('400')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('google-analytics-active-users')).getByText('300'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('google-analytics-engaged-sessions')).getByText('240'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('google-analytics-key-events')).getByText('12'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('google-analytics-engagement')).toHaveTextContent(
      'Engagement rate: 60%',
    );
    expect(screen.getByTestId('google-analytics-previous')).toHaveTextContent(
      'Previous period: 300 sessions · 250 active users',
    );
    expect(screen.getByText(/Data through/)).toBeInTheDocument();
  });

  it('hides the previous-period line when the server has no prior window', () => {
    renderWith(
      makeStore({
        connection: configured,
        analytics: loadedAnalytics({ summary: { ...summary, previousPeriod: null } }),
      }),
    );
    expect(screen.getByText('400')).toBeInTheDocument();
    expect(screen.queryByTestId('google-analytics-previous')).not.toBeInTheDocument();
  });

  it('renders the chart with a sessions/active-users toggle', async () => {
    const user = userEvent.setup();
    renderWith(makeStore({ connection: configured, analytics: loadedAnalytics() }));
    const svg = screen.getByTestId('ga4-timeseries-svg');
    expect(svg.getAttribute('aria-label')).toBe('Daily Sessions for the last 28 days');
    const activeUsersBtn = screen.getByRole('button', { name: 'Active users' });
    expect(activeUsersBtn).toHaveAttribute('aria-pressed', 'false');
    await user.click(activeUsersBtn);
    expect(activeUsersBtn).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('ga4-timeseries-svg').getAttribute('aria-label')).toBe(
      'Daily Active users for the last 28 days',
    );
    // The sr-only table carries all four metric columns per day.
    const table = screen.getByTestId('ga4-timeseries-table');
    expect(table.querySelectorAll('tbody tr')).toHaveLength(2);
  });

  it('renders the four breakdown lists with sessions · engagement rate', () => {
    renderWith(makeStore({ connection: configured, analytics: loadedAnalytics() }));
    const channels = screen.getByTestId('google-analytics-channels');
    expect(within(channels).getByText('Organic Search')).toBeInTheDocument();
    expect(within(channels).getByText('200 · 60%')).toBeInTheDocument();
    const pages = screen.getByTestId('google-analytics-pages');
    expect(within(pages).getByText('https://example.com/pricing')).toBeInTheDocument();
    const countries = screen.getByTestId('google-analytics-countries');
    expect(within(countries).getByText('United States')).toBeInTheDocument();
    const devices = screen.getByTestId('google-analytics-devices');
    // Known device localized; unknown falls back to "Other".
    expect(within(devices).getByText('Desktop')).toBeInTheDocument();
    expect(within(devices).getByText('Other')).toBeInTheDocument();
    // Per-row rate = engaged sessions / sessions (2 / 5 → 40%).
    expect(within(devices).getByText('5 · 40%')).toBeInTheDocument();
  });

  it('guards the per-row engagement rate against zero sessions', () => {
    renderWith(
      makeStore({
        connection: configured,
        analytics: loadedAnalytics({
          summary: {
            ...summary,
            channels: [
              { channel: 'Direct', sessions: 0, activeUsers: 0, engagedSessions: 0, keyEvents: 0 },
            ],
          },
        }),
      }),
    );
    const channels = screen.getByTestId('google-analytics-channels');
    expect(within(channels).getByText('0 · 0%')).toBeInTheDocument();
  });

  it('renders the empty state on a 404 with the controls available', async () => {
    mockedApi.fetchAnalyticsSummary.mockRejectedValue(new ApiError('no data', 404, null));
    renderWith(makeStore({ connection: configured }));
    expect(await screen.findByTestId('google-analytics-empty')).toHaveTextContent(
      /No analytics data yet/,
    );
    expect(screen.getByTestId('google-analytics-refresh')).toBeInTheDocument();
    expect(screen.getByTestId('google-analytics-range')).toBeInTheDocument();
  });

  it('renders the error state with a working retry button', async () => {
    mockedApi.fetchAnalyticsSummary.mockRejectedValueOnce(new ApiError('boom', 500, null));
    mockedApi.fetchAnalyticsSummary.mockResolvedValueOnce({ summary });
    const user = userEvent.setup();
    renderWith(makeStore({ connection: configured }));
    const alert = await screen.findByTestId('google-analytics-error');
    expect(alert).toBeInTheDocument();
    await user.click(screen.getByTestId('google-analytics-retry'));
    expect(await screen.findByText('400')).toBeInTheDocument();
    expect(mockedApi.fetchAnalyticsSummary).toHaveBeenCalledTimes(2);
  });

  it('renders under Arabic locale (RTL) with LTR-pinned numerics', async () => {
    await changeLanguage('ar');
    renderWith(makeStore({ connection: configured, analytics: loadedAnalytics() }));
    const tile = screen.getByTestId('google-analytics-sessions');
    expect(tile.querySelector('dd')?.getAttribute('dir')).toBe('ltr');
    await changeLanguage('en');
  });
});

describe('GoogleAnalyticsSummaryCard — refresh', () => {
  it('shows the shared spinner, updates the tiles, and announces success', async () => {
    const user = userEvent.setup();
    let release!: (value: { summary: GoogleAnalyticsSummary }) => void;
    mockedApi.refreshAnalyticsSummary.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    mockedApi.fetchAnalyticsSummary.mockResolvedValue({
      summary: { ...summary, totalSessions: 999 },
    });
    renderWith(makeStore({ connection: configured, analytics: loadedAnalytics() }));
    expect(screen.queryByText('Updated just now')).not.toBeInTheDocument();

    const button = screen.getByTestId('google-analytics-refresh');
    await user.click(button);

    // In-flight: shared in-button spinner + disabled, old data still visible.
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button.querySelector('[data-slot="spinner"]')).toBeInTheDocument();
    expect(screen.getByText('400')).toBeInTheDocument();
    expect(mockedApi.refreshAnalyticsSummary).toHaveBeenCalledWith('site-1');

    release({ summary });
    // The card shows the follow-up ranged GET's data.
    expect(await screen.findByText('999')).toBeInTheDocument();
    expect(await screen.findByText('Updated just now')).toBeInTheDocument();
    expect(screen.getByTestId('google-analytics-refresh')).not.toBeDisabled();
  });

  it('keeps the old summary and shows a refresh-error alert when a refresh fails', async () => {
    const user = userEvent.setup();
    mockedApi.refreshAnalyticsSummary.mockRejectedValue(new ApiError('boom', 500, null));
    renderWith(makeStore({ connection: configured, analytics: loadedAnalytics() }));
    await user.click(screen.getByTestId('google-analytics-refresh'));
    const alert = await screen.findByTestId('google-analytics-refresh-error');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert).toHaveTextContent(
      "We couldn't refresh your analytics data. Try again in a moment.",
    );
    expect(screen.getByText('400')).toBeInTheDocument();
    expect(screen.queryByText('Updated just now')).not.toBeInTheDocument();
  });
});

describe('GoogleAnalyticsSummaryCard — range', () => {
  it('reads ?range= from the URL and fetches that window', async () => {
    mockedApi.fetchAnalyticsSummary.mockResolvedValue({ summary });
    renderWith(
      makeStore({ connection: configured }),
      'site-1',
      '/sites/site-1?tab=google&range=7d',
    );
    await waitFor(() =>
      expect(mockedApi.fetchAnalyticsSummary).toHaveBeenCalledWith('site-1', '7d'),
    );
    expect(await screen.findByText('Google Analytics (last 7 days)')).toBeInTheDocument();
  });

  it('picking a range refetches and writes ?range= while preserving ?tab=', async () => {
    const user = userEvent.setup();
    mockedApi.fetchAnalyticsSummary.mockResolvedValue({ summary });
    renderWith(makeStore({ connection: configured, analytics: loadedAnalytics() }));
    expect(screen.getByText('Google Analytics (last 28 days)')).toBeInTheDocument();
    await user.click(screen.getByTestId('google-analytics-range'));
    await user.click(await screen.findByRole('option', { name: 'Last 90 days' }));
    await waitFor(() => expect(capturedSearch).toBe('?tab=google&range=90d'));
    await waitFor(() =>
      expect(mockedApi.fetchAnalyticsSummary).toHaveBeenCalledWith('site-1', '90d'),
    );
    expect(await screen.findByText('Google Analytics (last 90 days)')).toBeInTheDocument();
  });
});
