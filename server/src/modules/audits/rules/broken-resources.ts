/**
 * Rule `broken-resources` (resource scan) — images, scripts and
 * stylesheets that answered 4xx/5xx or did not answer. Visitors see missing
 * images or a page without its styling or behaviour, so it is fix-now
 * (warning: the page itself still loads). Without the scan the check is not
 * evaluated (`scan-off`), never passed.
 */
import type { AuditResult } from '../../../shared/providers/index.js';
import { bucketFor } from './bucket.js';
import { boundedEvidence, notEvaluated, resourceEvidence, scannedResources } from './deep-crawl.js';
import type { AuditRule, RuleFinding } from './rule.types.js';

const RULE_ID = 'broken-resources' as const;

export const brokenResourcesRule: AuditRule = {
  id: RULE_ID,
  evaluate(result: AuditResult): RuleFinding {
    const scan = scannedResources(result);
    if ('missing' in scan) return notEvaluated(RULE_ID, 'warning', scan.missing);
    const broken = scan.resources.filter((resource) => resource.isBroken);
    if (broken.length === 0) {
      return { ruleId: RULE_ID, bucket: bucketFor('warning', true), severity: 'warning', affectedUrls: [] };
    }
    return {
      ruleId: RULE_ID,
      bucket: bucketFor('warning', false, { fixNow: true }),
      severity: 'warning',
      affectedUrls: broken.map((resource) => resource.url),
      meta: {
        ...boundedEvidence(broken.map(resourceEvidence), 'resources'),
        ...(result.resourceTotal !== undefined ? { resourceTotal: result.resourceTotal } : {}),
      },
    };
  },
};
