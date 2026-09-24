import { apiClient } from '@shared/api/client';
import { DEFAULT_GOOGLE_RANGE } from './lib/range';
import type {
  CompleteGoogleConnectionBody,
  CompleteGoogleConnectionResponse,
  DisconnectGoogleResponse,
  GetAnalyticsDetailResponse,
  GetAnalyticsPropertiesResponse,
  GetAnalyticsSummaryResponse,
  GetGoogleConnectionResponse,
  GetSearchAnalyticsDetailResponse,
  GetSearchSummaryResponse,
  GetSitemapsResponse,
  GoogleAnalyticsDimension,
  GoogleConnection,
  GoogleRange,
  GscSearchDimension,
  RevokeGoogleResponse,
  SetGooglePropertyBody,
  SetGooglePropertyResponse,
  SiteGoogleConfiguration,
} from './types';

interface ConfigurationResponse {
  configuration: SiteGoogleConfiguration;
}

const siteGooglePath = (siteId: string, suffix: string): string =>
  `/sites/${encodeURIComponent(siteId)}/google${suffix}`;

const flattenConfiguration = (
  configuration: SiteGoogleConfiguration,
): GoogleConnection | null =>
  configuration.connection
    ? {
        ...configuration.connection,
        propertyUrl: configuration.gsc.propertyUrl,
        ga4PropertyId: configuration.ga4.propertyId,
        ga4PropertyDisplayName: configuration.ga4.propertyDisplayName,
        gscStatus: configuration.gsc.status,
        ga4Status: configuration.ga4.status,
        gscBindingSource: configuration.gsc.source,
        ga4BindingSource: configuration.ga4.source,
        connectedSiteCount: configuration.connectedSiteCount,
      }
    : null;

export const getConnection = async (
  siteId: string,
): Promise<GetGoogleConnectionResponse> => {
  const connection = await getConnectionConfiguration(siteId);
  if (!connection || connection.status !== 'connected') return { connection };
  try {
    const { properties } = await apiClient<{ properties: GetGoogleConnectionResponse['properties'] }>(
      siteGooglePath(siteId, '/search-properties'),
    );
    return { connection, properties: properties ?? [] };
  } catch {
    // Configuration remains usable when Google temporarily refuses the live
    // property-list request; the picker can be retried on the next load.
    return { connection, properties: [] };
  }
};

export const getConnectionConfiguration = async (
  siteId: string,
): Promise<GoogleConnection | null> => {
  const { configuration } = await apiClient<ConfigurationResponse>(
    siteGooglePath(siteId, '/configuration'),
  );
  return flattenConfiguration(configuration);
};

export const completeConnection = (
  siteId: string,
  body: CompleteGoogleConnectionBody,
): Promise<CompleteGoogleConnectionResponse> =>
  apiClient<ConfigurationResponse>(siteGooglePath(siteId, '/connect/complete'), {
    method: 'POST',
    body,
  }).then(({ configuration }) => ({ connection: flattenConfiguration(configuration)! }));

export const setConnectionProperty = (
  siteId: string,
  body: SetGooglePropertyBody,
): Promise<SetGooglePropertyResponse> =>
  apiClient<ConfigurationResponse>(siteGooglePath(siteId, '/bindings'), {
    method: 'PATCH',
    body,
  }).then(({ configuration }) => ({ connection: flattenConfiguration(configuration)! }));

export const disconnectConnection = (
  siteId: string,
): Promise<DisconnectGoogleResponse> =>
  apiClient<ConfigurationResponse>(siteGooglePath(siteId, '/bindings'), {
    method: 'DELETE',
  }).then(({ configuration }) => ({
    connection: flattenConfiguration(configuration),
    message: 'site_unlinked',
  }));

export const revokeGoogleCredential = (
  siteId: string,
): Promise<RevokeGoogleResponse> =>
  apiClient<RevokeGoogleResponse>(siteGooglePath(siteId, '/credential/revoke'), {
    method: 'POST',
    body: { acknowledgeAllSites: true },
  });

export const fetchSearchSummary = (
  siteId: string,
  range: GoogleRange = DEFAULT_GOOGLE_RANGE,
): Promise<GetSearchSummaryResponse> =>
  apiClient<GetSearchSummaryResponse>(
    `${siteGooglePath(siteId, '/search-summary')}?range=${range}`,
  );

/**
 * Trigger a fresh Search Analytics pull on the Site-scoped route. Returns
 * the SAME `{ summary }` shape as `fetchSearchSummary` and 404s in the same
 * no-data / not-connected / reconnect cases. The POST always answers with the
 * default 28-day window, so the thunk re-reads through the ranged GET.
 */
export const refreshSearchSummary = (
  siteId: string,
): Promise<GetSearchSummaryResponse> =>
  apiClient<GetSearchSummaryResponse>(siteGooglePath(siteId, '/search-refresh'), {
    method: 'POST',
    body: {},
  });

/**
 * Per-dimension Search Analytics drill-in (rows arrive clicks-DESC, ≤1000).
 * A 404 means "no data yet" — the thunk maps it to the empty state.
 */
export const fetchSearchAnalyticsDetail = (
  siteId: string,
  dimension: GscSearchDimension,
  range: GoogleRange = DEFAULT_GOOGLE_RANGE,
): Promise<GetSearchAnalyticsDetailResponse> =>
  apiClient<GetSearchAnalyticsDetailResponse>(
    `${siteGooglePath(siteId, '/search-analytics')}?dimension=${dimension}&range=${range}`,
  );

/** Submitted sitemaps — a 200 with an empty array is a legitimate empty state. */
export const fetchSitemaps = (siteId: string): Promise<GetSitemapsResponse> =>
  apiClient<GetSitemapsResponse>(
    siteGooglePath(siteId, '/sitemaps'),
  );

/**
 * GA4 summary. 404 = analytics not enabled / no snapshot yet — the thunk tells those apart via the connection.
 */
export const fetchAnalyticsSummary = (
  siteId: string,
  range: GoogleRange = DEFAULT_GOOGLE_RANGE,
): Promise<GetAnalyticsSummaryResponse> =>
  apiClient<GetAnalyticsSummaryResponse>(
    `${siteGooglePath(siteId, '/analytics-summary')}?range=${range}`,
  );

/** Trigger a fresh GA4 pull — same `{ summary }` shape as the GET. */
export const refreshAnalyticsSummary = (
  siteId: string,
): Promise<GetAnalyticsSummaryResponse> =>
  apiClient<GetAnalyticsSummaryResponse>(siteGooglePath(siteId, '/analytics-refresh'), {
    method: 'POST',
    body: {},
  });

/** Per-dimension GA4 drill-in (future `?view=` surface; wired now). */
export const fetchAnalyticsDetail = (
  siteId: string,
  dimension: GoogleAnalyticsDimension,
  range: GoogleRange = DEFAULT_GOOGLE_RANGE,
): Promise<GetAnalyticsDetailResponse> =>
  apiClient<GetAnalyticsDetailResponse>(
    `${siteGooglePath(siteId, '/analytics-detail')}?dimension=${dimension}&range=${range}`,
  );

/** GA4 properties the connected account can read (400 when the scope is missing). */
export const fetchAnalyticsProperties = (
  siteId: string,
): Promise<GetAnalyticsPropertiesResponse> =>
  apiClient<GetAnalyticsPropertiesResponse>(
    siteGooglePath(siteId, '/analytics-properties'),
  );
