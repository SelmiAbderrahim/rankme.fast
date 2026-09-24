/**
 * Rule `https-canonicalization` — the site enforces HTTPS and collapses
 * www/non-www + trailing-slash variants to one canonical origin. HTTPS not
 * enforced is fix-now (critical); a canonicalization mismatch is watch.
 */
import type { AuditResult } from '../../../shared/providers/index.js';
import { bucketFor } from './bucket.js';
import type { AuditRule, RuleFinding } from './rule.types.js';
const RULE_ID = 'https-canonicalization' as const;
export const httpsCanonicalizationRule: AuditRule = {
    id: RULE_ID,
    evaluate(result: AuditResult): RuleFinding {
        const { httpsEnforced, canonicalizationOk, httpsRedirect } = result.domainChecks;
        const httpsOk = httpsEnforced && httpsRedirect !== false;
        if (!httpsOk) {
            return {
                ruleId: RULE_ID,
                bucket: bucketFor('critical', false),
                severity: 'critical',
                affectedUrls: [],
                meta: { httpsEnforced, httpsRedirect: httpsRedirect ?? null },
            };
        }
        if (!canonicalizationOk) {
            return {
                ruleId: RULE_ID,
                bucket: bucketFor('warning', false),
                severity: 'warning',
                affectedUrls: [],
            };
        }
        return {
            ruleId: RULE_ID,
            bucket: bucketFor('critical', true),
            severity: 'critical',
            affectedUrls: [],
        };
    },
};
