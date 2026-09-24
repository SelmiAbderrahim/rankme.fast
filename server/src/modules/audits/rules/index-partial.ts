/**
 * Rule `index-partial` — a sampled URL whose GSC index verdict
 * is PARTIAL (e.g. indexed but with warnings on canonicalization or
 * duplicate content) → watch (warning). Not fix-now: the page IS in the
 * index; there's a signal Google wants clarified.
 *
 * `status !== 'ok'` → watch with `insufficientData`. Zero samples → passed.
 */
import type { IndexStatusEvaluationInput, IndexStatusRule, RuleFinding, } from './rule.types.js';
const RULE_ID = 'index-partial' as const;
export const indexPartialRule: IndexStatusRule = {
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
        const offenders = input.samples.filter((s) => s.inspection.indexVerdict === 'PARTIAL');
        if (offenders.length === 0) {
            return {
                ruleId: RULE_ID,
                bucket: 'passed',
                severity: 'warning',
                affectedUrls: [],
            };
        }
        // Expose coverage/fetch states so the copy can explain WHAT is
        // partial (canonical mismatch vs fetch problem). No bucket change.
        const first = offenders[0]!.inspection;
        return {
            ruleId: RULE_ID,
            bucket: 'watch',
            severity: 'warning',
            affectedUrls: offenders.map((s) => s.url),
            meta: {
                ...(first.coverageState ? { coverageState: first.coverageState } : {}),
                ...(first.pageFetchState ? { pageFetchState: first.pageFetchState } : {}),
            },
        };
    },
};
