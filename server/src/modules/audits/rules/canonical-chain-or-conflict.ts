/**
 * Rule `canonical-chain-or-conflict` — canonical tags that point at a broken
 * page (fix-now, critical: search engines are told to index an error), at a
 * redirect, at a page with its own canonical elsewhere, or back and forth
 * between two pages; and pages that receive both followed and `nofollow`
 * internal links (watch, warning). Distinct from
 * `canonical-missing-or-broken`, which checks the tag on the page itself.
 */
import type { AuditResult } from '../../../shared/providers/index.js';
import { evaluatePageChecks } from './deep-crawl.js';
import type { AuditRule, RuleFinding } from './rule.types.js';

const RULE_ID = 'canonical-chain-or-conflict' as const;

export const canonicalChainOrConflictRule: AuditRule = {
  id: RULE_ID,
  evaluate(result: AuditResult): RuleFinding {
    return evaluatePageChecks(result, {
      id: RULE_ID,
      severity: 'warning',
      checks: ['canonicalToBroken', 'canonicalToRedirect', 'canonicalChain', 'canonicalLoop', 'linkRelationConflict'],
      evidence: (page) => ({ canonical: page.canonical }),
      fixNowWhen: (page) => page.checks?.canonicalToBroken === true,
      fixNowSeverity: 'critical',
    });
  },
};
