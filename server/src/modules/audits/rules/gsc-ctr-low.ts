/**
 * Rule `gsc-ctr-low` — Google shows a query often (≥ 1000
 * impressions in the 28-day window) but almost nobody clicks (< 1% CTR).
 * That is an opportunity, not breakage — NEVER fix-now, always `watch`.
 *
 * `status !== 'ok'` (or null input) → watch with `insufficientData`.
 * No qualifying query → passed.
 */
import type { GscSearchEvaluationInput, GscSearchRule, RuleFinding, } from './rule.types.js';
const RULE_ID = 'gsc-ctr-low' as const;
/** A query only qualifies once Google shows it at scale. */
export const CTR_LOW_MIN_IMPRESSIONS = 1000;
/** 1% — below this the title/description are not earning the impression. */
export const CTR_LOW_THRESHOLD = 0.01;
export const gscCtrLowRule: GscSearchRule = {
    id: RULE_ID,
    evaluate(input: GscSearchEvaluationInput | null): RuleFinding {
        if (input === null || input.status !== 'ok') {
            return {
                ruleId: RULE_ID,
                bucket: 'watch',
                severity: 'warning',
                affectedUrls: [],
                meta: { insufficientData: true, reason: input?.status ?? 'not-connected' },
            };
        }
        const offenders = input.topQueries.filter((q) => q.impressions >= CTR_LOW_MIN_IMPRESSIONS && q.ctr < CTR_LOW_THRESHOLD);
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
            affectedUrls: [],
            meta: {
                queries: offenders.map((q) => ({
                    query: q.query,
                    impressions: q.impressions,
                    ctr: q.ctr,
                    position: q.position,
                })),
            },
        };
    },
};
