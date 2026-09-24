/**
 * Rule `broken-internal-links` — pages that link out to URLs the crawler
 * could not fetch (4xx/5xx). Always fix-now — broken links waste crawl
 * budget and confuse readers.
 */
import type { AuditResult } from '../../../shared/providers/index.js';
import { bucketFor } from './bucket.js';
import type { AuditRule, RuleFinding } from './rule.types.js';
const RULE_ID = 'broken-internal-links' as const;
export const brokenInternalLinksRule: AuditRule = {
    id: RULE_ID,
    evaluate(result: AuditResult): RuleFinding {
        const affected: string[] = [];
        const brokenLinkTargets = new Set<string>();
        let totalBroken = 0;
        for (const page of result.pages) {
            if (page.brokenLinks.length > 0) {
                affected.push(page.url);
                totalBroken += page.brokenLinks.length;
                page.brokenLinks.forEach((url) => brokenLinkTargets.add(url));
            }
        }
        const passed = affected.length === 0;
        const severity = 'critical';
        return {
            ruleId: RULE_ID,
            bucket: bucketFor(severity, passed),
            severity,
            affectedUrls: affected,
            ...(passed
                ? {}
                : { meta: { totalBroken, brokenLinkTargets: [...brokenLinkTargets] } }),
        };
    },
};
