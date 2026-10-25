/**
 * Rule `links-to-redirects` — pages that link to internal addresses that
 * redirect. Each extra hop slows visitors and wastes crawl time; the fix is to
 * point the link at the final address. Advisory (watch, warning).
 */
import type { AuditResult } from '../../../shared/providers/index.js';
import { evaluatePageChecks } from './deep-crawl.js';
import type { AuditRule, RuleFinding } from './rule.types.js';

const RULE_ID = 'links-to-redirects' as const;

export const linksToRedirectsRule: AuditRule = {
  id: RULE_ID,
  evaluate(result: AuditResult): RuleFinding {
    return evaluatePageChecks(result, {
      id: RULE_ID,
      severity: 'warning',
      checks: ['linksToRedirects'],
    });
  },
};
