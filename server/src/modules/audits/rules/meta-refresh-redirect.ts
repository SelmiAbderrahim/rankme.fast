/**
 * Rule `meta-refresh-redirect` — pages that send visitors on with
 * `<meta http-equiv="refresh">` instead of a server redirect. Search engines
 * may not pass ranking signals through it. Watch, warning. Applies to every
 * page that served a body, indexable or not.
 */
import type { AuditResult } from '../../../shared/providers/index.js';
import { evaluatePageChecks } from './deep-crawl.js';
import type { AuditRule, RuleFinding } from './rule.types.js';

const RULE_ID = 'meta-refresh-redirect' as const;

export const metaRefreshRedirectRule: AuditRule = {
  id: RULE_ID,
  evaluate(result: AuditResult): RuleFinding {
    return evaluatePageChecks(result, {
      id: RULE_ID,
      severity: 'warning',
      checks: ['metaRefreshRedirect'],
      scope: (page) => Math.floor(page.statusCode / 100) === 2,
    });
  },
};
