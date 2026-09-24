/**
 * Rule `sitemap-missing-or-weak` — no XML sitemap at all (fix-now); or a
 * sitemap exists but robots.txt does not point to it (watch). If the vendor
 * did not report the "referenced in robots" signal at all, the rule lands in
 * watch with insufficient-data meta — never a false fix-now.
 */
import type { AuditResult } from '../../../shared/providers/index.js';
import { bucketFor } from './bucket.js';
import type { AuditRule, RuleFinding } from './rule.types.js';
const RULE_ID = 'sitemap-missing-or-weak' as const;
export const sitemapMissingOrWeakRule: AuditRule = {
    id: RULE_ID,
    evaluate(result: AuditResult): RuleFinding {
        const { sitemapFound, sitemapReferencedInRobots } = result.domainChecks;
        if (!sitemapFound) {
            return {
                ruleId: RULE_ID,
                bucket: bucketFor('critical', false),
                severity: 'critical',
                affectedUrls: [],
            };
        }
        if (sitemapReferencedInRobots === false) {
            return {
                ruleId: RULE_ID,
                bucket: bucketFor('warning', false),
                severity: 'warning',
                affectedUrls: [],
            };
        }
        if (sitemapReferencedInRobots === undefined) {
            return {
                ruleId: RULE_ID,
                bucket: 'watch',
                severity: 'warning',
                affectedUrls: [],
                meta: { insufficientData: true },
            };
        }
        return {
            ruleId: RULE_ID,
            bucket: bucketFor('warning', true),
            severity: 'warning',
            affectedUrls: [],
        };
    },
};
