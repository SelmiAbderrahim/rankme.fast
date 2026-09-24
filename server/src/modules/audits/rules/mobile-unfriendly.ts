/**
 * Rule `mobile-unfriendly` — the mobile PSI run's Lighthouse `viewport` +
 * `tap-targets` audits failed. Google deprecated the dedicated
 * mobile-friendly API in 2023, so this rule reads Lighthouse instead.
 *
 * Any offending page is fix-now (critical) — mobile-first indexing means a
 * broken mobile experience directly costs rankings AND clicks.
 */
import { bucketFor } from './bucket.js';
import type { PageSpeedEvaluationInput, PageSpeedRule, RuleFinding, } from './rule.types.js';
const RULE_ID = 'mobile-unfriendly' as const;
export const mobileUnfriendlyRule: PageSpeedRule = {
    id: RULE_ID,
    evaluate(input: PageSpeedEvaluationInput | null): RuleFinding {
        if (input === null || input.status === 'unavailable' || input.samples.length === 0) {
            return {
                ruleId: RULE_ID,
                bucket: 'watch',
                severity: 'warning',
                affectedUrls: [],
                meta: { insufficientData: true, reason: 'unavailable' },
            };
        }
        const mobileSamples = input.samples.filter((s) => s.strategy === 'mobile');
        if (mobileSamples.length === 0) {
            // Only desktop samples were collected — nothing to say about mobile.
            return {
                ruleId: RULE_ID,
                bucket: 'watch',
                severity: 'warning',
                affectedUrls: [],
                meta: { insufficientData: true, reason: 'no-mobile-samples' },
            };
        }
        const rated = mobileSamples.filter((s) => typeof s.mobileFriendly === 'boolean');
        if (rated.length === 0) {
            return {
                ruleId: RULE_ID,
                bucket: 'watch',
                severity: 'warning',
                affectedUrls: [],
                meta: { insufficientData: true, reason: 'no-signal' },
            };
        }
        const offenders = rated.filter((s) => s.mobileFriendly === false).map((s) => s.url);
        if (offenders.length === 0) {
            return {
                ruleId: RULE_ID,
                bucket: 'passed',
                severity: 'critical',
                affectedUrls: [],
            };
        }
        const severity = 'critical';
        return {
            ruleId: RULE_ID,
            bucket: bucketFor(severity, false),
            severity,
            affectedUrls: offenders,
        };
    },
};
