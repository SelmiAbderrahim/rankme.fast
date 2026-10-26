import { describe, expect, it, vi } from 'vitest';
import type { AuditPage } from '../../shared/providers/index.js';
import type { PageProber, PageProbeResult } from '../../shared/security/site-probe.js';
import {
  BROKEN_LINK_EVIDENCE_PER_PAGE_MAX,
  BROKEN_LINK_VERIFY_MAX_TARGETS,
  COVERAGE_PROBE_MAX_URLS,
  classifyBrokenTarget,
  clampToPageCap,
  comparableUrl,
  probeCoverage,
  selectCoverageCandidates,
  verifyBrokenLinks,
} from './crawl-evidence.js';

function probeResult(overrides: Partial<PageProbeResult> = {}): PageProbeResult {
  return {
    url: 'https://example.com/x',
    statusCode: 200,
    finalUrl: 'https://example.com/x',
    redirectChain: [],
    contentType: 'text/html',
    failure: null,
    ...overrides,
  };
}

function page(url: string, brokenLinks: string[] = []): AuditPage {
  return {
    url,
    statusCode: 200,
    title: 't',
    metaDescription: 'd',
    h1: ['h'],
    h2: [],
    canonical: null,
    hasStructuredData: true,
    structuredDataErrors: [],
    isIndexable: true,
    brokenLinks,
    onPageScore: 80,
  };
}

function prober(answer: (url: string) => PageProbeResult | Promise<PageProbeResult>): PageProber & {
  probe: ReturnType<typeof vi.fn>;
} {
  return { probe: vi.fn(async (url: string) => answer(url)) };
}

const budget = { outOfBudget: () => false };

describe('comparableUrl', () => {
  it('ignores scheme, www, trailing slashes, fragments and host case but keeps the query', () => {
    expect(comparableUrl('HTTPS://WWW.Example.com/pricing/#plans')).toBe('example.com/pricing');
    expect(comparableUrl('https://example.com/')).toBe('example.com/');
    expect(comparableUrl('http://example.com/a?x=1')).toBe('example.com/a?x=1');
    expect(comparableUrl('not a url')).toBeNull();
  });
});

describe('clampToPageCap', () => {
  it('keeps everything at or under the page limit', () => {
    const pages = [page('https://example.com/a'), page('https://example.com/b')];
    expect(clampToPageCap(pages, 2)).toEqual({ pages, dropped: 0 });
    expect(clampToPageCap(pages, 5).dropped).toBe(0);
  });

  it('drops pages past the page limit and says how many', () => {
    const pages = Array.from({ length: 12 }, (_, i) => page(`https://example.com/${i}`));
    const out = clampToPageCap(pages, 10);
    expect(out.pages).toHaveLength(10);
    expect(out.dropped).toBe(2);
    expect(out.pages.at(-1)!.url).toBe('https://example.com/9');
  });
});

describe('classifyBrokenTarget', () => {
  const classify = (overrides: Partial<PageProbeResult>) =>
    classifyBrokenTarget('https://example.com/t', probeResult(overrides));

  it('clears a target that resolves to a page, recording the redirect it followed', () => {
    expect(
      classify({
        statusCode: 200,
        finalUrl: 'https://example.com/en/t',
        redirectChain: [{ url: 'https://example.com/t', status: 301 }],
      }),
    ).toEqual({
      target: 'https://example.com/t',
      outcome: 'cleared',
      status: 200,
      finalUrl: 'https://example.com/en/t',
    });
    expect(classify({ statusCode: 200, failure: { kind: 'non_html', contentType: 'application/pdf' } })).toMatchObject({
      outcome: 'cleared',
    });
  });

  it.each([404, 410, 500, 503])('confirms an HTTP %i', (statusCode) => {
    expect(classify({ statusCode, failure: { kind: 'http_error', statusCode } })).toEqual({
      target: 'https://example.com/t',
      outcome: 'confirmed',
      status: statusCode,
      failure: 'http_error',
    });
  });

  it.each([401, 403, 429])('leaves an HTTP %i unverified because the check may have been refused', (statusCode) => {
    expect(classify({ statusCode, failure: { kind: 'http_error', statusCode } })).toMatchObject({
      outcome: 'unverified',
      status: statusCode,
      failure: 'http_error',
    });
  });

  it.each(['redirect_loop', 'redirect_limit'] as const)('confirms %s as broken for visitors', (kind) => {
    expect(
      classify({ statusCode: null, finalUrl: null, failure: { kind }, redirectChain: [{ url: 'u', status: 301 }] }),
    ).toEqual({ target: 'https://example.com/t', outcome: 'confirmed', status: null, failure: kind });
  });

  it.each(['timeout', 'unreachable', 'unsafe_redirect'] as const)('leaves %s unverified', (kind) => {
    expect(classify({ statusCode: null, finalUrl: null, failure: { kind } })).toMatchObject({
      outcome: 'unverified',
      status: null,
      failure: kind,
    });
  });

  it('treats an answerless probe with no recorded failure as unreachable', () => {
    expect(classify({ statusCode: null, finalUrl: null, failure: null })).toMatchObject({
      outcome: 'unverified',
      failure: 'unreachable',
    });
  });
});

describe('verifyBrokenLinks', () => {
  it('clears false positives, keeps confirmed and unverified targets, and records evidence per page', async () => {
    const pages = [
      page('https://example.com/a', ['https://example.com/pricing', 'https://example.com/gone']),
      page('https://example.com/b', ['https://example.com/pricing', 'https://example.com/guarded']),
      page('https://example.com/clean'),
    ];
    const p = prober((url) => {
      if (url.endsWith('/pricing')) {
        return probeResult({
          statusCode: 200,
          finalUrl: 'https://example.com/en/pricing',
          redirectChain: [{ url, status: 301 }],
        });
      }
      if (url.endsWith('/gone')) {
        return probeResult({ statusCode: 404, failure: { kind: 'http_error', statusCode: 404 } });
      }
      return probeResult({ statusCode: 403, failure: { kind: 'http_error', statusCode: 403 } });
    });
    const tally = await verifyBrokenLinks(pages, { prober: p, ...budget });

    expect(pages[0]!.brokenLinks).toEqual(['https://example.com/gone']);
    expect(pages[1]!.brokenLinks).toEqual(['https://example.com/guarded']);
    expect(pages[0]!.brokenLinkEvidence).toEqual([
      {
        target: 'https://example.com/pricing',
        outcome: 'cleared',
        status: 200,
        finalUrl: 'https://example.com/en/pricing',
      },
      { target: 'https://example.com/gone', outcome: 'confirmed', status: 404, failure: 'http_error' },
    ]);
    expect(pages[2]).not.toHaveProperty('brokenLinkEvidence');
    expect(tally).toEqual({ verifiedTargets: 3, clearedTargets: 1, confirmedTargets: 1, unverifiedTargets: 1 });
    // The most-linked target is requested first, each exactly once, as a real GET without robots.txt.
    expect(p.probe).toHaveBeenCalledTimes(3);
    expect(p.probe.mock.calls[0]).toEqual(['https://example.com/pricing', { method: 'GET', checkRobots: false }]);
  });

  it('re-requests at most the verification ceiling and leaves the rest unverified without inventing a status', async () => {
    const targets = Array.from({ length: BROKEN_LINK_VERIFY_MAX_TARGETS + 30 }, (_, i) => `https://example.com/dead/${i}`);
    const pages = [page('https://example.com/a', targets)];
    const p = prober(() => probeResult({ statusCode: 404, failure: { kind: 'http_error', statusCode: 404 } }));
    const tally = await verifyBrokenLinks(pages, { prober: p, ...budget });
    expect(p.probe).toHaveBeenCalledTimes(BROKEN_LINK_VERIFY_MAX_TARGETS);
    expect(tally.verifiedTargets).toBe(BROKEN_LINK_VERIFY_MAX_TARGETS);
    expect(pages[0]!.brokenLinks).toHaveLength(BROKEN_LINK_VERIFY_MAX_TARGETS + 30);
    const unchecked = pages[0]!.brokenLinkEvidence!.filter((row) => row.status === null);
    expect(unchecked).toHaveLength(30);
    expect(unchecked.every((row) => row.outcome === 'unverified' && !('failure' in row))).toBe(true);
  });

  it('bounds the evidence rows kept per page without dropping the targets themselves', async () => {
    const targets = Array.from({ length: BROKEN_LINK_EVIDENCE_PER_PAGE_MAX + 40 }, (_, i) => `https://example.com/d/${i}`);
    const pages = [page('https://example.com/a', targets)];
    const p = prober(() => probeResult({ statusCode: 404, failure: { kind: 'http_error', statusCode: 404 } }));
    await verifyBrokenLinks(pages, { prober: p, ...budget });
    expect(pages[0]!.brokenLinkEvidence).toHaveLength(BROKEN_LINK_EVIDENCE_PER_PAGE_MAX);
    expect(pages[0]!.brokenLinks).toHaveLength(BROKEN_LINK_EVIDENCE_PER_PAGE_MAX + 40);
  });

  it('stops requesting when the audit budget is spent and labels the remainder unverified', async () => {
    const pages = [page('https://example.com/a', ['https://example.com/1', 'https://example.com/2', 'https://example.com/3'])];
    let calls = 0;
    const p = prober(() => {
      calls += 1;
      return probeResult({ statusCode: 404, failure: { kind: 'http_error', statusCode: 404 } });
    });
    const tally = await verifyBrokenLinks(pages, { prober: p, outOfBudget: () => calls >= 1 });
    expect(p.probe.mock.calls.length).toBeLessThan(3);
    expect(tally.verifiedTargets).toBeLessThan(3);
    expect(pages[0]!.brokenLinks).toHaveLength(3);
    expect(pages[0]!.brokenLinkEvidence!.some((row) => row.outcome === 'unverified' && row.status === null)).toBe(true);
  });

  it('is a no-op for a crawl without broken links', async () => {
    const p = prober(() => probeResult());
    const tally = await verifyBrokenLinks([page('https://example.com/a')], { prober: p, ...budget });
    expect(tally).toEqual({ verifiedTargets: 0, clearedTargets: 0, confirmedTargets: 0, unverifiedTargets: 0 });
    expect(p.probe).not.toHaveBeenCalled();
  });
});

describe('selectCoverageCandidates', () => {
  it('lists the root first, then Search Console URLs the crawl did not return', () => {
    const out = selectCoverageCandidates({
      rootUrl: 'https://example.com/',
      searchConsoleUrls: [
        'https://example.com/pricing',
        'https://example.com/features/',
        'https://example.com/en/help',
        'https://other.test/foreign',
        'https://example.com/pricing/',
        'garbage',
      ],
      crawledUrls: ['https://www.example.com/en/help/', 'https://example.com/features', 'not a url'],
    });
    expect(out).toEqual([
      { url: 'https://example.com/', source: 'site-root' },
      { url: 'https://example.com/pricing', source: 'search-console' },
    ]);
  });

  it('skips the root when it was crawled and caps the list', () => {
    const urls = Array.from({ length: COVERAGE_PROBE_MAX_URLS + 10 }, (_, i) => `https://example.com/p${i}`);
    const out = selectCoverageCandidates({
      rootUrl: 'https://example.com/',
      searchConsoleUrls: urls,
      crawledUrls: ['https://example.com/'],
    });
    expect(out).toHaveLength(COVERAGE_PROBE_MAX_URLS);
    expect(out.every((candidate) => candidate.source === 'search-console')).toBe(true);
  });

  it('returns nothing for an unparseable root', () => {
    expect(
      selectCoverageCandidates({ rootUrl: 'nope', searchConsoleUrls: ['https://example.com/a'], crawledUrls: [] }),
    ).toEqual([]);
  });
});

describe('probeCoverage', () => {
  it('records the probe outcome for each candidate, including a root-to-locale redirect', async () => {
    const p = prober((url) =>
      url === 'https://example.com/'
        ? probeResult({
            url,
            finalUrl: 'https://example.com/en',
            redirectChain: [{ url, status: 301 }],
          })
        : probeResult({ url, statusCode: 404, failure: { kind: 'http_error', statusCode: 404 } }),
    );
    const probes = await probeCoverage(
      [
        { url: 'https://example.com/', source: 'site-root' },
        { url: 'https://example.com/old', source: 'search-console' },
      ],
      { prober: p, ...budget },
    );
    expect(probes).toEqual([
      {
        url: 'https://example.com/',
        source: 'site-root',
        statusCode: 200,
        finalUrl: 'https://example.com/en',
        redirectChain: [{ url: 'https://example.com/', status: 301 }],
        contentType: 'text/html',
        failure: null,
      },
      {
        url: 'https://example.com/old',
        source: 'search-console',
        statusCode: 404,
        finalUrl: 'https://example.com/x',
        redirectChain: [],
        contentType: 'text/html',
        failure: { kind: 'http_error', statusCode: 404 },
      },
    ]);
  });

  it('omits candidates it ran out of budget for', async () => {
    let calls = 0;
    const p = prober(() => {
      calls += 1;
      return probeResult();
    });
    const probes = await probeCoverage(
      [
        { url: 'https://example.com/a', source: 'search-console' },
        { url: 'https://example.com/b', source: 'search-console' },
      ],
      { prober: p, outOfBudget: () => calls >= 1 },
    );
    expect(probes).toHaveLength(1);
  });
});
