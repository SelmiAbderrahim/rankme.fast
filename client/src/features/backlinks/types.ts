export interface BacklinkRow {
  urlFrom: string;
  urlTo: string;
  anchor: string | null;
  dofollow: boolean;
  isBroken: boolean;
  firstSeen: string | null;
  lastSeen: string | null;
}

export interface BacklinkSummaryDelta {
  domainRating: number | null;
  backlinks: number | null;
  referringDomains: number | null;
  brokenBacklinks: number | null;
}

export interface BacklinkSummary {
  domainRating: number | null;
  backlinks: number;
  referringDomains: number;
  brokenBacklinks: number;
  firstSeen: string | null;
  fetchedAt: string;
  cached: boolean;
  delta: BacklinkSummaryDelta | null;
}

export interface BacklinkList {
  rows: BacklinkRow[];
  nextCursor: string | null;
  cached: boolean;
}

export interface BacklinksState {
  /** Site the loaded/loading data belongs to; null before any load. */
  siteId: string | null;
  summary: BacklinkSummary | null;
  list: BacklinkList | null;
  loading: boolean;
  loaded: boolean;
  error: string;
  cursor: string | null;
  isRefreshing: boolean;
  /** Epoch ms until which the refresh button stays disabled; null → enabled. */
  cooldownUntil: number | null;
  refreshError: string;
  deepPulls: Record<BacklinkPullType, DeepPullState>;
  gap: LinkGapState;
}

export const BACKLINK_PULL_TYPES = [
  'refDomains',
  'anchors',
  'history',
  'bulkRanks',
] as const;

export type BacklinkPullType = (typeof BACKLINK_PULL_TYPES)[number];
export type BacklinkRunStatus = 'queued' | 'running' | 'succeeded' | 'failed';
export type DeepPullErrorKind = 'providerFailed' | 'disabled' | 'unknown';

export interface ReferringDomainRow {
  domain: string;
  backlinks: number;
  domainRank: number | null;
  firstSeen: string | null;
  lastSeen: string | null;
}

export interface AnchorRow {
  anchor: string;
  backlinks: number;
  referringDomains: number;
}

export interface HistoryPoint {
  year: number;
  month: number;
  backlinks: number;
  referringDomains: number;
}

export interface BulkRankRow {
  domain: string;
  rank: number | null;
}

export type BacklinkDeepRows =
  | ReferringDomainRow[]
  | AnchorRow[]
  | HistoryPoint[]
  | BulkRankRow[];

export interface BacklinkObservationMeta {
  capturedAt: string;
  source: 'provider_observation';
}

export interface BacklinkRunResult {
  rows: BacklinkDeepRows;
  observation: BacklinkObservationMeta;
}

export interface BacklinkRun {
  runId: string;
  siteId: string;
  type: BacklinkPullType;
  domain: string;
  inputs: { limit: number | null; domains: string[] };
  status: BacklinkRunStatus;
  retainedCount: number;
  refunded: boolean;
  createdAt: string;
  completedAt: string | null;
  result: BacklinkRunResult | null;
}

export interface BacklinkRunsPage {
  runs: Array<Omit<BacklinkRun, 'result'>>;
  nextCursor: string | null;
}

export type SpendCachedStatus = 'cached' | 'fresh_required' | 'mixed' | 'unknown';

export interface SpendPreviewOperation {
  operationKey: string;
  metric: 'link_intel_checks' | 'toxicity_reviews';
  productUnits: number;
  cachedStatus: SpendCachedStatus;
}

/** Server-authoritative spend preview; self-hosted runs are never metered. */
export interface SpendPreview {
  feature?: 'link_intelligence' | 'backlinks';
  operation?: string;
  cachedStatus?: SpendCachedStatus;
  breakdown?: SpendPreviewOperation[];
  estimatedAt?: string;
}

export interface StartedBacklinkRun {
  runId: string;
  siteId: string;
  type: BacklinkPullType;
  status: 'queued';
  reservedUnits: 1;
}

export interface DeepPullState {
  preview: SpendPreview | null;
  run: BacklinkRun | null;
  previewLoading: boolean;
  runLoading: boolean;
  submitting: boolean;
  error: string;
  errorKind: DeepPullErrorKind | null;
}

export type LinkGapLegStatus =
  | 'ok'
  | 'provider_failed_refunded'
  | 'zero_retained_consumed'
  | 'zero_retained_refunded';

export type LinkGapWireLegStatus =
  | LinkGapLegStatus
  | 'failed'
  | 'zeroRetained';

export interface LinkGapRow {
  domain: string;
  rank: number | null;
  firstSeen?: string | null;
  /** Optional provider URL; guarded with safeExternalHref before rendering. */
  url?: string | null;
  /** Retained for compatibility with the current server snapshot payload. */
  intersections?: number;
}

export interface LinkGapOverlap {
  totalUnique: number;
  exclusiveToCompetitor: number;
  exclusivePct: number;
}

export interface LinkGapLeg {
  competitor: string;
  status: LinkGapWireLegStatus;
  refunded: boolean;
  retainedCount: number;
  result: {
    rows: LinkGapRow[];
    /** Server-computed only. The client never derives overlap math. */
    overlap?: LinkGapOverlap | null;
    observation: BacklinkObservationMeta;
  } | null;
}

export interface LinkGapRun {
  runId: string;
  siteId: string;
  ownDomain: string;
  competitors: string[];
  status: BacklinkRunStatus;
  perLegOutcomes: Array<{
    competitor: string;
    status: LinkGapWireLegStatus;
    refunded: boolean;
    retainedCount: number;
  }>;
  totalRefunded: number;
  createdAt: string;
  completedAt: string | null;
  legs: LinkGapLeg[];
}

export interface StartedLinkGapRun {
  runId: string;
  siteId: string;
  ownDomain: string;
  competitors: string[];
  status: 'queued';
  reservedUnits: number;
}

export interface LinkGapState {
  preview: SpendPreview | null;
  run: LinkGapRun | null;
  previewLoading: boolean;
  runLoading: boolean;
  submitting: boolean;
  error: string;
  errorKind: DeepPullErrorKind | null;
}

export type ToxicityBand = 'clean' | 'watch' | 'toxic';
export type ToxicityRunStatus = 'queued' | 'running' | 'succeeded' | 'failed';
export type ToxicityProviderStatus =
  | 'not_started'
  | 'not_needed'
  | 'succeeded'
  | 'partial_failed'
  | 'failed'
  | 'budget_halted';
export type ToxicityAiStatus =
  | 'not_requested'
  | 'succeeded'
  | 'abstained'
  | 'failed'
  | 'budget_skipped';

export interface ToxicityRationale {
  status: 'not_requested' | 'annotated' | 'abstained' | 'failed';
  text: string | null;
  citedRowId: string | null;
  rubricVersion: string;
  sourceKind: 'provider_observation';
}

export interface ToxicityRow {
  id: string;
  url: string;
  domain: string;
  spamScore: number;
  band: ToxicityBand;
  signals: Array<
    'spam_clean' | 'spam_watch' | 'spam_toxic' | 'broken' | 'dofollow' | 'nofollow'
  >;
  firstSeen: string | null;
  lastSeen: string | null;
  dofollow: boolean;
  isBroken: boolean;
  capturedAt: string;
  rubricVersion: string;
  sourceKind: 'provider_observation';
  rationale: ToxicityRationale;
}

export interface ToxicityRunSummary {
  runId: string;
  siteId: string;
  domain: string;
  status: ToxicityRunStatus;
  rubricVersion: string;
  sourceKind: 'provider_observation';
  retainedCount: number;
  bulkDomainCount: number;
  refunded: boolean;
  providerStatus: ToxicityProviderStatus;
  aiStatus: ToxicityAiStatus;
  failureKind: 'provider_failed' | 'ceiling_halted' | null;
  estimatedCostMicros: number;
  createdAt: string;
  completedAt: string | null;
}

export interface ToxicityRunDetail extends ToxicityRunSummary {
  rows: ToxicityRow[];
}

export interface ToxicityRunsPage {
  runs: ToxicityRunSummary[];
  nextCursor: string | null;
}

export interface StartedToxicityRun {
  runId: string;
  siteId: string;
  status: 'queued';
  reservedUnits: 1;
  rowClamp: 1000;
}

export interface DisavowSelection {
  rowId: string;
  kind: 'domain' | 'url';
}
