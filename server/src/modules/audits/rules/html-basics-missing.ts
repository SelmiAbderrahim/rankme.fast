/**
 * Rule `html-basics-missing` — pages without a `<!DOCTYPE html>` line or
 * without a character-encoding declaration. Browsers then guess, which can
 * break layout or garble text. Watch, warning. (The vendor's charset
 * consistency check is not read: its recorded polarity contradicts its docs.)
 */
import type { AuditResult } from '../../../shared/providers/index.js';
import { evaluatePageChecks } from './deep-crawl.js';
import type { AuditRule, RuleFinding } from './rule.types.js';

const RULE_ID = 'html-basics-missing' as const;

export const htmlBasicsMissingRule: AuditRule = {
  id: RULE_ID,
  evaluate(result: AuditResult): RuleFinding {
    return evaluatePageChecks(result, {
      id: RULE_ID,
      severity: 'warning',
      checks: ['missingDoctype', 'missingCharset'],
    });
  },
};
