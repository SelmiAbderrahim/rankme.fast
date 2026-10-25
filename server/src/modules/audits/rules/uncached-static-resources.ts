/**
 * Rule `uncached-static-resources` (resource scan) — images, scripts and
 * stylesheets the server tells browsers not to cache, so returning visitors
 * download them again. Advisory (watch, info). Resources with no cache answer
 * reported are left out, never counted as uncached. Without the scan → not
 * evaluated (`scan-off`).
 */
import type { AuditResult } from '../../../shared/providers/index.js';
import { bucketFor } from './bucket.js';
import { boundedEvidence, notEvaluated, resourceEvidence, scannedResources } from './deep-crawl.js';
import type { AuditRule, RuleFinding } from './rule.types.js';

const RULE_ID = 'uncached-static-resources' as const;

export const uncachedStaticResourcesRule: AuditRule = {
  id: RULE_ID,
  evaluate(result: AuditResult): RuleFinding {
    const scan = scannedResources(result);
    if ('missing' in scan) return notEvaluated(RULE_ID, 'info', scan.missing);
    const uncached = scan.resources.filter(
      (resource) => resource.type !== 'other' && !resource.isBroken && resource.cacheable === false,
    );
    if (uncached.length === 0) {
      return { ruleId: RULE_ID, bucket: bucketFor('info', true), severity: 'info', affectedUrls: [] };
    }
    return {
      ruleId: RULE_ID,
      bucket: bucketFor('info', false),
      severity: 'info',
      affectedUrls: uncached.map((resource) => resource.url),
      meta: boundedEvidence(uncached.map(resourceEvidence), 'resources'),
    };
  },
};
