/**
 * Rule `faq-content-missing` — indexable pages that expose no FAQ / Q&A
 * signals (schema.org FAQPage micromarkup or question-style headings).
 * Advisory (watch) — never fix-now — because FAQ content is only
 * appropriate on some pages.
 *
 * If NO page reports `hasFaqSignals`, the signal was not evaluated and the
 * rule lands in watch with `insufficientData` meta.
 */
import type { AuditResult } from '../../../shared/providers/index.js';
import type { AuditRule, RuleFinding } from './rule.types.js';
const RULE_ID = 'faq-content-missing' as const;
export const faqContentMissingRule: AuditRule = {
    id: RULE_ID,
    evaluate(result: AuditResult): RuleFinding {
        const indexable = result.pages.filter((p) => p.isIndexable);
        const sampled = indexable.filter((p) => typeof p.hasFaqSignals === 'boolean');
        if (indexable.length > 0 && sampled.length === 0) {
            return {
                ruleId: RULE_ID,
                bucket: 'watch',
                severity: 'warning',
                affectedUrls: [],
                meta: { insufficientData: true },
            };
        }
        const affected = sampled.filter((p) => p.hasFaqSignals === false).map((p) => p.url);
        return {
            ruleId: RULE_ID,
            bucket: affected.length === 0 ? 'passed' : 'watch',
            severity: 'warning',
            affectedUrls: affected,
        };
    },
};
