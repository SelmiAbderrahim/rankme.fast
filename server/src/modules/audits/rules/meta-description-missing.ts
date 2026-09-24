/**
 * Rule `meta-description-missing` — pages that have no meta description or
 * where the same description repeats across multiple URLs. Advisory (watch):
 * Google may rewrite descriptions but a good one still lifts click-through.
 */
import type { AuditResult } from '../../../shared/providers/index.js';
import { bucketFor } from './bucket.js';
import type { AuditRule, RuleFinding } from './rule.types.js';
const RULE_ID = 'meta-description-missing' as const;
export const metaDescriptionMissingRule: AuditRule = {
    id: RULE_ID,
    evaluate(result: AuditResult): RuleFinding {
        const missing: string[] = [];
        const byDescription = new Map<string, string[]>();
        for (const page of result.pages) {
            if (!page.isIndexable)
                continue;
            const desc = page.metaDescription?.trim() ?? '';
            if (desc.length === 0) {
                missing.push(page.url);
                continue;
            }
            const bucket = byDescription.get(desc);
            if (bucket)
                bucket.push(page.url);
            else
                byDescription.set(desc, [page.url]);
        }
        const duplicateGroups = [...byDescription.values()].filter((urls) => urls.length > 1);
        const duplicateUrls = duplicateGroups.flat();
        const affected = [...new Set([...missing, ...duplicateUrls])];
        if (affected.length === 0) {
            return {
                ruleId: RULE_ID,
                bucket: bucketFor('warning', true),
                severity: 'warning',
                affectedUrls: [],
            };
        }
        return {
            ruleId: RULE_ID,
            bucket: bucketFor('warning', false),
            severity: 'warning',
            affectedUrls: affected,
            meta: { missing, duplicateGroups },
        };
    },
};
