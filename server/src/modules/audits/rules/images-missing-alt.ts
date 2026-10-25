/**
 * Rule `images-missing-alt` — indexable pages with at least one image that
 * has no `alt` text. Screen readers and image search depend on it. The crawler
 * reports whether any image lacks it; the evidence carries the page's image
 * count. Watch, warning.
 */
import type { AuditResult } from '../../../shared/providers/index.js';
import { evaluatePageChecks, pageFacts } from './deep-crawl.js';
import type { AuditRule, RuleFinding } from './rule.types.js';

const RULE_ID = 'images-missing-alt' as const;

export const imagesMissingAltRule: AuditRule = {
  id: RULE_ID,
  evaluate(result: AuditResult): RuleFinding {
    return evaluatePageChecks(result, {
      id: RULE_ID,
      severity: 'warning',
      checks: ['imagesMissingAlt'],
      evidence: (page) => pageFacts(page, ['imageCount']),
    });
  },
};
