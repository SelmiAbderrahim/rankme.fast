/**
 * The Pages list and inspector read ONE crawl state per URL
 * (`crawlState` / `crawlEvidence`), so "Not in the last crawl" and "Crawl
 * state unknown" cannot coexist for the same page.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { gscSearchAnalytics } from '../../db/schema/gsc.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import type { AuditPageInventory, AuditPageInventoryRow } from '../audits/index.js';
import type { CoverageProbe } from '../../shared/providers/index.js';
import type { PagesFallbackRefreshService } from './fallback-refresh.service.js';
import { createPagesService } from './pages.service.js';

const NOW = new Date('2026-08-09T12:00:00.000Z');
const ACCOUNT = '507f1f77bcf86cd799439011';
const SITE = '507f1f77bcf86cd799439012';
const SITE_SHAPE = { id: SITE, url: 'https://example.com/', domain: 'example.com' };

beforeAll(startTestPostgres);
afterAll(stopTestPostgres);
beforeEach(truncateAllTables);

async function seedGscPage(path: string, impressions = 40) {
  await getTestDb().insert(gscSearchAnalytics).values({
    accountId: ACCOUNT,
    siteId: SITE,
    bindingGenerationId: 'legacy',
    snapshotDate: '2026-08-06',
    dimensionSet: 'page',
    windowDays: 28,
    dimensionKey: `https://example.com${path}`,
    clicks: 2,
    impressions,
    ctr: 2 / impressions,
    position: 6,
    fetchedAt: NOW,
  });
}

const crawled = (url: string, overrides: Partial<AuditPageInventoryRow> = {}): AuditPageInventoryRow => ({
  url,
  title: url.split('/').at(-1) || 'Home',
  isIndexable: true,
  nonIndexableReason: null,
  onPageScore: 80,
  statusCode: 200,
  finalUrl: null,
  redirectChain: [],
  contentType: 'text/html',
  fetchFailure: null,
  ...overrides,
});

const probe = (url: string, overrides: Partial<CoverageProbe> = {}): CoverageProbe => ({
  url,
  source: 'search-console',
  statusCode: 200,
  finalUrl: url,
  redirectChain: [],
  contentType: 'text/html',
  failure: null,
  ...overrides,
});

function audit(
  rows: AuditPageInventoryRow[],
  coverageProbes: CoverageProbe[] | null,
  runId: string | null = 'run-1',
): AuditPageInventory {
  return { runId, rows, fetchedCount: rows.length, truncated: false, coverageProbes };
}

function service(readAudit: AuditPageInventory) {
  return createPagesService({
    db: getTestDb() as never,
    cursorSecret: 'test-master-key-with-at-least-thirty-two-characters',
    providerSelection: 'dataforseo',
    fallbackRefresh: { refresh: vi.fn() } as unknown as PagesFallbackRefreshService,
    now: () => NOW,
    loadSite: vi.fn().mockResolvedValue(SITE_SHAPE),
    resolveGscState: vi.fn().mockResolvedValue({
      usable: true,
      propertyUrl: 'sc-domain:example.com',
      propertyUrlHash: 'a'.repeat(64),
      bindingGenerationId: 'legacy',
      fallbackReason: null,
    }),
    readAudit: vi.fn().mockResolvedValue(readAudit),
    readAuditPageDetail: vi.fn().mockResolvedValue(null),
  });
}

const query = { range: '28d' as const, sort: 'opportunity' as const, limit: 50 } as never;

async function stateOf(readAudit: AuditPageInventory, path: string) {
  const svc = service(readAudit);
  const list = await svc.list(ACCOUNT, SITE, query);
  const row = list.items.find((item) => new URL(item.url).pathname === path)!;
  const detail = await svc.detail(ACCOUNT, SITE, row.pageId, '28d');
  return { row, detail: detail.page };
}

describe('Pages crawl state — one source for list and inspector', () => {
  it('says there is no crawl yet, with no evidence, before any audit completed', async () => {
    await seedGscPage('/pricing');
    const { row, detail } = await stateOf(audit([], null, null), '/pricing');
    expect(row).toMatchObject({ crawlState: 'no_crawl', crawlEvidence: null });
    expect(detail).toMatchObject({ crawlState: 'no_crawl', crawlEvidence: null });
  });

  it('gives a measured URL the crawl never returned the same answer in the list and the inspector', async () => {
    await seedGscPage('/features');
    const { row, detail } = await stateOf(audit([crawled('https://example.com/en')], null), '/features');
    expect(row).toMatchObject({ crawlState: 'not_in_crawl', crawlEvidence: null, isIndexable: null });
    expect(detail.crawlState).toBe(row.crawlState);
    expect(detail.crawlEvidence).toEqual(row.crawlEvidence);
  });

  it('ignores a coverage probe for an address outside the audited site', async () => {
    await seedGscPage('/features');
    const { row } = await stateOf(
      audit([crawled('https://example.com/en')], [probe('https://elsewhere.test/features')]),
      '/features',
    );
    expect(row).toMatchObject({ crawlState: 'not_in_crawl', crawlEvidence: null });
  });

  it('records a root-to-locale redirect from our probe and names the crawled destination', async () => {
    await seedGscPage('/');
    const { row, detail } = await stateOf(
      audit(
        [crawled('https://example.com/en', { title: 'Welcome' })],
        [
          probe('https://example.com/', {
            source: 'site-root',
            finalUrl: 'https://example.com/en',
            redirectChain: [{ url: 'https://example.com/', status: 301 }],
          }),
        ],
      ),
      '/',
    );
    expect(row).toMatchObject({
      crawlState: 'redirected',
      crawledAs: 'example.com/en',
      title: 'Welcome',
      crawlEvidence: {
        source: 'probe',
        finalUrl: 'https://example.com/en',
        redirectChain: [{ url: 'https://example.com/', status: 301 }],
      },
    });
    expect(detail.crawlState).toBe('redirected');
    expect(detail.crawlEvidence?.finalUrl).toBe('https://example.com/en');
  });

  it('keeps the destination name from a locale twin when the probe found no redirect', async () => {
    await seedGscPage('/help');
    const { row } = await stateOf(
      audit([crawled('https://example.com/en/help')], [probe('https://example.com/help')]),
      '/help',
    );
    // Reachable but not part of the crawl: still "not in the crawl", with the evidence.
    expect(row).toMatchObject({ crawlState: 'not_in_crawl', crawlEvidence: { source: 'probe', statusCode: 200 } });
    expect(row.crawledAs).toBe('example.com/en/help');
  });

  it('does not borrow a title when the redirect destination was not crawled', async () => {
    await seedGscPage('/old');
    const { row } = await stateOf(
      audit(
        [crawled('https://example.com/en')],
        [probe('https://example.com/old', { finalUrl: 'https://example.com/elsewhere', redirectChain: [{ url: 'https://example.com/old', status: 302 }] })],
      ),
      '/old',
    );
    expect(row).toMatchObject({ crawlState: 'redirected', title: null });
    expect(row).not.toHaveProperty('crawledAs');
  });

  it('names the crawled page a non-locale redirect leads to and borrows its title', async () => {
    await seedGscPage('/old-guide');
    const { row, detail } = await stateOf(
      audit(
        [crawled('https://example.com/guides/new-guide', { title: 'New guide' })],
        [
          probe('https://example.com/old-guide', {
            finalUrl: 'https://example.com/guides/new-guide',
            redirectChain: [{ url: 'https://example.com/old-guide', status: 301 }],
          }),
        ],
      ),
      '/old-guide',
    );
    expect(row).toMatchObject({
      crawlState: 'redirected',
      crawledAs: 'example.com/guides/new-guide',
      title: 'New guide',
    });
    expect(detail.crawledAs).toBe('example.com/guides/new-guide');
  });

  it('ignores a redirect that leaves the site', async () => {
    await seedGscPage('/leaves');
    const { row } = await stateOf(
      audit(
        [crawled('https://example.com/en')],
        [
          probe('https://example.com/leaves', {
            finalUrl: 'https://elsewhere.test/landing',
            redirectChain: [{ url: 'https://example.com/leaves', status: 302 }],
          }),
        ],
      ),
      '/leaves',
    );
    expect(row).toMatchObject({ crawlState: 'redirected', title: null });
    expect(row).not.toHaveProperty('crawledAs');
  });

  it('keeps an existing title when the redirect destination is crawled', async () => {
    await seedGscPage('/en/pricing');
    const { row } = await stateOf(
      audit(
        [crawled('https://example.com/en/pricing-v2', { title: 'Pricing v2' }), crawled('https://example.com/en/pricing', { title: 'Pricing' })],
        [
          probe('https://example.com/en/pricing', {
            finalUrl: 'https://example.com/en/pricing-v2',
            redirectChain: [{ url: 'https://example.com/en/pricing', status: 301 }],
          }),
        ],
      ),
      '/en/pricing',
    );
    // The crawl has the page itself, so it is the crawled row that decides.
    expect(row).toMatchObject({ crawlState: 'indexable', title: 'Pricing' });
  });

  it.each([
    [{ kind: 'http_error', statusCode: 404 }, 404, 'failed'],
    [{ kind: 'redirect_loop' }, null, 'failed'],
    [{ kind: 'timeout' }, null, 'failed'],
    [{ kind: 'robots_blocked' }, 200, 'non_indexable'],
  ] as const)('explains a probe failure %j', async (failure, statusCode, state) => {
    await seedGscPage('/problem');
    const { row, detail } = await stateOf(
      audit([crawled('https://example.com/en')], [probe('https://example.com/problem', { statusCode, failure, finalUrl: null })]),
      '/problem',
    );
    expect(row.crawlState).toBe(state);
    expect(row.crawlEvidence).toMatchObject({ source: 'probe', failure });
    expect(detail.crawlEvidence).toEqual(row.crawlEvidence);
  });

  it('reports the crawl row itself — indexable, failed, redirected, non-indexable — without a probe', async () => {
    for (const path of ['/ok', '/missing', '/moved', '/private']) await seedGscPage(path);
    const readAudit = audit(
      [
        crawled('https://example.com/ok'),
        crawled('https://example.com/missing', { statusCode: 404, isIndexable: false, fetchFailure: { kind: 'http_error', statusCode: 404 } }),
        crawled('https://example.com/moved', { statusCode: 301, finalUrl: 'https://example.com/ok', redirectChain: [{ url: 'https://example.com/moved', status: 301 }] }),
        crawled('https://example.com/private', { isIndexable: false, nonIndexableReason: 'robots_txt', fetchFailure: { kind: 'robots_blocked' } }),
      ],
      [],
    );
    const list = await service(readAudit).list(ACCOUNT, SITE, query);
    const byPath = new Map(list.items.map((item) => [new URL(item.url).pathname, item]));
    expect(byPath.get('/ok')).toMatchObject({ crawlState: 'indexable', crawlEvidence: { source: 'crawl', statusCode: 200 } });
    expect(byPath.get('/missing')).toMatchObject({
      crawlState: 'failed',
      crawlEvidence: { failure: { kind: 'http_error', statusCode: 404 } },
    });
    expect(byPath.get('/moved')).toMatchObject({ crawlState: 'redirected', crawlEvidence: { finalUrl: 'https://example.com/ok' } });
    expect(byPath.get('/private')).toMatchObject({ crawlState: 'non_indexable', crawlEvidence: { nonIndexableReason: 'robots_txt' } });
  });

  it('lists a crawled-only page with its own crawl state', async () => {
    await seedGscPage('/seed');
    const list = await service(audit([crawled('https://example.com/crawled-only')], null)).list(ACCOUNT, SITE, query);
    const row = list.items.find((item) => new URL(item.url).pathname === '/crawled-only')!;
    expect(row).toMatchObject({ performanceSource: null, crawlState: 'indexable' });
  });
});
