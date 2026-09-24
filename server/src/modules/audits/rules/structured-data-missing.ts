/**
 * Rule `structured-data-missing` — pages without schema.org micromarkup at
 * all (watch: advisory) or with vendor-reported micromarkup errors (fix-now:
 * broken markup is worse than none).
 */
import type { AuditResult } from '../../../shared/providers/index.js';
import { bucketFor } from './bucket.js';
import type { AuditRule, RuleFinding } from './rule.types.js';
const RULE_ID = 'structured-data-missing' as const;
interface Offender {
    url: string;
    reason: 'missing' | 'errors';
}
export const structuredDataMissingRule: AuditRule = {
    id: RULE_ID,
    evaluate(result: AuditResult): RuleFinding {
        const offenders: Offender[] = [];
        for (const page of result.pages) {
            if (!page.isIndexable)
                continue;
            if (page.structuredDataErrors.length > 0) {
                offenders.push({ url: page.url, reason: 'errors' });
            }
            else if (!page.hasStructuredData) {
                offenders.push({ url: page.url, reason: 'missing' });
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
        const anyErrors = offenders.some((o) => o.reason === 'errors');
        const severity = anyErrors ? 'critical' : 'warning';
        return {
            ruleId: RULE_ID,
            bucket: bucketFor(severity, false),
            severity,
            affectedUrls: offenders.map((o) => o.url),
            meta: { offenders },
        };
    },
};
