/**
 * Wire types for the Content Intelligence workspace. Kept in lockstep with
 * `server/src/modules/content-intelligence/content-intelligence.service.ts →
 * toPublicAnalysis` and the schema union in
 * `server/src/modules/content-intelligence/content-analysis.model.ts`.
 */

export const CONTENT_ANALYSIS_STATUSES = [
  'queued',
  'collecting_owned',
  'collecting_serp',
  'collecting_competitors',
  'scoring',
  'generating_brief',
  'generating_draft',
  'completed',
  'partial',
  'failed',
  'cancelled',
] as const;
export type ContentAnalysisStatus = (typeof CONTENT_ANALYSIS_STATUSES)[number];

export const CONTENT_ANALYSIS_TERMINAL_STATUSES: readonly ContentAnalysisStatus[] = [
  'completed',
  'partial',
  'failed',
  'cancelled',
];

export function isContentAnalysisStatus(v: unknown): v is ContentAnalysisStatus {
  return (
    typeof v === 'string' &&
    (CONTENT_ANALYSIS_STATUSES as readonly string[]).includes(v)
  );
}

export function isContentAnalysisTerminal(status: ContentAnalysisStatus): boolean {
  return (CONTENT_ANALYSIS_TERMINAL_STATUSES as readonly string[]).includes(status);
}

export function isContentAnalysisCancellable(status: ContentAnalysisStatus): boolean {
  return !isContentAnalysisTerminal(status);
}

export interface AnalysisStageEntry {
  name: ContentAnalysisStatus;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
}

export interface AnalysisWarning {
  code: string;
  messageKey: string;
  message: string;
}

export interface AnalysisScorecard {
  readabilityScore: number;
  coverageScore: number;
  structureScore: number;
  warnings: string[];
}

export interface AnalysisBriefSection {
  heading: string;
  body: string;
}

export interface AnalysisBrief {
  versionId: string;
  sections: AnalysisBriefSection[];
  text?: string | null;
  citations: string[];
  profileVersion?: string | null;
  provider?: string | null;
}

export interface AnalysisDraft {
  versionId: string;
  markdown: string;
  wordCount: number;
  text?: string | null;
  citations: string[];
  profileVersion?: string | null;
  provider?: string | null;
}

export interface AnalysisDraftVersion {
  versionId: string;
  markdown: string;
  wordCount: number;
  savedAt: string;
}

export interface AnalysisBriefVersion {
  versionId: string;
  sections: AnalysisBriefSection[];
  savedAt: string;
}

export interface AnalysisCitation {
  sourceId: string;
  url: string;
  title: string | null;
}

export interface AnalysisError {
  category: string;
  messageKey: string;
  retryable: boolean;
  terminal: boolean;
}

export interface AnalysisReservation {
  key: string;
  reservedUnits: number;
  refundedAt: string | null;
  refundReason: string | null;
}

export type RecommendationState = 'suggested' | 'accepted' | 'dismissed' | 'applied';
export type RecommendationSeverity = 'high' | 'medium' | 'low';

export interface ContentRecommendation {
  id: string;
  section: string;
  ruleId: string;
  direction: 'add' | 'strengthen' | 'clarify' | 'remove';
  confidence: number;
  messageKey: string;
  message: string;
  evidenceSourceIds: string[];
  codeFixPromptAvailable?: true;
}

export interface ContentRecommendationState {
  recommendationId: string;
  analysisVersion: string;
  state: RecommendationState;
  version: number;
  actorUserId: string | null;
  stateChangedAt: string | null;
  appliedAt: string | null;
  baselineAnchorAt: string | null;
  contentHash: string | null;
  analysisContentHash: string | null;
  hashStatus: 'same' | 'changed' | 'unavailable';
}

export interface ContentRecommendationEvent {
  id: string;
  eventKind: 'accepted' | 'dismissed' | 'applied' | 'undo_applied';
  priorState: RecommendationState;
  newState: RecommendationState;
  stateVersion: number;
  actorUserId: string;
  note: string | null;
  contentHash: string | null;
  analysisContentHash: string | null;
  hashStatus: 'same' | 'changed' | 'unavailable';
  appliedAt: string | null;
  recordedAt: string;
}

export interface RecommendationApplicationCheck {
  available: boolean;
  hashStatus: 'same' | 'changed' | 'unavailable';
  contentHash: string | null;
  analysisContentHash: string | null;
  noteRequired: boolean;
  freshnessDays: number;
}

export interface OutcomeMetric {
  baseline: number | null;
  following: number | null;
  delta: { absolute: number | null; relative: number | null };
}

export interface OutcomeCoverage {
  baselineDays: number;
  followingDays: number;
  expectedDays: number;
  completeness: 'unavailable' | 'partial' | 'complete';
  confidence: 'low' | 'medium' | 'high';
}

export interface RecommendationOutcome {
  available: boolean;
  dataAvailable?: boolean;
  aggregationVersion?: string;
  appliedAt?: string;
  contentHash?: string | null;
  hashStatus?: 'same' | 'changed' | 'unavailable';
  window?: {
    baselineStart: string;
    baselineEnd: string;
    followingStart: string;
    followingEnd: string;
    complete: boolean;
  };
  coverage?: { gsc: OutcomeCoverage; rank: OutcomeCoverage };
  metrics?: {
    clicks: OutcomeMetric;
    impressions: OutcomeMetric;
    ctr: OutcomeMetric;
    averagePosition: OutcomeMetric;
    rankPosition: OutcomeMetric;
  };
  laterEdit?: boolean;
  series?: Array<{
    source: 'gsc' | 'rank';
    phase: 'baseline' | 'following';
    observedAt: string;
    clicks: number | null;
    impressions: number | null;
    ctr: number | null;
    averagePosition: number | null;
    rankPosition: number | null;
    laterEdit: boolean;
  }>;
}

export interface ContentAnalysis {
  analysisId: string;
  siteId: string;
  ownedUrl: string;
  keyword: string;
  locale: string;
  status: ContentAnalysisStatus;
  stages: AnalysisStageEntry[];
  warnings: AnalysisWarning[];
  scorecard: AnalysisScorecard | null;
  schemaVersion: string;
  scorecardV2: {
    version: string;
    total: number;
    sections: Array<{
      key: string;
      score: number;
      weight: number;
      confidence: number;
      reason: string;
      reasonKey: string;
      reasonText: string;
    }>;
  } | null;
  owned: { url: string; contentHash: string } | null;
  recommendations: ContentRecommendation[];
  recommendationStates: ContentRecommendationState[];
  brief: AnalysisBrief | null;
  briefVersions?: AnalysisBriefVersion[];
  draft: AnalysisDraft | null;
  draftVersions?: AnalysisDraftVersion[];
  citations: AnalysisCitation[];
  error: AnalysisError | null;
  reservation: AnalysisReservation;
  costMicros: number;
  aiCostMicros: number;
  requestedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
}

export interface AnalysesPage {
  items: ContentAnalysis[];
  nextCursor: string | null;
}

export interface StartAnalysisResponse {
  analysisId: string;
  status: ContentAnalysisStatus;
  duplicate: boolean;
  message: string;
}

export type PreflightReason =
  | null
  | 'not_owned'
  | 'off_origin'
  | 'url_unsafe'
  | 'url_invalid';

export interface PreflightResponse {
  ok: boolean;
  reason: PreflightReason;
}

export interface CancelResponse {
  ok: true;
}

export const CONTENT_SUB_VIEWS = [
  'analyses',
  'inventory',
  'competitors',
  'monitoring',
  'briefs',
] as const;
export type ContentSubView = (typeof CONTENT_SUB_VIEWS)[number];
export const DEFAULT_CONTENT_SUB_VIEW: ContentSubView = 'analyses';

export function isContentSubView(v: unknown): v is ContentSubView {
  return typeof v === 'string' && (CONTENT_SUB_VIEWS as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Content Inventory + cannibalization — wire types kept in lockstep
// with server/src/modules/content-intelligence/inventory.{schemas,model,
// service}.ts → toPublicInventoryRun / getInventoryRun / inventoryFindingsSchema.
// ---------------------------------------------------------------------------

export const CONTENT_INVENTORY_STATUSES = [
  'queued',
  'crawling',
  'analyzing',
  'completed',
  'partial',
  'failed',
  'cancelled',
] as const;
export type ContentInventoryStatus = (typeof CONTENT_INVENTORY_STATUSES)[number];

export const CONTENT_INVENTORY_TERMINAL_STATUSES: readonly ContentInventoryStatus[] = [
  'completed',
  'partial',
  'failed',
  'cancelled',
];

export function isContentInventoryStatus(v: unknown): v is ContentInventoryStatus {
  return (
    typeof v === 'string' &&
    (CONTENT_INVENTORY_STATUSES as readonly string[]).includes(v)
  );
}

export function isContentInventoryTerminal(status: ContentInventoryStatus): boolean {
  return (CONTENT_INVENTORY_TERMINAL_STATUSES as readonly string[]).includes(status);
}

export function isContentInventoryCancellable(status: ContentInventoryStatus): boolean {
  return !isContentInventoryTerminal(status);
}

/**
 * Client mirror of `env.CONTENT_INVENTORY_MAX_PAGES` (server default 100) plus
 * the block-metering constants. One block covers four requested pages; the
 * server re-validates and re-derives the reservation, so these only bound the
 * client-side form UX and the live block-calc transparency.
 */
export const INVENTORY_MAX_PAGES = 100;
export const INVENTORY_PAGES_PER_BLOCK = 4;
export const INVENTORY_MAX_PATHS = 20;
export const INVENTORY_MAX_SEEDS = 5;

/** `ceil(pages / 4)`, floored at 0 — mirrors `inventory.refund.ts:blocksForPages`. */
export function inventoryBlocksForPages(pages: number): number {
  if (!Number.isFinite(pages) || pages <= 0) return 0;
  return Math.ceil(pages / INVENTORY_PAGES_PER_BLOCK);
}

export type InventoryConfidence = 'high' | 'medium' | 'low';

export interface InventoryTopicCluster {
  id: string;
  label: string;
  urls: string[];
  sharedTerms: string[];
}

export interface InventoryDuplicateGroup {
  id: string;
  kind: 'exact' | 'near';
  field: 'content' | 'title' | 'headings';
  urls: string[];
  similarity: number;
}

export interface InventoryFlaggedPage {
  url: string;
  reason: 'thin' | 'orphan' | 'weakly_linked';
  reasonKey: string;
  reasonText: string;
  wordCount: number;
  internalLinkCount: number;
}

export interface InventoryCannibalizationCandidate {
  id: string;
  query: string;
  urls: string[];
  confidence: InventoryConfidence;
  evidenceSourceIds: string[];
  hasGscEvidence: boolean;
}

export interface InventoryTopicalGap {
  id: string;
  query: string;
  confidence: InventoryConfidence;
  evidenceSourceIds: string[];
}

export interface InventoryFindings {
  version: string;
  thresholdsVersion: string;
  clusters: InventoryTopicCluster[];
  duplicates: InventoryDuplicateGroup[];
  thinPages: InventoryFlaggedPage[];
  orphanPages: InventoryFlaggedPage[];
  cannibalization: InventoryCannibalizationCandidate[];
  gaps: InventoryTopicalGap[];
  opportunityExplanation: string | null;
}

export type InventoryQualityFlag =
  | 'thin'
  | 'orphan'
  | 'weakly_linked'
  | 'noindex'
  | 'missing_title';

export interface InventoryPageFacts {
  url: string;
  canonical: string | null;
  statusCode: number;
  robots: string[];
  language: string | null;
  title: string | null;
  description: string | null;
  headings: string[];
  wordCount: number;
  schemaTypes: string[];
  hasSchemaOrgArticle: boolean;
  internalLinkCount: number;
  externalLinkCount: number;
  internalOutLinks: string[];
  contentHash: string;
  primaryTopics: string[];
  secondaryTopics: string[];
  targetQueries: string[];
  qualityFlags: InventoryQualityFlag[];
}

export interface InventoryWarning {
  code: string;
  messageKey: string;
  message: string;
}

export interface InventoryError {
  category: string;
  messageKey: string;
  retryable: boolean;
  terminal: boolean;
}

export interface InventoryRunProgress {
  pagesRequested: number;
  pagesProcessed: number;
  pagesFailed: number;
  blocksReserved: number;
  blocksRefunded: number;
}

export interface InventoryReservation {
  key: string;
  reservedUnits: number;
  refundedUnits: number;
  refundedAt: string | null;
  refundReason: string | null;
}

export interface InventoryInput {
  pageLimit: number;
  allowedPaths: string[];
  excludedPaths: string[];
  sitemapSeeds: string[];
}

export interface InventoryRun {
  runId: string;
  siteId: string;
  origin: string;
  locale: string;
  status: ContentInventoryStatus;
  input: InventoryInput;
  progress: InventoryRunProgress;
  warnings: InventoryWarning[];
  error: InventoryError | null;
  thresholdsVersion: string | null;
  findings: InventoryFindings | null;
  reservation: InventoryReservation;
  costMicros: number;
  aiCostMicros: number;
  requestedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
}

export interface InventoryRunPage {
  url: string;
  facts: InventoryPageFacts;
}

export interface InventoryRunDetail extends InventoryRun {
  pages: InventoryRunPage[];
}

export interface InventoryRunsPage {
  items: InventoryRun[];
  nextCursor: string | null;
}

export interface StartInventoryResponse {
  runId: string;
  status: ContentInventoryStatus;
  reservedBlocks: number;
  duplicate: boolean;
  message: string;
}

export interface CancelInventoryResponse {
  ok: true;
}

// ---------------------------------------------------------------------------
// Competitor content intelligence (Agency) — wire types kept in
// lockstep with server/src/modules/competitor-content/
// {competitor-content.runs.service.ts → toPublicCompetitorRun / getCompetitorRun,
//  competitor-content.profiles.service.ts, competitor-content.schemas.ts}.
// ---------------------------------------------------------------------------

export const COMPETITOR_CONTENT_STATUSES = [
  'queued',
  'collecting',
  'comparing',
  'completed',
  'partial',
  'failed',
  'cancelled',
] as const;
export type CompetitorContentStatus = (typeof COMPETITOR_CONTENT_STATUSES)[number];

export const COMPETITOR_CONTENT_TERMINAL_STATUSES: readonly CompetitorContentStatus[] = [
  'completed',
  'partial',
  'failed',
  'cancelled',
];

export function isCompetitorContentStatus(v: unknown): v is CompetitorContentStatus {
  return (
    typeof v === 'string' &&
    (COMPETITOR_CONTENT_STATUSES as readonly string[]).includes(v)
  );
}

export function isCompetitorContentTerminal(status: CompetitorContentStatus): boolean {
  return (COMPETITOR_CONTENT_TERMINAL_STATUSES as readonly string[]).includes(status);
}

export function isCompetitorContentCancellable(status: CompetitorContentStatus): boolean {
  return !isCompetitorContentTerminal(status);
}

/**
 * Client mirror of the server portfolio safety limits. The server re-validates
 * every bound, so these only shape the client-side form UX and the transparent
 * run-cost disclosure.
 */
export const COMPETITOR_PORTFOLIO_MAX_COMPETITORS = 10;
export const COMPETITOR_CONTENT_PAGES_PER_RUN = 15;
export const COMPETITOR_CONTENT_SNIPPET_MAX_CHARS = 500;

export type CompetitorProfileSource = 'suggested' | 'manual';
export type CompetitorProfileStatus = 'active' | 'archived';

export interface CompetitorProfile {
  id: string;
  origin: string;
  registrableDomain: string;
  source: CompetitorProfileSource;
  status: CompetitorProfileStatus;
  createdAt: string | null;
}

export interface CompetitorSuggestion {
  registrableDomain: string;
  origin: string;
  avgPosition: number | null;
  intersections: number;
  alreadyConfirmed: boolean;
}

export type CompetitorContentConfidence = 'high' | 'medium' | 'low';

export const COMPETITOR_OPPORTUNITY_KINDS = [
  'topic_gap',
  'schema_gap',
  'format_gap',
  'internal_linking_gap',
  'differentiated_strength',
  'target_keyword',
] as const;
export type CompetitorOpportunityKind = (typeof COMPETITOR_OPPORTUNITY_KINDS)[number];

export interface CompetitorLandscapeKeywordEvidence {
  keyword: string;
  class: 'missing' | 'owned_only' | 'shared_behind' | 'shared_ahead' | 'shared_even' | null;
  ownedPosition: number | null;
  competitorPosition: number | null;
  ownedUrl: string | null;
  competitorUrl: string | null;
  searchVolume: number | null;
  intent: 'informational' | 'navigational' | 'commercial' | 'transactional' | null;
  provenanceIndexes: number[];
}

export interface CompetitorOpportunity {
  id: string;
  kind: CompetitorOpportunityKind;
  messageKey: string;
  messageVars?: Record<string, string | number>;
  label: string;
  confidence: CompetitorContentConfidence;
  evidenceSourceIds: string[];
  /** Absent on historical origin-era findings. */
  keywordEvidence?: CompetitorLandscapeKeywordEvidence[];
}

export interface CompetitorDelta {
  competitorDomain: string;
  competitorUrl: string;
  /** Reviewed-page provenance is absent on historical origin-era findings. */
  ownedUrl?: string;
  landscapeReportId?: string | null;
  landscapeOpportunityId?: string | null;
  suggestionId?: string | null;
  keywordEvidence?: CompetitorLandscapeKeywordEvidence[];
  wordCountDelta: number;
  headingCountDelta: number;
  internalLinkDelta: number;
  externalLinkDelta: number;
  missingSchemaTypes: string[];
  missingTopics: string[];
  ownedOnlyTopics: string[];
  sharedQueries: string[];
  snippetSourceId: string;
}

export interface CompetitorContentFindings {
  version: string;
  thresholdsVersion: string;
  ownedUrl: string;
  keyword: string | null;
  deltas: CompetitorDelta[];
  opportunities: CompetitorOpportunity[];
  partialDomains: string[];
  aiExplanation: string | null;
}

export interface CompetitorPageFacts {
  url: string;
  role: 'owned' | 'competitor';
  competitorDomain: string | null;
  statusCode: number;
  title: string | null;
  description: string | null;
  headings: string[];
  wordCount: number;
  schemaTypes: string[];
  hasSchemaOrgArticle: boolean;
  internalLinkCount: number;
  externalLinkCount: number;
  contentHash: string;
  primaryTopics: string[];
  secondaryTopics: string[];
  snippet: string;
}

export interface CompetitorContentWarning {
  code: string;
  messageKey: string;
  message: string;
}

export interface CompetitorContentError {
  category: string;
  messageKey: string;
  retryable: boolean;
  terminal: boolean;
}

export interface CompetitorContentReservation {
  key: string;
  reservedUnits: number;
  refundedUnits: number;
  refundedAt: string | null;
  refundReason: string | null;
}

export interface CompetitorContentRunInput {
  competitorIds: string[];
  competitorDomains: string[];
  pageLimit: number;
  /** Frozen reviewed legs. Absent on historical origin-era run documents. */
  pageMatches?: Array<{
    source: 'landscape_review' | 'legacy_explicit';
    landscapeReportId: string | null;
    landscapeOpportunityId: string | null;
    suggestionId: string | null;
    competitorProfileId: string;
    competitorDomain: string;
    suggestedRankingUrl: string;
    selectedUrl: string;
    ownedUrl: string | null;
    keywordEvidence: CompetitorLandscapeKeywordEvidence[];
  }>;
  /** Absent on historical documents created before reviewed-page matching. */
  compatibilityMode?: 'reviewed_pages' | 'legacy_explicit' | 'historical_origin';
}

export interface CompetitorContentProgress {
  competitorsRequested: number;
  competitorsProcessed: number;
  competitorsFailed: number;
  pagesScraped: number;
}

export interface CompetitorContentRun {
  runId: string;
  siteId: string;
  origin: string;
  ownedUrl: string;
  keyword: string | null;
  locale: string;
  status: CompetitorContentStatus;
  input: CompetitorContentRunInput;
  progress: CompetitorContentProgress;
  warnings: CompetitorContentWarning[];
  error: CompetitorContentError | null;
  thresholdsVersion: string | null;
  findings: CompetitorContentFindings | null;
  reservation: CompetitorContentReservation;
  costMicros: number;
  aiCostMicros: number;
  requestedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
}

export interface CompetitorContentRunPage {
  url: string;
  role: 'owned' | 'competitor';
  facts: CompetitorPageFacts;
}

export interface CompetitorContentRunDetail extends CompetitorContentRun {
  pages: CompetitorContentRunPage[];
}

export interface CompetitorContentRunsPage {
  items: CompetitorContentRun[];
  nextCursor: string | null;
}

export interface StartCompetitorRunResponse {
  runId: string;
  status: CompetitorContentStatus;
  reservedUnits: number;
  duplicate: boolean;
  message: string;
}

export interface AddCompetitorResponse {
  profile: CompetitorProfile;
  duplicate: boolean;
}

export interface MutateCompetitorResponse {
  profile: CompetitorProfile;
}

export interface SuggestCompetitorsResponse {
  suggestions: CompetitorSuggestion[];
}

export interface ListCompetitorsResponse {
  competitors: CompetitorProfile[];
}

export interface CancelCompetitorRunResponse {
  ok: true;
}

// ---------------------------------------------------------------------------
// Public-page change monitoring (Agency) — wire types kept in
// lockstep with server/src/modules/content-monitoring/
// {monitoring.service.ts → toPublicMonitor / listMonitors / getMonitor,
//  monitoring.schemas.ts, monitor.model.ts}.
// ---------------------------------------------------------------------------

export const CONTENT_MONITOR_STATUSES = [
  'active',
  'paused',
  'cap_paused',
  'error',
] as const;
export type ContentMonitorStatus = (typeof CONTENT_MONITOR_STATUSES)[number];

export function isContentMonitorStatus(v: unknown): v is ContentMonitorStatus {
  return (
    typeof v === 'string' &&
    (CONTENT_MONITOR_STATUSES as readonly string[]).includes(v)
  );
}

/** A monitor is "settled" (no pending check work) unless it is actively running. */
export function isContentMonitorActive(status: ContentMonitorStatus): boolean {
  return status === 'active';
}

export const CONTENT_MONITOR_TARGET_KINDS = ['owned', 'competitor'] as const;
export type ContentMonitorTargetKind = (typeof CONTENT_MONITOR_TARGET_KINDS)[number];

export const CONTENT_MONITOR_ERROR_CATEGORIES = [
  'provider_unavailable',
  'reconcile_failed',
  'cap_exhausted',
  'unexpected',
] as const;
export type ContentMonitorErrorCategory =
  (typeof CONTENT_MONITOR_ERROR_CATEGORIES)[number];

export const CONTENT_MONITOR_FEED_KINDS = [
  'check_reserved',
  'check_completed',
  'change_detected',
  'check_failed',
  'cap_paused',
] as const;
export type ContentMonitorFeedKind = (typeof CONTENT_MONITOR_FEED_KINDS)[number];

/**
 * Client mirror of the server monitoring safety limit
 * (`server/src/shared/safety/feature-limits.ts → CONTENT_MONITOR_ACTIVE_LIMIT`).
 * The server re-validates every bound, so these only shape the client-side slot
 * meter + form disable logic. The live slot count always comes from the list
 * response (`activeLimit`/`usedSlots`) — these constants are the fallback copy.
 */
export const CONTENT_MONITOR_ACTIVE_LIMIT = 5;
export const CONTENT_MONITOR_WEEKLY_CADENCE = 'weekly';

export interface MonitorError {
  category: ContentMonitorErrorCategory;
  messageKey: string;
}

export interface ContentMonitor {
  monitorId: string;
  siteId: string;
  targetUrl: string;
  targetKind: ContentMonitorTargetKind;
  cadence: string;
  locale: string;
  status: ContentMonitorStatus;
  hasBaseline: boolean;
  lastCheckAt: string | null;
  lastMaterialChangeAt: string | null;
  lastReconcileAt: string | null;
  error: MonitorError | null;
  createdAt: string;
  updatedAt: string;
}

export interface MonitorFeedEvent {
  eventKey: string;
  kind: string;
  checkId: string | null;
  isoWeek: string | null;
  recordedAt: string;
  diffText: string | null;
}

export interface ListMonitorsResponse {
  monitors: ContentMonitor[];
  activeLimit: number;
  usedSlots: number;
}

export interface CreatedMonitorResponse {
  monitor: ContentMonitor;
  duplicate: boolean;
}

export interface MonitorFeedResponse {
  monitor: ContentMonitor;
  feed: MonitorFeedEvent[];
  nextCursor: string | null;
}

export interface MutateMonitorResponse {
  monitor: ContentMonitor;
}

export interface DeleteMonitorResponse {
  ok: true;
}

/** Minimal projection of `GET/PATCH /users/notifications` the toggle reads. */
export interface MonitorNotificationPrefResponse {
  preferences: { emailMonitorChange: boolean };
}
