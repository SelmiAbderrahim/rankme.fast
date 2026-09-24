/**
 * Rule `robots-blocked` — pages the crawler was blocked from indexing by
 * `robots.txt` (or a `robots.txt`-derived directive). Any hit is fix-now
 * because it hides real pages from search.
 */
import type { AuditResult } from '../../../shared/providers/index.js';
import { bucketFor } from './bucket.js';
import type { AuditRule, RuleFinding } from './rule.types.js';
const RULE_ID = 'robots-blocked' as const;
function reasonMatches(reason: string | undefined): boolean {
    if (!reason)
        return false;
    const lower = reason.toLowerCase();
    return lower.includes('robots') || lower === 'blocked_by_robots_txt';
}
export const robotsBlockedRule: AuditRule = {
    id: RULE_ID,
    evaluate(result: AuditResult): RuleFinding {
        const affected = result.pages
            .filter((page) => !page.isIndexable && reasonMatches(page.nonIndexableReason))
            .map((page) => page.url);
        const passed = affected.length === 0;
        const severity = 'critical';
        return {
            ruleId: RULE_ID,
            bucket: bucketFor(severity, passed),
            severity,
            affectedUrls: affected,
        };
    },
};
