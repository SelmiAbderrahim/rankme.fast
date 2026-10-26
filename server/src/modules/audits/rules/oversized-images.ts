/**
 * Rule `oversized-images` (resource scan) — images larger than
 * {@link OVERSIZED_IMAGE_BYTES}. Heavy images are the most common reason a
 * page loads slowly on a phone. Advisory (watch, info): a large hero image
 * can be deliberate. Without the scan → not evaluated (`scan-off`).
 */
import type { AuditResult } from '../../../shared/providers/index.js';
import { bucketFor } from './bucket.js';
import { boundedEvidence, notEvaluated, resourceEvidence, scannedResources } from './deep-crawl.js';
import type { AuditRule, RuleFinding } from './rule.types.js';

const RULE_ID = 'oversized-images' as const;

/**
 * 500 KB: well above a sharp, compressed full-width photo (typically 100–300
 * KB), so only images that clearly could be smaller are listed. Our own line.
 */
export const OVERSIZED_IMAGE_BYTES = 500_000;

export const oversizedImagesRule: AuditRule = {
  id: RULE_ID,
  evaluate(result: AuditResult): RuleFinding {
    const scan = scannedResources(result);
    if ('missing' in scan) return notEvaluated(RULE_ID, 'info', scan.missing);
    const oversized = scan.resources
      .filter((resource) => resource.type === 'image' && !resource.isBroken && (resource.sizeBytes ?? 0) > OVERSIZED_IMAGE_BYTES)
      .sort((a, b) => b.sizeBytes! - a.sizeBytes!);
    if (oversized.length === 0) {
      return { ruleId: RULE_ID, bucket: bucketFor('info', true), severity: 'info', affectedUrls: [] };
    }
    return {
      ruleId: RULE_ID,
      bucket: bucketFor('info', false),
      severity: 'info',
      affectedUrls: oversized.map((resource) => resource.url),
      meta: { ...boundedEvidence(oversized.map(resourceEvidence), 'resources'), threshold: OVERSIZED_IMAGE_BYTES },
    };
  },
};
