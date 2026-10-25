/**
 * Rule `placeholder-text` — indexable pages that still carry "lorem ipsum"
 * placeholder copy. Published filler text reads as an unfinished page to
 * visitors and search engines, so it is fix-now (critical).
 */
import type { AuditResult } from '../../../shared/providers/index.js';
import { evaluatePageChecks } from './deep-crawl.js';
import type { AuditRule, RuleFinding } from './rule.types.js';

const RULE_ID = 'placeholder-text' as const;

export const placeholderTextRule: AuditRule = {
  id: RULE_ID,
  evaluate(result: AuditResult): RuleFinding {
    return evaluatePageChecks(result, {
      id: RULE_ID,
      severity: 'critical',
      checks: ['placeholderText'],
    });
  },
};
