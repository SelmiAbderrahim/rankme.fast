/**
 * Rule `deep-pages` — indexable pages more than {@link DEEP_CLICK_DEPTH}
 * clicks from the home page. Pages buried that deep get crawled less often
 * and are hard for visitors to reach. Advisory (watch, info): a large archive
 * can be deep on purpose.
 */
import type { AuditResult } from '../../../shared/providers/index.js';
import { bucketFor } from './bucket.js';
import { boundedEvidence, missingSignalMeta, notEvaluated, servedIndexable } from './deep-crawl.js';
import type { AuditRule, RuleFinding } from './rule.types.js';

const RULE_ID = 'deep-pages' as const;

/**
 * Common site-architecture guidance keeps important pages within three clicks
 * of the home page; deeper is flagged. Our own line — the crawler only
 * reports the depth.
 */
export const DEEP_CLICK_DEPTH = 3;

export const deepPagesRule: AuditRule = {
  id: RULE_ID,
  evaluate(result: AuditResult): RuleFinding {
    const inScope = result.pages.filter(servedIndexable);
    const measured = inScope.filter((page) => typeof page.clickDepth === 'number');
    if (inScope.length > 0 && measured.length === 0) {
      return notEvaluated(RULE_ID, 'info', missingSignalMeta(result));
    }
    const deep = measured
      .filter((page) => page.clickDepth! > DEEP_CLICK_DEPTH)
      .sort((a, b) => b.clickDepth! - a.clickDepth! || a.url.localeCompare(b.url));
    if (deep.length === 0) {
      return { ruleId: RULE_ID, bucket: bucketFor('info', true), severity: 'info', affectedUrls: [] };
    }
    return {
      ruleId: RULE_ID,
      bucket: bucketFor('info', false),
      severity: 'info',
      affectedUrls: deep.map((page) => page.url),
      meta: {
        ...boundedEvidence(
          deep.map((page) => ({ url: page.url, clickDepth: page.clickDepth })),
          'pages',
        ),
        threshold: DEEP_CLICK_DEPTH,
      },
    };
  },
};
