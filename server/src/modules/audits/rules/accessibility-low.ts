/**
 * Rule `accessibility-low` — Lighthouse accessibility score < 90 on any
 * sampled page. A score below 70 on any sample escalates to fix-now
 * (critical): missing alt text, unlabeled controls, or unreadable contrast
 * turn real visitors away. Report copy MUST call this out as "our lab
 * estimate", never a legal-compliance verdict.
 */
import { bucketFor } from './bucket.js';
import type { PageSpeedEvaluationInput, PageSpeedRule, RuleFinding, } from './rule.types.js';
const RULE_ID = 'accessibility-low' as const;
export const ACCESSIBILITY_WATCH_THRESHOLD = 90;
export const ACCESSIBILITY_FIXNOW_THRESHOLD = 70;
export const accessibilityLowRule: PageSpeedRule = {
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
        const offenders = input.samples.filter((s) => s.labScores.accessibility < ACCESSIBILITY_WATCH_THRESHOLD);
        if (offenders.length === 0) {
            return {
                ruleId: RULE_ID,
                bucket: 'passed',
                severity: 'warning',
                affectedUrls: [],
            };
        }
        const severity = offenders.some((s) => s.labScores.accessibility < ACCESSIBILITY_FIXNOW_THRESHOLD)
            ? 'critical'
            : 'warning';
        return {
            ruleId: RULE_ID,
            bucket: bucketFor(severity, false),
            severity,
            affectedUrls: offenders.map((s) => s.url),
            meta: {
                watchThreshold: ACCESSIBILITY_WATCH_THRESHOLD,
                fixNowThreshold: ACCESSIBILITY_FIXNOW_THRESHOLD,
                samples: offenders.map((s) => ({
                    url: s.url,
                    accessibility: s.labScores.accessibility,
                })),
            },
        };
    },
};
