/**
 * Rule `https-canonicalization` — the site enforces HTTPS and collapses
 * www/non-www + trailing-slash variants to one canonical origin. HTTPS not
 * enforced is fix-now (critical); a canonicalization mismatch is watch.
 *
 * When the audit probed the http/https × apex/www addresses, the probed
 * variants travel in `meta.addressVariants` and the ones that do not end on
 * the canonical https origin are the finding's affected URLs — so the
 * warning names what to fix instead of a bare "site-wide" flag.
 */
import type { AuditResult } from '../../../shared/providers/index.js';
import { bucketFor } from './bucket.js';
import type { AuditRule, RuleFinding } from './rule.types.js';
const RULE_ID = 'https-canonicalization' as const;
export const httpsCanonicalizationRule: AuditRule = {
    id: RULE_ID,
    evaluate(result: AuditResult): RuleFinding {
        const { httpsEnforced, canonicalizationOk, httpsRedirect, addressVariants } = result.domainChecks;
        const evidence = addressVariants && addressVariants.length > 0 ? { addressVariants } : {};
        const failingVariants = (addressVariants ?? []).filter((v) => v.ok === false).map((v) => v.url);
        const httpsOk = httpsEnforced && httpsRedirect !== false;
        if (!httpsOk) {
            return {
                ruleId: RULE_ID,
                bucket: bucketFor('critical', false),
                severity: 'critical',
                affectedUrls: failingVariants,
                meta: { httpsEnforced, httpsRedirect: httpsRedirect ?? null, ...evidence },
            };
        }
        if (!canonicalizationOk) {
            return {
                ruleId: RULE_ID,
                bucket: bucketFor('warning', false),
                severity: 'warning',
                affectedUrls: failingVariants,
                ...(addressVariants && addressVariants.length > 0 ? { meta: evidence } : {}),
            };
        }
        return {
            ruleId: RULE_ID,
            bucket: bucketFor('critical', true),
            severity: 'critical',
            affectedUrls: [],
            ...(addressVariants && addressVariants.length > 0 ? { meta: evidence } : {}),
        };
    },
};
