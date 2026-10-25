/**
 * Rule `favicon-missing` — pages without a favicon. Search results and
 * browser tabs show it next to the site name. Watch, info.
 */
import type { AuditResult } from '../../../shared/providers/index.js';
import { evaluatePageChecks } from './deep-crawl.js';
import type { AuditRule, RuleFinding } from './rule.types.js';

const RULE_ID = 'favicon-missing' as const;

export const faviconMissingRule: AuditRule = {
  id: RULE_ID,
  evaluate(result: AuditResult): RuleFinding {
    return evaluatePageChecks(result, {
      id: RULE_ID,
      severity: 'info',
      checks: ['missingFavicon'],
    });
  },
};
