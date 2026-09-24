/**
 * Rule `title-missing-or-weak` — a page has no <title>, or a title short
 * enough / long enough to hurt in search results. Missing counts as critical
 * (fix-now); too-long counts as warning (watch).
 */
import type { AuditResult } from '../../../shared/providers/index.js';
import { bucketFor } from './bucket.js';
import type { AuditRule, RuleFinding } from './rule.types.js';
const RULE_ID = 'title-missing-or-weak' as const;
/** Vendors converge on ~60 characters; anything longer is truncated in SERPs. */
export const TITLE_TOO_LONG_CHARS = 60;
export const TITLE_TOO_SHORT_CHARS = 10;
interface Offender {
    url: string;
    reason: 'missing' | 'too-short' | 'too-long';
}
export const titleMissingOrWeakRule: AuditRule = {
    id: RULE_ID,
    evaluate(result: AuditResult): RuleFinding {
        const offenders: Offender[] = [];
        for (const page of result.pages) {
            if (!page.isIndexable)
                continue;
            const title = page.title;
            if (title === null || title.trim().length === 0) {
                offenders.push({ url: page.url, reason: 'missing' });
            }
            else if (title.trim().length < TITLE_TOO_SHORT_CHARS) {
                offenders.push({ url: page.url, reason: 'too-short' });
            }
            else if (title.trim().length > TITLE_TOO_LONG_CHARS) {
                offenders.push({ url: page.url, reason: 'too-long' });
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
        const anyMissing = offenders.some((o) => o.reason === 'missing');
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
