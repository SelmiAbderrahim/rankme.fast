export const PAGES_RANGES = ['7d', '28d', '90d'] as const;
export type PagesRange = (typeof PAGES_RANGES)[number];

export const PAGES_INSIGHTS = [
  'striking_distance',
  'low_ctr',
  'declining',
  'winning',
  'non_indexable_visibility',
  'unmeasured',
] as const;
export type PagesInsight = (typeof PAGES_INSIGHTS)[number];

export const PAGES_SORTS = [
  'opportunity',
  'url',
  'title',
  'clicks',
  'impressions',
  'ctr',
  'average_position',
  'best_position',
  'keyword_count',
  'search_volume',
  'difficulty',
  'estimated_traffic',
  'position_change',
  'click_change_pct',
] as const;
export type PagesSort = (typeof PAGES_SORTS)[number];

export type PagesDirection = 'asc' | 'desc';
export type PagesLimit = 25 | 50 | 100;
export type PagesIndexability = 'indexable' | 'non_indexable';
export type PagesVisibility = 'measured' | 'unmeasured';

export const DEFAULT_PAGES_DIRECTIONS: Record<PagesSort, PagesDirection> = {
  opportunity: 'desc',
  url: 'asc',
  title: 'asc',
  clicks: 'desc',
  impressions: 'desc',
  ctr: 'desc',
  average_position: 'asc',
  best_position: 'asc',
  keyword_count: 'desc',
  search_volume: 'desc',
  difficulty: 'asc',
  estimated_traffic: 'desc',
  position_change: 'desc',
  click_change_pct: 'desc',
};

export interface PagesListQuery {
  range: PagesRange;
  q: string;
  insight: PagesInsight | null;
  indexability: PagesIndexability | null;
  visibility: PagesVisibility | null;
  sort: PagesSort;
  direction: PagesDirection;
  cursor: string | null;
  limit: PagesLimit;
}

export interface PagesUrlState extends PagesListQuery {
  pageId: string | null;
}

export type PagesSource = 'gsc' | 'dataforseo' | 'demo' | 'none';
export type PagesStatus = 'ready' | 'syncing' | 'empty' | 'unavailable' | 'stale';
export type PagesFallbackReason =
  | 'gsc_not_connected'
  | 'gsc_needs_reconnect'
  | 'gsc_revoked'
  | 'gsc_property_unmatched';
export type PagesPerformanceSource = Exclude<PagesSource, 'none'> | null;

export interface PagesMarket {
  locationCode: number;
  languageCode: string;
  selection: 'tracked_keyword_mode' | 'default';
}

export interface PagesCoverage {
  reportingLagDays: 3 | null;
  sampled: boolean | null;
  sourceRowsFetched: number | null;
  sourceRowsAccepted: number;
  sourceRowsDropped: number;
  dropped: {
    malformedUrl: number;
    offsiteUrl: number;
    duplicateUrl: number;
    invalidMetric: number;
  };
  sourceLimit: number | null;
  sourceTruncated: boolean;
  auditRowsFetched: number;
  auditRowsAccepted: number;
  auditRowsDropped: number;
  auditTruncated: boolean;
  inventoryPages: number;
  measuredPages: number;
  unmeasuredPages: number;
}

export interface PageMetrics {
  clicks: number | null;
  impressions: number | null;
  ctr: number | null;
  averagePosition: number | null;
  bestPosition: number | null;
  keywordCount: number | null;
  searchVolume: number | null;
  difficulty: number | null;
  estimatedTraffic: number | null;
  associatedQueryCount: number;
}

export interface PageDeltas {
  positionChange: number | null;
  clickChangePct: number | null;
}

export interface PageRow {
  pageId: string;
  url: string;
  displayUrl: string;
  title: string | null;
  performanceSource: PagesPerformanceSource;
  isIndexable: boolean | null;
  nonIndexableReason: string | null;
  onPageScore: number | null;
  metrics: PageMetrics;
  deltas: PageDeltas;
  insights: PagesInsight[];
}

export interface PagesEnvelope {
  source: PagesSource;
  status: PagesStatus;
  fallbackReason: PagesFallbackReason | null;
  observedAt: string | null;
  staleAt: string | null;
  range: PagesRange;
  rangeSemantics: 'rolling_window' | 'point_in_time';
  comparison: {
    label: 'since_previous_sync';
    previousObservedAt: string | null;
  };
  market: PagesMarket | null;
  coverage: PagesCoverage;
}

export interface PagesListResponse {
  envelope: PagesEnvelope;
  summary: PageMetrics;
  items: PageRow[];
  pageInfo: {
    limit: PagesLimit;
    hasNext: boolean;
    nextCursor: string | null;
    totalFiltered: number;
    totalInventory: number;
    totalMeasured: number;
  };
}

export interface PageQueryRow {
  query: string;
  position: number | null;
  clicks: number | null;
  impressions: number | null;
  ctr: number | null;
  searchVolume: number | null;
  difficulty: number | null;
  estimatedTraffic: number | null;
}

export interface TrendPoint {
  observedAt: string;
  source: Exclude<PagesSource, 'none'>;
  range: PagesRange;
  market: PagesMarket | null;
  metrics: PageMetrics;
}

export interface PagesDetailResponse {
  envelope: PagesEnvelope;
  page: PageRow;
  associated: {
    kind: 'queries' | 'keywords' | 'none';
    rows: PageQueryRow[];
    total: number;
    truncated: boolean;
  };
  trend: TrendPoint[];
}

export interface PagesRefreshResponse {
  refresh: {
    outcome: 'refreshed' | 'empty';
    source: Exclude<PagesSource, 'none'>;
    cache: 'hit' | 'miss' | 'not_applicable';
    observedAt: string;
  };
  state: PagesListResponse;
}

export type PagesErrorKind =
  | 'invalid_request'
  | 'not_found'
  | 'rate_limited'
  | 'unavailable'
  | 'network'
  | 'timeout'
  | 'parse'
  | 'http'
  | 'unknown';

export interface PagesRequestError {
  kind: PagesErrorKind;
  status: number | null;
  code: string | null;
  message: string;
  details: Record<string, unknown> | null;
  retryAfterMs: number | null;
  state: PagesListResponse | null;
}

export interface PagesCacheEntry<T> {
  data: T | null;
  loading: boolean;
  loaded: boolean;
  invalidated: boolean;
  error: PagesRequestError | null;
  requestId: string | null;
}

export interface PagesRefreshState {
  loading: boolean;
  error: PagesRequestError | null;
  requestId: string | null;
  lastResult: PagesRefreshResponse['refresh'] | null;
}

export interface PagesState {
  lists: Record<string, PagesCacheEntry<PagesListResponse>>;
  details: Record<string, PagesCacheEntry<PagesDetailResponse>>;
  refreshes: Record<string, PagesRefreshState>;
}

export type PagesLoadState =
  | 'initial_loading'
  | 'background_loading'
  | 'ready'
  | 'empty'
  | 'syncing'
  | 'stale'
  | 'unavailable'
  | 'error';

export type PagesConnectionAction =
  | 'connect'
  | 'reconnect'
  | 'select_property'
  | 'collect'
  | null;

export interface PagesSourceCapabilities {
  isObserved: boolean;
  isEstimated: boolean;
  isDemo: boolean;
  metricAvailability: Omit<Record<keyof PageMetrics, boolean>, 'associatedQueryCount'> & {
    associatedQueryCount: true;
  };
  supportedInsights: PagesInsight[];
  supportedSorts: PagesSort[];
  filters: {
    insight: PagesInsight[];
    indexability: true;
    visibility: true;
  };
  connectionAction: PagesConnectionAction;
  canRefresh: boolean;
  coverage: PagesCoverage;
}
