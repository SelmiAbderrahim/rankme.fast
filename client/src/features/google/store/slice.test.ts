import { describe, expect, it } from 'vitest';
import { clearGoogleMessages, clearSetPropertyError, googleReducer } from './slice';
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
  revokeGoogle,
  setGa4Property,
  setGoogleProperty,
} from './thunks';
import {
  selectGoogleAnalytics,
  selectGoogleConnectError,
  selectGoogleConnecting,
  selectGoogleConnection,
  selectGoogleDetailRange,
  selectGoogleDetailSiteId,
  selectGoogleDisconnectError,
  selectGoogleDisconnecting,
  selectGoogleError,
  selectGoogleLoaded,
  selectGoogleLoading,
  selectGoogleMessage,
  selectGoogleProperties,
  selectGoogleSearchDetail,
  selectGoogleSearchSummary,
  selectGoogleSetPropertyError,
  selectGoogleSettingProperty,
  selectGoogleSitemaps,
  selectGoogleSitemapsSiteId,
  selectGoogleSummaryEmpty,
  selectGoogleSummaryError,
  selectGoogleSummaryLoaded,
  selectGoogleSummaryLoading,
  selectGoogleSummaryRange,
  selectGoogleSummaryRefreshing,
  selectGoogleSummarySiteId,
} from './selectors';
import type { RootState } from '@app/store';
import type {
  GoogleAnalyticsSummary,
  GoogleConnection,
  GoogleConnectionState,
  GoogleSearchSummary,
  GscProperty,
} from '../types';

const connection: GoogleConnection = {
  status: 'connected',
  googleAccountEmail: 'a@b.co',
  propertyUrl: 'https://example.com/',
  connectedAt: '2026-07-01T00:00:00.000Z',
  lastUsedAt: null,
};

const properties: GscProperty[] = [
  { siteUrl: 'https://example.com/', permissionLevel: 'siteOwner' },
  { siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' },
];
const siteId = 'site-1';

const initial = (): GoogleConnectionState => googleReducer(undefined, { type: '@@init' });
const current = (): GoogleConnectionState => ({
  ...initial(),
  connectionSiteId: siteId,
});

const body = {
  siteId,
  refreshToken: 'rt',
  scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
  googleAccountEmail: 'a@b.co',
};

describe('google slice — loadConnection', () => {
  it('pending sets loading and clears the error', () => {
    const state = googleReducer(
      { ...initial(), error: 'old' },
      loadConnection.pending('r1', siteId),
    );
    expect(state.loading).toBe(true);
    expect(state.error).toBeNull();
  });

  it('fulfilled stores the connection and marks loaded', () => {
    const state = googleReducer(
      current(),
      loadConnection.fulfilled({ connection, properties }, 'r1', siteId),
    );
    expect(state.loading).toBe(false);
    expect(state.loaded).toBe(true);
    expect(state.connection).toEqual(connection);
    expect(state.properties).toEqual(properties);
  });

  it('fulfilled defaults properties to an empty array when absent', () => {
    const state = googleReducer(
      current(),
      loadConnection.fulfilled({ connection }, 'r1', siteId),
    );
    expect(state.properties).toEqual([]);
  });

  it('rejected stores the payload error and marks loaded', () => {
    const state = googleReducer(
      current(),
      loadConnection.rejected(null, 'r1', siteId, 'load failed'),
    );
    expect(state.loading).toBe(false);
    expect(state.loaded).toBe(true);
    expect(state.error).toBe('load failed');
  });

  it('rejected without payload leaves error null', () => {
    const action = {
      type: loadConnection.rejected.type,
      meta: { arg: siteId },
      payload: undefined,
      error: { message: 'x' },
    };
    const state = googleReducer(current(), action as never);
    expect(state.error).toBeNull();
  });
});

describe('google slice — connectGoogle', () => {
  it('pending marks connecting and clears prior messages', () => {
    const seeded: GoogleConnectionState = {
      ...initial(),
      connectError: 'old',
      message: 'old',
    };
    const state = googleReducer(seeded, connectGoogle.pending('r1', body));
    expect(state.connecting).toBe(true);
    expect(state.connectError).toBeNull();
    expect(state.message).toBeNull();
  });

  it('fulfilled stores the returned connection', () => {
    const state = googleReducer(
      current(),
      connectGoogle.fulfilled({ connection }, 'r1', body),
    );
    expect(state.connecting).toBe(false);
    expect(state.connection).toEqual(connection);
  });

  it('fulfilled invalidates the analytics summary and property list', () => {
    const seeded: GoogleConnectionState = {
      ...current(),
      analytics: {
        ...initial().analytics,
        loaded: true,
        notEnabled: true,
        empty: true,
        error: 'stale',
        properties: [{ propertyId: 'properties/1', displayName: 'One' }],
        propertiesLoaded: true,
        propertiesError: 'stale',
      },
    };
    const state = googleReducer(
      seeded,
      connectGoogle.fulfilled({ connection }, 'r1', body),
    );
    // A (re)link may have granted the GA4 scope — everything refetches.
    expect(state.analytics.loaded).toBe(false);
    expect(state.analytics.notEnabled).toBe(false);
    expect(state.analytics.empty).toBe(false);
    expect(state.analytics.error).toBeNull();
    expect(state.analytics.properties).toEqual([]);
    expect(state.analytics.propertiesLoaded).toBe(false);
    expect(state.analytics.propertiesError).toBeNull();
  });

  it('rejected records the error', () => {
    const state = googleReducer(
      initial(),
      connectGoogle.rejected(null, 'r1', body, 'missing scope'),
    );
    expect(state.connecting).toBe(false);
    expect(state.connectError).toBe('missing scope');
  });

  it('rejected without payload leaves connectError null', () => {
    const action = {
      type: connectGoogle.rejected.type,
      meta: { arg: body },
      payload: undefined,
      error: { message: 'x' },
    };
    const state = googleReducer(initial(), action as never);
    expect(state.connectError).toBeNull();
  });
});

describe('google slice — disconnectGoogle', () => {
  it('pending marks disconnecting and clears prior messages', () => {
    const seeded: GoogleConnectionState = {
      ...initial(),
      disconnectError: 'old',
      message: 'old',
    };
    const state = googleReducer(seeded, disconnectGoogle.pending('r1', siteId));
    expect(state.disconnecting).toBe(true);
    expect(state.disconnectError).toBeNull();
    expect(state.message).toBeNull();
  });

  it('fulfilled clears the connection and records the message', () => {
    const seeded: GoogleConnectionState = { ...current(), connection };
    const state = googleReducer(
      seeded,
      disconnectGoogle.fulfilled({ message: 'Bye.', connection: null }, 'r1', siteId),
    );
    expect(state.disconnecting).toBe(false);
    expect(state.connection).toBeNull();
    expect(state.message).toBe('Bye.');
  });

  it('rejected records the error', () => {
    const state = googleReducer(
      current(),
      disconnectGoogle.rejected(null, 'r1', siteId, 'nope'),
    );
    expect(state.disconnecting).toBe(false);
    expect(state.disconnectError).toBe('nope');
  });

  it('rejected without payload leaves disconnectError null', () => {
    const action = {
      type: disconnectGoogle.rejected.type,
      meta: { arg: siteId },
      payload: undefined,
      error: { message: 'x' },
    };
    const state = googleReducer(current(), action as never);
    expect(state.disconnectError).toBeNull();
  });
});

describe('google slice — setGoogleProperty', () => {
  const arg = { siteId, propertyUrl: 'sc-domain:example.com' };

  it('pending marks settingProperty and clears prior messages', () => {
    const seeded: GoogleConnectionState = {
      ...initial(),
      setPropertyError: 'old',
      message: 'old',
    };
    const state = googleReducer(seeded, setGoogleProperty.pending('r1', arg));
    expect(state.settingProperty).toBe(true);
    expect(state.setPropertyError).toBeNull();
    expect(state.message).toBeNull();
  });

  it('fulfilled stores the updated connection', () => {
    const updated: GoogleConnection = { ...connection, propertyUrl: 'sc-domain:example.com' };
    const state = googleReducer(
      { ...current(), settingProperty: true },
      setGoogleProperty.fulfilled({ connection: updated }, 'r1', arg),
    );
    expect(state.settingProperty).toBe(false);
    expect(state.connection).toEqual(updated);
  });

  it('rejected records the error', () => {
    const state = googleReducer(
      initial(),
      setGoogleProperty.rejected(null, 'r1', arg, 'invalid property'),
    );
    expect(state.settingProperty).toBe(false);
    expect(state.setPropertyError).toBe('invalid property');
  });

  it('rejected without payload leaves setPropertyError null', () => {
    const action = {
      type: setGoogleProperty.rejected.type,
      meta: { arg },
      payload: undefined,
      error: { message: 'x' },
    };
    const state = googleReducer(initial(), action as never);
    expect(state.setPropertyError).toBeNull();
  });

  it('clearSetPropertyError resets the field', () => {
    const seeded: GoogleConnectionState = { ...initial(), setPropertyError: 'x' };
    const state = googleReducer(seeded, clearSetPropertyError());
    expect(state.setPropertyError).toBeNull();
  });
});

describe('google slice — stale site responses', () => {
  it('ignores fulfilled and rejected actions that belong to another site', () => {
    const seeded: GoogleConnectionState = {
      ...current(),
      connection,
      properties,
      loaded: true,
      analytics: {
        ...initial().analytics,
        properties: [{ propertyId: 'properties/1', displayName: 'One' }],
        propertiesLoaded: true,
      },
    };
    const otherSite = 'site-2';
    const otherBody = { ...body, siteId: otherSite };
    const otherGscArg = { siteId: otherSite, propertyUrl: 'sc-domain:other.example' };
    const otherGa4Arg = { siteId: otherSite, ga4PropertyId: 'properties/2' };
    const updated = { ...connection, propertyUrl: 'sc-domain:other.example' };
    const ignoredActions = [
      loadConnection.fulfilled({ connection: updated, properties: [] }, 'r1', otherSite),
      loadConnection.rejected(null, 'r2', otherSite, 'stale load'),
      connectGoogle.fulfilled({ connection: updated }, 'r3', otherBody),
      setGoogleProperty.fulfilled({ connection: updated }, 'r4', otherGscArg),
      disconnectGoogle.fulfilled(
        { connection: null, message: 'site_unlinked' },
        'r5',
        otherSite,
      ),
      disconnectGoogle.rejected(null, 'r6', otherSite, 'stale disconnect'),
      revokeGoogle.fulfilled({ ok: true, affectedSiteCount: 1 }, 'r7', otherSite),
      revokeGoogle.rejected(null, 'r8', otherSite, 'stale revoke'),
      loadGa4Properties.pending('r9', otherSite),
      loadGa4Properties.fulfilled({ properties: [] }, 'r10', otherSite),
      loadGa4Properties.rejected(
        null,
        'r11',
        otherSite,
        'stale properties',
      ),
      setGa4Property.fulfilled({ connection: updated }, 'r12', otherGa4Arg),
    ];

    for (const action of ignoredActions) {
      expect(googleReducer(seeded, action)).toEqual(seeded);
    }
  });

  it('keeps revokeError null when a matching rejection has no payload', () => {
    const action = {
      type: revokeGoogle.rejected.type,
      meta: { arg: siteId },
      payload: undefined,
      error: { message: 'network error' },
    };

    expect(googleReducer(current(), action as never).revokeError).toBeNull();
  });
});

describe('google slice — loadSearchSummary', () => {
  it('fulfilled stores the range alongside the site key', () => {
    const summary: GoogleSearchSummary = {
      totalClicks: 1,
      totalImpressions: 2,
      averageCtr: 0.5,
      averagePosition: 1,
      topQueries: [],
      topPages: [],
      asOf: '2026-07-04',
      previousPeriod: null,
    };
    const state = googleReducer(
      initial(),
      loadSearchSummary.fulfilled(
        { siteId: 'site-1', range: '7d', summary },
        'r1',
        { siteId: 'site-1', range: '7d' },
      ),
    );
    expect(state.summarySiteId).toBe('site-1');
    expect(state.summaryRange).toBe('7d');
    expect(state.summary).toEqual(summary);
  });

  it('rejected without payload leaves summaryError null', () => {
    const action = {
      type: loadSearchSummary.rejected.type,
      meta: { arg: { siteId: 'site-1' } },
      payload: undefined,
      error: { message: 'x' },
    };
    const state = googleReducer(initial(), action as never);
    expect(state.summaryError).toBeNull();
    expect(state.summaryLoaded).toBe(true);
  });
});

describe('google slice — refreshSearchSummary', () => {
  const summary: GoogleSearchSummary = {
    totalClicks: 20,
    totalImpressions: 2000,
    averageCtr: 0.02,
    averagePosition: 4.5,
    topQueries: [],
    topPages: [],
    asOf: '2026-07-05',
    previousPeriod: null,
  };
  const arg = { siteId: 'site-1', range: '28d' as const };

  it('starts with summaryRefreshing false', () => {
    expect(initial().summaryRefreshing).toBe(false);
  });

  it('pending marks refreshing, clears the error, and keeps the current summary', () => {
    const seeded: GoogleConnectionState = {
      ...initial(),
      summary,
      summaryError: 'old',
    };
    const state = googleReducer(seeded, refreshSearchSummary.pending('r1', arg));
    expect(state.summaryRefreshing).toBe(true);
    expect(state.summaryError).toBeNull();
    expect(state.summary).toEqual(summary);
  });

  it('fulfilled stores the refreshed summary + range and clears the refreshing flag', () => {
    const state = googleReducer(
      { ...initial(), summaryRefreshing: true },
      refreshSearchSummary.fulfilled(
        { siteId: 'site-1', range: '28d', summary },
        'r1',
        arg,
      ),
    );
    expect(state.summaryRefreshing).toBe(false);
    expect(state.summaryLoaded).toBe(true);
    expect(state.summarySiteId).toBe('site-1');
    expect(state.summaryRange).toBe('28d');
    expect(state.summary).toEqual(summary);
    expect(state.summaryEmpty).toBe(false);
  });

  it('fulfilled with a null summary marks the empty state', () => {
    const state = googleReducer(
      { ...initial(), summaryRefreshing: true },
      refreshSearchSummary.fulfilled(
        { siteId: 'site-1', range: '28d', summary: null },
        'r1',
        arg,
      ),
    );
    expect(state.summary).toBeNull();
    expect(state.summaryEmpty).toBe(true);
  });

  it('rejected records the error and leaves the existing summary intact', () => {
    const seeded: GoogleConnectionState = {
      ...initial(),
      summary,
      summaryRefreshing: true,
    };
    const state = googleReducer(
      seeded,
      refreshSearchSummary.rejected(null, 'r1', arg, 'boom'),
    );
    expect(state.summaryRefreshing).toBe(false);
    expect(state.summaryError).toBe('boom');
    expect(state.summary).toEqual(summary);
  });

  it('rejected without payload leaves summaryError null', () => {
    const action = {
      type: refreshSearchSummary.rejected.type,
      meta: { arg },
      payload: undefined,
      error: { message: 'x' },
    };
    const state = googleReducer(initial(), action as never);
    expect(state.summaryError).toBeNull();
    expect(state.summaryRefreshing).toBe(false);
  });
});

describe('google slice — loadSearchAnalyticsDetail (drill-in)', () => {
  const arg = { siteId: 'site-1', dimension: 'query' as const };
  const rows = [
    { key: 'seo audit', clicks: 12, impressions: 1200, ctr: 0.01, position: 4.2 },
  ];

  const keyedTo = (siteId: string): GoogleConnectionState =>
    googleReducer(initial(), loadSearchAnalyticsDetail.pending('r0', { siteId, dimension: 'query' }));

  it('pending re-keys to the new site + default range and marks the dimension loading', () => {
    const state = keyedTo('site-1');
    expect(state.detailSiteId).toBe('site-1');
    expect(state.detailRange).toBe('28d');
    expect(state.detail.query.loading).toBe(true);
    expect(state.detail.query.error).toBeNull();
  });

  it('pending for the SAME site + range keeps the other dimensions intact', () => {
    const seeded = googleReducer(
      keyedTo('site-1'),
      loadSearchAnalyticsDetail.fulfilled(
        { siteId: 'site-1', dimension: 'query', range: '28d', detail: { asOf: '2026-07-04', rows } },
        'r0',
        arg,
      ),
    );
    const state = googleReducer(
      seeded,
      loadSearchAnalyticsDetail.pending('r1', { siteId: 'site-1', dimension: 'page' }),
    );
    // No re-key: the query rows survive while page loads.
    expect(state.detail.query.rows).toEqual(rows);
    expect(state.detail.page.loading).toBe(true);
  });

  it('pending for the SAME site but a NEW range re-keys every dimension', () => {
    const seeded = googleReducer(
      keyedTo('site-1'),
      loadSearchAnalyticsDetail.fulfilled(
        { siteId: 'site-1', dimension: 'query', range: '28d', detail: { asOf: '2026-07-04', rows } },
        'r0',
        arg,
      ),
    );
    const state = googleReducer(
      seeded,
      loadSearchAnalyticsDetail.pending('r1', {
        siteId: 'site-1',
        dimension: 'page',
        range: '7d',
      }),
    );
    expect(state.detailRange).toBe('7d');
    expect(state.detail.query.rows).toEqual([]);
    expect(state.detail.query.loaded).toBe(false);
    expect(state.detail.page.loading).toBe(true);
  });

  it('fulfilled ignores a stale response for another site', () => {
    const state = googleReducer(
      keyedTo('site-2'),
      loadSearchAnalyticsDetail.fulfilled(
        { siteId: 'site-1', dimension: 'query', range: '28d', detail: { asOf: '2026-07-04', rows } },
        'r1',
        arg,
      ),
    );
    expect(state.detailSiteId).toBe('site-2');
    expect(state.detail.query.rows).toEqual([]);
    expect(state.detail.query.loaded).toBe(false);
  });

  it('fulfilled ignores a stale response for another range', () => {
    const state = googleReducer(
      keyedTo('site-1'),
      loadSearchAnalyticsDetail.fulfilled(
        { siteId: 'site-1', dimension: 'query', range: '90d', detail: { asOf: '2026-07-04', rows } },
        'r1',
        { ...arg, range: '90d' },
      ),
    );
    expect(state.detailRange).toBe('28d');
    expect(state.detail.query.rows).toEqual([]);
    expect(state.detail.query.loaded).toBe(false);
  });

  it('rejected ignores a stale failure for another site', () => {
    const state = googleReducer(
      keyedTo('site-2'),
      loadSearchAnalyticsDetail.rejected(null, 'r1', arg, 'boom'),
    );
    expect(state.detail.query.error).toBeNull();
    expect(state.detail.query.loaded).toBe(false);
  });

  it('rejected ignores a stale failure for another range', () => {
    const state = googleReducer(
      keyedTo('site-1'),
      loadSearchAnalyticsDetail.rejected(null, 'r1', { ...arg, range: '90d' }, 'boom'),
    );
    expect(state.detail.query.error).toBeNull();
    expect(state.detail.query.loaded).toBe(false);
  });

  it('rejected records the payload error for the current site', () => {
    const state = googleReducer(
      keyedTo('site-1'),
      loadSearchAnalyticsDetail.rejected(null, 'r1', arg, 'boom'),
    );
    expect(state.detail.query.loading).toBe(false);
    expect(state.detail.query.loaded).toBe(true);
    expect(state.detail.query.error).toBe('boom');
  });

  it('rejected without payload leaves the error null', () => {
    const action = {
      type: loadSearchAnalyticsDetail.rejected.type,
      meta: { arg },
      payload: undefined,
      error: { message: 'x' },
    };
    const state = googleReducer(keyedTo('site-1'), action as never);
    expect(state.detail.query.error).toBeNull();
    expect(state.detail.query.loaded).toBe(true);
  });

  it('fulfilled with a null detail marks the empty state', () => {
    const state = googleReducer(
      keyedTo('site-1'),
      loadSearchAnalyticsDetail.fulfilled(
        { siteId: 'site-1', dimension: 'query', range: '28d', detail: null },
        'r1',
        arg,
      ),
    );
    expect(state.detail.query.rows).toEqual([]);
    expect(state.detail.query.asOf).toBeNull();
    expect(state.detail.query.empty).toBe(true);
  });
});

describe('google slice — loadSitemaps (drill-in)', () => {
  const sitemaps = [
    {
      path: 'https://example.com/sitemap.xml',
      type: 'sitemap',
      lastSubmitted: null,
      lastDownloaded: null,
      isPending: true,
      isSitemapsIndex: false,
      errors: 0,
      warnings: 0,
      processed: 0,
    },
  ];

  const keyedTo = (siteId: string): GoogleConnectionState =>
    googleReducer(initial(), loadSitemaps.pending('r0', siteId));

  it('pending re-keys to the new site and marks loading', () => {
    const state = keyedTo('site-1');
    expect(state.sitemapsSiteId).toBe('site-1');
    expect(state.sitemaps.loading).toBe(true);
    expect(state.sitemaps.error).toBeNull();
  });

  it('pending for the SAME site clears the error without wiping items', () => {
    const seeded = googleReducer(
      keyedTo('site-1'),
      loadSitemaps.fulfilled({ siteId: 'site-1', asOf: '2026-07-04', sitemaps }, 'r0', 'site-1'),
    );
    const state = googleReducer(seeded, loadSitemaps.pending('r1', 'site-1'));
    expect(state.sitemaps.items).toEqual(sitemaps);
    expect(state.sitemaps.loading).toBe(true);
  });

  it('fulfilled ignores a stale response for another site', () => {
    const state = googleReducer(
      keyedTo('site-2'),
      loadSitemaps.fulfilled({ siteId: 'site-1', asOf: '2026-07-04', sitemaps }, 'r1', 'site-1'),
    );
    expect(state.sitemaps.items).toEqual([]);
    expect(state.sitemaps.loaded).toBe(false);
  });

  it('rejected ignores a stale failure for another site', () => {
    const state = googleReducer(
      keyedTo('site-2'),
      loadSitemaps.rejected(null, 'r1', 'site-1', 'boom'),
    );
    expect(state.sitemaps.error).toBeNull();
    expect(state.sitemaps.loaded).toBe(false);
  });

  it('rejected records the payload error for the current site', () => {
    const state = googleReducer(
      keyedTo('site-1'),
      loadSitemaps.rejected(null, 'r1', 'site-1', 'boom'),
    );
    expect(state.sitemaps.error).toBe('boom');
    expect(state.sitemaps.loaded).toBe(true);
  });

  it('rejected without payload leaves the error null', () => {
    const action = {
      type: loadSitemaps.rejected.type,
      meta: { arg: 'site-1' },
      payload: undefined,
      error: { message: 'x' },
    };
    const state = googleReducer(keyedTo('site-1'), action as never);
    expect(state.sitemaps.error).toBeNull();
    expect(state.sitemaps.loaded).toBe(true);
  });
});

const analyticsSummary: GoogleAnalyticsSummary = {
  totalSessions: 400,
  totalActiveUsers: 300,
  totalEngagedSessions: 240,
  totalKeyEvents: 12,
  engagementRate: 0.6,
  timeseries: [],
  channels: [],
  topPages: [],
  countries: [],
  devices: [],
  asOf: '2026-07-10',
  previousPeriod: null,
};

describe('google slice — loadAnalyticsSummary (GA4)', () => {
  const arg = { siteId: 'site-1', range: '28d' as const };
  const payload = {
    siteId: 'site-1',
    range: '28d' as const,
    summary: analyticsSummary,
    notEnabled: false,
  };

  const keyedTo = (siteId: string): GoogleConnectionState =>
    googleReducer(initial(), loadAnalyticsSummary.pending('r0', { siteId }));

  it('pending re-keys to a new site: the previous summary is dropped immediately', () => {
    const seeded = googleReducer(keyedTo('site-1'), loadAnalyticsSummary.fulfilled(payload, 'r0', arg));
    expect(seeded.analytics.summary).toEqual(analyticsSummary);
    const state = googleReducer(
      seeded,
      loadAnalyticsSummary.pending('r1', { siteId: 'site-2' }),
    );
    expect(state.analytics.siteId).toBe('site-2');
    expect(state.analytics.summary).toBeNull();
    expect(state.analytics.loaded).toBe(false);
    expect(state.analytics.notEnabled).toBe(false);
    expect(state.analytics.loading).toBe(true);
  });

  it('pending for the SAME site keeps the summary visible under the skeleton', () => {
    const seeded = googleReducer(keyedTo('site-1'), loadAnalyticsSummary.fulfilled(payload, 'r0', arg));
    const state = googleReducer(
      seeded,
      loadAnalyticsSummary.pending('r1', { siteId: 'site-1', range: '7d' }),
    );
    expect(state.analytics.summary).toEqual(analyticsSummary);
    expect(state.analytics.range).toBe('7d');
    expect(state.analytics.loading).toBe(true);
  });

  it('fulfilled ignores a stale response for another site', () => {
    const state = googleReducer(
      keyedTo('site-2'),
      loadAnalyticsSummary.fulfilled(payload, 'r1', arg),
    );
    expect(state.analytics.summary).toBeNull();
    expect(state.analytics.loaded).toBe(false);
  });

  it('fulfilled ignores a stale response for another range', () => {
    const state = googleReducer(
      keyedTo('site-1'),
      loadAnalyticsSummary.fulfilled(
        { ...payload, range: '90d' },
        'r1',
        { siteId: 'site-1', range: '90d' },
      ),
    );
    expect(state.analytics.summary).toBeNull();
    expect(state.analytics.loaded).toBe(false);
  });

  it('fulfilled with notEnabled marks the NOT ENABLED state (never empty)', () => {
    const state = googleReducer(
      keyedTo('site-1'),
      loadAnalyticsSummary.fulfilled(
        { ...payload, summary: null, notEnabled: true },
        'r1',
        arg,
      ),
    );
    expect(state.analytics.notEnabled).toBe(true);
    expect(state.analytics.empty).toBe(false);
  });

  it('fulfilled with a bare null summary marks the empty state', () => {
    const state = googleReducer(
      keyedTo('site-1'),
      loadAnalyticsSummary.fulfilled({ ...payload, summary: null }, 'r1', arg),
    );
    expect(state.analytics.empty).toBe(true);
  });

  it('rejected records the payload error for the current key', () => {
    const state = googleReducer(
      keyedTo('site-1'),
      loadAnalyticsSummary.rejected(null, 'r1', arg, 'boom'),
    );
    expect(state.analytics.loading).toBe(false);
    expect(state.analytics.loaded).toBe(true);
    expect(state.analytics.error).toBe('boom');
  });

  it('rejected ignores a stale failure for another site', () => {
    const state = googleReducer(
      keyedTo('site-2'),
      loadAnalyticsSummary.rejected(null, 'r1', arg, 'boom'),
    );
    expect(state.analytics.error).toBeNull();
    expect(state.analytics.loaded).toBe(false);
  });

  it('rejected ignores a stale failure for another range', () => {
    const state = googleReducer(
      keyedTo('site-1'),
      loadAnalyticsSummary.rejected(null, 'r1', { siteId: 'site-1', range: '90d' }, 'boom'),
    );
    expect(state.analytics.error).toBeNull();
  });

  it('rejected without payload leaves the error null', () => {
    const action = {
      type: loadAnalyticsSummary.rejected.type,
      meta: { arg },
      payload: undefined,
      error: { message: 'x' },
    };
    const state = googleReducer(keyedTo('site-1'), action as never);
    expect(state.analytics.error).toBeNull();
    expect(state.analytics.loaded).toBe(true);
  });
});

describe('google slice — refreshAnalyticsSummary (GA4)', () => {
  const arg = { siteId: 'site-1', range: '28d' as const };
  const payload = {
    siteId: 'site-1',
    range: '28d' as const,
    summary: analyticsSummary,
    notEnabled: false,
  };

  it('pending marks refreshing, clears the error, and keeps the current summary', () => {
    const seeded: GoogleConnectionState = {
      ...initial(),
      analytics: { ...initial().analytics, summary: analyticsSummary, error: 'old' },
    };
    const state = googleReducer(seeded, refreshAnalyticsSummary.pending('r1', arg));
    expect(state.analytics.refreshing).toBe(true);
    expect(state.analytics.error).toBeNull();
    expect(state.analytics.summary).toEqual(analyticsSummary);
  });

  it('fulfilled stores the refreshed summary keyed to site + range', () => {
    const state = googleReducer(
      initial(),
      refreshAnalyticsSummary.fulfilled(payload, 'r1', arg),
    );
    expect(state.analytics.refreshing).toBe(false);
    expect(state.analytics.loaded).toBe(true);
    expect(state.analytics.siteId).toBe('site-1');
    expect(state.analytics.range).toBe('28d');
    expect(state.analytics.summary).toEqual(analyticsSummary);
    expect(state.analytics.empty).toBe(false);
  });

  it('rejected records the error and leaves the summary intact', () => {
    const seeded: GoogleConnectionState = {
      ...initial(),
      analytics: {
        ...initial().analytics,
        summary: analyticsSummary,
        refreshing: true,
      },
    };
    const state = googleReducer(
      seeded,
      refreshAnalyticsSummary.rejected(null, 'r1', arg, 'boom'),
    );
    expect(state.analytics.refreshing).toBe(false);
    expect(state.analytics.error).toBe('boom');
    expect(state.analytics.summary).toEqual(analyticsSummary);
  });

  it('rejected without payload leaves the error null', () => {
    const action = {
      type: refreshAnalyticsSummary.rejected.type,
      meta: { arg },
      payload: undefined,
      error: { message: 'x' },
    };
    const state = googleReducer(initial(), action as never);
    expect(state.analytics.error).toBeNull();
    expect(state.analytics.refreshing).toBe(false);
  });
});

describe('google slice — loadGa4Properties', () => {
  const properties = [{ propertyId: 'properties/1', displayName: 'One' }];

  it('pending marks loading and clears the previous error', () => {
    const seeded: GoogleConnectionState = {
      ...current(),
      analytics: { ...initial().analytics, propertiesError: 'old' },
    };
    const state = googleReducer(seeded, loadGa4Properties.pending('r1', siteId));
    expect(state.analytics.propertiesLoading).toBe(true);
    expect(state.analytics.propertiesError).toBeNull();
  });

  it('fulfilled stores the properties', () => {
    const state = googleReducer(
      current(),
      loadGa4Properties.fulfilled({ properties }, 'r1', siteId),
    );
    expect(state.analytics.properties).toEqual(properties);
    expect(state.analytics.propertiesLoaded).toBe(true);
  });

  it('rejected records the error', () => {
    const state = googleReducer(
      current(),
      loadGa4Properties.rejected(null, 'r1', siteId, 'nope'),
    );
    expect(state.analytics.propertiesError).toBe('nope');
    expect(state.analytics.propertiesLoaded).toBe(true);
  });

  it('rejected without payload leaves the error null', () => {
    const action = {
      type: loadGa4Properties.rejected.type,
      meta: { arg: siteId },
      payload: undefined,
      error: { message: 'x' },
    };
    const state = googleReducer(current(), action as never);
    expect(state.analytics.propertiesError).toBeNull();
  });
});

describe('google slice — setGa4Property', () => {
  const arg = { siteId, ga4PropertyId: 'properties/2' };

  it('pending marks settingProperty and clears the previous error', () => {
    const seeded: GoogleConnectionState = {
      ...initial(),
      analytics: { ...initial().analytics, setPropertyError: 'old' },
    };
    const state = googleReducer(seeded, setGa4Property.pending('r1', arg));
    expect(state.analytics.settingProperty).toBe(true);
    expect(state.analytics.setPropertyError).toBeNull();
  });

  it('fulfilled stores the connection and invalidates the analytics summary', () => {
    const updated: GoogleConnection = { ...connection, ga4PropertyId: 'properties/2' };
    const seeded: GoogleConnectionState = {
      ...current(),
      analytics: {
        ...initial().analytics,
        settingProperty: true,
        loaded: true,
        notEnabled: true,
        empty: true,
        error: 'stale',
      },
    };
    const state = googleReducer(
      seeded,
      setGa4Property.fulfilled({ connection: updated }, 'r1', arg),
    );
    expect(state.analytics.settingProperty).toBe(false);
    expect(state.connection).toEqual(updated);
    expect(state.analytics.loaded).toBe(false);
    expect(state.analytics.notEnabled).toBe(false);
    expect(state.analytics.empty).toBe(false);
    expect(state.analytics.error).toBeNull();
  });

  it('rejected records the error', () => {
    const state = googleReducer(
      initial(),
      setGa4Property.rejected(null, 'r1', arg, 'nope'),
    );
    expect(state.analytics.settingProperty).toBe(false);
    expect(state.analytics.setPropertyError).toBe('nope');
  });

  it('rejected without payload leaves the error null', () => {
    const action = {
      type: setGa4Property.rejected.type,
      meta: { arg },
      payload: undefined,
      error: { message: 'x' },
    };
    const state = googleReducer(initial(), action as never);
    expect(state.analytics.setPropertyError).toBeNull();
  });
});

describe('google slice — clearGoogleMessages', () => {
  it('resets every transient message field', () => {
    const seeded: GoogleConnectionState = {
      ...initial(),
      error: 'a',
      connectError: 'b',
      disconnectError: 'c',
      message: 'd',
    };
    const state = googleReducer(seeded, clearGoogleMessages());
    expect(state.error).toBeNull();
    expect(state.connectError).toBeNull();
    expect(state.disconnectError).toBeNull();
    expect(state.message).toBeNull();
  });
});

describe('google selectors', () => {
  it('each selector reads its slice field', () => {
    const google: GoogleConnectionState = {
      connection,
      connectionSiteId: siteId,
      properties,
      loading: true,
      loaded: true,
      error: 'e',
      connecting: true,
      connectError: 'ce',
      settingProperty: true,
      setPropertyError: 'spe',
      disconnecting: true,
      disconnectError: 'de',
      revoking: true,
      revokeError: 're',
      message: 'm',
      summary: null,
      summarySiteId: 'site-1',
      summaryRange: '7d',
      summaryLoading: true,
      summaryLoaded: true,
      summaryRefreshing: true,
      summaryEmpty: true,
      summaryError: 'se',
      detailSiteId: 'site-1',
      detailRange: '90d',
      detail: initial().detail,
      sitemapsSiteId: 'site-2',
      sitemaps: initial().sitemaps,
      analytics: initial().analytics,
    };
    const state = { google } as RootState;
    expect(selectGoogleConnection(state)).toEqual(connection);
    expect(selectGoogleLoading(state)).toBe(true);
    expect(selectGoogleLoaded(state)).toBe(true);
    expect(selectGoogleError(state)).toBe('e');
    expect(selectGoogleConnecting(state)).toBe(true);
    expect(selectGoogleConnectError(state)).toBe('ce');
    expect(selectGoogleDisconnecting(state)).toBe(true);
    expect(selectGoogleDisconnectError(state)).toBe('de');
    expect(selectGoogleMessage(state)).toBe('m');
    expect(selectGoogleProperties(state)).toEqual(properties);
    expect(selectGoogleSettingProperty(state)).toBe(true);
    expect(selectGoogleSetPropertyError(state)).toBe('spe');
    expect(selectGoogleSearchSummary(state)).toBeNull();
    expect(selectGoogleSummarySiteId(state)).toBe('site-1');
    expect(selectGoogleSummaryRange(state)).toBe('7d');
    expect(selectGoogleSummaryLoading(state)).toBe(true);
    expect(selectGoogleSummaryLoaded(state)).toBe(true);
    expect(selectGoogleSummaryRefreshing(state)).toBe(true);
    expect(selectGoogleSummaryEmpty(state)).toBe(true);
    expect(selectGoogleSummaryError(state)).toBe('se');
    expect(selectGoogleSearchDetail(state)).toBe(google.detail);
    expect(selectGoogleDetailSiteId(state)).toBe('site-1');
    expect(selectGoogleDetailRange(state)).toBe('90d');
    expect(selectGoogleSitemaps(state)).toBe(google.sitemaps);
    expect(selectGoogleSitemapsSiteId(state)).toBe('site-2');
    expect(selectGoogleAnalytics(state)).toBe(google.analytics);
  });
});
