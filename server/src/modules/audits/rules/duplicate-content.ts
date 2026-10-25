/**
 * Rule `duplicate-content` — indexable pages the crawler judged near-identical
 * to another page. Search engines pick one to show and may pick the wrong one.
 * Watch, warning: the crawler's similarity is an estimate.
 *
 * Pages are flagged by `checks.duplicateContent`. The bounded per-page read
 * adds which pages match and how closely (`duplicateGroups`, kind `content`,
 * similarity 0–10). Flagged pages the read did not reach are counted in
 * `meta.unverifiedCount`: their flag stands without the match list.
 */
import type { AuditResult } from '../../../shared/providers/index.js';
import { bucketFor } from './bucket.js';
import { boundedEvidence, missingSignalMeta, notEvaluated, servedIndexable } from './deep-crawl.js';
import type { AuditRule, RuleFinding } from './rule.types.js';

const RULE_ID = 'duplicate-content' as const;

export const duplicateContentRule: AuditRule = {
  id: RULE_ID,
  evaluate(result: AuditResult): RuleFinding {
    const inScope = result.pages.filter(servedIndexable);
    const indexable = new Set(inScope.map((page) => page.url));
    const groups = (result.duplicateGroups ?? [])
      .filter((group) => group.kind === 'content')
      .map((group) => ({ urls: group.urls.filter((url) => indexable.has(url)), similarity: group.similarity }))
      .filter((group) => group.urls.length >= 2);
    const measured = inScope.filter((page) => typeof page.checks?.duplicateContent === 'boolean');
    if (inScope.length > 0 && measured.length === 0 && groups.length === 0) {
      return notEvaluated(RULE_ID, 'warning', missingSignalMeta(result));
    }
    const flagged = measured.filter((page) => page.checks?.duplicateContent === true).map((page) => page.url);
    const affected = [...new Set([...flagged, ...groups.flatMap((group) => group.urls)])];
    if (affected.length === 0) {
      return { ruleId: RULE_ID, bucket: bucketFor('warning', true), severity: 'warning', affectedUrls: [] };
    }
    const unverified = result.unverified?.duplicateContent ?? 0;
    return {
      ruleId: RULE_ID,
      bucket: bucketFor('warning', false),
      severity: 'warning',
      affectedUrls: affected,
      meta: {
        ...boundedEvidence(groups, 'groups'),
        ...(unverified > 0 ? { unverifiedCount: unverified } : {}),
      },
    };
  },
};
