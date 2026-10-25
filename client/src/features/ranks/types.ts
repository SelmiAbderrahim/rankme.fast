import type { ObservationMeta } from '@shared/observations/types';
import type { PositionChangeValue, RankMovementValue } from '@shared/components/PositionDelta';

export type SerpDevice = 'desktop' | 'mobile';
export type RankCadence = 'weekly' | 'daily';

/**
 * Mirrors the server `RANK_ENGINES` union.
 * `google` is the shipped default; the other three are gated by a rollout
 * flag.
 */
export const RANK_ENGINES = ['google', 'bing', 'youtube', 'amazon'] as const;
export type RankEngine = (typeof RANK_ENGINES)[number];

/** The engines that match on an explicit target token rather than the domain. */
export const TOKEN_MATCHED_ENGINES = ['youtube', 'amazon'] as const;

/**
 * Mirrors the server `RANK_CHECK_FAILURE_REASONS` union. Each value has a
 * matching `checkErroredReason.<key>` string in every locale; `vendor_error`
 * is the catch-all for a provider failure we could not classify.
 */
export const RANK_CHECK_FAILURE_REASONS = [
  'vendor_auth',
  'vendor_quota',
  'vendor_timeout',
  'vendor_unavailable',
  'vendor_malformed',
  'vendor_error',
] as const;
export type RankCheckFailureReason = (typeof RANK_CHECK_FAILURE_REASONS)[number];

export interface KeywordLatestOutcome {
  status: 'checked' | 'failed' | 'skipped';
  reason: RankCheckFailureReason | 'cap_reached' | 'site_paused' | null;
  at: string;
  periodKey: string;
  attempts: number;
  nextRetryAt: string | null;
}

export const KEYWORD_RANK_STATES = [
  'ranked', 'improved', 'declined', 'unchanged', 'new', 'lost',
  'not_in_top_100', 'failed_last_check', 'never_checked',
] as const;
export type KeywordRankState = (typeof KEYWORD_RANK_STATES)[number];
export interface KeywordRankStateValue {
  state: KeywordRankState;
  comparison: Exclude<KeywordRankState, 'failed_last_check' | 'never_checked'> | null;
  baseline: 'previous_check' | 'best_ever';
  position: number | null;
  baselinePosition: number | null;
  change: number | null;
  checkedAt: string | null;
  baselineCheckedAt: string | null;
  failedAt: string | null;
}

export const isAltRankEngine = (engine: RankEngine): boolean => engine !== 'google';

export interface Keyword {
  id: string;
  siteId: string;
  phrase: string;
  locationCode: number;
  languageCode: string;
  device: SerpDevice;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  latestPosition: number | null;
  previousPosition: number | null;
  delta: number | null;
  movement?: RankMovementValue;
  positionChange?: PositionChangeValue;
  rankState?: KeywordRankStateValue;
  lastOutcome?: KeywordLatestOutcome | null;
  lastCheckedAt: string | null;
  /** Google AI Overview signal from the latest check. null = unknown. */
  aiOverviewPresent: boolean | null;
  aiCited: boolean | null;
  aiCitedUrl: string | null;
  /**
   * ISO timestamp of the most recent rank check that ERRORED and wrote no
   * snapshot. Only meaningful when `latestPosition` and `lastCheckedAt` are
   * both null — it distinguishes a "check failed" row from a never-checked one.
   */
  lastFailedCheckAt: string | null;
  /**
   * Why that check errored. Null when the keyword never failed, or when it
   * failed before the reason was recorded — render the bare "check failed"
   * label in that case rather than guessing a cause.
   */
  lastFailedReason: RankCheckFailureReason | null;
  /** The engine this keyword is tracked on. */
  engine: RankEngine;
  /** Channel handle (YouTube) / ASIN (Amazon); null for google and bing. */
  engineTarget: string | null;
  /** Provider provenance from the latest stored alt-engine observation. */
  observationMeta: ObservationMeta | null;
}

export interface KeywordListPage {
  keywords: Keyword[];
  nextCursor: string | null;
  cadence: RankCadence;
  total?: number;
  siteTotal?: number;
  page?: number | null;
  pageSize?: number;
}

export const KEYWORD_PAGE_SIZES = [25, 50, 100] as const;
export type KeywordPageSize = (typeof KEYWORD_PAGE_SIZES)[number];
export interface KeywordListQuery {
  page: number;
  pageSize: KeywordPageSize;
  engine: RankEngine | null;
  search: string;
}

export interface TrackedKeywordPhrase {
  phrase: string;
  engine: RankEngine;
  locationCode: number;
  languageCode: string;
  device: SerpDevice;
}
export interface TrackedKeywordPhrasesResponse { keywords: TrackedKeywordPhrase[] }
export type BulkKeywordResultStatus = 'added' | 'duplicate' | 'invalid';
export interface BulkKeywordResult {
  phrase: string;
  status: BulkKeywordResultStatus;
  reason?: 'repeated' | 'already_tracked' | 'empty' | 'too_long';
  keyword?: Keyword;
  message?: string;
}
export interface BulkKeywordResponse {
  message: string;
  counts: { added: number; duplicate: number; invalid: number };
  results: BulkKeywordResult[];
}
export type BulkKeywordBody = Omit<CreateKeywordBody, 'phrase'> & { phrases: string[] };

export interface KeywordMarketMovePreview {
  target: { locationCode: number; languageCode: string; device: SerpDevice };
  tracked: number;
  inTarget: number;
  movable: number;
  alreadyTracked: number;
  withHistory: number;
  resumesHistory: number;
  token: string;
}
export interface KeywordMarketMoveResponse {
  moved: number;
  preview: KeywordMarketMovePreview;
}

export interface CreateKeywordBody {
  phrase: string;
  locationCode: number;
  languageCode: string;
  device: SerpDevice;
  /** Omitted by legacy callers, which the server reads as google. */
  engine?: RankEngine;
  engineTarget?: string;
}

// ---------------------------------------------------------------------------
// Alt-engine spend preview
// ---------------------------------------------------------------------------

/**
 * The server's advisory alt-engine preview. The form only needs to know one
 * arrived; it renders none of its fields.
 */
export type AltEngineSpendPreview = Record<string, unknown>;

export interface CreateKeywordResponse {
  keyword: Keyword;
  message: string;
}

export type KeywordSuggestionSource = 'gsc' | 'ranked' | 'site_ideas';

export interface KeywordSuggestion {
  keyword: string;
  searchVolume: number | null;
  difficulty: number | null;
  currentPosition: number | null;
  estimatedTraffic: number | null;
  rankingUrl: string | null;
  source: KeywordSuggestionSource;
  tracked: boolean;
}

export interface KeywordSuggestionsResponse {
  source: KeywordSuggestionSource;
  sources: KeywordSuggestionSource[];
  candidates: KeywordSuggestion[];
  cached: boolean;
  fetchedAt: string;
  fallbackStatus: 'not_needed' | 'used' | 'provider_unavailable';
}

export interface KeywordSuggestionsBody {
  locationCode: number;
  languageCode: string;
}

export interface RemoveKeywordResponse {
  message: string;
}

export interface CadenceUpdateResponse {
  cadence: RankCadence;
  message: string;
}

export interface CheckNowResponse {
  message: string;
  /** Server clock captured before enqueue; polling compares snapshots to this. */
  checkStartedAt: string;
  job?: RankJob | null;
  reused?: boolean;
}

export type RankJobItemState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'expired';
export type RankJobStatus = 'queued' | 'running' | 'succeeded' | 'partial' | 'failed' | 'cancelled';
export interface RankJobItem {
  keywordId: string;
  engine: string;
  state: RankJobItemState;
  reason: string | null;
  attempts: number;
  finishedAt: string | null;
}
export interface RankJobTotals {
  total: number;
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  expired: number;
  cancelled: number;
}
export interface RankJob {
  id: string;
  siteId: string;
  scope: 'site' | 'keyword' | 'retry';
  status: RankJobStatus;
  retryOfJobId: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  deadlineAt: string;
  totals: RankJobTotals;
  items: RankJobItem[];
}
export interface RankJobResponse { job: RankJob }
export interface ActiveRankJobResponse { job: RankJob | null }

export interface RankHistoryPoint {
  checkedAt: string;
  position: number | null;
  rankAbsolute: number | null;
  source: 'fresh' | 'cache';
  foundUrl: string | null;
  /** Google AI Overview signal at that check. null = unknown / pre-feature. */
  aiOverviewPresent: boolean | null;
  aiCited: boolean | null;
  aiCitedUrl: string | null;
  /** Provider provenance for this stored observation. */
  observationMeta: ObservationMeta | null;
}

export interface RankHistoryResponse {
  keywordId: string;
  series: RankHistoryPoint[];
}

// ---------------------------------------------------------------------------
// SERP feature tracking
// ---------------------------------------------------------------------------

/** Mirrors the server `SerpFeatureType` closed union. */
export const SERP_FEATURE_TYPES = [
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
export type SerpFeatureType = (typeof SERP_FEATURE_TYPES)[number];
export type SerpFeatureCaptureStatus = 'active' | 'paused';

export interface SerpFeatureOwnership {
  domain: string;
  url: string | null;
}

export interface SerpFeatureRow {
  keywordId: string;
  phrase: string;
  device: string;
  /** ISO stamp of the check that produced this row; null = never observed. */
  observedAt: string | null;
  /** ONLY observed types — the DTO cannot express "absent on Google". */
  features: SerpFeatureType[];
  ownedSnippet: SerpFeatureOwnership | null;
  ownedPaa: Array<{ question: string; url: string | null }>;
  paaCount: number;
  topResultCount: number;
}

export interface SerpFeaturesResponse {
  siteId: string;
  captureEnabled: boolean;
  captureStatus: SerpFeatureCaptureStatus;
  rows: SerpFeatureRow[];
}

export interface SerpFeatureHistoryPoint {
  observedAt: string;
  features: SerpFeatureType[];
  ownedSnippet: boolean;
  ownedPaaCount: number;
}

export interface SerpTopResultRow {
  rank: number;
  domain: string;
  url: string;
  owned: boolean;
}

export interface SerpFeatureDetail {
  keywordId: string;
  phrase: string;
  captureEnabled: boolean;
  captureStatus: SerpFeatureCaptureStatus;
  latest: {
    observedAt: string;
    features: SerpFeatureType[];
    ownedSnippet: SerpFeatureOwnership | null;
    snippetSource: SerpFeatureOwnership | null;
    paa: Array<{
      question: string;
      answerDomain: string | null;
      answerUrl: string | null;
      owned: boolean;
    }>;
    topResults: SerpTopResultRow[];
  } | null;
  history: SerpFeatureHistoryPoint[];
}

export interface RanksState {
  siteId: string | null;
  items: Keyword[];
  page: number;
  pageSize: KeywordPageSize;
  total: number;
  siteTotal: number;
  listRequestId: string | null;
  loadedQuery: KeywordListQuery;
  nextCursor: string | null;
  currentCursor: string | null;
  cursorStack: (string | null)[];
  cadence: RankCadence;
  loading: boolean;
  loaded: boolean;
  error: string;
  adding: boolean;
  addError: string;
  removingId: string | null;
  removeError: string;
  updatingCadence: boolean;
  cadenceError: string;
  /** "Check now" — an on-demand re-check is in flight. */
  checkingNow: boolean;
  /** Keyword UUID for a row request; null for the site-wide request. */
  checkingKeywordId: string | null;
  /** Epoch ms until which "Check now" stays disabled (server 429 cooldown). */
  checkCooldownUntil: number | null;
  message: string;
  selectedKeywordId: string | null;
  history: RankHistoryPoint[];
  historyKeywordId: string | null;
  historyLoading: boolean;
  historyError: string;
  // SERP feature tracking — stored observations, zero vendor spend.
  serpFeatureRows: SerpFeatureRow[];
  serpFeaturesSiteId: string | null;
  serpFeaturesLoading: boolean;
  serpFeaturesLoaded: boolean;
  serpFeaturesError: string;
  /** True when the read returned 503 — the kill switch is off. */
  serpFeaturesDisabled: boolean;
  /** New capture state; stored rows remain available when this is false. */
  serpFeatureCaptureEnabled: boolean;
  serpFeatureCaptureStatus: SerpFeatureCaptureStatus;
  serpFeatureDetail: SerpFeatureDetail | null;
  serpFeatureDetailKeywordId: string | null;
  serpFeatureDetailLoading: boolean;
  serpFeatureDetailError: string;
}
