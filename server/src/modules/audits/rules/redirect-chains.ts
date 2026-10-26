/**
 * Rule `redirect-chains` — addresses that take two or more redirects to
 * settle, and redirect loops that never settle. A loop is fix-now (critical):
 * the address cannot be opened at all. A chain is watch (warning): each hop
 * adds a round trip and can drop ranking signals.
 *
 * Evidence comes from the crawler's redirect-chain read (`redirectChains`,
 * every hop and its status). Pages the crawler reached through a chain
 * (`checks.reachedThroughRedirectChain`) are added when the read gave no
 * chain for them. When the read did not run or failed and no page carries the
 * flag, the check is not evaluated: a missing read is not a clean result.
 */
import type { AuditRedirectChain, AuditResult } from '../../../shared/providers/index.js';
import { bucketFor } from './bucket.js';
import { MAX_EVIDENCE_ROWS, boundedEvidence, missingSignalMeta, notEvaluated } from './deep-crawl.js';
import type { AuditRule, RuleFinding } from './rule.types.js';

const RULE_ID = 'redirect-chains' as const;

/** Two or more redirects before the final address. */
export const REDIRECT_CHAIN_MIN_HOPS = 2;

export const redirectChainsRule: AuditRule = {
  id: RULE_ID,
  evaluate(result: AuditResult): RuleFinding {
    const chains: AuditRedirectChain[] = (result.redirectChains ?? []).filter(
      (chain) => chain.isLoop || chain.hops.length >= REDIRECT_CHAIN_MIN_HOPS,
    );
    const inChain = new Set(chains.flatMap((chain) => [chain.from, ...chain.hops.map((hop) => hop.url)]));
    const flaggedPages = result.pages
      .filter((page) => page.checks?.reachedThroughRedirectChain === true && !inChain.has(page.url))
      .map((page) => page.url);
    const measuredByPages = result.pages.some(
      (page) => typeof page.checks?.reachedThroughRedirectChain === 'boolean',
    );
    if (!result.redirectChains && !measuredByPages) {
      return notEvaluated(RULE_ID, 'warning', missingSignalMeta(result, 'redirect-chains'));
    }
    if (chains.length === 0 && flaggedPages.length === 0) {
      return { ruleId: RULE_ID, bucket: bucketFor('warning', true), severity: 'warning', affectedUrls: [] };
    }
    const loops = chains.filter((chain) => chain.isLoop).length;
    const severity = loops > 0 ? 'critical' : 'warning';
    return {
      ruleId: RULE_ID,
      bucket: bucketFor(severity, false),
      severity,
      affectedUrls: [...new Set([...chains.map((chain) => chain.from), ...flaggedPages])],
      meta: {
        ...boundedEvidence(
          chains.map((chain) => ({ from: chain.from, hops: chain.hops, isLoop: chain.isLoop })),
          'chains',
        ),
        loops,
        ...(flaggedPages.length > 0 ? { reachedThroughChain: flaggedPages.slice(0, MAX_EVIDENCE_ROWS) } : {}),
        // Only page flags answered: hop-by-hop evidence is missing, and why.
        ...(result.redirectChains ? {} : { chainsNotRead: missingSignalMeta(result, 'redirect-chains').reason }),
      },
    };
  },
};
