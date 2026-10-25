/**
 * Rule `deprecated-html` — pages using tags removed from current HTML, Flash,
 * or frames (`frame`, `iframe`, `frameset`). Flash no longer runs anywhere;
 * frames are often fine (embedded videos), so this stays advisory: watch,
 * info, and the copy asks to check rather than remove.
 */
import type { AuditResult } from '../../../shared/providers/index.js';
import { evaluatePageChecks } from './deep-crawl.js';
import type { AuditRule, RuleFinding } from './rule.types.js';

const RULE_ID = 'deprecated-html' as const;

export const deprecatedHtmlRule: AuditRule = {
  id: RULE_ID,
  evaluate(result: AuditResult): RuleFinding {
    return evaluatePageChecks(result, {
      id: RULE_ID,
      severity: 'info',
      checks: ['deprecatedTags', 'flash', 'frames'],
    });
  },
};
