/**
 * Rule `page-speed-lab-low` — Lighthouse performance score < 50 on any
 * sampled page. Advisory (watch, warning) — Lighthouse runs vary
 * ~10 points between two consecutive lab runs, so a single low score is a
 * yellow flag, not a fix-now. Report copy MUST call this out as "our lab
 * estimate", never "your users' experience".
 */
import { bucketFor } from './bucket.js';
import type { PageSpeedEvaluationInput, PageSpeedRule, RuleFinding, } from './rule.types.js';
const RULE_ID = 'page-speed-lab-low' as const;
const LAB_LOW_THRESHOLD = 50;
export const pageSpeedLabLowRule: PageSpeedRule = {
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
        const low = input.samples.filter((s) => s.labScores.performance < LAB_LOW_THRESHOLD);
        if (low.length === 0) {
            return {
                ruleId: RULE_ID,
                bucket: 'passed',
                severity: 'warning',
                affectedUrls: [],
            };
        }
        const severity = 'warning';
        return {
            ruleId: RULE_ID,
            bucket: bucketFor(severity, false),
            severity,
            affectedUrls: low.map((s) => s.url),
            meta: {
                threshold: LAB_LOW_THRESHOLD,
                samples: low.map((s) => ({ url: s.url, performance: s.labScores.performance })),
            },
        };
    },
};
