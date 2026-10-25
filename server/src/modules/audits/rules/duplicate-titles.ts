/**
 * Rule `duplicate-titles` — two or more indexable pages sharing one title.
 * Search engines then struggle to tell the pages apart and may show the wrong
 * one. Watch, warning.
 *
 * The crawler's duplicate-tag read (`duplicateGroups`, kind `title`) is the
 * evidence: each group lists the pages that share a title. When that read did
 * not run, the per-page `checks.duplicateTitle` flag still answers, without
 * the grouping (also when the read failed but other duplicate groups were
 * read). Neither reported → not evaluated.
 */
import type { AuditResult } from '../../../shared/providers/index.js';
import { bucketFor } from './bucket.js';
import { boundedEvidence, missingSignalMeta, notEvaluated, servedIndexable } from './deep-crawl.js';
import type { AuditRule, RuleFinding } from './rule.types.js';

const RULE_ID = 'duplicate-titles' as const;

export const duplicateTitlesRule: AuditRule = {
  id: RULE_ID,
  evaluate(result: AuditResult): RuleFinding {
    const indexable = new Map(result.pages.filter(servedIndexable).map((page) => [page.url, page]));
    let groups: { title: string | null; urls: string[] }[];
    // Content groups can exist while the tag read failed; only a tag read
    // that answered makes the title groups authoritative.
    const tagsRead =
      result.duplicateGroups !== undefined &&
      !result.unavailableSignals?.some((entry) => entry.signal === 'duplicate-tags');
    if (tagsRead) {
      groups = result.duplicateGroups!
        .filter((group) => group.kind === 'title')
        .map((group) => group.urls.filter((url) => indexable.has(url)))
        .filter((urls) => urls.length >= 2)
        .map((urls) => ({ title: indexable.get(urls[0]!)!.title, urls }));
    } else {
      const measured = [...indexable.values()].filter((page) => typeof page.checks?.duplicateTitle === 'boolean');
      if (indexable.size > 0 && measured.length === 0) {
        return notEvaluated(RULE_ID, 'warning', missingSignalMeta(result, 'duplicate-tags'));
      }
      // Group the flagged pages by their own title text.
      const byTitle = new Map<string, string[]>();
      for (const page of measured) {
        if (page.checks?.duplicateTitle !== true) continue;
        const key = page.title?.trim() ?? '';
        byTitle.set(key, [...(byTitle.get(key) ?? []), page.url]);
      }
      groups = [...byTitle.entries()].map(([title, urls]) => ({ title: title || null, urls }));
    }
    if (groups.length === 0) {
      return { ruleId: RULE_ID, bucket: bucketFor('warning', true), severity: 'warning', affectedUrls: [] };
    }
    return {
      ruleId: RULE_ID,
      bucket: bucketFor('warning', false),
      severity: 'warning',
      affectedUrls: [...new Set(groups.flatMap((group) => group.urls))],
      meta: boundedEvidence(groups, 'groups'),
    };
  },
};
