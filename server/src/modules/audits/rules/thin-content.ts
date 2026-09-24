/**
 * Rule `thin-content` — indexable pages whose main content is short enough
 * that a real buyer question cannot be answered on the page. Advisory
 * (watch): thin content is often intentional (landing pages, category hubs).
 *
 * If NO page in the audit reports a `wordCount`, the vendor did not sample
 * this signal — the rule lands in watch with `insufficientData` meta so the
 * report never invents a fix-now the vendor cannot back up.
 */
import type { AuditResult } from '../../../shared/providers/index.js';
import { bucketFor } from './bucket.js';
import type { AuditRule, RuleFinding } from './rule.types.js';
const RULE_ID = 'thin-content' as const;
/** Words a business owner would expect on a page that actually answers a question. */
export const THIN_CONTENT_WORDS = 200;
export const thinContentRule: AuditRule = {
    id: RULE_ID,
    evaluate(result: AuditResult): RuleFinding {
        const indexable = result.pages.filter((p) => p.isIndexable);
        const sampled = indexable.filter((p) => typeof p.wordCount === 'number');
        if (indexable.length > 0 && sampled.length === 0) {
            return {
                ruleId: RULE_ID,
                bucket: 'watch',
                severity: 'warning',
                affectedUrls: [],
                meta: { insufficientData: true },
            };
        }
        const affected = sampled
            // `sampled` is filtered above on `typeof wordCount === 'number'` so the
            // cast is always safe; avoids a ?? branch under noUncheckedIndexedAccess.
            .filter((p) => (p.wordCount as number) < THIN_CONTENT_WORDS)
            .map((p) => p.url);
        const passed = affected.length === 0;
        return {
            ruleId: RULE_ID,
            bucket: bucketFor('warning', passed),
            severity: 'warning',
            affectedUrls: affected,
        };
    },
};
