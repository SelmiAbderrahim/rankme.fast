import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '@shared/api/client';
import {
  completeConnection,
  disconnectConnection,
  fetchAnalyticsDetail,
  fetchAnalyticsProperties,
  fetchAnalyticsSummary,
  fetchSearchAnalyticsDetail,
  fetchSearchSummary,
  fetchSitemaps,
  getConnection,
  refreshAnalyticsSummary,
  refreshSearchSummary,
  revokeGoogleCredential,
  setConnectionProperty,
} from './api';

vi.mock('@shared/api/client', () => ({ apiClient: vi.fn() }));
const apiClient = vi.mocked(client.apiClient);

beforeEach(() => {
  vi.clearAllMocks();
  apiClient.mockResolvedValue({
    configuration: {
      connection: null,
      connectedSiteCount: 0,
      gsc: { propertyUrl: null, source: null, status: 'not_connected' },
      ga4: {
        propertyId: null,
        propertyDisplayName: null,
        matchedWebStreamUri: null,
        source: null,
        status: 'not_connected',
      },
      autoMatch: { requestedAt: null, completedAt: null, failureClass: null },
    },
  } as never);
});

describe('google api wrappers', () => {
  it('getConnection fetches the site configuration', async () => {
    await getConnection('site/1');
    expect(apiClient).toHaveBeenCalledWith(
      '/sites/site%2F1/google/configuration',
    );
  });

  it('getConnection flattens a connected configuration and returns live properties', async () => {
    apiClient
      .mockResolvedValueOnce({
        configuration: {
          connection: {
            status: 'connected',
            googleAccountEmail: 'owner@example.com',
            connectedAt: '2026-08-01T00:00:00.000Z',
            lastUsedAt: null,
            scopes: [],
          },
          connectedSiteCount: 2,
          gsc: {
            propertyUrl: 'sc-domain:example.com',
            source: 'manual',
            status: 'bound',
          },
          ga4: {
            propertyId: 'properties/123',
            propertyDisplayName: 'Example',
            matchedWebStreamUri: 'https://example.com',
            source: 'auto',
            status: 'bound',
          },
          autoMatch: { requestedAt: null, completedAt: null, failureClass: null },
        },
      } as never)
      .mockResolvedValueOnce({
        properties: [
          { siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' },
        ],
      } as never);

    await expect(getConnection('site-1')).resolves.toMatchObject({
      connection: {
        propertyUrl: 'sc-domain:example.com',
        ga4PropertyId: 'properties/123',
        connectedSiteCount: 2,
      },
      properties: [{ siteUrl: 'sc-domain:example.com' }],
    });
    expect(apiClient).toHaveBeenLastCalledWith('/sites/site-1/google/search-properties');
  });

  it('getConnection defaults a missing live property list to empty', async () => {
    apiClient
      .mockResolvedValueOnce({
        configuration: {
          connection: {
            status: 'connected',
            googleAccountEmail: 'owner@example.com',
            connectedAt: '2026-08-01T00:00:00.000Z',
            lastUsedAt: null,
            scopes: [],
          },
          connectedSiteCount: 1,
          gsc: { propertyUrl: null, source: null, status: 'unbound' },
          ga4: {
            propertyId: null,
            propertyDisplayName: null,
            matchedWebStreamUri: null,
            source: null,
            status: 'unbound',
          },
          autoMatch: { requestedAt: null, completedAt: null, failureClass: null },
        },
      } as never)
      .mockResolvedValueOnce({ properties: undefined } as never);

    await expect(getConnection('site-1')).resolves.toMatchObject({ properties: [] });
  });

  it('getConnection keeps connected configuration when the live property request fails', async () => {
    apiClient
      .mockResolvedValueOnce({
        configuration: {
          connection: {
            status: 'connected',
            googleAccountEmail: 'owner@example.com',
            connectedAt: '2026-08-01T00:00:00.000Z',
            lastUsedAt: null,
            scopes: [],
          },
          connectedSiteCount: 1,
          gsc: { propertyUrl: null, source: null, status: 'unbound' },
          ga4: {
            propertyId: null,
            propertyDisplayName: null,
            matchedWebStreamUri: null,
            source: null,
            status: 'unbound',
          },
          autoMatch: { requestedAt: null, completedAt: null, failureClass: null },
        },
      } as never)
      .mockRejectedValueOnce(new Error('temporary Google error'));

    await expect(getConnection('site-1')).resolves.toMatchObject({
      connection: { status: 'connected' },
      properties: [],
    });
  });

  it('getConnection does not request properties for a reconnecting credential', async () => {
    apiClient.mockResolvedValueOnce({
      configuration: {
        connection: {
          status: 'needs_reconnect',
          googleAccountEmail: 'owner@example.com',
          connectedAt: '2026-08-01T00:00:00.000Z',
          lastUsedAt: null,
          scopes: [],
        },
        connectedSiteCount: 1,
        gsc: { propertyUrl: null, source: null, status: 'not_connected' },
        ga4: {
          propertyId: null,
          propertyDisplayName: null,
          matchedWebStreamUri: null,
          source: null,
          status: 'not_connected',
        },
        autoMatch: { requestedAt: null, completedAt: null, failureClass: null },
      },
    } as never);

    await expect(getConnection('site-1')).resolves.toMatchObject({
      connection: { status: 'needs_reconnect' },
    });
    expect(apiClient).toHaveBeenCalledTimes(1);
  });

  it('completeConnection posts to the site connect endpoint with the body', async () => {
    await completeConnection('site-1', {
      refreshToken: 'rt',
      scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
      googleAccountEmail: 'a@b.co',
    });
    expect(apiClient).toHaveBeenCalledWith('/sites/site-1/google/connect/complete', {
      method: 'POST',
      body: {
        refreshToken: 'rt',
        scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
        googleAccountEmail: 'a@b.co',
      },
    });
  });

  it('setConnectionProperty patches the site binding with the body', async () => {
    await setConnectionProperty('site-1', { propertyUrl: 'sc-domain:example.com' });
    expect(apiClient).toHaveBeenCalledWith('/sites/site-1/google/bindings', {
      method: 'PATCH',
      body: { propertyUrl: 'sc-domain:example.com' },
    });
  });

  it('setConnectionProperty also accepts a GA4 property id body', async () => {
    await setConnectionProperty('site-1', { ga4PropertyId: 'properties/123' });
    expect(apiClient).toHaveBeenCalledWith('/sites/site-1/google/bindings', {
      method: 'PATCH',
      body: { ga4PropertyId: 'properties/123' },
    });
  });

  it('disconnectConnection unlinks only the site binding', async () => {
    await disconnectConnection('site-1');
    expect(apiClient).toHaveBeenCalledWith('/sites/site-1/google/bindings', {
      method: 'DELETE',
    });
  });

  it('revokeGoogleCredential acknowledges the account-wide revoke request', async () => {
    await revokeGoogleCredential('site/1');
    expect(apiClient).toHaveBeenCalledWith('/sites/site%2F1/google/credential/revoke', {
      method: 'POST',
      body: { acknowledgeAllSites: true },
    });
  });

  it('fetchSearchSummary fetches with an encoded siteId and the default range', async () => {
    await fetchSearchSummary('site/1');
    expect(apiClient).toHaveBeenCalledWith(
      '/sites/site%2F1/google/search-summary?range=28d',
    );
  });

  it('fetchSearchSummary forwards an explicit range', async () => {
    await fetchSearchSummary('site-1', '90d');
    expect(apiClient).toHaveBeenCalledWith(
      '/sites/site-1/google/search-summary?range=90d',
    );
  });

  it('refreshSearchSummary posts to the site endpoint', async () => {
    await refreshSearchSummary('site-1');
    expect(apiClient).toHaveBeenCalledWith('/sites/site-1/google/search-refresh', {
      method: 'POST',
      body: {},
    });
  });

  it('fetchSearchAnalyticsDetail fetches the dimension with siteId and default range', async () => {
    await fetchSearchAnalyticsDetail('site/1', 'query');
    expect(apiClient).toHaveBeenCalledWith(
      '/sites/site%2F1/google/search-analytics?dimension=query&range=28d',
    );
  });

  it('fetchSearchAnalyticsDetail forwards an explicit range', async () => {
    await fetchSearchAnalyticsDetail('site-1', 'page', '7d');
    expect(apiClient).toHaveBeenCalledWith(
      '/sites/site-1/google/search-analytics?dimension=page&range=7d',
    );
  });

  it('fetchSitemaps fetches the nested site endpoint', async () => {
    await fetchSitemaps('site/1');
    expect(apiClient).toHaveBeenCalledWith('/sites/site%2F1/google/sitemaps');
  });

  it('fetchAnalyticsSummary fetches with an encoded siteId and the default range', async () => {
    await fetchAnalyticsSummary('site/1');
    expect(apiClient).toHaveBeenCalledWith(
      '/sites/site%2F1/google/analytics-summary?range=28d',
    );
  });

  it('fetchAnalyticsSummary forwards an explicit range', async () => {
    await fetchAnalyticsSummary('site-1', '7d');
    expect(apiClient).toHaveBeenCalledWith(
      '/sites/site-1/google/analytics-summary?range=7d',
    );
  });

  it('refreshAnalyticsSummary posts to the nested site endpoint', async () => {
    await refreshAnalyticsSummary('site-1');
    expect(apiClient).toHaveBeenCalledWith('/sites/site-1/google/analytics-refresh', {
      method: 'POST',
      body: {},
    });
  });

  it('fetchAnalyticsDetail fetches the dimension with siteId and default range', async () => {
    await fetchAnalyticsDetail('site/1', 'channel');
    expect(apiClient).toHaveBeenCalledWith(
      '/sites/site%2F1/google/analytics-detail?dimension=channel&range=28d',
    );
  });

  it('fetchAnalyticsDetail forwards an explicit range', async () => {
    await fetchAnalyticsDetail('site-1', 'device', '90d');
    expect(apiClient).toHaveBeenCalledWith(
      '/sites/site-1/google/analytics-detail?dimension=device&range=90d',
    );
  });

  it('fetchAnalyticsProperties fetches the nested site endpoint', async () => {
    await fetchAnalyticsProperties('site-1');
    expect(apiClient).toHaveBeenCalledWith(
      '/sites/site-1/google/analytics-properties',
    );
  });
});
