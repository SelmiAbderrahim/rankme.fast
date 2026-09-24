/**
 * Rule engine — pure fan-out over ALL_RULES.
 *
 * Each rule is called defensively: a rule that throws is downgraded to a
 * watch finding with `insufficientData` meta so an unknown/malformed vendor
 * check can never crash the report or invent a fix-now.
 */
import type { AuditResult } from '../../../shared/providers/index.js';
import { accessibilityLowRule } from './accessibility-low.js';
import { aiVisibilityLowRule } from './ai-visibility-low.js';
import { brokenInternalLinksRule } from './broken-internal-links.js';
import { canonicalMissingOrBrokenRule } from './canonical-missing-or-broken.js';
import { coreWebVitalsPoorRule } from './core-web-vitals-poor.js';
import { faqContentMissingRule } from './faq-content-missing.js';
import { gscCtrLowRule } from './gsc-ctr-low.js';
import { headingsWeakRule } from './headings-weak.js';
import { httpsCanonicalizationRule } from './https-canonicalization.js';
import { indexPartialRule } from './index-partial.js';
import { llmsTxtMissingRule } from './llms-txt-missing.js';
import { localPackNotRankingRule, lowReviewCountRule, lowReviewRatingRule, napInconsistencyRule, } from './local-seo/index.js';
import { metaDescriptionMissingRule } from './meta-description-missing.js';
import { mobileUnfriendlyRule } from './mobile-unfriendly.js';
import { notIndexedRule } from './not-indexed.js';
import { pageSpeedLabLowRule } from './page-speed-lab-low.js';
import { richResultsIssuesRule } from './rich-results-issues.js';
import { robotsBlockedRule } from './robots-blocked.js';
import { sitemapErrorsRule } from './sitemap-errors.js';
import { sitemapMissingOrWeakRule } from './sitemap-missing-or-weak.js';
import { structuredDataMissingRule } from './structured-data-missing.js';
import { thinContentRule } from './thin-content.js';
import { titleMissingOrWeakRule } from './title-missing-or-weak.js';
import type { AuditRule, AiVisibilityEvaluationInput, AiVisibilityRule, GscSearchEvaluationInput, GscSearchRule, GscSitemapsEvaluationInput, GscSitemapsRule, IndexStatusEvaluationInput, IndexStatusRule, LocalSeoEvaluationInput, LocalSeoRule, PageSpeedEvaluationInput, PageSpeedRule, RuleBucket, RuleFinding, } from './rule.types.js';
/**
 * Ordered so the report screen shows the highest-impact
 * findings first when several land in the same bucket at the same page
 * count. Keep alphabetical inside a topical group so diffs read cleanly.
 */
export const ALL_RULES: readonly AuditRule[] = [
    robotsBlockedRule,
    sitemapMissingOrWeakRule,
    httpsCanonicalizationRule,
    canonicalMissingOrBrokenRule,
    brokenInternalLinksRule,
    titleMissingOrWeakRule,
    metaDescriptionMissingRule,
    headingsWeakRule,
    structuredDataMissingRule,
    thinContentRule,
    faqContentMissingRule,
    llmsTxtMissingRule,
];
/**
 * Page-speed rules are a separate list because they consume a
 * different input (`PageSpeedEvaluationInput`) than on-page audit rules.
 * Findings from both engines are merged before persisting a snapshot.
 */
export const ALL_PAGESPEED_RULES: readonly PageSpeedRule[] = [
    coreWebVitalsPoorRule,
    pageSpeedLabLowRule,
    mobileUnfriendlyRule,
    accessibilityLowRule,
];
/**
 * Index-status rules consume a separate `IndexStatusEvaluationInput`
 * so a missing / needs-reconnect / quota-exceeded connection degrades to
 * `insufficientData` findings while the core audit still finishes.
 */
export const ALL_INDEXSTATUS_RULES: readonly IndexStatusRule[] = [
    notIndexedRule,
    richResultsIssuesRule,
    indexPartialRule,
];
/**
 * Search-analytics rules consume the aggregated GSC Search
 * Analytics window; sitemap rules consume the GSC sitemaps list. Both follow
 * the same degradation contract as the index-status rules.
 */
export const ALL_GSC_SEARCH_RULES: readonly GscSearchRule[] = [gscCtrLowRule];
export const ALL_GSC_SITEMAPS_RULES: readonly GscSitemapsRule[] = [
    sitemapErrorsRule,
];
export const ALL_AIVISIBILITY_RULES: readonly AiVisibilityRule[] = [
    aiVisibilityLowRule,
];
/**
 * Local SEO rules consume the `LocalSeoEvaluationInput` rollup —
 * NAP consistency, review/Q&A health, and local-pack rank. Same degradation
 * contract as every other typed rule list: `null` / non-`ok` status lands in
 * `watch` with `insufficientData` meta.
 */
export const ALL_LOCALSEO_RULES: readonly LocalSeoRule[] = [
    napInconsistencyRule,
    lowReviewCountRule,
    lowReviewRatingRule,
    localPackNotRankingRule,
];
const BUCKET_ORDER: Record<RuleBucket, number> = {
    'fix-now': 0,
    watch: 1,
    passed: 2,
};
const SEVERITY_ORDER: Record<RuleFinding['severity'], number> = {
    critical: 0,
    warning: 1,
    info: 2,
};
/**
 * Priority within a bucket: severity first, then affected-page count
 * (larger blast radius sinks lower id), stable tiebreak on `ruleId`.
 */
function compareFindings(a: RuleFinding, b: RuleFinding): number {
    const bucket = BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket];
    if (bucket !== 0)
        return bucket;
    const severity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (severity !== 0)
        return severity;
    const pages = b.affectedUrls.length - a.affectedUrls.length;
    if (pages !== 0)
        return pages;
    return a.ruleId.localeCompare(b.ruleId);
}
export function evaluateAllRules(result: AuditResult, pageSpeed: PageSpeedEvaluationInput | null = null, indexStatus: IndexStatusEvaluationInput | null = null, gscSearch: GscSearchEvaluationInput | null = null, gscSitemaps: GscSitemapsEvaluationInput | null = null, aiVisibility: AiVisibilityEvaluationInput | null = null, localSeo: LocalSeoEvaluationInput | null = null): RuleFinding[] {
    const auditFindings: RuleFinding[] = ALL_RULES.map((rule) => {
        try {
            return rule.evaluate(result);
            /* c8 ignore start -- defensive: current rules do not throw; caught to keep an unknown vendor payload from crashing the pipeline. */
        }
        catch {
            return {
                ruleId: rule.id,
                bucket: 'watch',
                severity: 'warning',
                affectedUrls: [],
                meta: { insufficientData: true, error: true },
            };
        }
        /* c8 ignore stop */
    });
    const psFindings: RuleFinding[] = ALL_PAGESPEED_RULES.map((rule) => {
        try {
            return rule.evaluate(pageSpeed);
            /* c8 ignore start -- defensive parity with the audit path. */
        }
        catch {
            return {
                ruleId: rule.id,
                bucket: 'watch',
                severity: 'warning',
                affectedUrls: [],
                meta: { insufficientData: true, error: true },
            };
        }
        /* c8 ignore stop */
    });
    const idxFindings: RuleFinding[] = ALL_INDEXSTATUS_RULES.map((rule) => {
        try {
            return rule.evaluate(indexStatus);
            /* c8 ignore start -- defensive parity with the audit path. */
        }
        catch {
            return {
                ruleId: rule.id,
                bucket: 'watch',
                severity: 'warning',
                affectedUrls: [],
                meta: { insufficientData: true, error: true },
            };
        }
        /* c8 ignore stop */
    });
    const gscSearchFindings: RuleFinding[] = ALL_GSC_SEARCH_RULES.map((rule) => {
        try {
            return rule.evaluate(gscSearch);
            /* c8 ignore start -- defensive parity with the audit path. */
        }
        catch {
            return {
                ruleId: rule.id,
                bucket: 'watch',
                severity: 'warning',
                affectedUrls: [],
                meta: { insufficientData: true, error: true },
            };
        }
        /* c8 ignore stop */
    });
    const gscSitemapFindings: RuleFinding[] = ALL_GSC_SITEMAPS_RULES.map((rule) => {
        try {
            return rule.evaluate(gscSitemaps);
            /* c8 ignore start -- defensive parity with the audit path. */
        }
        catch {
            return {
                ruleId: rule.id,
                bucket: 'watch',
                severity: 'warning',
                affectedUrls: [],
                meta: { insufficientData: true, error: true },
            };
        }
        /* c8 ignore stop */
    });
    const aiVisibilityFindings: RuleFinding[] = ALL_AIVISIBILITY_RULES.map((rule) => {
        try {
            return rule.evaluate(aiVisibility);
            /* c8 ignore start -- defensive parity with the audit path. */
        }
        catch {
            return {
                ruleId: rule.id,
                bucket: 'watch',
                severity: 'warning',
                affectedUrls: [],
                meta: { insufficientData: true, error: true },
            };
        }
        /* c8 ignore stop */
    });
    const localSeoFindings: RuleFinding[] = ALL_LOCALSEO_RULES.map((rule) => {
        try {
            return rule.evaluate(localSeo);
            /* c8 ignore start -- defensive parity with the audit path. */
        }
        catch {
            return {
                ruleId: rule.id,
                bucket: 'watch',
                severity: 'warning',
                affectedUrls: [],
                meta: { insufficientData: true, error: true },
            };
        }
        /* c8 ignore stop */
    });
    return [
        ...auditFindings,
        ...psFindings,
        ...idxFindings,
        ...gscSearchFindings,
        ...gscSitemapFindings,
        ...aiVisibilityFindings,
        ...localSeoFindings,
    ].sort(compareFindings);
}
export interface FindingCounts {
    fixNow: number;
    watch: number;
    passed: number;
}
export function countByBucket(findings: RuleFinding[]): FindingCounts {
    const counts: FindingCounts = { fixNow: 0, watch: 0, passed: 0 };
    for (const finding of findings) {
        if (finding.bucket === 'fix-now')
            counts.fixNow += 1;
        else if (finding.bucket === 'watch')
            counts.watch += 1;
        else
            counts.passed += 1;
    }
    return counts;
}
