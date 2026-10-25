/**
 * Rule `url-structure` — addresses that are hard to read or share: unusual
 * characters (anything but letters, digits and dashes), dynamic query
 * parameters, or longer than the crawler's 120-character limit. Advisory
 * (watch, info): changing a live address needs a redirect.
 */
import type { AuditResult } from '../../../shared/providers/index.js';
import { evaluatePageChecks } from './deep-crawl.js';
import type { AuditRule, RuleFinding } from './rule.types.js';

const RULE_ID = 'url-structure' as const;

export const urlStructureRule: AuditRule = {
  id: RULE_ID,
  evaluate(result: AuditResult): RuleFinding {
    return evaluatePageChecks(result, {
      id: RULE_ID,
      severity: 'info',
      checks: ['urlHasUnusualCharacters', 'urlHasParameters', 'urlTooLong'],
    });
  },
};
