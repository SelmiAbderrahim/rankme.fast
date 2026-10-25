import { describe, expect, it } from 'vitest';
import type { CoverageProbe } from '../../shared/providers/index.js';
import { CRAWL_STATES, resolveCrawlState } from './crawl-state.js';
import type { AuditPageInventoryRow } from './page-inventory.service.js';

const row = (overrides: Partial<AuditPageInventoryRow> = {}): AuditPageInventoryRow => ({
  url: 'https://example.com/en',
  title: 'Home',
  isIndexable: true,
  nonIndexableReason: null,
  onPageScore: 90,
  statusCode: 200,
  finalUrl: null,
  redirectChain: [],
  contentType: 'text/html',
  fetchFailure: null,
  ...overrides,
});

const probe = (overrides: Partial<CoverageProbe> = {}): CoverageProbe => ({
  url: 'https://example.com/pricing',
  source: 'search-console',
  statusCode: 200,
  finalUrl: 'https://example.com/pricing',
  redirectChain: [],
  contentType: 'text/html',
  failure: null,
  ...overrides,
});

describe('resolveCrawlState', () => {
  it('lists the six states the product knows', () => {
    expect(CRAWL_STATES).toEqual(['indexable', 'non_indexable', 'redirected', 'failed', 'not_in_crawl', 'no_crawl']);
  });

  it('is no_crawl, with no evidence, before any crawl has completed — whatever else is passed', () => {
    expect(resolveCrawlState({ hasCompletedCrawl: false })).toEqual({ state: 'no_crawl', evidence: null });
    expect(resolveCrawlState({ hasCompletedCrawl: false, row: row(), probe: probe() })).toEqual({
      state: 'no_crawl',
      evidence: null,
    });
  });

  it('is not_in_crawl with no evidence when a crawl completed and nothing explains the URL', () => {
    expect(resolveCrawlState({ hasCompletedCrawl: true })).toEqual({ state: 'not_in_crawl', evidence: null });
    expect(resolveCrawlState({ hasCompletedCrawl: true, row: null, probe: null })).toEqual({
      state: 'not_in_crawl',
      evidence: null,
    });
  });

  describe('a crawled row', () => {
    it('is indexable when nothing was recorded against it', () => {
      expect(resolveCrawlState({ hasCompletedCrawl: true, row: row() })).toEqual({
        state: 'indexable',
        evidence: {
          source: 'crawl',
          statusCode: 200,
          finalUrl: null,
          redirectChain: [],
          contentType: 'text/html',
          failure: null,
          nonIndexableReason: null,
        },
      });
    });

    it('treats a legacy row without evidence fields as indexable and never invents a cause', () => {
      const legacy: AuditPageInventoryRow = {
        url: 'https://example.com/a',
        title: null,
        isIndexable: true,
        nonIndexableReason: null,
        onPageScore: null,
      };
      expect(resolveCrawlState({ hasCompletedCrawl: true, row: legacy })).toEqual({
        state: 'indexable',
        evidence: {
          source: 'crawl',
          statusCode: null,
          finalUrl: null,
          redirectChain: [],
          contentType: null,
          failure: null,
          nonIndexableReason: null,
        },
      });
    });

    it('is non_indexable for a noindex row and for a robots.txt exclusion', () => {
      expect(
        resolveCrawlState({ hasCompletedCrawl: true, row: row({ isIndexable: false, nonIndexableReason: 'meta_tag' }) }),
      ).toMatchObject({ state: 'non_indexable', evidence: { nonIndexableReason: 'meta_tag' } });
      expect(
        resolveCrawlState({
          hasCompletedCrawl: true,
          row: row({ isIndexable: false, nonIndexableReason: 'robots_txt', fetchFailure: { kind: 'robots_blocked' } }),
        }).state,
      ).toBe('non_indexable');
    });

    it('is redirected when the row leads somewhere', () => {
      expect(
        resolveCrawlState({
          hasCompletedCrawl: true,
          row: row({
            statusCode: 301,
            finalUrl: 'https://example.com/en',
            redirectChain: [{ url: 'https://example.com/', status: 301 }],
          }),
        }),
      ).toMatchObject({ state: 'redirected', evidence: { finalUrl: 'https://example.com/en', statusCode: 301 } });
    });

    it.each([
      [{ kind: 'http_error', statusCode: 404 }],
      [{ kind: 'non_html', contentType: 'application/pdf' }],
      [{ kind: 'timeout' }],
    ] as const)('is failed for %j, even when the crawler also marked it non-indexable', (failure) => {
      expect(
        resolveCrawlState({
          hasCompletedCrawl: true,
          row: row({ isIndexable: false, fetchFailure: failure }),
        }),
      ).toMatchObject({ state: 'failed', evidence: { failure } });
    });
  });

  describe('a URL the crawl did not return, requested by us', () => {
    it('is redirected when the probe followed a redirect (root to locale)', () => {
      const result = resolveCrawlState({
        hasCompletedCrawl: true,
        probe: probe({
          url: 'https://example.com/',
          finalUrl: 'https://example.com/en',
          redirectChain: [{ url: 'https://example.com/', status: 301 }],
        }),
      });
      expect(result.state).toBe('redirected');
      expect(result.evidence).toMatchObject({ source: 'probe', finalUrl: 'https://example.com/en', statusCode: 200 });
    });

    it.each([
      [{ kind: 'http_error', statusCode: 404 }, 'failed'],
      [{ kind: 'redirect_loop' }, 'failed'],
      [{ kind: 'redirect_limit' }, 'failed'],
      [{ kind: 'unsafe_redirect' }, 'failed'],
      [{ kind: 'unreachable' }, 'failed'],
      [{ kind: 'non_html', contentType: 'application/json' }, 'failed'],
      [{ kind: 'robots_blocked' }, 'non_indexable'],
    ] as const)('maps probe failure %j to %s', (failure, state) => {
      const result = resolveCrawlState({
        hasCompletedCrawl: true,
        probe: probe({ failure, statusCode: failure.kind === 'http_error' ? failure.statusCode : null }),
      });
      expect(result.state).toBe(state);
      expect(result.evidence?.failure).toEqual(failure);
    });

    it('is only not_in_crawl, with the evidence, when the page is reachable but the crawl skipped it', () => {
      expect(resolveCrawlState({ hasCompletedCrawl: true, probe: probe() })).toMatchObject({
        state: 'not_in_crawl',
        evidence: { source: 'probe', statusCode: 200, failure: null },
      });
    });

    it('prefers the crawl row over a probe for the same URL', () => {
      expect(resolveCrawlState({ hasCompletedCrawl: true, row: row(), probe: probe({ failure: { kind: 'timeout' } }) }).state).toBe(
        'indexable',
      );
    });
  });
});
