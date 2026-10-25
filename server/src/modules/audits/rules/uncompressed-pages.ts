/**
 * Rule `uncompressed-pages` — HTML sent without compression (no gzip or
 * Brotli). Compression usually cuts the transfer several times over; it is a
 * server setting. Watch, warning.
 */
import type { AuditResult } from '../../../shared/providers/index.js';
import { evaluatePageChecks, pageFacts } from './deep-crawl.js';
import type { AuditRule, RuleFinding } from './rule.types.js';

const RULE_ID = 'uncompressed-pages' as const;

export const uncompressedPagesRule: AuditRule = {
  id: RULE_ID,
  evaluate(result: AuditResult): RuleFinding {
    return evaluatePageChecks(result, {
      id: RULE_ID,
      severity: 'warning',
      checks: ['uncompressed'],
      evidence: (page) => pageFacts(page, ['pageSizeBytes', 'transferSizeBytes', 'contentEncoding']),
    });
  },
};
