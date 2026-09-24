/**
 * Rule `low-review-count` — few reviews is an opportunity, not a
 * defect: always `watch`, never `fix-now`.
 */
import type { LocalSeoEvaluationInput, LocalSeoRule, RuleFinding } from '../rule.types.js';
const RULE_ID = 'low-review-count' as const;
export const LOW_REVIEW_COUNT_THRESHOLD = 10;
function insufficient(reason: string): RuleFinding {
    return {
        ruleId: RULE_ID,
        bucket: 'watch',
        severity: 'warning',
        affectedUrls: [],
        meta: { insufficientData: true, reason },
    };
}
export const lowReviewCountRule: LocalSeoRule = {
    id: RULE_ID,
    evaluate(input: LocalSeoEvaluationInput | null): RuleFinding {
        if (input === null || input.status !== 'ok') {
            return insufficient(input?.status ?? 'not-configured');
        }
        if (input.reviews === null) {
            return insufficient('no-reviews-data');
        }
        if (input.reviews.reviewCount < LOW_REVIEW_COUNT_THRESHOLD) {
            return {
                ruleId: RULE_ID,
                bucket: 'watch',
                severity: 'warning',
                affectedUrls: [],
                meta: { reviewCount: input.reviews.reviewCount },
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
