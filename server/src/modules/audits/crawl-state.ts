/**
 * Canonical crawl state of one URL (issues #4b / #4c / #14).
 *
 * ONE function answers "what happened to this URL in the last crawl?" for
 * every surface — the Pages list, the Pages inspector, exports — so the list
 * can never say "Not in the last crawl" while the inspector says "Crawl state
 * unknown". Callers pass what they know; the function never guesses a cause.
 *
 *   state           meaning
 *   --------------  ---------------------------------------------------------
 *   indexable       crawled, readable, indexable
 *   non_indexable   crawled (or requested by us) but excluded: noindex,
 *                   robots.txt, or other crawler-recorded reason
 *   redirected      the URL answers with a redirect; `evidence.finalUrl` is
 *                   where it leads
 *   failed          the URL could not be read: HTTP error, redirect loop or
 *                   limit, unsafe redirect, timeout, unreachable, non-HTML
 *   not_in_crawl    a completed crawl exists and this URL is not part of it;
 *                   `evidence` explains why only when we requested the URL
 *   no_crawl        no completed crawl exists yet, so nothing is known
 */
import type {
  CoverageProbe,
  PageFetchFailure,
  RedirectHop,
} from '../../shared/providers/index.js';
import type { AuditPageInventoryRow } from './page-inventory.service.js';

export const CRAWL_STATES = [
  'indexable',
  'non_indexable',
  'redirected',
  'failed',
  'not_in_crawl',
  'no_crawl',
] as const;
export type CrawlState = (typeof CRAWL_STATES)[number];

export interface CrawlEvidence {
  /** `crawl` = a row of the crawl; `probe` = our own request for a URL the crawl did not return. */
  source: 'crawl' | 'probe';
  statusCode: number | null;
  finalUrl: string | null;
  redirectChain: RedirectHop[];
  contentType: string | null;
  failure: PageFetchFailure | null;
  /** The crawler's own exclusion reason (`robots_txt`, `meta_tag`, …), when recorded. */
  nonIndexableReason: string | null;
}

export interface CrawlStateResult {
  state: CrawlState;
  evidence: CrawlEvidence | null;
}

export interface CrawlStateInput {
  /** A succeeded crawl exists for the site. */
  hasCompletedCrawl: boolean;
  /** This URL's row in that crawl. */
  row?: AuditPageInventoryRow | null;
  /** Our own request for this URL; only meaningful when `row` is absent. */
  probe?: CoverageProbe | null;
}

function stateFor(
  failure: PageFetchFailure | null,
  finalUrl: string | null,
  excluded: boolean,
): CrawlState {
  if (failure && failure.kind !== 'robots_blocked') return 'failed';
  if (failure?.kind === 'robots_blocked' || excluded) return 'non_indexable';
  if (finalUrl) return 'redirected';
  return 'indexable';
}

export function resolveCrawlState(input: CrawlStateInput): CrawlStateResult {
  if (!input.hasCompletedCrawl) return { state: 'no_crawl', evidence: null };

  const { row, probe } = input;
  if (row) {
    const evidence: CrawlEvidence = {
      source: 'crawl',
      statusCode: row.statusCode ?? null,
      finalUrl: row.finalUrl ?? null,
      redirectChain: row.redirectChain ?? [],
      contentType: row.contentType ?? null,
      failure: row.fetchFailure ?? null,
      nonIndexableReason: row.nonIndexableReason,
    };
    return { state: stateFor(evidence.failure, evidence.finalUrl, !row.isIndexable), evidence };
  }

  if (probe) {
    const evidence: CrawlEvidence = {
      source: 'probe',
      statusCode: probe.statusCode,
      finalUrl: probe.finalUrl,
      redirectChain: probe.redirectChain,
      contentType: probe.contentType,
      failure: probe.failure,
      nonIndexableReason: null,
    };
    // A probe that reached the page without a redirect or failure only proves
    // the page exists: the crawl still did not include it.
    const redirected = probe.redirectChain.length > 0 ? probe.finalUrl : null;
    const state = stateFor(probe.failure, redirected, false);
    return { state: state === 'indexable' ? 'not_in_crawl' : state, evidence };
  }

  return { state: 'not_in_crawl', evidence: null };
}
