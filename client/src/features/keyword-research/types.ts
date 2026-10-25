export interface KeywordMonthlySearch {
  year: number;
  month: number;
  searchVolume: number;
}

/** DataForSEO Labs Search Intent primary label. */
export type SearchIntent =
  | 'informational'
  | 'commercial'
  | 'transactional'
  | 'navigational';

export interface KeywordMetric {
  keyword: string;
  searchVolume: number | null;
  difficulty: number | null;
  /** Decimal-string USD, e.g. "4.120000". null when unknown. */
  cpc: string | null;
  monthlySearches: KeywordMonthlySearch[];
  cached: boolean;
  fetchedAt: string;
  expiresAt: string;
  /**
   * Search intent, merged in from the /intent endpoint after the row loads.
   * `null` = vendor returned no classification (render no badge, not a fifth
   * "unknown" category); `undefined` = intent not fetched yet.
   */
  intent?: SearchIntent | null;
  confidence?: number | null;
}

export interface RelatedKeyword {
  keyword: string;
  searchVolume: number | null;
  difficulty: number | null;
  cpc: string | null;
  monthlySearches: KeywordMonthlySearch[];
}

export interface MetricsResponse {
  keywords: KeywordMetric[];
}

export interface RelatedResponse {
  keyword: string;
  related: RelatedKeyword[];
  cached: boolean;
}

export interface IntentRow {
  keyword: string;
  intent: SearchIntent | null;
  confidence: number | null;
  cached: boolean;
  fetchedAt: string;
  expiresAt: string;
}

export interface IntentResponse {
  intents: IntentRow[];
}

export interface IdeasResponse {
  seed: string;
  ideas: RelatedKeyword[];
  cached: boolean;
}

export interface LongTailResponse {
  seed: string;
  suggestions: RelatedKeyword[];
  cached: boolean;
}

export type ResearchHistoryKind =
  | 'metrics'
  | 'related'
  | 'intent'
  | 'ideas'
  | 'long_tail'
  | 'gap'
  | 'overview'
  | 'trends'
  | 'clusters';

export interface ResearchHistoryItem {
  id: string;
  kind: ResearchHistoryKind;
  phrases: string[];
  locationCode: number;
  languageCode: string;
  resultCount: number;
  cached: boolean;
  /**
   * Shared by the metrics + intent records of one Research press; null on
   * records written before the column existed or by callers that never sent
   * one. See `historyGroups.ts` for how the list folds them.
   */
  lookupId: string | null;
  createdAt: string;
}

export interface HistoryResponse {
  items: ResearchHistoryItem[];
  nextCursor: string | null;
  /** Every saved lookup in the requested scope, whatever the page. */
  total?: number;
}

// ---------------------------------------------------------------------------
// Stored reads: mirrors of
// `server/src/modules/keyword-research/keyword-research.stored.ts`.
// ---------------------------------------------------------------------------

/**
 * available   everything the lookup asked for is still stored
 * partial     some of the requested phrases are stored
 * expired     nothing is stored any more (cache TTL passed / evicted)
 * unsupported the kind has no stored view (gap, overview, trends, clusters)
 */
export type StoredResearchStatus = 'available' | 'partial' | 'expired' | 'unsupported';

export interface StoredKeywordRow {
  keyword: string;
  searchVolume: number | null;
  difficulty: number | null;
  cpc: string | null;
  monthlySearches: KeywordMonthlySearch[];
  intent: SearchIntent | null;
  confidence: number | null;
  cached: true;
  fetchedAt: string;
  expiresAt: string;
}

export interface StoredResearchResult {
  id: string;
  kind: ResearchHistoryKind;
  lookupId: string | null;
  phrases: string[];
  locationCode: number;
  languageCode: string;
  status: StoredResearchStatus;
  requestedCount: number;
  storedCount: number;
  seed: string | null;
  keywords: StoredKeywordRow[];
  items: RelatedKeyword[];
  fetchedAt: string | null;
  expiresAt: string | null;
}

export type StoredCandidateSource = 'seed' | 'related' | 'idea' | 'long_tail';

export interface StoredKeywordCandidate {
  phrase: string;
  source: StoredCandidateSource;
  searchVolume: number | null;
  observedAt: string;
}

export interface StoredKeywordsResponse {
  candidates: StoredKeywordCandidate[];
  /** Matches for the query BEFORE the limit cut. */
  total: number;
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// Keyword-intelligence workspace DTO mirrors (server contract:
// server/src/modules/keyword-research/keyword-research.{service,controller}.ts).
// Field-for-field mirrors: never add, rename, or re-derive a server field.
// ---------------------------------------------------------------------------

/**
 * Compact per-row provenance metadata.
 * This is a feature-local mirror of the server's `ObservationMeta` — it is
 * deliberately NOT parsed with the richer `@shared/observations` schema
 * (that shape has fields this seam never ships).
 */
export type KeywordObservationKind =
  | 'estimate'
  | 'provider_observation'
  | 'ai_interpretation';

export interface KeywordObservationMeta {
  kind: KeywordObservationKind;
  observedAt: string;
  freshUntil: string;
  market: { locationCode: number; languageCode: string };
}

/** Closed SERP-feature enum — mirrors `SerpFeatureType`. */
export const SERP_FEATURES = [
  'ai_overview',
  'featured_snippet',
  'people_also_ask',
  'local_pack',
  'video',
  'images',
  'shopping',
  'knowledge_graph',
  'other',
] as const;
export type SerpFeature = (typeof SERP_FEATURES)[number];

export interface GapRow {
  keyword: string;
  ownPosition: number | null;
  competitorPosition: number | null;
  searchVolume: number | null;
}

export interface GapPair {
  ownDomain: string;
  competitorDomain: string;
  cached: boolean;
  fetchedAt: string;
  expiresAt: string;
  rows: GapRow[];
  meta: KeywordObservationMeta;
}

export interface GapResponse {
  ownDomain: string;
  pairs: GapPair[];
}

export interface KeywordOverviewRow {
  keyword: string;
  searchVolume: number | null;
  difficulty: number | null;
  /** Decimal-string USD; null when unknown. */
  cpc: string | null;
  intent: SearchIntent | null;
  serpFeatures: SerpFeature[];
  resultsCount: number | null;
  observedAt: string | null;
  cached: boolean;
  fetchedAt: string;
  expiresAt: string;
  meta: KeywordObservationMeta;
}

export interface OverviewResponse {
  keywords: KeywordOverviewRow[];
}

export interface KeywordTrendsSummary {
  yoyDelta: number | null;
  twelveMonthMomentum: number | null;
  seasonalityFlags: { peakMonth: number | null; troughMonth: number | null };
}

export interface KeywordTrendsRow {
  keyword: string;
  monthlySearches: KeywordMonthlySearch[];
  trends: KeywordTrendsSummary;
  cached: boolean;
  fetchedAt: string;
  expiresAt: string;
  meta: KeywordObservationMeta;
}

export interface TrendsResponse {
  keywords: KeywordTrendsRow[];
}

// --- Spend preview ------------------------------------------------------------

/**
 * The server's advisory spend preview for gap/overview/trends. The forms only
 * need to know one arrived (confirm waits for it); no field is rendered.
 */
export type KeywordSpendPreview = Record<string, unknown>;

export type KeywordPreviewOperation = 'gap' | 'overview' | 'trends';

// ---------------------------------------------------------------------------
// Live Keyword Trends (client mirrors of the server DTOs).
// Field-for-field mirrors of `TrendsExplorationDto`, `TrendsSeriesDto`,
// `TrendsReadoutDto`, `TrendsRelatedQueryDto`, and the shared
// `SpendPreview` returned by the trends preview endpoint. NEVER add, rename,
// or re-derive a server field client-side.
// ---------------------------------------------------------------------------

export interface TrendsSeriesPoint {
  year: number;
  month: number;
  value: number;
}

export interface TrendsEstimateEnvelope {
  source: 'estimate';
  observationMeta: { searchInterestIndexKey: string };
}

export interface TrendsSeriesDto extends TrendsEstimateEnvelope {
  keyword: string;
  points: TrendsSeriesPoint[];
}

export interface TrendsRelatedQueryDto {
  query: string;
  value: number;
  kind: 'rising' | 'top';
}

export interface TrendsReadoutDto {
  yoy: TrendsEstimateEnvelope & {
    deltaFraction: number | null;
    reason?: 'insufficient_history';
  };
  momentum: TrendsEstimateEnvelope & {
    direction: 'up' | 'down' | 'flat';
    slopePerWeek: number | null;
    reason?: 'insufficient_history';
  };
  seasonality: TrendsEstimateEnvelope & {
    months: number[];
    reason?: 'insufficient_history';
  };
}

export type TrendsRunStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface TrendsExplorationInputs {
  keywords: string[];
  geo: string | null;
  language: string | null;
}

export interface TrendsExplorationDto {
  runId: string;
  status: TrendsRunStatus;
  retained: boolean;
  refunded: boolean;
  errorCode: string | null;
  inputs: TrendsExplorationInputs;
  cached: boolean;
  fetchedAt: string | null;
  window: { startDate: string | null; endDate: string | null };
  observedAt: string | null;
  locationCode: number | null;
  languageCode: string | null;
  series: TrendsSeriesDto[];
  seriesReadouts: Array<{ keyword: string; readouts: TrendsReadoutDto }>;
  relatedQueries: TrendsRelatedQueryDto[];
  createdAt: string;
  completedAt: string | null;
}

/** Free-read stored-run DTO — metadata only, series omitted. */
export interface TrendsStoredRunSummary extends TrendsEstimateEnvelope {
  runId: string;
  status: TrendsRunStatus;
  retained: boolean;
  refunded: boolean;
  errorCode: string | null;
  inputs: TrendsExplorationInputs;
  siteId: string | null;
  seriesCount: number;
  relatedQueryCount: number;
  createdAt: string;
  completedAt: string | null;
}

export interface TrendsListResponse {
  runs: TrendsStoredRunSummary[];
  nextCursor: string | null;
}

/** The server's advisory live-trends preview; no field is rendered. */
export type TrendsSpendPreview = Record<string, unknown>;

/**
 * Failure discrimination for live-trends thunks:
 *   - `unavailable` — kill switch (`KEYWORD_TRENDS_ENABLED=false`) → 503
 *     with `error.details.reason="disabled"`.
 *   - `providerFailed` — vendor throw → 503 with `providerFailed` message;
 *     `error.details.reason="provider_failed"`; server has already refunded
 *     the reserved unit.
 */
export type LiveTrendsErrorKind =
  | 'unavailable'
  | 'providerFailed'
  | 'notFound'
  | 'unknown';

export interface LiveTrendsRequestState<T> {
  loading: boolean;
  data: T | null;
  error: string;
  errorKind: LiveTrendsErrorKind | null;
}

export interface LiveTrendsSubState {
  preview: LiveTrendsRequestState<TrendsSpendPreview>;
  run: LiveTrendsRequestState<TrendsExplorationDto>;
  list: LiveTrendsRequestState<TrendsListResponse>;
  storedRun: LiveTrendsRequestState<TrendsStoredRunSummary>;
}

// --- Clusters ---------------------------------------------

export interface ClusterMemberRef {
  keyword: string;
  source: 'vendor_cache' | 'history';
  observedAt: string;
}

export type ClusterSuggestedRoute = 'brief' | 'seo';
export type ClusterConfidence = 'low' | 'medium' | 'high';

export interface ClusterResult {
  clusterId: string;
  label: string;
  memberKeywords: string[];
  suggestedRoute: ClusterSuggestedRoute;
  confidence: ClusterConfidence;
  summedSearchVolume: number;
}

export interface ClusterRun {
  runId: string;
  market: { locationCode: number; languageCode: string };
  memberRefs: ClusterMemberRef[];
  clusters: ClusterResult[];
  aiProfile: { name: string; version: string };
  costMicros: number;
  createdAt: string;
  cached: boolean;
}

export interface ClusterRunsResponse {
  runs: ClusterRun[];
  nextCursor: string | null;
}

export type ClusterDecisionKind = 'accepted' | 'dismissed';

export interface ClusterDecisionResponse {
  id: string;
  runId: string;
  clusterId: string;
  kind: ClusterDecisionKind;
  siteId: string | null;
  /** `keyword-cluster:<32hex>` on accepted decisions; null on dismissed. */
  recommendationId: string | null;
  createdAt: string;
}

export interface ClusterDecisionState {
  pending: boolean;
  result: ClusterDecisionResponse | null;
  error: string;
  /** True after a 409 — the cluster already carries a different decision. */
  conflict: boolean;
}

export interface KeywordResearchState {
  metrics: KeywordMetric[];
  loading: boolean;
  loaded: boolean;
  error: string;
  expandedKeyword: string | null;
  relatedByKeyword: Record<string, RelatedKeyword[]>;
  relatedLoading: boolean;
  relatedError: string;
  addToTrackingError: string;
  addingToTrackingKeyword: string | null;
  /** Intent map keyed by normalized keyword — merged onto metrics rows. */
  intentByKeyword: Record<string, { intent: SearchIntent | null; confidence: number | null }>;
  intentLoading: boolean;
  intentError: string;
  /** Keyword ideas — candidate list rendered with the same list UI as
   * related keywords. Accumulates across "Get ideas" clicks. */
  ideas: RelatedKeyword[];
  ideasLoading: boolean;
  ideasError: string;
  ideasSeed: string | null;
  /** Focused seed-containing suggestions. Each request replaces this result. */
  longTail: {
    suggestions: RelatedKeyword[];
    loading: boolean;
    error: string;
    seed: string | null;
    cached: boolean | null;
    locationCode: number | null;
    languageCode: string | null;
  };
  /** Per-account research history page (cursor-appended). */
  history: ResearchHistoryItem[];
  historyLoading: boolean;
  historyLoaded: boolean;
  historyError: string;
  historyCursor: string | null;
  /** Size of the whole saved-lookup list (null until the server reports it). */
  historyTotal: number | null;
  /** requestId of the newest first-page history load; older first-page
   * responses that resolve later are dropped so they never overwrite it. */
  historyRequestId: string | null;
  /** Scope of the loaded history list: a site id (site Research tab) or
   * null (account-wide). A first-page load for another scope clears the
   * list so one scope's rows never show under another. */
  historySiteId: string | null;
  /** Re-open of one history row's stored results (no provider call). */
  stored: {
    loading: boolean;
    error: string;
    /** History row id being shown / loaded; null when none. */
    historyId: string | null;
    result: StoredResearchResult | null;
  };
  /** Namespaced sub-state for the workspace views. */
  preview: {
    loading: boolean;
    data: KeywordSpendPreview | null;
    error: string;
    /** Which paid form the preview belongs to (one preview slot at a time). */
    forOperation: KeywordPreviewOperation | null;
    /** Server refusal attributed to the competitors field (gap form). */
    competitorsError?: string;
  };
  gap: {
    loading: boolean;
    data: GapResponse | null;
    error: string;
    /** Server refusal attributed to the competitors field. */
    competitorsError?: string;
  };
  overview: {
    loading: boolean;
    rows: KeywordOverviewRow[];
    loaded: boolean;
    error: string;
  };
  trends: {
    loading: boolean;
    rows: KeywordTrendsRow[];
    loaded: boolean;
    error: string;
  };
  clusters: {
    running: boolean;
    run: ClusterRun | null;
    runError: string;
    runs: ClusterRun[];
    runsLoading: boolean;
    runsLoaded: boolean;
    runsError: string;
    runsCursor: string | null;
    detailLoading: boolean;
    detailError: string;
    /** Keyed by `runId:clusterId`. */
    decisions: Record<string, ClusterDecisionState>;
    /** Stored phrases the picker offers (free read, never calls a provider). */
    candidates: {
      loading: boolean;
      error: string;
      data: StoredKeywordsResponse | null;
      /** requestId of the newest load; older responses that resolve later are dropped. */
      requestId: string | null;
    };
  };
  /** Live Keyword Trends sub-state. */
  liveTrends: LiveTrendsSubState;
}
