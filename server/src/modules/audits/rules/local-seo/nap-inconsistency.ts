/**
 * Rule `nap-inconsistency` — mismatched Name/Address/Phone
 * across business-listing directories actively hurts local rank, so this is
 * the one local-seo rule that can land in `fix-now`. It needs at least one
 * listing to compare; with none it is not evaluated.
 */
import type { LocalSeoEvaluationInput, LocalSeoRule, RuleFinding } from '../rule.types.js';
const RULE_ID = 'nap-inconsistency' as const;
function insufficient(reason: string): RuleFinding {
    return {
        ruleId: RULE_ID,
        bucket: 'watch',
        severity: 'warning',
        affectedUrls: [],
        meta: { insufficientData: true, reason },
    };
}
export const napInconsistencyRule: LocalSeoRule = {
    id: RULE_ID,
    evaluate(input: LocalSeoEvaluationInput | null): RuleFinding {
        if (input === null || input.status !== 'ok') {
            return insufficient(input?.status ?? 'not-configured');
        }
        // No directory listing was found for the business. Nothing was compared,
        // so the rule can neither fail nor claim the listings agree.
        if (input.listings.length === 0) {
            return insufficient('no-business-listings');
        }
        const inconsistent = input.listings.filter((listing) => !listing.consistent);
        if (inconsistent.length > 0) {
            return {
                ruleId: RULE_ID,
                bucket: 'fix-now',
                severity: 'critical',
                affectedUrls: [],
                meta: { sources: inconsistent.map((listing) => listing.source) },
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
