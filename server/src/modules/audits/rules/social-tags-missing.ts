/**
 * Rule `social-tags-missing` — indexable pages without Open Graph tags. When a
 * page is shared, social networks and chat apps build the preview from them;
 * Twitter/X cards fall back to Open Graph, so Open Graph is what decides.
 * Advisory (watch, info).
 */
import type { AuditResult } from '../../../shared/providers/index.js';
import { bucketFor } from './bucket.js';
import { boundedEvidence, missingSignalMeta, notEvaluated, servedIndexable } from './deep-crawl.js';
import type { AuditRule, RuleFinding } from './rule.types.js';

const RULE_ID = 'social-tags-missing' as const;

export const socialTagsMissingRule: AuditRule = {
  id: RULE_ID,
  evaluate(result: AuditResult): RuleFinding {
    const inScope = result.pages.filter(servedIndexable);
    const measured = inScope.filter((page) => page.socialTags !== undefined);
    if (inScope.length > 0 && measured.length === 0) {
      return notEvaluated(RULE_ID, 'info', missingSignalMeta(result));
    }
    const missing = measured.filter((page) => !page.socialTags!.openGraph);
    if (missing.length === 0) {
      return { ruleId: RULE_ID, bucket: bucketFor('info', true), severity: 'info', affectedUrls: [] };
    }
    return {
      ruleId: RULE_ID,
      bucket: bucketFor('info', false),
      severity: 'info',
      affectedUrls: missing.map((page) => page.url),
      meta: boundedEvidence(
        missing.map((page) => ({ url: page.url, ...page.socialTags! })),
        'pages',
      ),
    };
  },
};
