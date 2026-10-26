/**
 * Post-crawl evidence stages.
 *
 * The crawl vendor answers "what did you crawl". These stages answer what the
 * product needs on top of that, using first-party requests that never spend
 * vendor budget and always go through the shared SSRF authority:
 *
 *   - `clampToPageCap`      the stored crawl never exceeds the audit's page limit
 *   - `verifyBrokenLinks`   re-request every reported broken target (GET, up to
 *                           five redirects) and clear the false positives
 *   - `probeCoverage`       request the URLs the crawl did not return (site root,
 *                           Search Console URLs) so "absent" has a recorded cause
 *
 * Every stage is bounded (targets, concurrency, per-request deadline, total
 * deadline) and degrades to "unverified"/"no evidence" — it never fails the run.
 */
import type {
  AuditPage,
  BrokenLinkEvidence,
  CoverageProbe,
} from '../../shared/providers/index.js';
import type { PageProber, PageProbeResult } from '../../shared/security/site-probe.js';

/** Distinct broken targets re-requested per audit. */
export const BROKEN_LINK_VERIFY_MAX_TARGETS = 100;
/** URLs (site root + Search Console pages) probed per audit for crawl coverage. */
export const COVERAGE_PROBE_MAX_URLS = 25;
/** Requests in flight at once, per stage. */
export const EVIDENCE_CONCURRENCY = 5;
/** Evidence rows kept per page; targets past it keep the crawler's verdict. */
export const BROKEN_LINK_EVIDENCE_PER_PAGE_MAX = 500;
/** Statuses that usually mean "our check was refused", not "the page is gone". */
const INCONCLUSIVE_STATUSES = new Set([401, 403, 429]);

/** Host-and-path identity used to compare crawled URLs with candidates. */
export function comparableUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : '/';
    return `${host}${path}${url.search}`;
  } catch {
    return null;
  }
}

export interface ClampOutcome {
  pages: AuditPage[];
  /** Pages dropped because the vendor returned more than the page limit. */
  dropped: number;
}

/**
 * The audit's page limit is also enforced on what we STORE: a vendor that
 * returns more rows than `max_crawl_pages` asked for must not hand back pages
 * beyond the limit the run was started with.
 */
export function clampToPageCap(pages: readonly AuditPage[], pageCap: number): ClampOutcome {
  if (pages.length <= pageCap) return { pages: [...pages], dropped: 0 };
  return { pages: pages.slice(0, pageCap), dropped: pages.length - pageCap };
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  shouldStop: () => boolean,
  work: (item: T) => Promise<R>,
): Promise<Array<R | undefined>> {
  const results: Array<R | undefined> = new Array<R | undefined>(items.length).fill(undefined);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      if (shouldStop()) return;
      results[index] = await work(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

export interface EvidenceStageOptions {
  prober: PageProber;
  /** Return true once the audit's wall-clock budget no longer allows more requests. */
  outOfBudget: () => boolean;
}

// ---------------------------------------------------------------------------
// Broken links
// ---------------------------------------------------------------------------

/** Classifies one re-request of a reported broken target. */
export function classifyBrokenTarget(target: string, probe: PageProbeResult): BrokenLinkEvidence {
  const finalUrl = probe.finalUrl !== null && probe.redirectChain.length > 0 ? probe.finalUrl : undefined;
  const base = { target, status: probe.statusCode, ...(finalUrl ? { finalUrl } : {}) };
  const failure = probe.failure;
  if (probe.statusCode !== null && probe.statusCode >= 200 && probe.statusCode < 300) {
    // Reached a page. A robots.txt disallow or a non-HTML type does not make
    // the link broken for a visitor.
    return { ...base, outcome: 'cleared' };
  }
  if (probe.statusCode !== null) {
    return {
      ...base,
      outcome: INCONCLUSIVE_STATUSES.has(probe.statusCode) ? 'unverified' : 'confirmed',
      failure: 'http_error',
    };
  }
  if (failure?.kind === 'redirect_loop' || failure?.kind === 'redirect_limit') {
    return { ...base, outcome: 'confirmed', failure: failure.kind };
  }
  // timeout / unreachable / unsafe_redirect: we cannot say the page is gone.
  return { ...base, outcome: 'unverified', failure: failure?.kind ?? 'unreachable' };
}

export interface BrokenLinkVerification {
  verifiedTargets: number;
  clearedTargets: number;
  confirmedTargets: number;
  unverifiedTargets: number;
}

/**
 * Re-requests the most-linked broken targets (up to
 * {@link BROKEN_LINK_VERIFY_MAX_TARGETS}) and rewrites each page's
 * `brokenLinks` / `brokenLinkEvidence`: cleared targets leave the list,
 * confirmed ones stay with their status, everything else stays labelled
 * unverified. Mutates `pages` in place and never throws.
 */
export async function verifyBrokenLinks(
  pages: AuditPage[],
  options: EvidenceStageOptions,
): Promise<BrokenLinkVerification> {
  const linkCount = new Map<string, number>();
  for (const page of pages) {
    for (const target of new Set(page.brokenLinks)) {
      linkCount.set(target, (linkCount.get(target) ?? 0) + 1);
    }
  }
  const ranked = [...linkCount.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, BROKEN_LINK_VERIFY_MAX_TARGETS)
    .map(([target]) => target);

  // A real GET, no robots.txt lookup: the verdict is what a visitor receives.
  const probes = await mapWithConcurrency(ranked, EVIDENCE_CONCURRENCY, options.outOfBudget, (target) =>
    options.prober.probe(target, { method: 'GET', checkRobots: false }),
  );
  const evidenceByTarget = new Map<string, BrokenLinkEvidence>();
  ranked.forEach((target, index) => {
    const probe = probes[index];
    if (probe) evidenceByTarget.set(target, classifyBrokenTarget(target, probe));
  });

  for (const page of pages) {
    if (page.brokenLinks.length === 0) continue;
    const kept: string[] = [];
    const evidence: BrokenLinkEvidence[] = [];
    for (const target of new Set(page.brokenLinks)) {
      const proof = evidenceByTarget.get(target) ?? { target, outcome: 'unverified' as const, status: null };
      if (evidence.length < BROKEN_LINK_EVIDENCE_PER_PAGE_MAX) evidence.push(proof);
      if (proof.outcome !== 'cleared') kept.push(target);
    }
    page.brokenLinks = kept;
    page.brokenLinkEvidence = evidence;
  }

  const tally = { cleared: 0, confirmed: 0, unverified: 0 };
  for (const proof of evidenceByTarget.values()) tally[proof.outcome] += 1;
  return {
    verifiedTargets: evidenceByTarget.size,
    clearedTargets: tally.cleared,
    confirmedTargets: tally.confirmed,
    unverifiedTargets: tally.unverified,
  };
}

// ---------------------------------------------------------------------------
// Crawl coverage
// ---------------------------------------------------------------------------

export interface CoverageCandidate {
  url: string;
  source: CoverageProbe['source'];
}

/**
 * URLs worth explaining: the site root first, then Search Console URLs, minus
 * anything the crawl returned (compared by host-and-path, ignoring `www.` and
 * a trailing slash) and minus addresses on other sites.
 */
export function selectCoverageCandidates(input: {
  rootUrl: string;
  searchConsoleUrls: readonly string[];
  crawledUrls: readonly string[];
}): CoverageCandidate[] {
  const crawled = new Set<string>();
  for (const url of input.crawledUrls) {
    const key = comparableUrl(url);
    if (key) crawled.add(key);
  }
  const rootHost = comparableUrl(input.rootUrl)?.split('/')[0];
  const seen = new Set<string>();
  const out: CoverageCandidate[] = [];
  const consider = (url: string, source: CoverageProbe['source']): void => {
    if (out.length >= COVERAGE_PROBE_MAX_URLS) return;
    const key = comparableUrl(url);
    if (!key || key.split('/')[0] !== rootHost) return;
    if (crawled.has(key) || seen.has(key)) return;
    seen.add(key);
    out.push({ url, source });
  };
  consider(input.rootUrl, 'site-root');
  for (const url of input.searchConsoleUrls) consider(url, 'search-console');
  return out;
}

/** Requests each candidate and records what happened. Never throws. */
export async function probeCoverage(
  candidates: readonly CoverageCandidate[],
  options: EvidenceStageOptions,
): Promise<CoverageProbe[]> {
  const results = await mapWithConcurrency(candidates, EVIDENCE_CONCURRENCY, options.outOfBudget, (candidate) =>
    options.prober.probe(candidate.url),
  );
  const probes: CoverageProbe[] = [];
  candidates.forEach((candidate, index) => {
    const probe = results[index];
    if (!probe) return;
    probes.push({
      url: candidate.url,
      source: candidate.source,
      statusCode: probe.statusCode,
      finalUrl: probe.finalUrl,
      redirectChain: probe.redirectChain,
      contentType: probe.contentType,
      failure: probe.failure,
    });
  });
  return probes;
}
