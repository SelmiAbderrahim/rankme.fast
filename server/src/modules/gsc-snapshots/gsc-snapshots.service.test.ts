/**
 * GSC snapshot repository tests — real generated migrations
 * against PGlite, per the drizzle-postgres-scope rule.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../db/client.js';
import { GSC_DIMENSION_KEY_SEPARATOR } from '../../db/schema/index.js';
import {
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import type { GscSitemapEntry } from '../../shared/providers/index.js';
import {
  readLatestSnapshotDate,
  readPreviousSnapshotTotals,
  readSearchAnalytics,
  readSitemaps,
  upsertSearchAnalytics,
  upsertSitemaps,
} from './gsc-snapshots.service.js';

let db: Db;

beforeAll(async () => {
  db = (await startTestPostgres()) as unknown as Db;
});

afterAll(async () => {
  await stopTestPostgres();
});

beforeEach(async () => {
  await truncateAllTables();
});

const SITE_A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const SITE_B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const ACCOUNT_A = '111111111111111111111111';
const ACCOUNT_B = '222222222222222222222222';

function saRow(key: string, clicks: number, impressions = clicks * 20) {
  return {
    keys: [key],
    clicks,
    impressions,
    ctr: impressions === 0 ? 0 : clicks / impressions,
    position: 5.5,
  };
}

function sitemapEntry(overrides: Partial<GscSitemapEntry> = {}): GscSitemapEntry {
  return {
    path: 'https://example.com/sitemap.xml',
    type: 'sitemap',
    lastSubmitted: new Date('2026-06-20T09:12:00.000Z'),
    lastDownloaded: new Date('2026-07-01T04:30:00.000Z'),
    isPending: false,
    isSitemapsIndex: false,
    errors: 0,
    warnings: 0,
    processed: 128,
    ...overrides,
  };
}

describe('upsertSearchAnalytics', () => {
  it('persists rows keyed by the joined dimension key', async () => {
    await upsertSearchAnalytics(db, {
      siteId: SITE_A,
      accountId: ACCOUNT_A,
      snapshotDate: '2026-07-04',
      dimensionSet: 'query',
      rows: [saRow('seo audit', 10), saRow('rank tracker', 4)],
    });
    const rows = await readSearchAnalytics(db, SITE_A, 'query');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      accountId: ACCOUNT_A,
      siteId: SITE_A,
      snapshotDate: '2026-07-04',
      dimensionSet: 'query',
      dimensionKey: 'seo audit',
      clicks: 10,
    });
  });

  it('re-run for the same snapshot replaces, never duplicates', async () => {
    const base = {
      siteId: SITE_A,
      accountId: ACCOUNT_A,
      snapshotDate: '2026-07-04',
      dimensionSet: 'query',
    };
    await upsertSearchAnalytics(db, {
      ...base,
      rows: [saRow('seo audit', 10), saRow('stale query', 2)],
    });
    await upsertSearchAnalytics(db, {
      ...base,
      rows: [saRow('seo audit', 12)],
    });
    const rows = await readSearchAnalytics(db, SITE_A, 'query');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ dimensionKey: 'seo audit', clicks: 12 });
  });

  it('deduplicates a duplicated key inside one batch (last wins)', async () => {
    await upsertSearchAnalytics(db, {
      siteId: SITE_A,
      accountId: ACCOUNT_A,
      snapshotDate: '2026-07-04',
      dimensionSet: 'query',
      rows: [saRow('dup', 1), saRow('dup', 9)],
    });
    const rows = await readSearchAnalytics(db, SITE_A, 'query');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.clicks).toBe(9);
  });

  it('multi-dimension keys join with the unit separator', async () => {
    await upsertSearchAnalytics(db, {
      siteId: SITE_A,
      accountId: ACCOUNT_A,
      snapshotDate: '2026-07-04',
      dimensionSet: 'query,page',
      rows: [
        {
          keys: ['seo audit', 'https://example.com/'],
          clicks: 3,
          impressions: 60,
          ctr: 0.05,
          position: 4.1,
        },
      ],
    });
    const rows = await readSearchAnalytics(db, SITE_A, 'query,page');
    expect(rows[0]!.dimensionKey).toBe(
      `seo audit${GSC_DIMENSION_KEY_SEPARATOR}https://example.com/`,
    );
  });

  it('an empty row set clears the snapshot', async () => {
    const base = {
      siteId: SITE_A,
      accountId: ACCOUNT_A,
      snapshotDate: '2026-07-04',
      dimensionSet: 'query',
    };
    await upsertSearchAnalytics(db, { ...base, rows: [saRow('seo audit', 10)] });
    await upsertSearchAnalytics(db, { ...base, rows: [] });
    expect(await readSearchAnalytics(db, SITE_A, 'query')).toEqual([]);
  });
});

describe('readSearchAnalytics', () => {
  it('orders by snapshotDate ASC then clicks DESC and honours the range', async () => {
    for (const [date, rows] of [
      ['2026-06-01', [saRow('a', 1)]],
      ['2026-07-04', [saRow('low', 2), saRow('high', 30)]],
      ['2026-06-15', [saRow('mid', 5)]],
    ] as const) {
      await upsertSearchAnalytics(db, {
        siteId: SITE_A,
        accountId: ACCOUNT_A,
        snapshotDate: date,
        dimensionSet: 'query',
        rows: [...rows],
      });
    }
    const all = await readSearchAnalytics(db, SITE_A, 'query');
    expect(all.map((r) => [r.snapshotDate, r.dimensionKey])).toEqual([
      ['2026-06-01', 'a'],
      ['2026-06-15', 'mid'],
      ['2026-07-04', 'high'],
      ['2026-07-04', 'low'],
    ]);
    const ranged = await readSearchAnalytics(db, SITE_A, 'query', {
      since: '2026-06-10',
      until: '2026-06-30',
    });
    expect(ranged.map((r) => r.dimensionKey)).toEqual(['mid']);
  });

  it('cross-site isolation: site A reads never return site B rows', async () => {
    await upsertSearchAnalytics(db, {
      siteId: SITE_A,
      accountId: ACCOUNT_A,
      snapshotDate: '2026-07-04',
      dimensionSet: 'query',
      rows: [saRow('a-only', 1)],
    });
    await upsertSearchAnalytics(db, {
      siteId: SITE_B,
      accountId: ACCOUNT_B,
      snapshotDate: '2026-07-04',
      dimensionSet: 'query',
      rows: [saRow('b-only', 2)],
    });
    const rows = await readSearchAnalytics(db, SITE_A, 'query');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.dimensionKey).toBe('a-only');
  });
});

describe('readLatestSnapshotDate', () => {
  it('returns the newest date for the site + dimension set, null when empty', async () => {
    expect(await readLatestSnapshotDate(db, SITE_A, 'query')).toBeNull();
    for (const date of ['2026-06-01', '2026-07-04', '2026-06-15']) {
      await upsertSearchAnalytics(db, {
        siteId: SITE_A,
        accountId: ACCOUNT_A,
        snapshotDate: date,
        dimensionSet: 'query',
        rows: [saRow('k', 1)],
      });
    }
    expect(await readLatestSnapshotDate(db, SITE_A, 'query')).toBe('2026-07-04');
    expect(await readLatestSnapshotDate(db, SITE_A, 'page')).toBeNull();
  });
});

describe('readPreviousSnapshotTotals', () => {
  it('returns summed totals of the newest snapshot before the date, null on first run', async () => {
    expect(
      await readPreviousSnapshotTotals(db, SITE_A, 'query', '2026-07-04'),
    ).toBeNull();
    await upsertSearchAnalytics(db, {
      siteId: SITE_A,
      accountId: ACCOUNT_A,
      snapshotDate: '2026-06-01',
      dimensionSet: 'query',
      rows: [saRow('a', 3, 100), saRow('b', 7, 200)],
    });
    await upsertSearchAnalytics(db, {
      siteId: SITE_A,
      accountId: ACCOUNT_A,
      snapshotDate: '2026-06-20',
      dimensionSet: 'query',
      rows: [saRow('a', 5, 150)],
    });
    // Rows AT the boundary date are excluded (strictly before).
    await upsertSearchAnalytics(db, {
      siteId: SITE_A,
      accountId: ACCOUNT_A,
      snapshotDate: '2026-07-04',
      dimensionSet: 'query',
      rows: [saRow('a', 99, 999)],
    });
    expect(
      await readPreviousSnapshotTotals(db, SITE_A, 'query', '2026-07-04'),
    ).toEqual({ snapshotDate: '2026-06-20', clicks: 5, impressions: 150 });
    // Different dimension set is invisible.
    expect(
      await readPreviousSnapshotTotals(db, SITE_A, 'page', '2026-07-04'),
    ).toBeNull();
    // Cross-site isolation.
    expect(
      await readPreviousSnapshotTotals(db, SITE_B, 'query', '2026-07-04'),
    ).toBeNull();
  });
});

describe('upsertSitemaps + readSitemaps', () => {
  it('persists entries and reads the latest snapshot by default', async () => {
    await upsertSitemaps(db, {
      siteId: SITE_A,
      accountId: ACCOUNT_A,
      snapshotDate: '2026-06-01',
      entries: [sitemapEntry({ path: 'https://example.com/old.xml' })],
    });
    await upsertSitemaps(db, {
      siteId: SITE_A,
      accountId: ACCOUNT_A,
      snapshotDate: '2026-07-04',
      entries: [
        sitemapEntry(),
        sitemapEntry({
          path: 'https://example.com/broken.xml',
          errors: 2,
          warnings: 1,
          processed: 0,
          lastDownloaded: null,
        }),
      ],
    });
    const latest = await readSitemaps(db, SITE_A);
    expect(latest).toHaveLength(2);
    // Ordered by path.
    expect(latest.map((s) => s.path)).toEqual([
      'https://example.com/broken.xml',
      'https://example.com/sitemap.xml',
    ]);
    expect(latest[0]).toMatchObject({ errors: 2, warnings: 1, processed: 0 });
    expect(latest[0]!.lastDownloaded).toBeNull();
    const old = await readSitemaps(db, SITE_A, '2026-06-01');
    expect(old.map((s) => s.path)).toEqual(['https://example.com/old.xml']);
  });

  it('re-run replaces the snapshot (idempotent, no duplicates)', async () => {
    const base = { siteId: SITE_A, accountId: ACCOUNT_A, snapshotDate: '2026-07-04' };
    await upsertSitemaps(db, {
      ...base,
      entries: [sitemapEntry(), sitemapEntry({ path: 'https://example.com/gone.xml' })],
    });
    await upsertSitemaps(db, { ...base, entries: [sitemapEntry({ errors: 5 })] });
    const rows = await readSitemaps(db, SITE_A, '2026-07-04');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      path: 'https://example.com/sitemap.xml',
      errors: 5,
    });
  });

  it('deduplicates a duplicated path inside one batch (last wins)', async () => {
    await upsertSitemaps(db, {
      siteId: SITE_A,
      accountId: ACCOUNT_A,
      snapshotDate: '2026-07-04',
      entries: [sitemapEntry({ errors: 1 }), sitemapEntry({ errors: 7 })],
    });
    const rows = await readSitemaps(db, SITE_A, '2026-07-04');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.errors).toBe(7);
  });

  it('empty entries clears the snapshot; empty site reads []', async () => {
    const base = { siteId: SITE_A, accountId: ACCOUNT_A, snapshotDate: '2026-07-04' };
    await upsertSitemaps(db, { ...base, entries: [sitemapEntry()] });
    await upsertSitemaps(db, { ...base, entries: [] });
    expect(await readSitemaps(db, SITE_A, '2026-07-04')).toEqual([]);
    expect(await readSitemaps(db, SITE_B)).toEqual([]);
  });

  it('cross-site isolation on sitemap reads', async () => {
    await upsertSitemaps(db, {
      siteId: SITE_A,
      accountId: ACCOUNT_A,
      snapshotDate: '2026-07-04',
      entries: [sitemapEntry({ path: 'https://a.example/s.xml' })],
    });
    await upsertSitemaps(db, {
      siteId: SITE_B,
      accountId: ACCOUNT_B,
      snapshotDate: '2026-07-04',
      entries: [sitemapEntry({ path: 'https://b.example/s.xml' })],
    });
    const rows = await readSitemaps(db, SITE_A);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.path).toBe('https://a.example/s.xml');
  });
});
