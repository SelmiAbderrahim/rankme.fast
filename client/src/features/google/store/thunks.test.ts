import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import { ApiError } from '@shared/api/client';
import { initI18n } from '@shared/i18n';
import * as api from '../api';
import { googleReducer } from './slice';
import {
  connectGoogle,
  disconnectGoogle,
  loadAnalyticsSummary,
  loadConnection,
  loadGa4Properties,
  loadSearchAnalyticsDetail,
  loadSearchSummary,
  loadSitemaps,
  refreshAnalyticsSummary,
  refreshSearchSummary,
  pollConnection,
  revokeGoogle,
  setGa4Property,
  setGoogleProperty,
} from './thunks';
import { GA4_SCOPE, GSC_SCOPE } from '../lib/googleScopes';
import type {
  GoogleAnalyticsSummary,
  GoogleConnection,
  GoogleConnectionState,
  GoogleSearchSummary,
  GscSitemap,
} from '../types';

vi.mock('../api', () => ({
  getConnection: vi.fn(),
  getConnectionConfiguration: vi.fn(),
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
  revokeGoogleCredential: vi.fn(),
}));

const mocked = vi.mocked(api);

const connection: GoogleConnection = {
  status: 'connected',
  googleAccountEmail: 'a@b.co',
  propertyUrl: 'https://example.com/',
  connectedAt: '2026-07-01T00:00:00.000Z',
  lastUsedAt: '2026-07-02T00:00:00.000Z',
};

/** Fully configured GA4 connection: scope granted + property chosen. */
const ga4Connection: GoogleConnection = {
  ...connection,
  scopes: [GSC_SCOPE, GA4_SCOPE],
  ga4PropertyId: 'properties/123',
  ga4PropertyDisplayName: 'Example site',
};

const serverError = (message: string, status = 400) =>
  new ApiError('request failed', status, { error: { message } });

const initial = (): GoogleConnectionState =>
  googleReducer(undefined, { type: '@@init' });

const makeStore = (preloaded?: Partial<GoogleConnectionState>) =>
  configureStore({
    reducer: { google: googleReducer },
    ...(preloaded
      ? { preloadedState: { google: { ...initial(), ...preloaded } } }
      : {}),
  });

beforeAll(() => {
  initI18n({ initialLocale: 'en' });
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('loadConnection', () => {
  it('stores the fetched connection on success', async () => {
    mocked.getConnection.mockResolvedValue({ connection });
    const store = makeStore();
    await store.dispatch(loadConnection('site-1'));
    expect(store.getState().google.connection).toEqual(connection);
    expect(store.getState().google.loaded).toBe(true);
  });

  it('stores null when the server reports no connection', async () => {
    mocked.getConnection.mockResolvedValue({ connection: null });
    const store = makeStore();
    await store.dispatch(loadConnection('site-1'));
    expect(store.getState().google.connection).toBeNull();
  });

  it('rejects with the server-localized message', async () => {
    mocked.getConnection.mockRejectedValue(serverError('server exploded', 500));
    const store = makeStore();
    await store.dispatch(loadConnection('site-1'));
    expect(store.getState().google.error).toBe('server exploded');
  });

  it('rejects with the localized fallback on network failure', async () => {
    mocked.getConnection.mockRejectedValue(new TypeError('offline'));
    const store = makeStore();
    await store.dispatch(loadConnection('site-1'));
    expect(store.getState().google.error).toBe('Could not load your Google connection.');
  });
});

describe('pollConnection', () => {
  it('updates the current site without refetching resource lists', async () => {
    mocked.getConnectionConfiguration.mockResolvedValue(connection);
    const store = makeStore({ connectionSiteId: 'site-1', loaded: true });
    await store.dispatch(pollConnection('site-1'));
    expect(mocked.getConnectionConfiguration).toHaveBeenCalledWith('site-1');
    expect(store.getState().google.connection).toEqual(connection);
  });

  it('invalidates the lightweight load when matching finishes so resources reload', async () => {
    const pending: GoogleConnection = {
      ...connection,
      propertyUrl: null,
      gscStatus: 'matching',
      ga4Status: 'scope_missing',
    };
    mocked.getConnectionConfiguration.mockResolvedValue({
      ...pending,
      propertyUrl: 'sc-domain:example.com',
      gscStatus: 'bound',
    });
    const store = makeStore({
      connectionSiteId: 'site-1',
      connection: pending,
      loaded: true,
    });

    await store.dispatch(pollConnection('site-1'));

    expect(store.getState().google.loaded).toBe(false);
    expect(store.getState().google.connection?.propertyUrl).toBe(
      'sc-domain:example.com',
    );
  });

  it('does not replace another site after navigation', async () => {
    mocked.getConnectionConfiguration.mockResolvedValue(connection);
    const store = makeStore({ connectionSiteId: 'site-2', loaded: true });
    await store.dispatch(pollConnection('site-1'));
    expect(store.getState().google.connection).toBeNull();
  });

  it('rejects with the localized fallback when polling fails', async () => {
    mocked.getConnectionConfiguration.mockRejectedValue(new TypeError('offline'));
    const store = makeStore({ connectionSiteId: 'site-1', loaded: true });
    const result = await store.dispatch(pollConnection('site-1'));
    expect(pollConnection.rejected.match(result)).toBe(true);
  });
});

describe('connectGoogle', () => {
  it('resolves with the connection payload', async () => {
    mocked.completeConnection.mockResolvedValue({ connection });
    const store = makeStore();
    const result = await store.dispatch(
      connectGoogle({
        siteId: 'site-1',
        refreshToken: 'rt',
        scopes: [GSC_SCOPE],
        googleAccountEmail: 'a@b.co',
      }),
    );
    expect(connectGoogle.fulfilled.match(result)).toBe(true);
    expect(mocked.completeConnection).toHaveBeenCalledWith('site-1', {
      refreshToken: 'rt',
      scopes: [GSC_SCOPE],
      googleAccountEmail: 'a@b.co',
    });
    expect(store.getState().google.connection).toEqual(connection);
  });

  it('rejects with the server message on missing-scope error', async () => {
    mocked.completeConnection.mockRejectedValue(serverError('missing scope', 400));
    const store = makeStore();
    await store.dispatch(
      connectGoogle({
        siteId: 'site-1',
        refreshToken: 'rt',
        scopes: [],
        googleAccountEmail: 'a@b.co',
      }),
    );
    expect(store.getState().google.connectError).toBe('missing scope');
  });

  it('rejects with the localized fallback on network failure', async () => {
    mocked.completeConnection.mockRejectedValue(new TypeError('offline'));
    const store = makeStore();
    await store.dispatch(
      connectGoogle({
        siteId: 'site-1',
        refreshToken: 'rt',
        scopes: [],
        googleAccountEmail: 'a@b.co',
      }),
    );
    expect(store.getState().google.connectError).toBe(
      "We couldn't reach Google Search Console. Try again in a moment.",
    );
  });
});

describe('setGoogleProperty', () => {
  it('stores the updated connection on success', async () => {
    const updated: GoogleConnection = { ...connection, propertyUrl: 'sc-domain:example.com' };
    mocked.setConnectionProperty.mockResolvedValue({ connection: updated });
    const store = makeStore();
    const result = await store.dispatch(
      setGoogleProperty({ siteId: 'site-1', propertyUrl: 'sc-domain:example.com' }),
    );
    expect(setGoogleProperty.fulfilled.match(result)).toBe(true);
    expect(mocked.setConnectionProperty).toHaveBeenCalledWith('site-1', {
      propertyUrl: 'sc-domain:example.com',
    });
    expect(store.getState().google.connection).toEqual(updated);
  });

  it('rejects with the server message on invalid property', async () => {
    mocked.setConnectionProperty.mockRejectedValue(serverError('bad property', 400));
    const store = makeStore();
    await store.dispatch(setGoogleProperty({ siteId: 'site-1', propertyUrl: 'https://nope/' }));
    expect(store.getState().google.setPropertyError).toBe('bad property');
  });

  it('rejects with the localized fallback on network failure', async () => {
    mocked.setConnectionProperty.mockRejectedValue(new TypeError('offline'));
    const store = makeStore();
    await store.dispatch(setGoogleProperty({ siteId: 'site-1', propertyUrl: 'https://nope/' }));
    expect(store.getState().google.setPropertyError).toBe(
      "We couldn't reach Google Search Console. Try again in a moment.",
    );
  });
});

describe('disconnectGoogle', () => {
  it('records the success message and clears the connection', async () => {
    mocked.disconnectConnection.mockResolvedValue({
      message: 'Disconnected.',
      connection: null,
    });
    const store = makeStore({ connection, loaded: true });
    await store.dispatch(disconnectGoogle('site-1'));
    expect(store.getState().google.connection).toBeNull();
    expect(store.getState().google.message).toBe('Disconnected.');
  });

  it('rejects with the server message', async () => {
    mocked.disconnectConnection.mockRejectedValue(serverError('server hates you', 500));
    const store = makeStore();
    await store.dispatch(disconnectGoogle('site-1'));
    expect(store.getState().google.disconnectError).toBe('server hates you');
  });

  it('rejects with the localized fallback on network failure', async () => {
    mocked.disconnectConnection.mockRejectedValue(new TypeError('offline'));
    const store = makeStore();
    await store.dispatch(disconnectGoogle('site-1'));
    expect(store.getState().google.disconnectError).toBe('Could not disconnect.');
  });
});

describe('revokeGoogle', () => {
  it('clears the shared credential from the current site', async () => {
    mocked.revokeGoogleCredential.mockResolvedValue({
      ok: true,
      affectedSiteCount: 2,
    });
    const store = makeStore({
      connection,
      connectionSiteId: 'site-1',
      loaded: true,
    });
    await store.dispatch(revokeGoogle('site-1'));
    expect(mocked.revokeGoogleCredential).toHaveBeenCalledWith('site-1');
    expect(store.getState().google.connection).toBeNull();
    expect(store.getState().google.revoking).toBe(false);
  });

  it('keeps the connection and shows the server error when revoke fails', async () => {
    mocked.revokeGoogleCredential.mockRejectedValue(serverError('not now', 500));
    const store = makeStore({
      connection,
      connectionSiteId: 'site-1',
      loaded: true,
    });
    await store.dispatch(revokeGoogle('site-1'));
    expect(store.getState().google.connection).toEqual(connection);
    expect(store.getState().google.revokeError).toBe('not now');
  });

  it('uses the disconnect fallback for a network failure', async () => {
    mocked.revokeGoogleCredential.mockRejectedValue(new TypeError('offline'));
    const store = makeStore({ connectionSiteId: 'site-1' });
    await store.dispatch(revokeGoogle('site-1'));
    expect(store.getState().google.revokeError).toBe('Could not disconnect.');
  });
});

describe('loadSearchSummary', () => {
  const summary: GoogleSearchSummary = {
    totalClicks: 10,
    totalImpressions: 1000,
    averageCtr: 0.01,
    averagePosition: 5.5,
    topQueries: [],
    topPages: [],
    asOf: '2026-07-04',
    previousPeriod: null,
  };

  it('stores the summary keyed to the requested site and default range', async () => {
    mocked.fetchSearchSummary.mockResolvedValue({ summary });
    const store = makeStore();
    await store.dispatch(loadSearchSummary({ siteId: 'site-1' }));
    const state = store.getState().google;
    expect(mocked.fetchSearchSummary).toHaveBeenCalledWith('site-1', '28d');
    expect(state.summary).toEqual(summary);
    expect(state.summarySiteId).toBe('site-1');
    expect(state.summaryRange).toBe('28d');
    expect(state.summaryLoaded).toBe(true);
    expect(state.summaryEmpty).toBe(false);
    expect(state.summaryError).toBeNull();
  });

  it('forwards an explicit range and keys the state to it', async () => {
    mocked.fetchSearchSummary.mockResolvedValue({ summary });
    const store = makeStore();
    await store.dispatch(loadSearchSummary({ siteId: 'site-1', range: '7d' }));
    expect(mocked.fetchSearchSummary).toHaveBeenCalledWith('site-1', '7d');
    expect(store.getState().google.summaryRange).toBe('7d');
  });

  it('treats a 404 as the empty state, not an error', async () => {
    mocked.fetchSearchSummary.mockRejectedValue(new ApiError('no data', 404, null));
    const store = makeStore();
    await store.dispatch(loadSearchSummary({ siteId: 'site-1' }));
    const state = store.getState().google;
    expect(state.summary).toBeNull();
    expect(state.summaryEmpty).toBe(true);
    expect(state.summaryError).toBeNull();
  });

  it('rejects with the server message on non-404 failures', async () => {
    mocked.fetchSearchSummary.mockRejectedValue(serverError('pg down', 500));
    const store = makeStore();
    await store.dispatch(loadSearchSummary({ siteId: 'site-1' }));
    expect(store.getState().google.summaryError).toBe('pg down');
    expect(store.getState().google.summaryEmpty).toBe(false);
  });

  it('rejects with the localized fallback on network failure', async () => {
    mocked.fetchSearchSummary.mockRejectedValue(new TypeError('offline'));
    const store = makeStore();
    await store.dispatch(loadSearchSummary({ siteId: 'site-1' }));
    expect(store.getState().google.summaryError).toBe(
      "We couldn't load your search summary. Try again in a moment.",
    );
  });

  it('pending clears the previous error', async () => {
    mocked.fetchSearchSummary.mockRejectedValueOnce(serverError('x', 500));
    mocked.fetchSearchSummary.mockResolvedValueOnce({ summary });
    const store = makeStore();
    await store.dispatch(loadSearchSummary({ siteId: 'site-1' }));
    expect(store.getState().google.summaryError).toBe('x');
    await store.dispatch(loadSearchSummary({ siteId: 'site-1' }));
    expect(store.getState().google.summaryError).toBeNull();
    expect(store.getState().google.summary).toEqual(summary);
  });
});

describe('refreshSearchSummary', () => {
  const summary: GoogleSearchSummary = {
    totalClicks: 20,
    totalImpressions: 2000,
    averageCtr: 0.02,
    averagePosition: 4.5,
    topQueries: [],
    topPages: [],
    asOf: '2026-07-05',
    previousPeriod: null,
    timeseries: [{ date: '2026-07-01', clicks: 3, impressions: 30, ctr: 0.1, position: 2 }],
    countries: [{ country: 'usa', clicks: 12, impressions: 120, ctr: 0.1, position: 2 }],
    devices: [{ device: 'DESKTOP', clicks: 8, impressions: 80, ctr: 0.1, position: 2 }],
  };

  it('POSTs the refresh, then re-reads through the ranged GET', async () => {
    mocked.refreshSearchSummary.mockResolvedValue({ summary });
    mocked.fetchSearchSummary.mockResolvedValue({
      summary: { ...summary, totalClicks: 99 },
    });
    const store = makeStore();
    await store.dispatch(refreshSearchSummary({ siteId: 'site-1', range: '90d' }));
    const state = store.getState().google;
    expect(mocked.refreshSearchSummary).toHaveBeenCalledWith('site-1');
    expect(mocked.fetchSearchSummary).toHaveBeenCalledWith('site-1', '90d');
    // The card shows the RANGED summary, not the POST's 28-day answer.
    expect(state.summary?.totalClicks).toBe(99);
    expect(state.summarySiteId).toBe('site-1');
    expect(state.summaryRange).toBe('90d');
    expect(state.summaryLoaded).toBe(true);
    expect(state.summaryRefreshing).toBe(false);
    expect(state.summaryEmpty).toBe(false);
    expect(state.summaryError).toBeNull();
  });

  it('treats a 404 on the POST as the empty state and skips the GET', async () => {
    mocked.refreshSearchSummary.mockRejectedValue(new ApiError('no data', 404, null));
    const store = makeStore();
    await store.dispatch(refreshSearchSummary({ siteId: 'site-1' }));
    const state = store.getState().google;
    expect(state.summary).toBeNull();
    expect(state.summaryEmpty).toBe(true);
    expect(state.summaryError).toBeNull();
    expect(mocked.fetchSearchSummary).not.toHaveBeenCalled();
  });

  it('treats a 404 on the follow-up GET as the empty state', async () => {
    mocked.refreshSearchSummary.mockResolvedValue({ summary });
    mocked.fetchSearchSummary.mockRejectedValue(new ApiError('no data', 404, null));
    const store = makeStore();
    await store.dispatch(refreshSearchSummary({ siteId: 'site-1', range: '7d' }));
    const state = store.getState().google;
    expect(state.summary).toBeNull();
    expect(state.summaryEmpty).toBe(true);
    expect(state.summaryError).toBeNull();
  });

  it('rejects with the server message on non-404 POST failures and preserves prior summary', async () => {
    const store = makeStore({
      summary,
      summarySiteId: 'site-1',
      summaryRange: '28d',
      summaryLoaded: true,
    });
    mocked.refreshSearchSummary.mockRejectedValue(serverError('pg down', 500));
    await store.dispatch(refreshSearchSummary({ siteId: 'site-1' }));
    const state = store.getState().google;
    expect(state.summaryError).toBe('pg down');
    expect(state.summaryEmpty).toBe(false);
    // A failed refresh never wipes good data.
    expect(state.summary).toEqual(summary);
  });

  it('rejects with the refresh fallback when the follow-up GET fails', async () => {
    mocked.refreshSearchSummary.mockResolvedValue({ summary });
    mocked.fetchSearchSummary.mockRejectedValue(new TypeError('offline'));
    const store = makeStore();
    await store.dispatch(refreshSearchSummary({ siteId: 'site-1' }));
    expect(store.getState().google.summaryError).toBe(
      "We couldn't refresh your search data. Try again in a moment.",
    );
  });

  it('rejects with the localized refresh fallback on network failure', async () => {
    mocked.refreshSearchSummary.mockRejectedValue(new TypeError('offline'));
    const store = makeStore();
    await store.dispatch(refreshSearchSummary({ siteId: 'site-1' }));
    expect(store.getState().google.summaryError).toBe(
      "We couldn't refresh your search data. Try again in a moment.",
    );
  });

  it('pending marks refreshing and clears the previous error', async () => {
    mocked.refreshSearchSummary.mockRejectedValueOnce(serverError('x', 500));
    const store = makeStore();
    await store.dispatch(refreshSearchSummary({ siteId: 'site-1' }));
    expect(store.getState().google.summaryError).toBe('x');
    // Freeze the next POST mid-flight to observe the pending state.
    let release!: (value: { summary: GoogleSearchSummary }) => void;
    mocked.refreshSearchSummary.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    mocked.fetchSearchSummary.mockResolvedValue({ summary });
    const pending = store.dispatch(refreshSearchSummary({ siteId: 'site-1' }));
    expect(store.getState().google.summaryRefreshing).toBe(true);
    expect(store.getState().google.summaryError).toBeNull();
    release({ summary });
    await pending;
    expect(store.getState().google.summaryRefreshing).toBe(false);
  });
});

describe('loadSearchAnalyticsDetail (drill-in)', () => {
  const rows = [
    { key: 'seo audit', clicks: 12, impressions: 1200, ctr: 0.01, position: 4.2 },
  ];

  it('stores the rows keyed to the site + dimension + default range', async () => {
    mocked.fetchSearchAnalyticsDetail.mockResolvedValue({
      detail: { asOf: '2026-07-04', rows },
    });
    const store = makeStore();
    await store.dispatch(loadSearchAnalyticsDetail({ siteId: 'site-1', dimension: 'query' }));
    const state = store.getState().google;
    expect(mocked.fetchSearchAnalyticsDetail).toHaveBeenCalledWith('site-1', 'query', '28d');
    expect(state.detailSiteId).toBe('site-1');
    expect(state.detailRange).toBe('28d');
    expect(state.detail.query.rows).toEqual(rows);
    expect(state.detail.query.asOf).toBe('2026-07-04');
    expect(state.detail.query.loaded).toBe(true);
    expect(state.detail.query.empty).toBe(false);
    expect(state.detail.query.error).toBeNull();
    // Other dimensions stay untouched.
    expect(state.detail.page.loaded).toBe(false);
  });

  it('treats a 404 as the empty state, not an error', async () => {
    mocked.fetchSearchAnalyticsDetail.mockRejectedValue(
      new ApiError('no data', 404, null),
    );
    const store = makeStore();
    await store.dispatch(loadSearchAnalyticsDetail({ siteId: 'site-1', dimension: 'page' }));
    const state = store.getState().google;
    expect(state.detail.page.rows).toEqual([]);
    expect(state.detail.page.asOf).toBeNull();
    expect(state.detail.page.empty).toBe(true);
    expect(state.detail.page.error).toBeNull();
  });

  it('rejects with the server message on non-404 failures', async () => {
    mocked.fetchSearchAnalyticsDetail.mockRejectedValue(serverError('pg down', 500));
    const store = makeStore();
    await store.dispatch(
      loadSearchAnalyticsDetail({ siteId: 'site-1', dimension: 'country' }),
    );
    expect(store.getState().google.detail.country.error).toBe('pg down');
    expect(store.getState().google.detail.country.empty).toBe(false);
  });

  it('rejects with the localized fallback on network failure', async () => {
    mocked.fetchSearchAnalyticsDetail.mockRejectedValue(new TypeError('offline'));
    const store = makeStore();
    await store.dispatch(
      loadSearchAnalyticsDetail({ siteId: 'site-1', dimension: 'device' }),
    );
    expect(store.getState().google.detail.device.error).toBe(
      "We couldn't load this data. Try again in a moment.",
    );
  });

  it('re-keys every dimension when the site changes', async () => {
    mocked.fetchSearchAnalyticsDetail.mockResolvedValue({
      detail: { asOf: '2026-07-04', rows },
    });
    const store = makeStore();
    await store.dispatch(loadSearchAnalyticsDetail({ siteId: 'site-1', dimension: 'query' }));
    expect(store.getState().google.detail.query.loaded).toBe(true);
    await store.dispatch(loadSearchAnalyticsDetail({ siteId: 'site-2', dimension: 'page' }));
    const state = store.getState().google;
    expect(state.detailSiteId).toBe('site-2');
    // site-1 query data was reset by the re-key.
    expect(state.detail.query.loaded).toBe(false);
    expect(state.detail.query.rows).toEqual([]);
    expect(state.detail.page.rows).toEqual(rows);
  });

  it('re-keys every dimension when the range changes for the same site', async () => {
    mocked.fetchSearchAnalyticsDetail.mockResolvedValue({
      detail: { asOf: '2026-07-04', rows },
    });
    const store = makeStore();
    await store.dispatch(loadSearchAnalyticsDetail({ siteId: 'site-1', dimension: 'query' }));
    expect(store.getState().google.detail.query.loaded).toBe(true);
    await store.dispatch(
      loadSearchAnalyticsDetail({ siteId: 'site-1', dimension: 'page', range: '7d' }),
    );
    const state = store.getState().google;
    expect(mocked.fetchSearchAnalyticsDetail).toHaveBeenLastCalledWith(
      'site-1',
      'page',
      '7d',
    );
    expect(state.detailRange).toBe('7d');
    // The 28d query data was reset by the range re-key.
    expect(state.detail.query.loaded).toBe(false);
    expect(state.detail.page.rows).toEqual(rows);
  });
});

describe('loadSitemaps (drill-in)', () => {
  const sitemap: GscSitemap = {
    path: 'https://example.com/sitemap.xml',
    type: 'sitemap',
    lastSubmitted: '2026-07-01T00:00:00.000Z',
    lastDownloaded: null,
    isPending: false,
    isSitemapsIndex: false,
    errors: 0,
    warnings: 0,
    processed: 120,
  };

  it('stores the sitemaps keyed to the site', async () => {
    mocked.fetchSitemaps.mockResolvedValue({ asOf: '2026-07-04', sitemaps: [sitemap] });
    const store = makeStore();
    await store.dispatch(loadSitemaps('site-1'));
    const state = store.getState().google;
    expect(mocked.fetchSitemaps).toHaveBeenCalledWith('site-1');
    expect(state.sitemapsSiteId).toBe('site-1');
    expect(state.sitemaps.items).toEqual([sitemap]);
    expect(state.sitemaps.asOf).toBe('2026-07-04');
    expect(state.sitemaps.loaded).toBe(true);
    expect(state.sitemaps.error).toBeNull();
  });

  it('keeps a 200 with an empty array as a legitimate empty state', async () => {
    mocked.fetchSitemaps.mockResolvedValue({ asOf: null, sitemaps: [] });
    const store = makeStore();
    await store.dispatch(loadSitemaps('site-1'));
    const state = store.getState().google;
    expect(state.sitemaps.items).toEqual([]);
    expect(state.sitemaps.asOf).toBeNull();
    expect(state.sitemaps.loaded).toBe(true);
    expect(state.sitemaps.error).toBeNull();
  });

  it('maps a 404 to the same empty shape', async () => {
    mocked.fetchSitemaps.mockRejectedValue(new ApiError('no data', 404, null));
    const store = makeStore();
    await store.dispatch(loadSitemaps('site-1'));
    const state = store.getState().google;
    expect(state.sitemaps.items).toEqual([]);
    expect(state.sitemaps.error).toBeNull();
  });

  it('rejects with the server message on non-404 failures', async () => {
    mocked.fetchSitemaps.mockRejectedValue(serverError('gsc down', 500));
    const store = makeStore();
    await store.dispatch(loadSitemaps('site-1'));
    expect(store.getState().google.sitemaps.error).toBe('gsc down');
  });

  it('rejects with the localized fallback on network failure', async () => {
    mocked.fetchSitemaps.mockRejectedValue(new TypeError('offline'));
    const store = makeStore();
    await store.dispatch(loadSitemaps('site-1'));
    expect(store.getState().google.sitemaps.error).toBe(
      "We couldn't load this data. Try again in a moment.",
    );
  });

  it('re-keys the sitemaps state when the site changes', async () => {
    mocked.fetchSitemaps.mockResolvedValueOnce({ asOf: '2026-07-04', sitemaps: [sitemap] });
    mocked.fetchSitemaps.mockResolvedValueOnce({ asOf: null, sitemaps: [] });
    const store = makeStore();
    await store.dispatch(loadSitemaps('site-1'));
    expect(store.getState().google.sitemaps.items).toHaveLength(1);
    await store.dispatch(loadSitemaps('site-2'));
    const state = store.getState().google;
    expect(state.sitemapsSiteId).toBe('site-2');
    expect(state.sitemaps.items).toEqual([]);
  });
});

const analyticsSummary: GoogleAnalyticsSummary = {
  totalSessions: 400,
  totalActiveUsers: 300,
  totalEngagedSessions: 240,
  totalKeyEvents: 12,
  engagementRate: 0.6,
  timeseries: [
    { date: '2026-07-01', sessions: 10, activeUsers: 8, engagedSessions: 6, keyEvents: 1 },
  ],
  channels: [
    { channel: 'Organic Search', sessions: 200, activeUsers: 150, engagedSessions: 120, keyEvents: 6 },
  ],
  topPages: [
    { url: 'https://example.com/', sessions: 100, activeUsers: 80, engagedSessions: 60, keyEvents: 3 },
  ],
  countries: [
    { country: 'United States', sessions: 150, activeUsers: 110, engagedSessions: 90, keyEvents: 4 },
  ],
  devices: [
    { device: 'desktop', sessions: 250, activeUsers: 190, engagedSessions: 150, keyEvents: 8 },
  ],
  asOf: '2026-07-10',
  previousPeriod: {
    totalSessions: 300,
    totalActiveUsers: 250,
    totalEngagedSessions: 180,
    totalKeyEvents: 9,
  },
};

describe('loadAnalyticsSummary (GA4)', () => {
  it('stores the summary keyed to the site + default range', async () => {
    mocked.fetchAnalyticsSummary.mockResolvedValue({ summary: analyticsSummary });
    const store = makeStore({ connection: ga4Connection, loaded: true });
    await store.dispatch(loadAnalyticsSummary({ siteId: 'site-1' }));
    const a = store.getState().google.analytics;
    expect(mocked.fetchAnalyticsSummary).toHaveBeenCalledWith('site-1', '28d');
    expect(a.summary).toEqual(analyticsSummary);
    expect(a.siteId).toBe('site-1');
    expect(a.range).toBe('28d');
    expect(a.loaded).toBe(true);
    expect(a.notEnabled).toBe(false);
    expect(a.empty).toBe(false);
    expect(a.error).toBeNull();
  });

  it('forwards an explicit range', async () => {
    mocked.fetchAnalyticsSummary.mockResolvedValue({ summary: analyticsSummary });
    const store = makeStore({ connection: ga4Connection, loaded: true });
    await store.dispatch(loadAnalyticsSummary({ siteId: 'site-1', range: '90d' }));
    expect(mocked.fetchAnalyticsSummary).toHaveBeenCalledWith('site-1', '90d');
    expect(store.getState().google.analytics.range).toBe('90d');
  });

  it('maps a 404 to NOT ENABLED when the GA4 scope is missing on the connection', async () => {
    mocked.fetchAnalyticsSummary.mockRejectedValue(new ApiError('not enabled', 404, null));
    const store = makeStore({
      connection: { ...connection, scopes: [GSC_SCOPE] },
      loaded: true,
    });
    await store.dispatch(loadAnalyticsSummary({ siteId: 'site-1' }));
    const a = store.getState().google.analytics;
    expect(a.notEnabled).toBe(true);
    expect(a.empty).toBe(false);
    expect(a.error).toBeNull();
  });

  it('maps a 404 to NOT ENABLED when the scope is granted but no property is chosen', async () => {
    mocked.fetchAnalyticsSummary.mockRejectedValue(new ApiError('not enabled', 404, null));
    const store = makeStore({
      connection: { ...ga4Connection, ga4PropertyId: null },
      loaded: true,
    });
    await store.dispatch(loadAnalyticsSummary({ siteId: 'site-1' }));
    expect(store.getState().google.analytics.notEnabled).toBe(true);
  });

  it('maps a 404 to NOT ENABLED when there is no connection in state at all', async () => {
    mocked.fetchAnalyticsSummary.mockRejectedValue(new ApiError('not enabled', 404, null));
    const store = makeStore();
    await store.dispatch(loadAnalyticsSummary({ siteId: 'site-1' }));
    expect(store.getState().google.analytics.notEnabled).toBe(true);
  });

  it('maps a 404 to the plain EMPTY state when GA4 is fully configured', async () => {
    mocked.fetchAnalyticsSummary.mockRejectedValue(new ApiError('no data', 404, null));
    const store = makeStore({ connection: ga4Connection, loaded: true });
    await store.dispatch(loadAnalyticsSummary({ siteId: 'site-1' }));
    const a = store.getState().google.analytics;
    expect(a.empty).toBe(true);
    expect(a.notEnabled).toBe(false);
  });

  it('rejects with the server message on non-404 failures', async () => {
    mocked.fetchAnalyticsSummary.mockRejectedValue(serverError('ga down', 500));
    const store = makeStore({ connection: ga4Connection, loaded: true });
    await store.dispatch(loadAnalyticsSummary({ siteId: 'site-1' }));
    expect(store.getState().google.analytics.error).toBe('ga down');
  });

  it('rejects with the localized fallback on network failure', async () => {
    mocked.fetchAnalyticsSummary.mockRejectedValue(new TypeError('offline'));
    const store = makeStore({ connection: ga4Connection, loaded: true });
    await store.dispatch(loadAnalyticsSummary({ siteId: 'site-1' }));
    expect(store.getState().google.analytics.error).toBe(
      "We couldn't load your analytics summary. Try again in a moment.",
    );
  });
});

describe('refreshAnalyticsSummary (GA4)', () => {
  it('POSTs the refresh, then re-reads through the ranged GET', async () => {
    mocked.refreshAnalyticsSummary.mockResolvedValue({ summary: analyticsSummary });
    mocked.fetchAnalyticsSummary.mockResolvedValue({
      summary: { ...analyticsSummary, totalSessions: 999 },
    });
    const store = makeStore({ connection: ga4Connection, loaded: true });
    await store.dispatch(refreshAnalyticsSummary({ siteId: 'site-1', range: '7d' }));
    const a = store.getState().google.analytics;
    expect(mocked.refreshAnalyticsSummary).toHaveBeenCalledWith('site-1');
    expect(mocked.fetchAnalyticsSummary).toHaveBeenCalledWith('site-1', '7d');
    expect(a.summary?.totalSessions).toBe(999);
    expect(a.siteId).toBe('site-1');
    expect(a.range).toBe('7d');
    expect(a.refreshing).toBe(false);
    expect(a.loaded).toBe(true);
  });

  it('maps a 404 on the POST to the EMPTY state when fully configured', async () => {
    mocked.refreshAnalyticsSummary.mockRejectedValue(new ApiError('no data', 404, null));
    const store = makeStore({ connection: ga4Connection, loaded: true });
    await store.dispatch(refreshAnalyticsSummary({ siteId: 'site-1' }));
    const a = store.getState().google.analytics;
    expect(a.empty).toBe(true);
    expect(a.notEnabled).toBe(false);
  });

  it('maps a 404 on the follow-up GET to NOT ENABLED when the scope is missing', async () => {
    mocked.refreshAnalyticsSummary.mockResolvedValue({ summary: analyticsSummary });
    mocked.fetchAnalyticsSummary.mockRejectedValue(new ApiError('not enabled', 404, null));
    const store = makeStore({
      connection: { ...connection, scopes: [GSC_SCOPE] },
      loaded: true,
    });
    await store.dispatch(refreshAnalyticsSummary({ siteId: 'site-1' }));
    expect(store.getState().google.analytics.notEnabled).toBe(true);
  });

  it('rejects with the server message on a non-404 POST failure', async () => {
    mocked.refreshAnalyticsSummary.mockRejectedValue(serverError('ga down', 500));
    const store = makeStore({ connection: ga4Connection, loaded: true });
    await store.dispatch(refreshAnalyticsSummary({ siteId: 'site-1' }));
    expect(store.getState().google.analytics.error).toBe('ga down');
  });

  it('rejects with the refresh fallback when the follow-up GET fails', async () => {
    mocked.refreshAnalyticsSummary.mockResolvedValue({ summary: analyticsSummary });
    mocked.fetchAnalyticsSummary.mockRejectedValue(new TypeError('offline'));
    const store = makeStore({ connection: ga4Connection, loaded: true });
    await store.dispatch(refreshAnalyticsSummary({ siteId: 'site-1' }));
    expect(store.getState().google.analytics.error).toBe(
      "We couldn't refresh your analytics data. Try again in a moment.",
    );
  });
});

describe('loadGa4Properties', () => {
  const properties = [
    { propertyId: 'properties/1', displayName: 'Site one' },
    { propertyId: 'properties/2', displayName: 'Site two' },
  ];

  it('stores the property list', async () => {
    mocked.fetchAnalyticsProperties.mockResolvedValue({ properties });
    const store = makeStore({ connectionSiteId: 'site-1' });
    await store.dispatch(loadGa4Properties('site-1'));
    const a = store.getState().google.analytics;
    expect(a.properties).toEqual(properties);
    expect(a.propertiesLoaded).toBe(true);
    expect(a.propertiesError).toBeNull();
  });

  it('a failure records the error', async () => {
    mocked.fetchAnalyticsProperties.mockRejectedValue(serverError('scope missing', 400));
    const store = makeStore({ connectionSiteId: 'site-1' });
    await store.dispatch(loadGa4Properties('site-1'));
    const a = store.getState().google.analytics;
    expect(a.propertiesError).toBe('scope missing');
  });

  it('rejects with the localized fallback on network failure', async () => {
    mocked.fetchAnalyticsProperties.mockRejectedValue(new TypeError('offline'));
    const store = makeStore({ connectionSiteId: 'site-1' });
    await store.dispatch(loadGa4Properties('site-1'));
    expect(store.getState().google.analytics.propertiesError).toBe(
      "We couldn't load your Analytics properties. Try again in a moment.",
    );
  });
});

describe('setGa4Property', () => {
  it('stores the updated connection and invalidates the loaded summary', async () => {
    const updated: GoogleConnection = {
      ...ga4Connection,
      ga4PropertyId: 'properties/2',
      ga4PropertyDisplayName: 'Site two',
    };
    mocked.setConnectionProperty.mockResolvedValue({ connection: updated });
    const store = makeStore({
      connection: ga4Connection,
      loaded: true,
      analytics: {
        ...initial().analytics,
        summary: analyticsSummary,
        siteId: 'site-1',
        range: '28d',
        loaded: true,
        notEnabled: true,
      },
    });
    const result = await store.dispatch(
      setGa4Property({ siteId: 'site-1', ga4PropertyId: 'properties/2' }),
    );
    expect(setGa4Property.fulfilled.match(result)).toBe(true);
    expect(mocked.setConnectionProperty).toHaveBeenCalledWith('site-1', {
      ga4PropertyId: 'properties/2',
    });
    const state = store.getState().google;
    expect(state.connection).toEqual(updated);
    // The property changed → the summary must refetch.
    expect(state.analytics.loaded).toBe(false);
    expect(state.analytics.notEnabled).toBe(false);
    expect(state.analytics.settingProperty).toBe(false);
  });

  it('rejects with the server message', async () => {
    mocked.setConnectionProperty.mockRejectedValue(serverError('bad property', 400));
    const store = makeStore();
    await store.dispatch(setGa4Property({ siteId: 'site-1', ga4PropertyId: 'properties/9' }));
    expect(store.getState().google.analytics.setPropertyError).toBe('bad property');
  });

  it('rejects with the localized fallback on network failure', async () => {
    mocked.setConnectionProperty.mockRejectedValue(new TypeError('offline'));
    const store = makeStore();
    await store.dispatch(setGa4Property({ siteId: 'site-1', ga4PropertyId: 'properties/9' }));
    expect(store.getState().google.analytics.setPropertyError).toBe(
      "We couldn't save that Analytics property. Try again in a moment.",
    );
  });
});
