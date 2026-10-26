/**
 * How each finding compares with the previous audit of the same site
 *. One vocabulary for every finding and every surface:
 *
 * - `new`            — failing now; the previous run did not have the check,
 *                      or could not evaluate it. You cannot regress from a
 *                      state that was never measured.
 * - `regressed`      — the previous run EVALUATED the check and it was
 *                      passing, or less severe, or fewer pages were affected.
 * - `improved`       — still failing, but less severe or fewer pages.
 * - `unchanged`      — same result as the previous run.
 * - `resolved`       — failing before, passing now.
 * - `not_comparable` — the page count moved, but the two crawls covered a
 *                      materially different set of pages, so the counts do
 *                      not say whether things got better or worse.
 *
 * A check that is not evaluated in THIS run has no status (it lives in the
 * "Not evaluated" section), and neither does a check that passes now and was
 * never measured before. The status names are a contract shared with the
 * report view (prompt group 05); do not rename them.
 */
import { isNotEvaluatedFinding } from './rules/index.js';

export const FINDING_COMPARISON_STATUSES = [
  'new',
  'regressed',
  'improved',
  'unchanged',
  'resolved',
  'not_comparable',
] as const;
export type FindingComparisonStatus = (typeof FINDING_COMPARISON_STATUSES)[number];

/**
 * Crawl sizes that differ by less than this share are treated as the same
 * scope: a few pages appearing or disappearing between runs is normal churn.
 */
export const SCOPE_MISMATCH_RELATIVE = 0.1;
/** ...and by fewer than this many pages, whatever the share (tiny sites). */
export const SCOPE_MISMATCH_MIN_PAGES = 5;

export interface CrawlScope {
  /** Page limit the run was started with. */
  pageCap: number;
  /** Pages stored for the run; `null` when not recorded. */
  pagesCrawled: number | null;
}

export interface ReportComparison {
  previousRunId: string;
  previous: CrawlScope;
  current: CrawlScope;
  /**
   * The two crawls covered materially different sets of pages, so counts
   * are not directly comparable. The report shows a neutral note.
   */
  scopeMismatch: boolean;
}

function hitCap(scope: CrawlScope): boolean {
  return scope.pagesCrawled !== null && scope.pagesCrawled >= scope.pageCap;
}

/**
 * Whether two crawls covered materially different sets of pages: their page
 * counts differ by at least {@link SCOPE_MISMATCH_MIN_PAGES} AND more than
 * {@link SCOPE_MISMATCH_RELATIVE}, or their page limits differ and at least
 * one crawl was cut off by its limit (a different limit only matters when it
 * actually stopped a crawl). Unrecorded counts prove nothing either way.
 */
export function crawlScopesDiffer(previous: CrawlScope, current: CrawlScope): boolean {
  if (previous.pagesCrawled !== null && current.pagesCrawled !== null) {
    const gap = Math.abs(previous.pagesCrawled - current.pagesCrawled);
    const larger = Math.max(previous.pagesCrawled, current.pagesCrawled);
    if (gap >= SCOPE_MISMATCH_MIN_PAGES && gap / larger > SCOPE_MISMATCH_RELATIVE) return true;
  }
  return previous.pageCap !== current.pageCap && (hitCap(previous) || hitCap(current));
}

interface ComparableFinding {
  bucket: string;
  affectedUrls: readonly string[];
  meta?: Record<string, unknown> | null;
}

/** Severity of a failing bucket: fix-now outranks watch. */
const failingRank = (bucket: string): number => (bucket === 'fix-now' ? 2 : 1);

/**
 * The comparison status of one finding against the same rule in the
 * previous run. `baseline` is `undefined` when the previous run has no
 * finding for the rule. Returns `null` when there is nothing honest to say.
 */
export function compareFinding(
  baseline: ComparableFinding | undefined,
  current: ComparableFinding,
  scopeMismatch: boolean,
): FindingComparisonStatus | null {
  if (isNotEvaluatedFinding(current)) return null;
  const currentPassed = current.bucket === 'passed';
  if (baseline === undefined || isNotEvaluatedFinding(baseline)) {
    return currentPassed ? null : 'new';
  }
  const baselinePassed = baseline.bucket === 'passed';
  if (currentPassed) return baselinePassed ? 'unchanged' : 'resolved';
  if (baselinePassed) return 'regressed';
  const rankChange = failingRank(current.bucket) - failingRank(baseline.bucket);
  if (rankChange !== 0) return rankChange > 0 ? 'regressed' : 'improved';
  const countChange = current.affectedUrls.length - baseline.affectedUrls.length;
  if (countChange === 0) return 'unchanged';
  if (scopeMismatch) return 'not_comparable';
  return countChange > 0 ? 'regressed' : 'improved';
}

/** Statuses for every finding of `current`, keyed by rule id. */
export function compareFindings(
  previous: readonly (ComparableFinding & { ruleId: string })[],
  current: readonly (ComparableFinding & { ruleId: string })[],
  scopeMismatch: boolean,
): Map<string, FindingComparisonStatus> {
  const baselineByRule = new Map(previous.map((finding) => [finding.ruleId, finding]));
  const statuses = new Map<string, FindingComparisonStatus>();
  for (const finding of current) {
    const status = compareFinding(baselineByRule.get(finding.ruleId), finding, scopeMismatch);
    if (status !== null) statuses.set(finding.ruleId, status);
  }
  return statuses;
}
