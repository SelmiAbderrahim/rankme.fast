/**
 * Why an audit's crawl stopped.
 *
 * New runs ALWAYS persist a code: the crawler's own reason when it gave one,
 * otherwise one derived from the page counts at the moment the run finished.
 * Older runs stored nothing; their reason is derived at READ time from what
 * they did store (never written back), and when even that is impossible the
 * report says the reason was not recorded and offers to run the audit again.
 */
import { AUDIT_CRAWL_STOP_REASONS } from '../../shared/providers/types.js';

/**
 * The crawler's own codes plus `finished_below_limit`: the crawl finished on
 * its own before reaching the page limit, without naming a cause.
 */
export const AUDIT_RUN_STOP_REASONS = [...AUDIT_CRAWL_STOP_REASONS, 'finished_below_limit'] as const;
export type AuditRunStopReason = (typeof AUDIT_RUN_STOP_REASONS)[number];

/** `recorded` = stored with the run; `derived` = worked out at read time from stored counts. */
export type AuditStopReasonSource = 'recorded' | 'derived';

/** The code a finishing run persists; never empty. */
export function finalStopReason(input: {
  reported: AuditRunStopReason | undefined;
  pageCap: number;
  pagesCrawled: number;
}): AuditRunStopReason {
  if (input.reported) return input.reported;
  return input.pagesCrawled >= input.pageCap ? 'page_limit' : 'finished_below_limit';
}

/**
 * The stop reason to show for a run: the stored code, else `page_limit`
 * when the stored counts prove the crawl reached its limit, else `null`
 * (an older run that recorded nothing usable).
 */
export function readStopReason(run: {
  pageCap: number;
  pagesCrawled?: number | null;
  vendorPagesCrawled?: number | null;
  crawlStopReason?: AuditRunStopReason | null;
}): { stopReason: AuditRunStopReason | null; stopReasonSource: AuditStopReasonSource | null } {
  if (run.crawlStopReason) return { stopReason: run.crawlStopReason, stopReasonSource: 'recorded' };
  const crawled = run.vendorPagesCrawled ?? run.pagesCrawled ?? null;
  if (crawled !== null && run.pageCap > 0 && crawled >= run.pageCap) {
    return { stopReason: 'page_limit', stopReasonSource: 'derived' };
  }
  return { stopReason: null, stopReasonSource: null };
}
