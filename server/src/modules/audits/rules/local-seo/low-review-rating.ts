/**
 * Rule `low-review-rating` — a low average rating is an
 * opportunity, not a defect: always `watch`, never `fix-now`.
 */
import type { LocalSeoEvaluationInput, LocalSeoRule, RuleFinding } from '../rule.types.js';
const RULE_ID = 'low-review-rating' as const;
export const LOW_REVIEW_RATING_THRESHOLD = 4.0;
function insufficient(reason: string): RuleFinding {
    return {
        ruleId: RULE_ID,
        bucket: 'watch',
        severity: 'warning',
        affectedUrls: [],
        meta: { insufficientData: true, reason },
    };
}
export const lowReviewRatingRule: LocalSeoRule = {
    id: RULE_ID,
    evaluate(input: LocalSeoEvaluationInput | null): RuleFinding {
        if (input === null || input.status !== 'ok') {
            return insufficient(input?.status ?? 'not-configured');
        }
        if (input.reviews === null || input.reviews.averageRating === null) {
            return insufficient('no-rating-data');
        }
        if (input.reviews.averageRating < LOW_REVIEW_RATING_THRESHOLD) {
            return {
                ruleId: RULE_ID,
                bucket: 'watch',
                severity: 'warning',
                affectedUrls: [],
                meta: { averageRating: input.reviews.averageRating },
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
