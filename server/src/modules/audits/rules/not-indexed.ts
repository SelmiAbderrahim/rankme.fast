/**
 * Rule `not-indexed` — any sampled URL whose GSC index verdict
 * is FAIL (blocked, error) or NEUTRAL (unknown to Google) → fix-now.
 *
 * `status: 'unavailable'` / `'not-connected'` / `'needs-reconnect'` /
 * `'quota-exceeded'` → watch (`insufficientData`) — the audit still
 * finishes. Zero samples → passed (nothing to say).
 */
import { bucketFor } from './bucket.js';
import type { IndexStatusEvaluationInput, IndexStatusRule, RuleFinding, } from './rule.types.js';
const RULE_ID = 'not-indexed' as const;
export const notIndexedRule: IndexStatusRule = {
    id: RULE_ID,
    evaluate(input: IndexStatusEvaluationInput | null): RuleFinding {
        if (input === null || input.status !== 'ok') {
            return {
                ruleId: RULE_ID,
                bucket: 'watch',
                severity: 'warning',
                affectedUrls: [],
                meta: { insufficientData: true, reason: input?.status ?? 'not-connected' },
            };
        }
        if (input.samples.length === 0) {
            return {
                ruleId: RULE_ID,
                bucket: 'passed',
                severity: 'critical',
                affectedUrls: [],
            };
        }
        const offenders = input.samples.filter((s) => s.inspection.indexVerdict === 'FAIL' ||
            s.inspection.indexVerdict === 'NEUTRAL');
        if (offenders.length === 0) {
            return {
                ruleId: RULE_ID,
                bucket: 'passed',
                severity: 'critical',
                affectedUrls: [],
            };
        }
        const severity = 'critical';
        // Carry the coverage/robots states so the report copy can say
        // "blocked by robots.txt" vs "Google couldn't fetch the page" instead of
        // a generic "not indexed". No bucket change.
        const first = offenders[0]!.inspection;
        return {
            ruleId: RULE_ID,
            bucket: bucketFor(severity, false),
            severity,
            affectedUrls: offenders.map((s) => s.url),
            meta: {
                ...(first.coverageState ? { coverageState: first.coverageState } : {}),
                ...(first.robotsTxtState ? { robotsTxtState: first.robotsTxtState } : {}),
            },
        };
    },
};
