/**
 * Rule `sitemap-errors` — Google Search Console reports the
 * submitted sitemap's processing health. `errors > 0` blocks indexing of the
 * listed URLs → fix-now (critical). `warnings > 0` degrades it → watch.
 *
 * `status: 'no-sitemaps'` → watch with `insufficientData: 'no-sitemaps'`
 * ("no sitemap submitted to Google" — distinct copy from a vendor failure).
 * Other non-`ok` status (or null input) → watch with `insufficientData`.
 * Healthy sitemaps → passed.
 *
 * Distinct from the crawl-based `sitemap-missing-or-weak` rule: this one is
 * Google's own verdict on what was SUBMITTED, not our crawl of the file.
 */
import { bucketFor } from './bucket.js';
import type { GscSitemapsEvaluationInput, GscSitemapsRule, RuleFinding, } from './rule.types.js';
const RULE_ID = 'sitemap-errors' as const;
export const sitemapErrorsRule: GscSitemapsRule = {
    id: RULE_ID,
    evaluate(input: GscSitemapsEvaluationInput | null): RuleFinding {
        if (input === null || input.status === 'no-sitemaps') {
            return {
                ruleId: RULE_ID,
                bucket: 'watch',
                severity: 'warning',
                affectedUrls: [],
                meta: {
                    insufficientData: input === null ? true : 'no-sitemaps',
                    reason: input?.status ?? 'not-connected',
                },
            };
        }
        if (input.status !== 'ok') {
            return {
                ruleId: RULE_ID,
                bucket: 'watch',
                severity: 'warning',
                affectedUrls: [],
                meta: { insufficientData: true, reason: input.status },
            };
        }
        const withErrors = input.sitemaps.filter((s) => s.errors > 0);
        if (withErrors.length > 0) {
            const severity = 'critical';
            return {
                ruleId: RULE_ID,
                bucket: bucketFor(severity, false),
                severity,
                affectedUrls: withErrors.map((s) => s.path),
                meta: {
                    sitemaps: withErrors.map((s) => ({
                        path: s.path,
                        errors: s.errors,
                        warnings: s.warnings,
                    })),
                },
            };
        }
        const withWarnings = input.sitemaps.filter((s) => s.warnings > 0);
        if (withWarnings.length > 0) {
            return {
                ruleId: RULE_ID,
                bucket: 'watch',
                severity: 'warning',
                affectedUrls: withWarnings.map((s) => s.path),
                meta: {
                    sitemaps: withWarnings.map((s) => ({
                        path: s.path,
                        errors: s.errors,
                        warnings: s.warnings,
                    })),
                },
            };
        }
        return {
            ruleId: RULE_ID,
            bucket: 'passed',
            severity: 'critical',
            affectedUrls: [],
        };
    },
};
