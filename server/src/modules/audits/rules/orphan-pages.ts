/**
 * Rule `orphan-pages` — pages listed in the sitemap that no internal link
 * points at (the crawler reaches them only through the sitemap). Visitors
 * cannot find them by browsing and search engines treat them as unimportant.
 * Watch, warning.
 */
import type { AuditResult } from '../../../shared/providers/index.js';
import { evaluatePageChecks, pageFacts } from './deep-crawl.js';
import type { AuditRule, RuleFinding } from './rule.types.js';

const RULE_ID = 'orphan-pages' as const;

export const orphanPagesRule: AuditRule = {
  id: RULE_ID,
  evaluate(result: AuditResult): RuleFinding {
    return evaluatePageChecks(result, {
      id: RULE_ID,
      severity: 'warning',
      checks: ['orphan'],
      evidence: (page) => pageFacts(page, ['inboundInternalLinks', 'clickDepth']),
    });
  },
};
