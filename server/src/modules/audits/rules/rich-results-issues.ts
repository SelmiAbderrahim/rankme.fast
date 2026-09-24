/**
 * Rule `rich-results-issues` — a sampled URL whose GSC
 * richResultsResult verdict is FAIL, or PARTIAL with any item carrying
 * `issues > 0` → watch (warning). Never fix-now: rich-result issues rarely
 * cost core rankings but they do cost the visual snippet.
 *
 * `status !== 'ok'` → watch with `insufficientData`. Zero samples → passed.
 */
import type { IndexStatusEvaluationInput, IndexStatusRule, RuleFinding, } from './rule.types.js';
const RULE_ID = 'rich-results-issues' as const;
export const richResultsIssuesRule: IndexStatusRule = {
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
                severity: 'warning',
                affectedUrls: [],
            };
        }
        const offenders = input.samples
            .filter((s) => {
            const rr = s.inspection.richResults;
            if (rr.verdict === 'FAIL')
                return true;
            if (rr.verdict === 'PARTIAL') {
                return rr.items.some((it) => it.issues > 0);
            }
            return false;
        })
            .map((s) => s.url);
        if (offenders.length === 0) {
            return {
                ruleId: RULE_ID,
                bucket: 'passed',
                severity: 'warning',
                affectedUrls: [],
            };
        }
        return {
            ruleId: RULE_ID,
            bucket: 'watch',
            severity: 'warning',
            affectedUrls: offenders,
        };
    },
};
