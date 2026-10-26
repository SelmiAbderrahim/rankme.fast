/**
 * Rule `slow-server-response` — pages the crawler found slow: the first byte
 * took longer than 1.5 seconds, or the whole page longer than 3 seconds (the
 * crawler's own limits). Watch, warning: one lab load from the crawler's
 * location, not what every visitor sees.
 *
 * The bounded waterfall read adds the measured time to first byte
 * (`serverResponseMs`); flagged pages it did not reach are counted in
 * `meta.unverifiedCount`.
 */
import type { AuditResult } from '../../../shared/providers/index.js';
import { evaluatePageChecks } from './deep-crawl.js';
import type { AuditRule, RuleFinding } from './rule.types.js';

const RULE_ID = 'slow-server-response' as const;

export const slowServerResponseRule: AuditRule = {
  id: RULE_ID,
  evaluate(result: AuditResult): RuleFinding {
    return evaluatePageChecks(result, {
      id: RULE_ID,
      severity: 'warning',
      checks: ['slowServerResponse', 'slowLoad'],
      evidence: (page) => ({
        ...(page.serverResponseMs !== undefined ? { serverResponseMs: page.serverResponseMs } : {}),
        ...(page.timing?.fetchMs !== undefined ? { fetchMs: page.timing.fetchMs } : {}),
      }),
      extraMeta: (audit) => {
        const unverified = audit.unverified?.slowPages ?? 0;
        return unverified > 0 ? { unverifiedCount: unverified } : {};
      },
    });
  },
};
