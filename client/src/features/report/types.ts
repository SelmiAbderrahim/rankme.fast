/**
 * Shape of the report payload returned by GET /api/audits/:runId/report
 * (server/src/modules/audits/report.service.ts). Rule copy is already
 * localized to the caller's locale — the client never sees `auditRules.*`
 * keys.
 */
import type { SupportedLocale } from '@shared/i18n';
import type { CrawlStopReason, CrawlStopReasonSource } from '@shared/components/CrawlStopReasonNote';

export interface AuditCrawlSummary {
  finishedAt: string | null;
  pageCap: number;
  pagesStored: number | null;
  vendorPagesCrawled: number | null;
  stopReason: CrawlStopReason | null;
  stopReasonSource?: CrawlStopReasonSource | null;
  sitemapFound: boolean | null;
}

export type RuleBucket = 'fix-now' | 'watch' | 'passed';
export type RuleSeverity = 'critical' | 'warning' | 'info';
export type DiffKind = 'fixed' | 'regressed' | 'new' | 'unchanged';

export interface LocalizedRuleCopy {
  title: string;
  why: string;
  fix: string;
  passedLabel: string;
  /** Message keys: on the full report (exports, public API); the report screen payload leaves them out. */
  titleKey?: string;
  whyKey?: string;
  fixKey?: string;
  passedLabelKey?: string;
  /** GSC-state-specific explanation — server-localized; present
   * on `not-indexed` / `index-partial` when the finding meta carried a
   * coverage/robots/fetch state. */
  reason?: string;
  reasonKey?: string;
}

/**
 * How a finding compares with the previous audit. Mirrors
 * `server/src/modules/audits/finding-comparison.ts`; `regressed` always means
 * the previous run evaluated the check, `new` covers a check that was absent
 * or not evaluated before.
 */
export type FindingComparisonStatus =
  | 'new'
  | 'regressed'
  | 'improved'
  | 'unchanged'
  | 'resolved'
  | 'not_comparable';

/** Whether a check applies to the site at all. */
export type FindingApplicability = 'applicable' | 'not_applicable';

/** A measured page length behind a thin-content finding. */
export interface FindingMeasurement {
  url: string;
  value: number;
  unit: 'words' | 'characters';
}

/** The previous run a report compares with. */
export interface ReportComparison {
  previousRunId: string;
  previous: { pageCap: number; pagesCrawled: number | null };
  current: { pageCap: number; pagesCrawled: number | null };
  scopeMismatch: boolean;
}

export type DismissalReason = 'false_positive' | 'wont_fix' | 'fixed_elsewhere' | 'other';
export type FindingRecheckOutcome = 'still_failing' | 'cleared' | 'unverified';

export interface FindingRecheck {
  checkedAt: string;
  totalUrls: number;
  checked: number;
  stillFailing: number;
  cleared: number;
  unverified: number;
  results: Array<{ url: string; outcome: FindingRecheckOutcome; status: number | null }>;
}

/** GET …/findings/:ruleId/recheck: what a re-check would request. */
export interface FindingRecheckPreview {
  ruleId: string;
  totalUrls: number;
  urlCount: number;
  lastRecheck: FindingRecheck | null;
}

/** A decision as the server applied it to the report (one `applyDismissals`). */
export interface FindingDecision {
  state: 'open' | 'planned' | 'dismissed' | 'completed';
  regressed: boolean;
  decidedAt: string;
  decidedBy: string | null;
  reason: DismissalReason | null;
  affectedCountAtDismissal: number | null;
  /** The newest audit's view of the rule; null when the site has no finished audit. */
  latest: { runId: string; detected: boolean; affectedCount: number } | null;
  /** Dismissed, but the newest audit counts more pages: counted as open again. */
  resurfaced: { addedCount: number } | null;
  recheckable: boolean;
  recheck: FindingRecheck | null;
}

/** How a broken-link target fared when the audit requested it again. */
export type BrokenLinkOutcome = 'confirmed' | 'unverified' | 'reported' | 'cleared';

export type BrokenLinkFailureKind =
  | 'http_error'
  | 'redirect_loop'
  | 'redirect_limit'
  | 'unsafe_redirect'
  | 'robots_blocked'
  | 'timeout'
  | 'non_html'
  | 'unreachable';

export interface BrokenLinkEvidenceRow {
  source: string;
  target: string;
  outcome: BrokenLinkOutcome;
  /** HTTP status of the re-request; `null` when there was no HTTP answer. */
  status: number | null;
  failure?: BrokenLinkFailureKind;
  finalUrl?: string;
}

export interface LocalizedFinding {
  ruleId: string;
  bucket: RuleBucket;
  severity: RuleSeverity;
  /** The report screen receives a preview; `affectedUrlCount` is the total. */
  affectedUrls: string[];
  /** Total affected URLs when the server sent a preview; absent means `affectedUrls` is complete. */
  affectedUrlCount?: number;
  codeFixPromptAvailable?: true;
  brokenLinkTargets?: string[];
  /** Total broken-link targets when `brokenLinkTargets` is a preview. */
  brokenLinkTargetCount?: number;
  /** Every source → target pair behind a broken-links finding; confirmed first, dismissed last. */
  brokenLinkEvidence?: BrokenLinkEvidenceRow[];
  /** Total rows when `brokenLinkEvidence` was cut at the report bound. */
  brokenLinkEvidenceTotal?: number;
  meta?: Record<string, unknown>;
  /** The check could not run (data source missing) — not an open problem. */
  notEvaluated?: true;
  /** Report category for the category filter; absent on older servers, `null` for an unknown id. */
  category?: ReportCategory | null;
  copy: LocalizedRuleCopy;
  /** Absent on a first run, a check not evaluated now, or a passing check never measured before. */
  comparisonStatus?: FindingComparisonStatus;
  applicability?: FindingApplicability;
  /** The site's decision on this Fix-now / Watch finding; absent = none. */
  decision?: FindingDecision;
}

/** Mirrors the server's `RULE_CATEGORIES` (rules/categories.ts). */
export const REPORT_CATEGORIES = [
  'indexability',
  'links-redirects',
  'content',
  'html',
  'media',
  'performance',
  'security',
  'social',
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export interface FindingCounts {
  fixNow: number;
  watch: number;
  passed: number;
  /** Checks that could not run; absent on responses from older API versions. */
  notEvaluated?: number;
}

export interface DiffEntry {
  ruleId: string;
  url: string;
  kind: DiffKind;
}

export interface SnapshotDiff {
  entries: DiffEntry[];
  summary: Record<DiffKind, number>;
}

/**
 * Full lists of one finding from GET /api/audits/:runId/findings/:ruleId/urls.
 * The report carries a preview of each list; these load on demand.
 */
export interface FindingUrls {
  ruleId: string;
  affectedUrls: string[];
  brokenLinkTargets: string[];
  brokenLinkEvidence: BrokenLinkEvidenceRow[];
  /** Measured length of every affected URL; absent on older responses. */
  measurements?: FindingMeasurement[];
  /** Per-URL change against the previous run; unchanged URLs are omitted. */
  diff: Array<{ url: string; kind: DiffKind }>;
  /** Full deep crawl evidence lists; absent on older responses. */
  evidence?: Record<string, unknown[]>;
}

// ---------------------------------------------------------------------------
// PageSpeed section — PSI + CrUX samples merged into the report.
// ---------------------------------------------------------------------------

export type CoreWebVitalsCategory = 'good' | 'needs-improvement' | 'poor';
export type PageSpeedStatus = 'ok' | 'unavailable';
export type PageSpeedStrategy = 'mobile' | 'desktop';
export type PageSpeedFieldDataLevel = 'url' | 'origin' | 'none';

export interface PageSpeedSampleCoreWebVitals {
  lcpMs: number;
  inp: number;
  cls: number;
  category: CoreWebVitalsCategory;
}

export interface PageSpeedSample {
  url: string;
  strategy: PageSpeedStrategy;
  labScores: {
    performance: number;
    accessibility: number;
    bestPractices: number;
    seo: number;
  };
  coreWebVitals?: PageSpeedSampleCoreWebVitals;
  mobileFriendly?: boolean;
  fieldDataLevel: PageSpeedFieldDataLevel;
}

export interface PageSpeedSection {
  status: PageSpeedStatus;
  samples: PageSpeedSample[];
}

// ---------------------------------------------------------------------------
// GSC Search Analytics + Sitemaps sections.
// ---------------------------------------------------------------------------

export type GscSearchStatus =
  | 'ok'
  | 'unavailable'
  | 'not-connected'
  | 'needs-reconnect'
  | 'no-data';

export interface GscSearchTopQuery {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GscSearchTopPage {
  url: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GscSearchSection {
  status: GscSearchStatus;
  totalClicks: number;
  totalImpressions: number;
  averageCtr: number;
  averagePosition: number;
  topQueries: GscSearchTopQuery[];
  topPages: GscSearchTopPage[];
  delta: { clicks: number | null; impressions: number | null };
}

export type GscSitemapsStatus =
  | 'ok'
  | 'unavailable'
  | 'not-connected'
  | 'needs-reconnect'
  | 'no-sitemaps';

export interface GscSitemapEntry {
  path: string;
  errors: number;
  warnings: number;
  processed: number;
  lastDownloaded: string | null;
}

export interface GscSitemapsSection {
  status: GscSitemapsStatus;
  sitemaps: GscSitemapEntry[];
}

export type AiVisibilityStatus = 'ok' | 'unavailable' | 'no-prompts-tracked';

export interface AiVisibilitySection {
  status: AiVisibilityStatus;
  aiOverviewCitedCount: number;
  aiOverviewTotalChecked: number;
  llmMentionedCount: number;
  llmTotalChecked: number;
  shareOfVoicePct: number | null;
  sentiment: { positive: number; neutral: number; negative: number };
  notMentionedPrompts: string[];
}

// ---------------------------------------------------------------------------
// Local SEO section — NAP, reviews/Q&A, local-pack rank.
// ---------------------------------------------------------------------------

export type LocalSeoStatus = 'ok' | 'unavailable' | 'not-configured';

export interface LocalSeoSection {
  status: LocalSeoStatus;
  listings: Array<{ source: string; consistent: boolean }>;
  reviews: { averageRating: number | null; reviewCount: number } | null;
  qa: { unansweredCount: number } | null;
  localPack: { keyword: string; position: number | null; totalPackSize: number } | null;
}

/**
 * AI summary. Optional model-generated plain-English summary of
 * the Fix-now findings. `null` = never generated for this run — the card
 * renders its CTA. `null` at the top level's `aiSummaryEnabled=false` hides
 * the card entirely.
 */
export interface AuditReportAiSummary {
  text: string;
  locale: SupportedLocale;
  model: string;
  truncated: boolean;
  createdAt: string;
  /** Rule ids of the open findings the summary was built from (its evidence). */
  basisRuleIds?: string[];
  /** Hash of the findings, dismissals and action states it was built from. */
  inputHash?: string;
  /** Status sentence + top items; absent on older, text-only summaries. */
  structured?: AiSummaryStructured;
}

export type SummaryActArea = 'report' | 'pages' | 'google' | 'schema' | 'local-seo' | 'ai-visibility';

export interface AiSummaryItem {
  ruleId: string;
  what: string;
  why: string;
  firstStep: string;
  whereToAct: SummaryActArea;
}

export interface AiSummaryStructured {
  status: string;
  items: AiSummaryItem[];
}

/** Whether a stored summary still matches the findings that are open today. */
export interface AuditSummaryFreshness {
  stale: boolean;
  reason: 'triage_changed' | null;
  evidenceRuleIds: string[] | null;
  changedRuleIds: string[];
}

export type AuditSummaryStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed';

/** What a running summary job reports. */
export type AuditSummaryStage = 'queued' | 'reading_findings' | 'checking_priorities' | 'writing_summary';
export type AuditSummaryFailureCode = 'provider_unavailable' | 'timeout' | 'internal';

export interface AuditSummaryProgress {
  stage: AuditSummaryStage | null;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** Server-measured time since the request, up to its end. */
  elapsedMs: number;
  failureCode: AuditSummaryFailureCode | null;
}

export interface AuditSummaryState {
  status: AuditSummaryStatus;
  aiSummary: AuditReportAiSummary | null;
  requestedLocale: SupportedLocale;
  availableLocales: SupportedLocale[];
  freshness?: AuditSummaryFreshness | null;
  /** Latest job of this locale; sent by the summary routes only. */
  progress?: AuditSummaryProgress | null;
}

export interface AuditReportAiSummaryAvailability {
  requestedLocale: SupportedLocale;
  availableLocales: SupportedLocale[];
  status: AuditSummaryStatus;
}

export interface AuditReport {
  runId: string;
  /** What the run's crawl recorded about itself; absent on older responses. */
  crawl?: AuditCrawlSummary;
  /** The site's newest finished audit; absent on older responses. */
  latestRunId?: string | null;
  /** `counts` without dismissed and fixed findings; absent on older responses. */
  openCounts?: FindingCounts;
  /** What `openCounts` leaves out. */
  notCounted?: { dismissed: number; completed: number };
  counts: FindingCounts;
  findings: LocalizedFinding[];
  /** Checks that do not apply to this site; absent on older responses. */
  notApplicable?: LocalizedFinding[];
  /** The owner marked the site as a local business. */
  localBusiness?: boolean;
  diff: SnapshotDiff;
  /** The run this report compares with; `null` on a first run. */
  comparison?: ReportComparison | null;
  pageSpeed: PageSpeedSection | null;
  /** `null` on pre-feature snapshots — GscBlock renders the connect prompt. */
  gscSearch?: GscSearchSection | null;
  gscSitemaps?: GscSitemapsSection | null;
  aiVisibility?: AiVisibilitySection | null;
  /** Local SEO section — NAP, reviews/Q&A, local-pack rank. */
  localSeo?: LocalSeoSection | null;
  /**
   * Set when the crawl landed on another host than the site's own (www <->
   * apex or another domain): every affected URL in the report belongs to `to`.
   */
  hostRedirect?: { from: string; to: string } | null;
  /** `null` when the AI summary has never been generated for this run. */
  aiSummary?: AuditReportAiSummary | null;
  /** Durable generation state; absent on responses from older API versions. */
  aiSummaryStatus?: AuditSummaryStatus;
  aiSummaryAvailability?: AuditReportAiSummaryAvailability;
  /**
   * Feature gate — `true` iff `AI_SUMMARY_ENABLED=true` AND the server has a
   * working summary provider. When absent/false the client hides the card
   * entirely (byte-identical to the pre-feature UI).
   */
  aiSummaryEnabled?: boolean;
  /** Set when the stored summary no longer matches the open findings. */
  aiSummaryFreshness?: AuditSummaryFreshness | null;
  /** Days after which an audit counts as out of date; the Actions evidence uses the same value. */
  auditFreshDays?: number;
}

/** Rule ids driven by the PSI/CrUX pipeline. Report UI uses this to render
 * the compact page-speed block inside the relevant issue rows. */
export const PAGE_SPEED_RULE_IDS = [
  'core-web-vitals-poor',
  'page-speed-lab-low',
  'mobile-unfriendly',
  'accessibility-low',
] as const;
export type PageSpeedRuleId = (typeof PAGE_SPEED_RULE_IDS)[number];
export const isPageSpeedRuleId = (id: string): id is PageSpeedRuleId =>
  (PAGE_SPEED_RULE_IDS as readonly string[]).includes(id);

/** Rule ids driven by the GSC Search Analytics window. */
export const GSC_SEARCH_RULE_IDS = ['gsc-ctr-low'] as const;
export type GscSearchRuleId = (typeof GSC_SEARCH_RULE_IDS)[number];
export const isGscSearchRuleId = (id: string): id is GscSearchRuleId =>
  (GSC_SEARCH_RULE_IDS as readonly string[]).includes(id);

/** Rule ids driven by the GSC sitemaps list. */
export const GSC_SITEMAP_RULE_IDS = ['sitemap-errors'] as const;
export type GscSitemapRuleId = (typeof GSC_SITEMAP_RULE_IDS)[number];
export const isGscSitemapRuleId = (id: string): id is GscSitemapRuleId =>
  (GSC_SITEMAP_RULE_IDS as readonly string[]).includes(id);

export const AI_VISIBILITY_RULE_IDS = ['ai-visibility-low'] as const;
export type AiVisibilityRuleId = (typeof AI_VISIBILITY_RULE_IDS)[number];
export const isAiVisibilityRuleId = (id: string): id is AiVisibilityRuleId =>
  (AI_VISIBILITY_RULE_IDS as readonly string[]).includes(id);

export const LOCAL_SEO_RULE_IDS = [
  'nap-inconsistency',
  'low-review-count',
  'low-review-rating',
  'local-pack-not-ranking',
] as const;
export type LocalSeoRuleId = (typeof LOCAL_SEO_RULE_IDS)[number];
export const isLocalSeoRuleId = (id: string): id is LocalSeoRuleId =>
  (LOCAL_SEO_RULE_IDS as readonly string[]).includes(id);

/** Public shape of an audit run from GET /api/sites/:siteId/audits. */
export interface PublicAuditRun {
  id: string;
  siteId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  pageCap: number;
  /** The crawl loads images, scripts and stylesheets. */
  resourceScan?: boolean;
  pagesCrawled: number;
  vendorTaskId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditRunListPage {
  runs: PublicAuditRun[];
  nextCursor: string | null;
}

export interface StartAuditResponse {
  run: PublicAuditRun;
  message: string;
}

export interface ReportState {
  presentationLocale: SupportedLocale;
  presentationGeneration: number;
  reportCacheKey: string;
  runId: string | null;
  siteId: string | null;
  report: AuditReport | null;
  loading: boolean;
  loaded: boolean;
  error: string;
  retesting: boolean;
  retestError: string;
  runStatus: PublicAuditRun['status'] | null;
  /** Crawl ceiling of the in-flight run, when known. */
  runPageCap: number | null;
  /** When the run behind `report` finished; null without a report. */
  reportRunAt: string | null;
  /** Recent audit runs for the report history block. */
  runs: PublicAuditRun[];
  runsLoading: boolean;
  runsLoaded: boolean;
  runsSiteId: string | null;
  /** Thunk request id of the history read that owns `runsLoading`. */
  runsRequestId: string | null;
  /** Localized message when the history read failed; '' otherwise. */
  runsError: string;
  /** White-label PDF download (workstream B). */
  pdfDownloading: boolean;
  pdfError: string;
}
