/**
 * Rule `render-blocking-resources` — pages whose scripts or stylesheets hold
 * back the first paint. Advisory (watch, info): the crawler counts them in a
 * lab load, and some blocking styles are intentional.
 */
import type { AuditResult } from '../../../shared/providers/index.js';
import { evaluatePageChecks, pageFacts } from './deep-crawl.js';
import type { AuditRule, RuleFinding } from './rule.types.js';

const RULE_ID = 'render-blocking-resources' as const;

export const renderBlockingResourcesRule: AuditRule = {
  id: RULE_ID,
  evaluate(result: AuditResult): RuleFinding {
    return evaluatePageChecks(result, {
      id: RULE_ID,
      severity: 'info',
      checks: ['renderBlocking'],
      evidence: (page) => pageFacts(page, ['renderBlockingScripts', 'renderBlockingStylesheets']),
    });
  },
};
