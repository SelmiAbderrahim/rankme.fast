/**
 * Rule `core-web-vitals-poor` — Chrome UX Report field data (real visitor
 * p75 for LCP / INP / CLS) categorised against Google's thresholds. Poor →
 * fix-now (critical); needs-improvement → watch (warning); good → passed.
 * Lab (Lighthouse) scores never feed this rule — they belong to
 * `page-speed-lab-low` — so the worst category across every sampled page
 * decides the outcome. The Overview "Site experience" tile applies the same
 * worst-of-samples reading, so the two never disagree.
 *
 * "No field data" is an EXPECTED state for low-traffic sites, NOT an error:
 * the rule lands in watch with `{ insufficientData: true, reason: 'no-field-data' }`
 * so the report copy can say "not enough visitor data yet". The provider
 * being unavailable is a separate state — same watch bucket, different meta.
 */
import { bucketFor } from './bucket.js';
import type { PageSpeedEvaluationInput, PageSpeedRule, RuleFinding, } from './rule.types.js';
const RULE_ID = 'core-web-vitals-poor' as const;
export const coreWebVitalsPoorRule: PageSpeedRule = {
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
        const withField = input.samples.filter((s) => s.coreWebVitals !== undefined);
        if (withField.length === 0) {
            // Every sample: no URL-level + no origin-level field data.
            return {
                ruleId: RULE_ID,
                bucket: 'watch',
                severity: 'warning',
                affectedUrls: [],
                meta: { insufficientData: true, reason: 'no-field-data' },
            };
        }
        const poor = withField.filter((s) => s.coreWebVitals?.category === 'poor');
        const ni = withField.filter((s) => s.coreWebVitals?.category === 'needs-improvement');
        // Both failing branches carry the field-data evidence they were decided
        // on, so the report and the Overview tile show the same visitor numbers.
        const evidence = {
            samples: withField.map((s) => ({
                url: s.url,
                fieldDataLevel: s.fieldDataLevel,
                category: s.coreWebVitals!.category,
                lcpMs: s.coreWebVitals!.lcpMs,
                inp: s.coreWebVitals!.inp,
                cls: s.coreWebVitals!.cls,
            })),
        };
        if (poor.length > 0) {
            const severity = 'critical';
            return {
                ruleId: RULE_ID,
                bucket: bucketFor(severity, false),
                severity,
                affectedUrls: poor.map((s) => s.url),
                meta: evidence,
            };
        }
        if (ni.length > 0) {
            const severity = 'warning';
            return {
                ruleId: RULE_ID,
                bucket: bucketFor(severity, false),
                severity,
                affectedUrls: ni.map((s) => s.url),
                meta: evidence,
            };
        }
        return {
            ruleId: RULE_ID,
            bucket: 'passed',
            severity: 'warning',
            affectedUrls: [],
        };
    },
};
