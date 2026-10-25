/**
 * Whether a check applies to a site at all.
 *
 * "Not evaluated" means a check that applies could not run. Local SEO checks
 * (business listings, reviews, the map pack) do not apply to a site that is
 * not a local business: listing them under "Not evaluated" told an online
 * publisher that four checks were missing. They move to a separate "Not
 * applicable to this site" group and out of every "Not evaluated" count,
 * until the owner says the site is a local business or sets up Local SEO.
 */
import type { LocalSeoEvaluationInput } from './rules/index.js';
import { isNotEvaluatedFinding } from './rules/index.js';

export type FindingApplicability = 'applicable' | 'not_applicable';

export const LOCAL_SEO_RULE_IDS: ReadonlySet<string> = new Set([
  'nap-inconsistency',
  'low-review-count',
  'low-review-rating',
  'local-pack-not-ranking',
]);

/**
 * Local SEO applies when the owner marked the site as a local business, or
 * when Local SEO data exists for it (listings refreshed or a map-pack
 * keyword tracked — any status other than `not-configured`).
 */
export function localSeoApplies(input: {
  localBusiness: boolean;
  localSeoStatus: LocalSeoEvaluationInput['status'] | null;
}): boolean {
  return input.localBusiness || (input.localSeoStatus !== null && input.localSeoStatus !== 'not-configured');
}

/**
 * A check is `not_applicable` only when it is a Local SEO check, Local SEO
 * does not apply, and the check did not run. A check that produced a result
 * is always applicable — real evidence is never hidden.
 */
export function findingApplicability(
  finding: { ruleId: string; bucket: string; meta?: Record<string, unknown> | null },
  localApplies: boolean,
): FindingApplicability {
  return LOCAL_SEO_RULE_IDS.has(finding.ruleId) && !localApplies && isNotEvaluatedFinding(finding)
    ? 'not_applicable'
    : 'applicable';
}
