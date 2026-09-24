/**
 * Rule engine types.
 *
 * Rules are pure functions over the vendor-neutral `AuditResult` — never over
 * raw DataForSEO / PSI fields. That firewall is what keeps `AuditRule.id`
 * stable across vendor swaps: the id keys i18n copy and history diffs.
 */
import type { AuditResult, GscSearchEvaluationInput, GscSearchStatus, GscSitemapsEvaluationInput, GscSitemapsStatus, IndexStatusEvaluationInput, IndexStatusSample, IndexStatusStatus, } from '../../../shared/providers/index.js';
export type { GscSearchEvaluationInput, GscSearchStatus, GscSitemapsEvaluationInput, GscSitemapsStatus, IndexStatusEvaluationInput, IndexStatusSample, IndexStatusStatus, };
/** Stable ids — DO NOT rename. They key `auditRules` i18n + report snapshot diffs. */
export const RULE_IDS = [
    'robots-blocked',
    'sitemap-missing-or-weak',
    'title-missing-or-weak',
    'meta-description-missing',
    'headings-weak',
    'canonical-missing-or-broken',
    'structured-data-missing',
    'broken-internal-links',
    'thin-content',
    'faq-content-missing',
    'llms-txt-missing',
    'https-canonicalization',
    // Page speed. Field data (CrUX) vs lab (PSI Lighthouse) rules.
    'core-web-vitals-poor',
    'page-speed-lab-low',
    'mobile-unfriendly',
    'accessibility-low',
    // Index status (Google Search Console URL inspection).
    'not-indexed',
    'rich-results-issues',
    'index-partial',
    // GSC Search Analytics + Sitemaps.
    'gsc-ctr-low',
    'sitemap-errors',
    'ai-visibility-low',
    // Local SEO (NAP consistency, reviews/Q&A health, local pack).
    'nap-inconsistency',
    'low-review-count',
    'low-review-rating',
    'local-pack-not-ranking',
] as const;
export type RuleId = (typeof RULE_IDS)[number];
// ---------------------------------------------------------------------------
// Page-speed evaluation input.
//
// The audit processor samples PSI+CrUX on the site root + top-N pages by
// internal-link count. Each sample carries lab scores, optional CrUX field
// data (may be `undefined` for low-traffic URLs), a mobile-friendly signal
// (mobile strategy only), and a `fieldDataLevel` marker so the UI can
// label "URL-level" vs "origin fallback" vs "no field data" honestly.
//
// `status: 'unavailable'` means the provider failed on every sample — the
// PageSpeed rules then land in watch with `insufficientData` meta and the
// core audit still finishes (release-gate contract).
// ---------------------------------------------------------------------------
export interface PageSpeedSample {
    url: string;
    strategy: 'mobile' | 'desktop';
    labScores: {
        performance: number;
        accessibility: number;
        bestPractices: number;
        seo: number;
    };
    coreWebVitals?: {
        lcpMs: number;
        inp: number;
        cls: number;
        category: 'good' | 'needs-improvement' | 'poor';
    };
    mobileFriendly?: boolean;
    fieldDataLevel: 'url' | 'origin' | 'none';
}
export type PageSpeedStatus = 'ok' | 'unavailable';
export interface PageSpeedEvaluationInput {
    status: PageSpeedStatus;
    samples: PageSpeedSample[];
}
/** Broadest severity beats bucket policy: `critical → fix-now`, `warning → watch`, `info → passed`. */
export type RuleSeverity = 'critical' | 'warning' | 'info';
export type RuleBucket = 'fix-now' | 'watch' | 'passed';
export interface RuleFinding {
    ruleId: RuleId;
    bucket: RuleBucket;
    severity: RuleSeverity;
    /** URLs the finding applies to. Empty = site-wide (domain-level check). */
    affectedUrls: string[];
    /**
     * Free-form structured detail the report may render inline (e.g.
     * `{ insufficientData: true }` for a rule the vendor never sampled).
     * Kept as a plain object so it round-trips through Mongo unchanged.
     */
    meta?: Record<string, unknown>;
}
export interface AuditRule {
    id: RuleId;
    evaluate(result: AuditResult): RuleFinding;
}
/**
 * Page-speed rules evaluate over PSI+CrUX samples, not the
 * on-page AuditResult. A `null` input means the provider never ran (rare
 * — usually reflected by `status: 'unavailable'` on a real input).
 */
export interface PageSpeedRule {
    id: RuleId;
    evaluate(input: PageSpeedEvaluationInput | null): RuleFinding;
}
/**
 * Index-status rules evaluate over GSC URL-inspection samples.
 * `null` = the audit ran with no connection at all (equivalent to
 * `status: 'not-connected'` — rules land in watch with `insufficientData`).
 */
export interface IndexStatusRule {
    id: RuleId;
    evaluate(input: IndexStatusEvaluationInput | null): RuleFinding;
}
/**
 * Search-analytics rules evaluate over the aggregated GSC
 * Search Analytics window. `null` = pre-feature snapshot or no collector
 * wired — same degradation contract as the index-status rules.
 */
export interface GscSearchRule {
    id: RuleId;
    evaluate(input: GscSearchEvaluationInput | null): RuleFinding;
}
/** Sitemap-health rules evaluate over the GSC sitemaps list. */
export interface GscSitemapsRule {
    id: RuleId;
    evaluate(input: GscSitemapsEvaluationInput | null): RuleFinding;
}
export interface AiVisibilityEvaluationInput {
    status: 'ok' | 'unavailable' | 'no-prompts-tracked';
    /** Rollup of the existing per-keyword aiOverview signal already collected by rank checks. */
    aiOverviewCitedCount: number;
    aiOverviewTotalChecked: number;
    /** Rollup of the new LLM-mention checks. */
    llmMentionedCount: number;
    llmTotalChecked: number;
    /** Full-AEO: brand mentions ÷ (brand + competitor mentions), 0–100. null when no data. */
    shareOfVoicePct: number | null;
    /** Full-AEO: how many checked answers scored negative sentiment on the brand. */
    negativeSentimentCount: number;
    /** Whether any competitor was mentioned at all (distinguishes "0% SoV, competitors present" from "no competitors tracked"). */
    competitorsPresent: boolean;
}
export interface AiVisibilityRule {
    id: RuleId;
    evaluate(input: AiVisibilityEvaluationInput | null): RuleFinding;
}
/**
 * Local SEO evaluation input — NAP consistency across
 * directories, review/Q&A health, and local-pack (map pack) rank.
 * `status: 'not-configured'` = never refreshed AND no local-pack keyword
 * tracked (distinct from `'unavailable'`, reserved for a future
 * provider-outage signal — the current refresh path never persists a
 * partial result, so a failed refresh is indistinguishable from "never
 * tried" and both degrade identically).
 */
export interface LocalSeoEvaluationInput {
    status: 'ok' | 'unavailable' | 'not-configured';
    listings: Array<{
        source: string;
        consistent: boolean;
    }>;
    reviews: {
        averageRating: number | null;
        reviewCount: number;
    } | null;
    qa: {
        unansweredCount: number;
    } | null;
    localPack: {
        keyword: string;
        position: number | null;
        totalPackSize: number;
    } | null;
}
export interface LocalSeoRule {
    id: RuleId;
    evaluate(input: LocalSeoEvaluationInput | null): RuleFinding;
}
