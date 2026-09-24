export type GoogleConnectionStatus = 'connected' | 'needs_reconnect' | 'revoked';

/** Date-range window shared by the summary cards and the drill-in panel (`?range=`). */
export type GoogleRange = '7d' | '28d' | '90d';

export interface GoogleConnection {
  status: GoogleConnectionStatus;
  googleAccountEmail: string;
  propertyUrl: string | null;
  /** ISO 8601 */
  connectedAt: string;
  /** ISO 8601 */
  lastUsedAt: string | null;
  /**
   * Granted OAuth scopes. Optional so the client survives the server-rollout
   * window; a legacy row without the field was created by the GSC-only flow.
   */
  scopes?: string[];
  /** Selected GA4 property (`properties/<id>`) — null until the user picks one. */
  ga4PropertyId?: string | null;
  ga4PropertyDisplayName?: string | null;
  /** Site binding state returned by the site-scoped configuration endpoint. */
  gscStatus?: string;
  ga4Status?: string;
  gscBindingSource?: 'auto' | 'manual' | 'legacy' | null;
  ga4BindingSource?: 'auto' | 'manual' | 'legacy' | null;
  /** Number of sites using either resource from this shared credential. */
  connectedSiteCount?: number;
}

export interface GoogleResourceUsage {
  siteId: string;
  domain: string;
  displayName: string;
}

export interface SiteGoogleConfiguration {
  connection: Omit<GoogleConnection, 'propertyUrl' | 'ga4PropertyId' | 'ga4PropertyDisplayName'> | null;
  connectedSiteCount: number;
  gsc: {
    propertyUrl: string | null;
    source: 'auto' | 'manual' | 'legacy' | null;
    status: string;
  };
  ga4: {
    propertyId: string | null;
    propertyDisplayName: string | null;
    matchedWebStreamUri: string | null;
    source: 'auto' | 'manual' | 'legacy' | null;
    status: string;
  };
  autoMatch: {
    requestedAt: string | null;
    completedAt: string | null;
    failureClass: string | null;
  };
}

/** A verified Search Console property returned by the server proxy. */
export interface GscProperty {
  siteUrl: string;
  permissionLevel: string;
  inUseBy?: GoogleResourceUsage[];
}

export interface GetGoogleConnectionResponse {
  connection: GoogleConnection | null;
  /** Present only when connected and the properties fetch succeeded. */
  properties?: GscProperty[];
}

export interface CompleteGoogleConnectionResponse {
  connection: GoogleConnection;
}

export interface SetGooglePropertyBody {
  propertyUrl?: string | null;
  ga4PropertyId?: string | null;
}

export interface SetGooglePropertyResponse {
  connection: GoogleConnection;
}

export interface CompleteGoogleConnectionBody {
  /** Optional — the server resolves it from the Better Auth account row when absent. */
  refreshToken?: string;
  scopes: string[];
  /** Optional — the server resolves it from the Better Auth account row when absent. */
  googleAccountEmail?: string;
}

export interface DisconnectGoogleResponse {
  message: string;
  connection: GoogleConnection | null;
}

export interface RevokeGoogleResponse {
  ok: true;
  affectedSiteCount: number;
}

/** One daily point in the 28-day Search Analytics time series (ascending by date). */
export interface GscSummaryTimeseriesPoint {
  /** ISO date (YYYY-MM-DD). */
  date: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

/** One country row — `country` is a lowercase ISO-3166-1 alpha-3 code (e.g. `usa`). */
export interface GscSummaryCountryRow {
  country: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

/** One device row — `device` is one of `DESKTOP` | `MOBILE` | `TABLET` (uppercase). */
export interface GscSummaryDeviceRow {
  device: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

/**
 * Last-28-days Search Analytics summary — read from the Postgres
 * snapshot the audit processor wrote; never a live vendor call.
 */
export interface GoogleSearchSummary {
  totalClicks: number;
  totalImpressions: number;
  averageCtr: number;
  averagePosition: number;
  topQueries: Array<{
    query: string;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
  }>;
  topPages: Array<{
    url: string;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
  }>;
  /** ISO date the snapshot was taken (already lag-adjusted by 3 days). */
  asOf: string;
  previousPeriod: { totalClicks: number; totalImpressions: number } | null;
  /**
   * Up to 28 daily points, ascending by date. Optional so the client survives
   * the server-rollout window and keeps existing fixtures compiling.
   */
  timeseries?: GscSummaryTimeseriesPoint[];
  /** Top ~10 countries by clicks. Optional (see `timeseries`). */
  countries?: GscSummaryCountryRow[];
  /** Per-device breakdown. Optional (see `timeseries`). */
  devices?: GscSummaryDeviceRow[];
}

export interface GetSearchSummaryResponse {
  summary: GoogleSearchSummary;
}

/** Search Analytics drill-in dimensions (`?view=` → GSC dimension). */
export type GscSearchDimension = 'query' | 'page' | 'country' | 'device';

/** One drill-in row — `key` is the query text / page URL / ISO code / device code. */
export interface GscSearchAnalyticsRow {
  key: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

/** Per-dimension detail payload (rows arrive clicks-DESC, ≤1000). */
export interface GscSearchAnalyticsDetail {
  /** ISO date the snapshot was taken. */
  asOf: string;
  rows: GscSearchAnalyticsRow[];
}

export interface GetSearchAnalyticsDetailResponse {
  detail: GscSearchAnalyticsDetail;
}

/** One submitted sitemap as reported by Search Console. */
export interface GscSitemap {
  path: string;
  type: string;
  /** ISO 8601 or null when Google never recorded a submission. */
  lastSubmitted: string | null;
  /** ISO 8601 or null. */
  lastDownloaded: string | null;
  isPending: boolean;
  isSitemapsIndex: boolean;
  errors: number;
  warnings: number;
  processed: number;
}

export interface GetSitemapsResponse {
  /** ISO date of the snapshot, or null when nothing was captured yet. */
  asOf: string | null;
  sitemaps: GscSitemap[];
}

/** Redux state for one drill-in dimension of the detail panel. */
export interface GscDetailSectionState {
  rows: GscSearchAnalyticsRow[];
  asOf: string | null;
  loading: boolean;
  loaded: boolean;
  /** True when the 404 "no data yet" state came back (distinct from errors). */
  empty: boolean;
  error: string | null;
}

/** Redux state for the sitemaps drill-in view. */
export interface GscSitemapsState {
  items: GscSitemap[];
  asOf: string | null;
  loading: boolean;
  loaded: boolean;
  error: string | null;
}

/** Per-row GA4 metric set — every timeseries point and breakdown row carries it. */
export interface GoogleAnalyticsMetrics {
  sessions: number;
  activeUsers: number;
  engagedSessions: number;
  keyEvents: number;
}

/** One daily point in the GA4 time series (ascending by `date`, YYYY-MM-DD). */
export interface GoogleAnalyticsTimeseriesPoint extends GoogleAnalyticsMetrics {
  date: string;
}

export interface GoogleAnalyticsChannelRow extends GoogleAnalyticsMetrics {
  channel: string;
}

export interface GoogleAnalyticsPageRow extends GoogleAnalyticsMetrics {
  url: string;
}

export interface GoogleAnalyticsCountryRow extends GoogleAnalyticsMetrics {
  country: string;
}

/** `device` is `desktop` | `mobile` | `tablet` | vendor string (lowercase). */
export interface GoogleAnalyticsDeviceRow extends GoogleAnalyticsMetrics {
  device: string;
}

export interface GoogleAnalyticsPreviousPeriod {
  totalSessions: number;
  totalActiveUsers: number;
  totalEngagedSessions: number;
  totalKeyEvents: number;
}

/** GA4 summary read from the server snapshot (Pro+; never a live vendor call). */
export interface GoogleAnalyticsSummary {
  totalSessions: number;
  totalActiveUsers: number;
  totalEngagedSessions: number;
  totalKeyEvents: number;
  /** 0..1 fraction — engaged sessions / sessions across the window. */
  engagementRate: number;
  timeseries: GoogleAnalyticsTimeseriesPoint[];
  channels: GoogleAnalyticsChannelRow[];
  topPages: GoogleAnalyticsPageRow[];
  countries: GoogleAnalyticsCountryRow[];
  devices: GoogleAnalyticsDeviceRow[];
  /** ISO date the snapshot was taken. */
  asOf: string;
  previousPeriod: GoogleAnalyticsPreviousPeriod | null;
}

export interface GetAnalyticsSummaryResponse {
  summary: GoogleAnalyticsSummary;
}

/** GA4 drill-in dimensions (future `?view=` surface; API wired now). */
export type GoogleAnalyticsDimension = 'channel' | 'page' | 'country' | 'device';

export interface GoogleAnalyticsDetailRow extends GoogleAnalyticsMetrics {
  key: string;
}

export interface GoogleAnalyticsDetail {
  asOf: string;
  rows: GoogleAnalyticsDetailRow[];
}

export interface GetAnalyticsDetailResponse {
  detail: GoogleAnalyticsDetail;
}

/** One GA4 property the connected Google account can read. */
export interface Ga4Property {
  /** `properties/<number>` resource name. */
  propertyId: string;
  displayName: string;
  webDataStreams?: Array<{
    streamId: string;
    displayName: string;
    defaultUri: string;
  }>;
  inUseBy?: GoogleResourceUsage[];
}

export interface GetAnalyticsPropertiesResponse {
  properties: Ga4Property[];
}

/** Redux state for the GA4 analytics section of the google slice. */
export interface GoogleAnalyticsState {
  /** Summary keyed to the site + range it was loaded for. */
  summary: GoogleAnalyticsSummary | null;
  siteId: string | null;
  range: GoogleRange | null;
  loading: boolean;
  loaded: boolean;
  /** True while a manual refresh (POST /google/analytics-refresh) is in flight. */
  refreshing: boolean;
  /** True when a 404 "no data yet" came back with GA4 fully configured. */
  empty: boolean;
  /** True when a 404 came back while the GA4 scope or property is missing. */
  notEnabled: boolean;
  error: string | null;
  /** GA4 property picker state (account-level — survives site re-keys). */
  properties: Ga4Property[];
  propertiesLoading: boolean;
  propertiesLoaded: boolean;
  propertiesError: string | null;
  settingProperty: boolean;
  setPropertyError: string | null;
}

export interface GoogleConnectionState {
  connection: GoogleConnection | null;
  /** Site owning the loaded configuration; prevents cross-site reuse. */
  connectionSiteId: string | null;
  properties: GscProperty[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  connecting: boolean;
  connectError: string | null;
  settingProperty: boolean;
  setPropertyError: string | null;
  disconnecting: boolean;
  disconnectError: string | null;
  revoking: boolean;
  revokeError: string | null;
  message: string | null;
  /** Search summary — keyed to the site it was loaded for. */
  summary: GoogleSearchSummary | null;
  summarySiteId: string | null;
  /** Range the loaded summary belongs to (`?range=`). */
  summaryRange: GoogleRange | null;
  summaryLoading: boolean;
  summaryLoaded: boolean;
  /** True while a manual refresh (POST /google/search-refresh) is in flight. */
  summaryRefreshing: boolean;
  /** True when the 404 "no data yet" state came back (distinct from errors). */
  summaryEmpty: boolean;
  summaryError: string | null;
  /** Drill-in detail (`?view=`) — all four dimensions keyed to one site + range. */
  detailSiteId: string | null;
  detailRange: GoogleRange | null;
  detail: Record<GscSearchDimension, GscDetailSectionState>;
  /** Sitemaps drill-in — keyed to the site it was loaded for. */
  sitemapsSiteId: string | null;
  sitemaps: GscSitemapsState;
  /** GA4 analytics summary card state (Pro+). */
  analytics: GoogleAnalyticsState;
}
