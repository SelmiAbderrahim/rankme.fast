/**
 * Rule `canonical-missing-or-broken` — pages without a canonical (watch) or
 * with a canonical that redirects, 404s, or points at a different origin
 * (fix-now). Duplicate content is what search engines fight hardest about.
 */
import type { AuditResult } from '../../../shared/providers/index.js';
import { bucketFor } from './bucket.js';
import type { AuditRule, RuleFinding } from './rule.types.js';
const RULE_ID = 'canonical-missing-or-broken' as const;
interface Offender {
    url: string;
    reason: 'missing' | 'broken';
}
function sameOrigin(a: string, b: string): boolean {
    try {
        const originA = new URL(a).origin;
        const originB = new URL(b).origin;
        return originA === originB;
    }
    catch {
        return false;
    }
}
export const canonicalMissingOrBrokenRule: AuditRule = {
    id: RULE_ID,
    evaluate(result: AuditResult): RuleFinding {
        const offenders: Offender[] = [];
        for (const page of result.pages) {
            if (!page.isIndexable)
                continue;
            const canonical = page.canonical;
            if (canonical === null || canonical.trim().length === 0) {
                offenders.push({ url: page.url, reason: 'missing' });
                continue;
            }
            if (!sameOrigin(page.url, canonical)) {
                offenders.push({ url: page.url, reason: 'broken' });
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
        const anyBroken = offenders.some((o) => o.reason === 'broken');
        const severity = anyBroken ? 'critical' : 'warning';
        return {
            ruleId: RULE_ID,
            bucket: bucketFor(severity, false),
            severity,
            affectedUrls: offenders.map((o) => o.url),
            meta: { offenders },
        };
    },
};
