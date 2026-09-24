/**
 * Shape of the report payload returned by GET /api/audits/:runId/report
 * (server/src/modules/audits/report.service.ts). Rule copy is already
 * localized to the caller's locale — the client never sees `auditRules.*`
 * keys.
 */
import type { SupportedLocale } from '@shared/i18n';

export type RuleBucket = 'fix-now' | 'watch' | 'passed';
export type RuleSeverity = 'critical' | 'warning' | 'info';
export type DiffKind = 'fixed' | 'regressed' | 'new' | 'unchanged';

export interface LocalizedRuleCopy {
  title: string;
  why: string;
  fix: string;
  passedLabel: string;
  titleKey: string;
  whyKey: string;
  fixKey: string;
  passedLabelKey: string;
  /** GSC-state-specific explanation — server-localized; present
   * on `not-indexed` / `index-partial` when the finding meta carried a
   * coverage/robots/fetch state. */
  reason?: string;
  reasonKey?: string;
}

export interface LocalizedFinding {
  ruleId: string;
  bucket: RuleBucket;
  severity: RuleSeverity;
  affectedUrls: string[];
  codeFixPromptAvailable?: true;
  brokenLinkTargets?: string[];
  meta?: Record<string, unknown>;
  copy: LocalizedRuleCopy;
}

export interface FindingCounts {
  fixNow: number;
  watch: number;
  passed: number;
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
}

export type AuditSummaryStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed';

export interface AuditSummaryState {
  status: AuditSummaryStatus;
  aiSummary: AuditReportAiSummary | null;
  requestedLocale: SupportedLocale;
  availableLocales: SupportedLocale[];
}

export interface AuditReportAiSummaryAvailability {
  requestedLocale: SupportedLocale;
  availableLocales: SupportedLocale[];
  status: AuditSummaryStatus;
}

export interface AuditReport {
  runId: string;
  counts: FindingCounts;
  findings: LocalizedFinding[];
  diff: SnapshotDiff;
  pageSpeed: PageSpeedSection | null;
  /** `null` on pre-feature snapshots — GscBlock renders the connect prompt. */
  gscSearch?: GscSearchSection | null;
  gscSitemaps?: GscSitemapsSection | null;
  aiVisibility?: AiVisibilitySection | null;
  /** Local SEO section — NAP, reviews/Q&A, local-pack rank. */
  localSeo?: LocalSeoSection | null;
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
  /** Recent audit runs for the report history block. */
  runs: PublicAuditRun[];
  runsLoading: boolean;
  runsLoaded: boolean;
  runsSiteId: string | null;
  /** White-label PDF download (workstream B). */
  pdfDownloading: boolean;
  pdfError: string;
}
