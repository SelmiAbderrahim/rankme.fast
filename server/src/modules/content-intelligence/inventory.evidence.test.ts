/**
 * Content inventory evidence loader tests (prompt 08).
 *
 * Real PGlite Postgres with the generated migrations applied by the shared
 * harness. Seeds GSC `query,page` snapshots + tracked keywords + rankings and
 * asserts the normalized `InventoryEvidence` shape the analysis consumes.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import { GSC_DIMENSION_KEY_SEPARATOR, gscSearchAnalytics } from '../../db/schema/gsc.js';
import { keywords, rankings } from '../../db/schema/keywords.js';
import {
  GSC_QUERY_PAGE_DIMENSION,
  GSC_QUERY_PAGE_WINDOW_DAYS,
  loadGscQueryPageEvidence,
  loadInventoryEvidence,
} from './inventory.evidence.js';
import { normalizeUrlKey } from './inventory.analysis.js';
import { Site } from '../sites/index.js';

const SITE = '000000000000000000000001';
const ACCOUNT = '000000000000000000000002';
const OTHER_SITE = '000000000000000000000003';

function db(): ApplicationDb {
  return getTestDb() as unknown as ApplicationDb;
}

async function seedGsc(input: {
  siteId?: string;
  snapshotDate: string;
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  position: number;
}) {
  await getTestDb()
    .insert(gscSearchAnalytics)
    .values({
      accountId: ACCOUNT,
      siteId: input.siteId ?? SITE,
      bindingGenerationId: 'legacy',
      snapshotDate: input.snapshotDate,
      dimensionSet: 'query,page',
      windowDays: 28,
      dimensionKey: `${input.query}${GSC_DIMENSION_KEY_SEPARATOR}${input.page}`,
      clicks: input.clicks,
      impressions: input.impressions,
      ctr: input.impressions > 0 ? input.clicks / input.impressions : 0,
      position: input.position,
    });
}

async function seedKeyword(input: {
  phrase: string;
  active?: boolean;
  siteId?: string;
}): Promise<string> {
  const rows = await getTestDb()
    .insert(keywords)
    .values({
      accountId: ACCOUNT,
      siteId: input.siteId ?? SITE,
      phrase: input.phrase,
      locationCode: 2840,
      languageCode: 'en',
      active: input.active ?? true,
    })
    .returning({ id: keywords.id });
  return rows[0]!.id;
}

async function seedRanking(input: {
  keywordId: string;
  foundUrl: string | null;
  position: number | null;
  checkedAt: Date;
}) {
  await getTestDb().insert(rankings).values({
    keywordId: input.keywordId,
    foundUrl: input.foundUrl,
    position: input.position,
    checkedAt: input.checkedAt,
    source: 'fresh',
  });
}

beforeAll(async () => {
  await startTestPostgres();
});
afterAll(async () => {
  await stopTestPostgres();
});
afterEach(async () => {
  await truncateAllTables();
});

describe('loadInventoryEvidence', () => {
  it('exposes the shipped 28-day query,page contract', () => {
    expect(GSC_QUERY_PAGE_DIMENSION).toBe('query,page');
    expect(GSC_QUERY_PAGE_WINDOW_DAYS).toBe(28);
  });

  it('returns empty maps when no GSC / keyword / rank rows exist', async () => {
    const evidence = await loadInventoryEvidence(db(), { siteId: SITE });
    expect(evidence.gscByUrl.size).toBe(0);
    expect(evidence.rankByQuery.size).toBe(0);
    expect(evidence.trackedQueries).toEqual([]);
  });

  it('returns no GSC evidence for an account-scoped site without a property', async () => {
    const lean = vi.fn().mockResolvedValue({
      gscPropertyUrl: null,
      gscBindingGenerationId: null,
    });
    const find = vi.spyOn(Site, 'findOne').mockReturnValue({
      select: vi.fn().mockReturnValue({ lean }),
    } as never);
    await expect(loadGscQueryPageEvidence(db(), {
      accountId: ACCOUNT,
      siteId: SITE,
    })).resolves.toEqual({ snapshotDate: null, gscByUrl: new Map() });
    expect(find).toHaveBeenCalled();
    find.mockRestore();
  });

  it('uses legacy and explicit binding generations for account-scoped reads', async () => {
    await seedGsc({
      snapshotDate: '2026-07-10',
      query: 'legacy query',
      page: 'https://example.com/legacy',
      clicks: 1,
      impressions: 10,
      position: 5,
    });
    await getTestDb().insert(gscSearchAnalytics).values({
      accountId: ACCOUNT,
      siteId: SITE,
      bindingGenerationId: 'generation-2',
      snapshotDate: '2026-07-11',
      dimensionSet: 'query,page',
      windowDays: 28,
      dimensionKey: `explicit query${GSC_DIMENSION_KEY_SEPARATOR}https://example.com/explicit`,
      clicks: 2,
      impressions: 20,
      ctr: 0.1,
      position: 4,
    });
    const lean = vi.fn()
      .mockResolvedValueOnce({
        gscPropertyUrl: 'sc-domain:example.com',
        gscBindingGenerationId: undefined,
      })
      .mockResolvedValueOnce({
        gscPropertyUrl: 'sc-domain:example.com',
        gscBindingGenerationId: 'generation-2',
      });
    const find = vi.spyOn(Site, 'findOne').mockReturnValue({
      select: vi.fn().mockReturnValue({ lean }),
    } as never);
    const legacy = await loadGscQueryPageEvidence(db(), {
      accountId: ACCOUNT,
      siteId: SITE,
    });
    const explicit = await loadGscQueryPageEvidence(db(), {
      accountId: ACCOUNT,
      siteId: SITE,
    });
    expect([...legacy.gscByUrl.values()].flat()[0]?.query).toBe('legacy query');
    expect([...explicit.gscByUrl.values()].flat()[0]?.query).toBe('explicit query');
    find.mockRestore();
  });

  it('groups the newest query,page snapshot rows per normalized page URL', async () => {
    // Older snapshot — must be ignored in favour of the newest date.
    await seedGsc({
      snapshotDate: '2026-07-01',
      query: 'old query',
      page: 'https://example.com/blog',
      clicks: 1,
      impressions: 10,
      position: 9,
    });
    await seedGsc({
      snapshotDate: '2026-07-10',
      query: 'seo audit',
      page: 'https://example.com/blog/',
      clicks: 3,
      impressions: 60,
      position: 4,
    });
    await seedGsc({
      snapshotDate: '2026-07-10',
      query: 'content audit',
      page: 'https://example.com/blog/',
      clicks: 2,
      impressions: 40,
      position: 6,
    });
    const evidence = await loadInventoryEvidence(db(), { siteId: SITE });
    const key = normalizeUrlKey('https://example.com/blog');
    expect(evidence.gscByUrl.get(key)?.map((r) => r.query).sort()).toEqual([
      'content audit',
      'seo audit',
    ]);
    // The 2026-07-01 snapshot's query is not present.
    expect([...evidence.gscByUrl.values()].flat().some((r) => r.query === 'old query')).toBe(
      false,
    );
  });

  it('can pin an exact older snapshot for a reproducible downstream run', async () => {
    await seedGsc({
      snapshotDate: '2026-07-01',
      query: 'old query',
      page: 'https://example.com/old',
      clicks: 1,
      impressions: 10,
      position: 8,
    });
    await seedGsc({
      snapshotDate: '2026-07-10',
      query: 'new query',
      page: 'https://example.com/new',
      clicks: 2,
      impressions: 20,
      position: 4,
    });
    const pinned = await loadGscQueryPageEvidence(db(), {
      siteId: SITE,
      snapshotDate: '2026-07-01',
    });
    expect(pinned.snapshotDate).toBe('2026-07-01');
    expect([...pinned.gscByUrl.values()].flat()[0]?.query).toBe('old query');
    const missing = await loadGscQueryPageEvidence(db(), {
      siteId: SITE,
      snapshotDate: '2025-01-01',
    });
    expect(missing.snapshotDate).toBe('2025-01-01');
    expect(missing.gscByUrl.size).toBe(0);
  });

  it('skips a malformed dimensionKey missing the separator', async () => {
    await getTestDb()
      .insert(gscSearchAnalytics)
      .values({
        accountId: ACCOUNT,
        siteId: SITE,
        bindingGenerationId: 'legacy',
        snapshotDate: '2026-07-10',
        dimensionSet: 'query,page',
        windowDays: 28,
        dimensionKey: 'no-separator-here',
        clicks: 1,
        impressions: 5,
        ctr: 0.2,
        position: 3,
      });
    const evidence = await loadInventoryEvidence(db(), { siteId: SITE });
    expect(evidence.gscByUrl.size).toBe(0);
  });

  it('skips a dimensionKey with an empty query or page segment', async () => {
    // Separator present but the query part is empty.
    await getTestDb()
      .insert(gscSearchAnalytics)
      .values({
        accountId: ACCOUNT,
        siteId: SITE,
        bindingGenerationId: 'legacy',
        snapshotDate: '2026-07-10',
        dimensionSet: 'query,page',
        windowDays: 28,
        dimensionKey: `${GSC_DIMENSION_KEY_SEPARATOR}https://example.com/x`,
        clicks: 1,
        impressions: 5,
        ctr: 0.2,
        position: 3,
      });
    await getTestDb()
      .insert(gscSearchAnalytics)
      .values({
        accountId: ACCOUNT,
        siteId: SITE,
        bindingGenerationId: 'legacy',
        snapshotDate: '2026-07-10',
        dimensionSet: 'query,page',
        windowDays: 28,
        dimensionKey: `query${GSC_DIMENSION_KEY_SEPARATOR}`,
        clicks: 1,
        impressions: 5,
        ctr: 0.2,
        position: 3,
      });
    const evidence = await loadInventoryEvidence(db(), { siteId: SITE });
    expect(evidence.gscByUrl.size).toBe(0);
  });

  it('collects active tracked queries and the latest ranking per keyword only', async () => {
    const kwActive = await seedKeyword({ phrase: 'seo audit' });
    await seedKeyword({ phrase: 'inactive term', active: false });
    // Two rankings for one keyword — only the newest (with URL) is kept.
    await seedRanking({
      keywordId: kwActive,
      foundUrl: 'https://example.com/old',
      position: 8,
      checkedAt: new Date('2026-07-01T00:00:00Z'),
    });
    await seedRanking({
      keywordId: kwActive,
      foundUrl: 'https://example.com/seo-guide',
      position: 2,
      checkedAt: new Date('2026-07-10T00:00:00Z'),
    });
    const evidence = await loadInventoryEvidence(db(), { siteId: SITE });
    expect(evidence.trackedQueries).toEqual(['seo audit']);
    const rank = evidence.rankByQuery.get('seo audit');
    expect(rank).toHaveLength(1);
    expect(rank?.[0]).toEqual({ url: 'https://example.com/seo-guide', position: 2 });
  });

  it('ignores rankings whose foundUrl/position is null', async () => {
    const kw = await seedKeyword({ phrase: 'no url term' });
    await seedRanking({
      keywordId: kw,
      foundUrl: null,
      position: null,
      checkedAt: new Date('2026-07-10T00:00:00Z'),
    });
    const evidence = await loadInventoryEvidence(db(), { siteId: SITE });
    expect(evidence.trackedQueries).toEqual(['no url term']);
    expect(evidence.rankByQuery.size).toBe(0);
  });

  it('scopes strictly to the requested site', async () => {
    await seedKeyword({ phrase: 'other-site term', siteId: OTHER_SITE });
    await seedGsc({
      siteId: OTHER_SITE,
      snapshotDate: '2026-07-10',
      query: 'other',
      page: 'https://other.com/x',
      clicks: 1,
      impressions: 1,
      position: 1,
    });
    const evidence = await loadInventoryEvidence(db(), { siteId: SITE });
    expect(evidence.trackedQueries).toEqual([]);
    expect(evidence.gscByUrl.size).toBe(0);
  });
});
