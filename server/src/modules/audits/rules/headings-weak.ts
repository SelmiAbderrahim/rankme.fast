/**
 * Rule `headings-weak` — pages with no H1 (fix-now) or multiple H1s (watch).
 * Search engines lean on the H1 to summarize the page's topic.
 */
import type { AuditResult } from '../../../shared/providers/index.js';
import { bucketFor } from './bucket.js';
import type { AuditRule, RuleFinding } from './rule.types.js';
const RULE_ID = 'headings-weak' as const;
interface Offender {
    url: string;
    reason: 'no-h1' | 'multiple-h1';
}
export const headingsWeakRule: AuditRule = {
    id: RULE_ID,
    evaluate(result: AuditResult): RuleFinding {
        const offenders: Offender[] = [];
        for (const page of result.pages) {
            if (!page.isIndexable)
                continue;
            const h1Count = page.h1.filter((h) => h.trim().length > 0).length;
            if (h1Count === 0) {
                offenders.push({ url: page.url, reason: 'no-h1' });
            }
            else if (h1Count > 1) {
                offenders.push({ url: page.url, reason: 'multiple-h1' });
            }
        }
        if (offenders.length === 0) {
            return {
                ruleId: RULE_ID,
                bucket: bucketFor('critical', true),
                severity: 'critical',
                affectedUrls: [],
            };
        }
        const anyMissing = offenders.some((o) => o.reason === 'no-h1');
        const severity = anyMissing ? 'critical' : 'warning';
        return {
            ruleId: RULE_ID,
            bucket: bucketFor(severity, false),
            severity,
            affectedUrls: offenders.map((o) => o.url),
            meta: { offenders },
        };
    },
};
