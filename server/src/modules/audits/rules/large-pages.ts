/**
 * Rule `large-pages` — HTML documents over the crawler's 1 MB limit (watch,
 * info). Over 3 MB the page is slow on most phones and may not be read in
 * full, so the finding escalates to fix-now (warning).
 */
import type { AuditResult } from '../../../shared/providers/index.js';
import { evaluatePageChecks, pageFacts } from './deep-crawl.js';
import type { AuditRule, RuleFinding } from './rule.types.js';

const RULE_ID = 'large-pages' as const;

export const largePagesRule: AuditRule = {
  id: RULE_ID,
  evaluate(result: AuditResult): RuleFinding {
    return evaluatePageChecks(result, {
      id: RULE_ID,
      severity: 'info',
      checks: ['largePage', 'veryLargePage'],
      evidence: (page) => pageFacts(page, ['pageSizeBytes', 'transferSizeBytes']),
      fixNowWhen: (page) => page.checks?.veryLargePage === true,
      fixNowSeverity: 'warning',
    });
  },
};
