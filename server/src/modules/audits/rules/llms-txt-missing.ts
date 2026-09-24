/**
 * Rule `llms-txt-missing` — the site does not serve `/llms.txt`. Advisory
 * (watch) — this is an emerging convention, NOT a ranking factor. The copy
 * must say so.
 *
 * If the vendor did not sample this signal (`llmsTxtFound` absent), the rule
 * lands in watch with `insufficientData` meta.
 */
import type { AuditResult } from '../../../shared/providers/index.js';
import type { AuditRule, RuleFinding } from './rule.types.js';
const RULE_ID = 'llms-txt-missing' as const;
export const llmsTxtMissingRule: AuditRule = {
    id: RULE_ID,
    evaluate(result: AuditResult): RuleFinding {
        const found = result.domainChecks.llmsTxtFound;
        if (found === undefined) {
            return {
                ruleId: RULE_ID,
                bucket: 'watch',
                severity: 'info',
                affectedUrls: [],
                meta: { insufficientData: true },
            };
        }
        if (!found) {
            return {
                ruleId: RULE_ID,
                bucket: 'watch',
                severity: 'info',
                affectedUrls: [],
            };
        }
        return {
            ruleId: RULE_ID,
            bucket: 'passed',
            severity: 'info',
            affectedUrls: [],
        };
    },
};
