/**
 * The two page counts mean two different things, and a redirect source is
 * not a second page. Fixture: `audits/__fixtures__/crawl/redirect-duplicates.json`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

interface Fixture {
  siteUrl: string;
  auditRows: Array<Partial<AuditPageInventoryRow> & { url: string }>;
  gscPages: Array<{ url: string; clicks: number; impressions: number; position: number }>;
  expected: {
    auditRowsFetched: number;
    inventoryPages: number;
    measuredPages: number;
    redirectSources: number;
    averagePosition: number;
  };
}

const fixture = JSON.parse(
  readFileSync(
    join(import.meta.dirname, '..', 'audits', '__fixtures__', 'crawl', 'redirect-duplicates.json'),
    'utf8',
  ),
) as Fixture;
const SITE_SHAPE = { id: SITE, url: fixture.siteUrl, domain: new URL(fixture.siteUrl).hostname };

beforeAll(startTestPostgres);
afterAll(stopTestPostgres);
beforeEach(truncateAllTables);

async function seedGsc(rows: Fixture['gscPages']) {
  for (const row of rows) {
    await getTestDb().insert(gscSearchAnalytics).values({
      accountId: ACCOUNT,
      siteId: SITE,
      bindingGenerationId: 'legacy',
      snapshotDate: '2026-08-06',
      dimensionSet: 'page',
      windowDays: 28,
      dimensionKey: row.url,
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: row.clicks / row.impressions,
      position: row.position,
      fetchedAt: NOW,
    });
  }
}

const row = (input: Partial<AuditPageInventoryRow> & { url: string }): AuditPageInventoryRow => ({
  title: null,
  isIndexable: true,
  nonIndexableReason: null,
  onPageScore: 80,
  statusCode: 200,
  finalUrl: null,
  redirectChain: [],
  contentType: 'text/html',
  fetchFailure: null,
  ...input,
});

function audit(rows: AuditPageInventoryRow[], coverageProbes: CoverageProbe[] | null = []): AuditPageInventory {
  return { runId: 'run-1', rows, fetchedCount: rows.length, truncated: false, coverageProbes };
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
      propertyUrl: 'sc-domain:episodebrief.example',
      propertyUrlHash: 'a'.repeat(64),
      bindingGenerationId: 'legacy',
      fallbackReason: null,
    }),
    readAudit: vi.fn().mockResolvedValue(readAudit),
  });
}

const query = { range: '28d' as const, sort: 'opportunity' as const, limit: 50 } as never;
const base = fixture.siteUrl.replace(/\/$/, '');

describe('Pages counts — inventory vs crawled URLs', () => {
  it('counts unique canonical pages and keeps the crawl count separate', async () => {
    await seedGsc(fixture.gscPages);
    const list = await service(audit(fixture.auditRows.map(row))).list(ACCOUNT, SITE, query);
    const { coverage } = list.envelope;
    expect(coverage.auditRowsFetched).toBe(fixture.expected.auditRowsFetched);
    expect(coverage.inventoryPages).toBe(fixture.expected.inventoryPages);
    expect(coverage.redirectPages).toBe(fixture.expected.redirectSources);
    expect(coverage.measuredPages).toBe(fixture.expected.measuredPages);
    expect(coverage.unmeasuredPages).toBe(fixture.expected.inventoryPages - fixture.expected.measuredPages);
    // Rows still sum: every listed row, including the labelled redirect source.
    expect(list.pageInfo.totalInventory).toBe(coverage.inventoryPages + coverage.redirectPages);
    // The impression-weighted average position is unchanged by the grouping.
    expect(list.summary.averagePosition).toBeCloseTo(fixture.expected.averagePosition, 2);
  });

  it('labels the redirect source with the page it leads to', async () => {
    await seedGsc(fixture.gscPages);
    const list = await service(audit(fixture.auditRows.map(row))).list(ACCOUNT, SITE, query);
    const source = list.items.find((item) => new URL(item.url).pathname === '/episode-pass');
    expect(source).toMatchObject({ redirectsTo: 'episodebrief.example/en/episode-pass', title: 'Episode Pass' });
    const target = list.items.find((item) => new URL(item.url).pathname === '/en/episode-pass');
    expect(target).not.toHaveProperty('redirectsTo');
  });

  it('keeps its own title, ignores redirects to itself, to an unknown page or off the site', async () => {
    const rows = [
      row({ url: `${base}/en/a`, title: 'A' }),
      row({ url: `${base}/a`, title: 'Old A', statusCode: 301, finalUrl: `${base}/en/a` }),
      row({ url: `${base}/b`, title: 'B', statusCode: 301, finalUrl: `${base}/b` }),
      row({ url: `${base}/c`, title: 'C', statusCode: 301, finalUrl: `${base}/en/never-crawled` }),
      row({ url: `${base}/d`, title: 'D', statusCode: 301, finalUrl: 'https://elsewhere.test/d' }),
    ];
    const list = await service(audit(rows)).list(ACCOUNT, SITE, query);
    const byPath = new Map(list.items.map((item) => [new URL(item.url).pathname, item]));
    expect(byPath.get('/a')).toMatchObject({ title: 'Old A', redirectsTo: 'episodebrief.example/en/a' });
    for (const path of ['/b', '/c', '/d']) expect(byPath.get(path)).not.toHaveProperty('redirectsTo');
    expect(list.envelope.coverage).toMatchObject({ inventoryPages: 4, redirectPages: 1 });
  });

  it('does not fold a probe redirect into a page that is not listed', async () => {
    await seedGsc([{ url: `${base}/promo`, clicks: 1, impressions: 10, position: 5 }]);
    const rows = [row({ url: `${base}/en/promo`, title: 'Promo', isIndexable: false, nonIndexableReason: 'noindex' })];
    const probes: CoverageProbe[] = [
      {
        url: `${base}/promo`,
        source: 'search-console',
        statusCode: 301,
        finalUrl: `${base}/en/promo`,
        redirectChain: [{ url: `${base}/promo`, status: 301 }],
        contentType: 'text/html',
        failure: null,
      },
    ];
    const list = await service(audit(rows, probes)).list(ACCOUNT, SITE, query);
    expect(list.items[0]).toMatchObject({ redirectsTo: 'episodebrief.example/en/promo' });
    // The destination is not an inventory page, so the source still counts.
    expect(list.envelope.coverage).toMatchObject({ inventoryPages: 1, redirectPages: 0, measuredPages: 1 });
  });
});

describe('Pages counts — a known site keeps its numbers', () => {
  it('keeps "8 of 71" and the 38.5 weighted position with 128 URLs crawled', async () => {
    const pages = Array.from({ length: 71 }, (_, i) => `${base}/en/p${i}`);
    // Eight pages with equal impressions whose positions average 38.5.
    const positions = [30, 35, 38, 40, 41, 42, 40, 42];
    await seedGsc(pages.slice(0, 8).map((url, i) => ({ url, clicks: 1, impressions: 100, position: positions[i]! })));
    const canonical = pages.map((url, i) => row({ url, title: `P${i}` }));
    // 57 redirect sources group under their targets and leave the denominator.
    const redirects = Array.from({ length: 57 }, (_, i) =>
      row({ url: `${base}/old/p${i}`, statusCode: 301, finalUrl: pages[i] ?? null }),
    );
    const list = await service(audit([...canonical, ...redirects])).list(ACCOUNT, SITE, query);
    const { coverage } = list.envelope;
    expect(coverage).toMatchObject({
      auditRowsFetched: 128,
      inventoryPages: 71,
      measuredPages: 8,
      unmeasuredPages: 63,
      redirectPages: 57,
    });
    expect(list.summary.averagePosition).toBeCloseTo(38.5, 2);
    expect(list.pageInfo.totalInventory).toBe(71 + 57);
  });
});
