/**
 * Cache repo, service, and route tests for the new
 * gap / overview / trends / preview keyword-intelligence operations.
 *
 * Kept in a dedicated file (not folded into the shipped routes/service tests)
 * so a bisect on the sub-prompt reads cleanly.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../../app.js';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import {
  installTestAuth,
  signupVerifiedUser,
  uninstallTestAuth,
} from '../../shared/testing/auth.js';
import { vendorCache, vendorResponses } from '../../db/schema/vendor-cache.js';
import { keywordResearchHistory } from '../../db/schema/keyword-research-history.js';
import {
  createFakeCompetitorProvider,
  createFakeKeywordProvider,
  recordVendorCostUsd,
  VendorUnavailableError,
  type CompetitorProvider,
  type KeywordHistoricalVolume,
  type KeywordOverview,
  type KeywordProvider,
  type DomainComparisonResult,
} from '../../shared/providers/index.js';
import {
  setKeywordProvider,
  setKeywordResearchCompetitorProvider,
  setKeywordResearchDb,
} from './keyword-research.holder.js';
import {
  computeGapCacheKey,
  createKeywordCacheRepo,
  normalizeCacheDomain,
} from './keyword-research.cache.js';
import {
  GAP_LIMIT_PER_PAIR,
  computeTrendSummary,
  getGapCached,
  getOverviewCached,
  getTrendsCached,
  normalizeSerpFeatures,
} from './keyword-research.service.js';

const NOW = new Date('2026-07-01T00:00:00.000Z');

function makeDeps(overrides: {
  provider: KeywordProvider;
  competitorProvider?: CompetitorProvider;
  now?: () => Date;
}) {
  return {
    db: getTestDb() as never,
    provider: overrides.provider,
    competitorProvider: overrides.competitorProvider,
    ttlDays: 30,
    now: overrides.now ?? (() => NOW),
  };
}

// ---------------------------------------------------------------------------
// Cache key math + normalization
// ---------------------------------------------------------------------------

describe('computeGapCacheKey', () => {
  it('normalizes domain to lowercase + strips trailing dot', () => {
    const a = computeGapCacheKey({
      ownDomain: 'Example.COM.',
      competitorDomain: 'RIVAL.example',
      locationCode: 2840,
      languageCode: 'EN',
    });
    const b = computeGapCacheKey({
      ownDomain: 'example.com',
      competitorDomain: 'rival.example',
      locationCode: 2840,
      languageCode: 'en',
    });
    expect(a).toBe(b);
  });

  it('pair order matters — different competitor → different key', () => {
    const a = computeGapCacheKey({
      ownDomain: 'example.com',
      competitorDomain: 'rival-a.example',
      locationCode: 2840,
      languageCode: 'en',
    });
    const b = computeGapCacheKey({
      ownDomain: 'example.com',
      competitorDomain: 'rival-b.example',
      locationCode: 2840,
      languageCode: 'en',
    });
    expect(a).not.toBe(b);
  });
});

describe('normalizeSerpFeatures', () => {
  it('empty / null input → []', () => {
    expect(normalizeSerpFeatures(undefined)).toEqual([]);
    expect(normalizeSerpFeatures([])).toEqual([]);
  });

  it('unknown feature strings map to "other" (never dropped)', () => {
    expect(normalizeSerpFeatures(['ai_overview', 'weather_widget'])).toEqual([
      'ai_overview',
      'other',
    ]);
  });

  it('preserves order and dedupes duplicates', () => {
    expect(
      normalizeSerpFeatures(['video', 'video', 'featured_snippet', 'video']),
    ).toEqual(['video', 'featured_snippet']);
  });
});

// ---------------------------------------------------------------------------
// Deterministic trend math (spec 13 §5.3)
// ---------------------------------------------------------------------------

describe('computeTrendSummary', () => {
  it('empty series → all null', () => {
    expect(computeTrendSummary([])).toEqual({
      yoyDelta: null,
      twelveMonthMomentum: null,
      seasonalityFlags: { peakMonth: null, troughMonth: null },
    });
  });

  it('sparse (<13 months) series → yoyDelta null, momentum null, seasonality null', () => {
    const series = Array.from({ length: 6 }, (_, i) => ({
      year: 2025,
      month: i + 1,
      searchVolume: 100 + i,
    }));
    const out = computeTrendSummary(series);
    expect(out.yoyDelta).toBeNull();
    expect(out.twelveMonthMomentum).toBeNull();
    expect(out.seasonalityFlags).toEqual({ peakMonth: null, troughMonth: null });
  });

  it('13-month series → yoyDelta set, momentum null, seasonality null', () => {
    const series: { year: number; month: number; searchVolume: number }[] = [];
    for (let i = 0; i < 13; i += 1) {
      series.push({ year: 2024, month: i + 1, searchVolume: 100 + i * 10 });
    }
    // latest = 220 (idx 12), twelveEarlier = 100 (idx 0) → (220-100)/100 = 1.2
    const out = computeTrendSummary(series);
    expect(out.yoyDelta).toBe(1.2);
    expect(out.twelveMonthMomentum).toBeNull();
    expect(out.seasonalityFlags).toEqual({ peakMonth: null, troughMonth: null });
  });

  it('yoy division-by-zero guard: earlier bucket was 0 → yoyDelta null', () => {
    const series: { year: number; month: number; searchVolume: number }[] = [];
    for (let i = 0; i < 13; i += 1) {
      series.push({ year: 2024, month: i + 1, searchVolume: i === 0 ? 0 : 50 });
    }
    expect(computeTrendSummary(series).yoyDelta).toBeNull();
  });

  it('full 36-month series → yoy, momentum, and seasonality all populated', () => {
    // Deterministic seasonal ripple identical to the fake fixture: months
    // in [Oct..Feb] get +200 lift so the peak lands in month 12 (December).
    const series: { year: number; month: number; searchVolume: number }[] = [];
    for (let year = 2023; year <= 2025; year += 1) {
      for (let month = 1; month <= 12; month += 1) {
        const offset = (year - 2023) * 12 + (month - 1);
        const seasonal = month >= 10 || month <= 2 ? 200 : 0;
        series.push({ year, month, searchVolume: 100 + offset * 10 + seasonal });
      }
    }
    const out = computeTrendSummary(series);
    expect(out.yoyDelta).not.toBeNull();
    expect(out.twelveMonthMomentum).not.toBeNull();
    // Peak is a winter month (Nov/Dec/Jan/Feb/Oct), trough is a summer month
    // (Mar..Sep). We assert set membership because two months can tie on mean.
    const winter = new Set([10, 11, 12, 1, 2]);
    const summer = new Set([3, 4, 5, 6, 7, 8, 9]);
    expect(winter.has(out.seasonalityFlags.peakMonth as number)).toBe(true);
    expect(summer.has(out.seasonalityFlags.troughMonth as number)).toBe(true);
  });

  it('seasonality: 24+ rows but no month with ≥2 samples → both seasonal flags null', () => {
    // Construct a 24-row series across 24 DIFFERENT months (2 non-overlapping
    // years of month indices) so every calendar-month bucket has exactly one
    // sample; the ≥2-samples filter excludes all of them and `eligible` = 0.
    const series: { year: number; month: number; searchVolume: number }[] = [];
    // Year 2024 months 1..12 (12 rows), year 2025 months 13-shaped as fake
    // "month" values BUT computeTrendSummary buckets by `month` field only —
    // so we need distinct month numbers in a synthetic series. Since valid
    // month numbers are 1..12, the only way to get eligible=0 is a synthetic
    // series where each `month` value is unique across the 24 rows. Use
    // 1..24 with month wrapping to satisfy the length check but no repeats.
    for (let i = 0; i < 24; i += 1) {
      // Fabricated month values 100..123 keep buckets singleton-only —
      // no natural month index collides so `count === 1` for every bucket.
      series.push({ year: 2024, month: 100 + i, searchVolume: 50 });
    }
    expect(computeTrendSummary(series).seasonalityFlags).toEqual({
      peakMonth: null,
      troughMonth: null,
    });
  });

  it('momentum division-by-zero guard: prior 12-month sum is 0 → momentum null', () => {
    const series: { year: number; month: number; searchVolume: number }[] = [];
    for (let i = 0; i < 24; i += 1) {
      // The first 12 months are all zero → prior sum = 0.
      series.push({ year: 2024, month: (i % 12) + 1, searchVolume: i < 12 ? 0 : 50 });
    }
    expect(computeTrendSummary(series).twelveMonthMomentum).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Cache repo — stale-shape → miss for each new op
// ---------------------------------------------------------------------------

describe('cache repo — stale-shape reads as miss', () => {
  beforeAll(async () => {
    await startTestPostgres();
  });
  afterAll(async () => {
    await stopTestPostgres();
  });
  beforeEach(async () => {
    await truncateAllTables();
  });

  it('overview: garbage payload → miss', async () => {
    const db = getTestDb();
    await db.insert(vendorCache).values({
      capability: 'keyword',
      operation: 'overview',
      cacheKey: 'k-1',
      params: {},
      payload: { random: true },
      fetchedAt: NOW,
      expiresAt: new Date(NOW.getTime() + 60_000),
    });
    const repo = createKeywordCacheRepo(db as never);
    const hits = await repo.readOverviewMany(['k-1'], NOW);
    expect(hits.size).toBe(0);
  });

  it('trends: garbage payload → miss', async () => {
    const db = getTestDb();
    await db.insert(vendorCache).values({
      capability: 'keyword',
      operation: 'trends',
      cacheKey: 'k-2',
      params: {},
      payload: {},
      fetchedAt: NOW,
      expiresAt: new Date(NOW.getTime() + 60_000),
    });
    const repo = createKeywordCacheRepo(db as never);
    const hits = await repo.readTrendsMany(['k-2'], NOW);
    expect(hits.size).toBe(0);
  });

  it('gap: garbage payload → miss', async () => {
    const db = getTestDb();
    await db.insert(vendorCache).values({
      capability: 'keyword',
      operation: 'gap',
      cacheKey: 'k-3',
      params: {},
      payload: { rows: 'not-an-array' },
      fetchedAt: NOW,
      expiresAt: new Date(NOW.getTime() + 60_000),
    });
    const repo = createKeywordCacheRepo(db as never);
    const hits = await repo.readGapMany(['k-3'], NOW);
    expect(hits.size).toBe(0);
  });

  it('batched read: empty input → empty map (no round trip)', async () => {
    const repo = createKeywordCacheRepo(getTestDb() as never);
    expect((await repo.readOverviewMany([], NOW)).size).toBe(0);
    expect((await repo.readTrendsMany([], NOW)).size).toBe(0);
    expect((await repo.readGapMany([], NOW)).size).toBe(0);
  });

  it('overview: observedAtIso null → observedAt null on read (falsy branch)', async () => {
    const db = getTestDb();
    await db.insert(vendorCache).values({
      capability: 'keyword',
      operation: 'overview',
      cacheKey: 'k-noobs',
      params: {},
      payload: {
        phrase: 'p',
        searchVolume: null,
        difficulty: null,
        cpcMicros: null,
        intent: null,
        serpFeatures: [],
        observedAtIso: null,
        resultsCount: null,
      },
      fetchedAt: NOW,
      expiresAt: new Date(NOW.getTime() + 60_000),
    });
    const repo = createKeywordCacheRepo(db as never);
    const hits = await repo.readOverviewMany(['k-noobs'], NOW);
    expect(hits.get('k-noobs')!.observedAt).toBeNull();
  });

  it('overview: observedAtIso ISO → Date on read (truthy branch)', async () => {
    const db = getTestDb();
    const iso = '2026-06-01T00:00:00.000Z';
    await db.insert(vendorCache).values({
      capability: 'keyword',
      operation: 'overview',
      cacheKey: 'k-obs',
      params: {},
      payload: {
        phrase: 'p',
        searchVolume: 1,
        difficulty: 2,
        cpcMicros: 3,
        intent: null,
        serpFeatures: ['ai_overview'],
        observedAtIso: iso,
        resultsCount: 4,
      },
      fetchedAt: NOW,
      expiresAt: new Date(NOW.getTime() + 60_000),
    });
    const repo = createKeywordCacheRepo(db as never);
    const hits = await repo.readOverviewMany(['k-obs'], NOW);
    expect(hits.get('k-obs')!.observedAt?.toISOString()).toBe(iso);
  });

  it('expired rows are excluded at read time', async () => {
    const db = getTestDb();
    const past = new Date(NOW.getTime() - 60_000);
    await db.insert(vendorCache).values({
      capability: 'keyword',
      operation: 'overview',
      cacheKey: 'k-expired',
      params: {},
      payload: {
        phrase: 'x',
        searchVolume: null,
        difficulty: null,
        cpcMicros: null,
        intent: null,
        serpFeatures: [],
        observedAtIso: null,
        resultsCount: null,
      },
      fetchedAt: past,
      expiresAt: past,
    });
    const repo = createKeywordCacheRepo(db as never);
    const hits = await repo.readOverviewMany(['k-expired'], NOW);
    expect(hits.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Service — cache-first + cost allocation + provider-error wrap
// ---------------------------------------------------------------------------

describe('getOverviewCached', () => {
  beforeAll(async () => {
    await startTestPostgres();
  });
  afterAll(async () => {
    await stopTestPostgres();
  });
  beforeEach(async () => {
    await truncateAllTables();
  });

  it('deduped miss → one vendor call, one row per phrase, cost split across rows', async () => {
    const provider = createFakeKeywordProvider();
    // Wrap getOverview to also record vendor cost + count invocations.
    const spy = vi.fn(async (kws: string[], loc: number, lang: string): Promise<KeywordOverview[]> => {
      recordVendorCostUsd(0.06); // 60_000 micros → 20_000 per phrase for 3
      return provider.getOverview(kws, loc, lang);
    });
    const results = await getOverviewCached(
      { keywords: ['seo audit tool', 'seo audit tool', ' SEO AUDIT TOOL '], locationCode: 2840, languageCode: 'en' },
      makeDeps({ provider: { ...provider, getOverview: spy } }),
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(1);
    expect(results[0]!.keyword).toBe('seo audit tool');
    expect(results[0]!.cached).toBe(false);
    expect(results[0]!.meta.kind).toBe('provider_observation');
    expect(results[0]!.meta.market.locationCode).toBe(2840);
  });

  it('cache hit on second call for same phrase (locale-normalized)', async () => {
    const provider = createFakeKeywordProvider();
    const spy = vi.fn(provider.getOverview.bind(provider));
    const deps = makeDeps({ provider: { ...provider, getOverview: spy } });
    await getOverviewCached(
      { keywords: ['seo audit tool'], locationCode: 2840, languageCode: 'en' },
      deps,
    );
    const second = await getOverviewCached(
      { keywords: ['seo audit tool'], locationCode: 2840, languageCode: 'EN' },
      deps,
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(second[0]!.cached).toBe(true);
  });

  it('unknown SERP feature strings normalize to "other" in the cached payload', async () => {
    const custom: KeywordOverview[] = [
      {
        keyword: 'x',
        searchVolume: 100,
        difficulty: 20,
        cpc: 1.5,
        intent: 'commercial',
        serpFeatures: ['ai_overview', 'weather_widget' as never, 'ai_overview'],
        observedAt: null,
        resultsCount: 42,
      },
    ];
    const provider: KeywordProvider = {
      ...createFakeKeywordProvider(),
      getOverview: async () => custom,
    };
    const [row] = await getOverviewCached(
      { keywords: ['x'], locationCode: 1, languageCode: 'en' },
      makeDeps({ provider }),
    );
    expect(row!.serpFeatures).toEqual(['ai_overview', 'other']);
  });

  it('provider throw wraps as localized HttpError 503', async () => {
    const provider: KeywordProvider = {
      ...createFakeKeywordProvider(),
      getOverview: async () => {
        throw new VendorUnavailableError('down', { provider: 'x', operation: 'y' });
      },
    };
    await expect(
      getOverviewCached(
        { keywords: ['x'], locationCode: 1, languageCode: 'en' },
        makeDeps({ provider }),
      ),
    ).rejects.toMatchObject({
      status: 503,
      message: 'keywordResearch.errors.unavailable',
    });
  });

  it('cache hit for a keyword whose vendor observedAt was null → observedAt stays null', async () => {
    // 'obscure long-tail phrase' in the fake fixture has observedAt: null;
    // running twice hits the cache path and the falsy `row.observedAt ? ... :
    // null` branch inside `overviewFromCache`.
    const provider = createFakeKeywordProvider();
    const deps = makeDeps({ provider });
    await getOverviewCached(
      { keywords: ['obscure long-tail phrase'], locationCode: 2840, languageCode: 'en' },
      deps,
    );
    const [row] = await getOverviewCached(
      { keywords: ['obscure long-tail phrase'], locationCode: 2840, languageCode: 'en' },
      deps,
    );
    expect(row!.cached).toBe(true);
    expect(row!.observedAt).toBeNull();
  });

  it('vendor omits a keyword → phrase reported with null fields (never dropped)', async () => {
    // Vendor returns ONLY one of the two requested phrases; the other is
    // omitted (mirrors the DataForSEO "no result" behavior). The service
    // must still emit a row for the missing phrase with everything null.
    const provider: KeywordProvider = {
      ...createFakeKeywordProvider(),
      getOverview: async () => [
        {
          keyword: 'known',
          searchVolume: 10,
          difficulty: 5,
          cpc: null,
          intent: null,
          serpFeatures: [],
          observedAt: null,
          resultsCount: null,
        },
      ],
    };
    const results = await getOverviewCached(
      { keywords: ['known', 'omitted'], locationCode: 1, languageCode: 'en' },
      makeDeps({ provider }),
    );
    expect(results).toHaveLength(2);
    const omitted = results.find((r) => r.keyword === 'omitted');
    expect(omitted).toBeDefined();
    expect(omitted!.searchVolume).toBeNull();
    expect(omitted!.serpFeatures).toEqual([]);
  });
});

describe('getTrendsCached', () => {
  beforeAll(async () => {
    await startTestPostgres();
  });
  afterAll(async () => {
    await stopTestPostgres();
  });
  beforeEach(async () => {
    await truncateAllTables();
  });

  it('vendor call → cached payload, trend summary derived deterministically', async () => {
    const provider = createFakeKeywordProvider();
    const spy = vi.fn(provider.getHistoricalVolume.bind(provider));
    const deps = makeDeps({ provider: { ...provider, getHistoricalVolume: spy } });
    const first = await getTrendsCached(
      { keywords: ['seo audit tool'], locationCode: 2840, languageCode: 'en' },
      deps,
    );
    expect(spy).toHaveBeenCalledTimes(1);
    // Fake ships 48 months of ascending data for this keyword.
    expect(first[0]!.monthlySearches.length).toBeGreaterThan(24);
    expect(first[0]!.trends.yoyDelta).not.toBeNull();
    expect(first[0]!.trends.twelveMonthMomentum).not.toBeNull();
    expect(first[0]!.meta.kind).toBe('estimate');
    // Repeat is a cache hit.
    const second = await getTrendsCached(
      { keywords: ['seo audit tool'], locationCode: 2840, languageCode: 'en' },
      deps,
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(second[0]!.cached).toBe(true);
  });

  it('sparse-series keyword → cached payload, all trend fields null', async () => {
    const custom: KeywordHistoricalVolume[] = [
      { keyword: 'short-history', monthlySearches: [{ year: 2025, month: 1, searchVolume: 10 }] },
    ];
    const provider: KeywordProvider = {
      ...createFakeKeywordProvider(),
      getHistoricalVolume: async () => custom,
    };
    const [row] = await getTrendsCached(
      { keywords: ['short-history'], locationCode: 1, languageCode: 'en' },
      makeDeps({ provider }),
    );
    expect(row!.trends).toEqual({
      yoyDelta: null,
      twelveMonthMomentum: null,
      seasonalityFlags: { peakMonth: null, troughMonth: null },
    });
  });

  it('provider throw wraps as localized HttpError 503', async () => {
    const provider: KeywordProvider = {
      ...createFakeKeywordProvider(),
      getHistoricalVolume: async () => {
        throw new VendorUnavailableError('down', { provider: 'x', operation: 'y' });
      },
    };
    await expect(
      getTrendsCached(
        { keywords: ['x'], locationCode: 1, languageCode: 'en' },
        makeDeps({ provider }),
      ),
    ).rejects.toMatchObject({ status: 503 });
  });

  it('vendor omits a keyword → row still reported with empty monthly series', async () => {
    // Same "never dropped" contract as overview above. The vendor returns
    // ONLY the phrase it has data for; the other is omitted. The service
    // must still emit a trends row for it.
    const provider: KeywordProvider = {
      ...createFakeKeywordProvider(),
      getHistoricalVolume: async (): Promise<KeywordHistoricalVolume[]> => [
        { keyword: 'known', monthlySearches: [] },
      ],
    };
    const results = await getTrendsCached(
      { keywords: ['known', 'omitted'], locationCode: 1, languageCode: 'en' },
      makeDeps({ provider }),
    );
    expect(results).toHaveLength(2);
    const omitted = results.find((r) => r.keyword === 'omitted');
    expect(omitted).toBeDefined();
    expect(omitted!.monthlySearches).toEqual([]);
    expect(omitted!.trends).toEqual({
      yoyDelta: null,
      twelveMonthMomentum: null,
      seasonalityFlags: { peakMonth: null, troughMonth: null },
    });
  });
});

describe('getGapCached', () => {
  beforeAll(async () => {
    await startTestPostgres();
  });
  afterAll(async () => {
    await stopTestPostgres();
  });
  beforeEach(async () => {
    await truncateAllTables();
  });

  it('missing competitorProvider throws a clear runtime error', async () => {
    const provider = createFakeKeywordProvider();
    await expect(
      getGapCached(
        {
          ownDomain: 'example.com',
          competitors: ['rival.example'],
          locationCode: 2840,
          languageCode: 'en',
        },
        makeDeps({ provider }),
      ),
    ).rejects.toThrow(/competitorProvider is required/);
  });

  it('one corrected comparison per competitor pair, bounded by the provider leg limit', async () => {
    const provider = createFakeKeywordProvider();
    const competitorProvider = createFakeCompetitorProvider();
    const template = (
      await competitorProvider.compareDomains({
        ownedDomain: 'example.com',
        ownedOrigin: 'https://example.com',
        competitorDomain: 'rival.example',
        competitorOrigin: 'https://rival.example',
        locationCode: 2840,
        languageCode: 'en',
      })
    ).competitorOnly[0]!;
    const oversized = Array.from({ length: 250 }, (_, i) => ({
      ...template,
      keyword: `k-${i}`,
      normalizedKeyword: `k-${i}`,
      competitorPosition: i + 1,
      competitorRankAbsolute: i + 2,
      searchVolume: 10 + i,
    }));
    const spy = vi.fn(async (): Promise<DomainComparisonResult> => ({
      shared: [],
      ownedOnly: [],
      competitorOnly: oversized,
    }));
    const wrapped: CompetitorProvider = {
      ...competitorProvider,
      compareDomains: spy,
    };
    const out = await getGapCached(
      {
        ownDomain: 'example.com',
        competitors: ['rival-a.example', 'rival-b.example'],
        locationCode: 2840,
        languageCode: 'en',
      },
      makeDeps({ provider, competitorProvider: wrapped }),
    );
    expect(spy).toHaveBeenCalledTimes(2);
    expect(out.pairs).toHaveLength(2);
    expect(out.pairs[0]!.rows).toHaveLength(Math.min(GAP_LIMIT_PER_PAIR, 100));
    expect(out.pairs[0]!.rows[0]).toMatchObject({
      ownPosition: null,
      class: 'missing',
    });
  });

  it('normalizes nullable comparison provenance without inventing an observation time', async () => {
    const provider = createFakeKeywordProvider();
    const competitorProvider = createFakeCompetitorProvider();
    const template = (
      await competitorProvider.compareDomains({
        ownedDomain: 'example.com',
        ownedOrigin: 'https://example.com',
        competitorDomain: 'rival.example',
        competitorOrigin: 'https://rival.example',
        locationCode: 2840,
        languageCode: 'en',
      })
    ).competitorOnly[0]!;
    const comparison: DomainComparisonResult = {
      shared: [],
      ownedOnly: [],
      competitorOnly: [
        {
          ...template,
          observationMeta: {
            ...template.observationMeta,
            sourceLabel: null,
            observedAt: '',
          },
        },
      ],
    };
    const out = await getGapCached(
      {
        ownDomain: 'example.com',
        competitors: ['rival.example'],
        locationCode: 2840,
        languageCode: 'en',
      },
      makeDeps({
        provider,
        competitorProvider: createFakeCompetitorProvider({ comparison }),
      }),
    );
    expect(out.pairs[0]!.rows[0]!.provenance).toMatchObject({
      provider: 'dataforseo',
      capturedAt: null,
      truncated: false,
    });
  });

  it('keeps the pre-landscape domain-intersection adapter compatible', async () => {
    const provider = createFakeKeywordProvider();
    const { compareDomains: _compareDomains, ...legacyProvider } =
      createFakeCompetitorProvider();
    const intersection = vi.spyOn(legacyProvider, 'getDomainIntersection');
    const out = await getGapCached(
      {
        ownDomain: 'example.com',
        competitors: ['rival.example'],
        locationCode: 2840,
        languageCode: 'en',
      },
      makeDeps({ provider, competitorProvider: legacyProvider }),
    );
    expect(intersection).toHaveBeenCalledWith('rival.example', 'example.com', {
      locationCode: 2840,
      languageCode: 'en',
      limit: 100,
    });
    expect(out.pairs[0]!.rows[0]).toMatchObject({
      keyword: 'seo audit tool',
      competitorPosition: null,
      provenance: {
        provider: 'dataforseo',
        cache: 'miss',
        capturedAt: null,
      },
    });
  });

  it('second call for the same pair is a cache hit — vendor spy not invoked again', async () => {
    const provider = createFakeKeywordProvider();
    const competitorProvider = createFakeCompetitorProvider();
    const spy = vi.fn(competitorProvider.compareDomains.bind(competitorProvider));
    const wrapped: CompetitorProvider = { ...competitorProvider, compareDomains: spy };
    const deps = makeDeps({ provider, competitorProvider: wrapped });
    await getGapCached(
      { ownDomain: 'example.com', competitors: ['rival.example'], locationCode: 1, languageCode: 'en' },
      deps,
    );
    const second = await getGapCached(
      { ownDomain: 'example.com', competitors: ['rival.example'], locationCode: 1, languageCode: 'en' },
      deps,
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(second.pairs[0]!.cached).toBe(true);
  });

  it('domain normalization is applied consistently (trailing dot, casing)', async () => {
    const provider = createFakeKeywordProvider();
    const competitorProvider = createFakeCompetitorProvider();
    const deps = makeDeps({ provider, competitorProvider });
    const out = await getGapCached(
      { ownDomain: 'Example.COM.', competitors: ['RIVAL.example.'], locationCode: 1, languageCode: 'EN' },
      deps,
    );
    expect(out.pairs[0]!.ownDomain).toBe('example.com');
    expect(out.pairs[0]!.competitorDomain).toBe('rival.example');
  });

  it('provider throw wraps as localized HttpError 503', async () => {
    const provider = createFakeKeywordProvider();
    const competitorProvider: CompetitorProvider = {
      ...createFakeCompetitorProvider(),
      compareDomains: async () => {
        throw new VendorUnavailableError('down', { provider: 'x', operation: 'y' });
      },
    };
    await expect(
      getGapCached(
        {
          ownDomain: 'example.com',
          competitors: ['rival.example'],
          locationCode: 1,
          languageCode: 'en',
        },
        makeDeps({ provider, competitorProvider }),
      ),
    ).rejects.toMatchObject({ status: 503 });
  });
});

// ---------------------------------------------------------------------------
// Router — auth gate, cache reuse, preview purity, i18n, no
// `modules/competitors` import.
// ---------------------------------------------------------------------------

const app = createApp();

async function seedUser(email: string) {
  return signupVerifiedUser(app, { email });
}

describe('POST /api/keyword-research/{gap,overview,trends,preview}', () => {
  beforeAll(async () => {
    await startMemoryMongo();
    const db = await startTestPostgres();
    installTestAuth();
    setKeywordResearchDb(db as unknown as never);
  });
  afterAll(async () => {
    uninstallTestAuth();
    setKeywordResearchDb(null);
    setKeywordProvider(null);
    setKeywordResearchCompetitorProvider(null);
    await stopTestPostgres();
    await stopMemoryMongo();
  });
  beforeEach(async () => {
    await clearCollections();
    await truncateAllTables();
    setKeywordProvider(createFakeKeywordProvider());
    setKeywordResearchCompetitorProvider(createFakeCompetitorProvider());
    vi.restoreAllMocks();
  });

  describe('auth', () => {
    it('gap: rejects unauthenticated with 401', async () => {
      const res = await request(app)
        .post('/api/keyword-research/gap')
        .send({
          ownDomain: 'example.com',
          competitors: ['rival.example'],
          locationCode: 2840,
          languageCode: 'en',
        });
      expect(res.status).toBe(401);
    });

  });

  describe('gap route', () => {
    it('rejects own domain listed as competitor with a localized 400', async () => {
      const user = await seedUser('gap-conflict@x.co');
      const res = await request(app)
        .post('/api/keyword-research/gap')
        .set('Cookie', user.cookie)
        .send({
          ownDomain: 'example.com',
          competitors: ['example.com'],
          locationCode: 2840,
          languageCode: 'en',
        });
      expect(res.status).toBe(400);
      // Zod flattened error surface: the message is the i18n key.
      const flat = JSON.stringify(res.body);
      expect(flat).toContain('keywordResearch.errors.gapDomainConflict');
    });

    it('rejects duplicate competitors with a localized 400', async () => {
      const user = await seedUser('gap-dup@x.co');
      const res = await request(app)
        .post('/api/keyword-research/gap')
        .set('Cookie', user.cookie)
        .send({
          ownDomain: 'example.com',
          competitors: ['rival.example', 'rival.example'],
          locationCode: 2840,
          languageCode: 'en',
        });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain(
        'keywordResearch.errors.competitorsDuplicate',
      );
    });

    it('returns one pair per competitor and records success-only history', async () => {
      const user = await seedUser('gap-charge@x.co');
      const res = await request(app)
        .post('/api/keyword-research/gap')
        .set('Cookie', user.cookie)
        .send({
          ownDomain: 'example.com',
          competitors: ['rival-a.example', 'rival-b.example'],
          locationCode: 2840,
          languageCode: 'en',
        });
      expect(res.status).toBe(200);
      expect(res.body.pairs).toHaveLength(2);
      const history = await getTestDb()
        .select()
        .from(keywordResearchHistory)
        .where(eq(keywordResearchHistory.accountId, user.id));
      expect(history).toHaveLength(1);
      expect(history[0]!.kind).toBe('gap');
    });

    it('second identical call is served from the cache', async () => {
      const user = await seedUser('gap-cache@x.co');
      const body = {
        ownDomain: 'example.com',
        competitors: ['rival.example'],
        locationCode: 2840,
        languageCode: 'en',
      };
      await request(app)
        .post('/api/keyword-research/gap')
        .set('Cookie', user.cookie)
        .send(body)
        .expect(200);
      const second = await request(app)
        .post('/api/keyword-research/gap')
        .set('Cookie', user.cookie)
        .send(body);
      expect(second.status).toBe(200);
      expect(second.body.pairs[0].cached).toBe(true);
    });

    it('history is NOT recorded on provider failure', async () => {
      const user = await seedUser('gap-503@x.co');
      setKeywordResearchCompetitorProvider({
        ...createFakeCompetitorProvider(),
        compareDomains: async () => {
          throw new VendorUnavailableError('down', { provider: 'x', operation: 'y' });
        },
      });
      const res = await request(app)
        .post('/api/keyword-research/gap')
        .set('Cookie', user.cookie)
        .send({
          ownDomain: 'example.com',
          competitors: ['rival.example'],
          locationCode: 2840,
          languageCode: 'en',
        });
      expect(res.status).toBe(503);
      const history = await getTestDb()
        .select()
        .from(keywordResearchHistory)
        .where(eq(keywordResearchHistory.accountId, user.id));
      expect(history).toHaveLength(0);
    });
  });

  describe('overview route', () => {
    it('dedupes phrases and records history', async () => {
      const user = await seedUser('ov-charge@x.co');
      const res = await request(app)
        .post('/api/keyword-research/overview')
        .set('Cookie', user.cookie)
        .send({
          keywords: ['seo audit tool', 'SEO AUDIT TOOL', 'rank tracker'],
          locationCode: 2840,
          languageCode: 'en',
        });
      expect(res.status).toBe(200);
      expect(res.body.keywords).toHaveLength(2);
      const history = await getTestDb()
        .select()
        .from(keywordResearchHistory)
        .where(eq(keywordResearchHistory.accountId, user.id));
      expect(history).toHaveLength(1);
      expect(history[0]!.kind).toBe('overview');
    });

    it('rejects > 20 phrases with 400', async () => {
      const user = await seedUser('ov-bad@x.co');
      const kws = Array.from({ length: 21 }, (_, i) => `k${i}`);
      const res = await request(app)
        .post('/api/keyword-research/overview')
        .set('Cookie', user.cookie)
        .send({ keywords: kws, locationCode: 2840, languageCode: 'en' });
      expect(res.status).toBe(400);
    });
  });

  describe('trends route', () => {
    it('returns trend summary', async () => {
      const user = await seedUser('tr-charge@x.co');
      const res = await request(app)
        .post('/api/keyword-research/trends')
        .set('Cookie', user.cookie)
        .send({
          keywords: ['seo audit tool'],
          locationCode: 2840,
          languageCode: 'en',
        });
      expect(res.status).toBe(200);
      expect(res.body.keywords[0].trends).toBeDefined();
    });

    it('rejects > 10 phrases with 400', async () => {
      const user = await seedUser('tr-bad@x.co');
      const kws = Array.from({ length: 11 }, (_, i) => `k${i}`);
      const res = await request(app)
        .post('/api/keyword-research/trends')
        .set('Cookie', user.cookie)
        .send({ keywords: kws, locationCode: 2840, languageCode: 'en' });
      expect(res.status).toBe(400);
    });
  });

  describe('preview route', () => {
    it('preview is a read-only estimate — no history, no vendor call, no cache write', async () => {
      const user = await seedUser('prev-pure@x.co');
      const vendorSpy = vi.fn();
      setKeywordResearchCompetitorProvider({
        ...createFakeCompetitorProvider(),
        getDomainIntersection: vendorSpy as never,
      });
      const res = await request(app)
        .post('/api/keyword-research/preview')
        .set('Cookie', user.cookie)
        .send({
          operation: 'overview',
          keywords: ['seo audit tool', 'rank tracker'],
          locationCode: 2840,
          languageCode: 'en',
        });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        deploymentMode: 'community',
        capacityEnforced: false,
        cachedUnits: 0,
        freshUnits: 2,
      });
      // No vendor call, no history row, no vendor_cache row.
      expect(vendorSpy).not.toHaveBeenCalled();
      const history = await getTestDb().select().from(keywordResearchHistory);
      expect(history).toHaveLength(0);
      const responses = await getTestDb().select().from(vendorResponses);
      expect(responses).toHaveLength(0);
      const cacheRows = await getTestDb().select().from(vendorCache);
      expect(cacheRows).toHaveLength(0);
    });

    it('preview reports cached/fresh split after a real provider call', async () => {
      const user = await seedUser('prev-cached@x.co');
      await request(app)
        .post('/api/keyword-research/overview')
        .set('Cookie', user.cookie)
        .send({ keywords: ['seo audit tool'], locationCode: 2840, languageCode: 'en' })
        .expect(200);
      const preview = await request(app)
        .post('/api/keyword-research/preview')
        .set('Cookie', user.cookie)
        .send({
          operation: 'overview',
          keywords: ['seo audit tool', 'rank tracker'],
          locationCode: 2840,
          languageCode: 'en',
        });
      expect(preview.status).toBe(200);
      expect(preview.body.cachedUnits).toBe(1);
      expect(preview.body.freshUnits).toBe(1);
    });

    it('preview for gap counts every competitor as fresh before any call', async () => {
      const user = await seedUser('prev-gap@x.co');
      const preview = await request(app)
        .post('/api/keyword-research/preview')
        .set('Cookie', user.cookie)
        .send({
          operation: 'gap',
          ownDomain: 'example.com',
          competitors: ['rival-a.example', 'rival-b.example', 'rival-c.example'],
          locationCode: 2840,
          languageCode: 'en',
        });
      expect(preview.status).toBe(200);
      expect(preview.body.cachedUnits).toBe(0);
      expect(preview.body.freshUnits).toBe(3);
    });

    it('preview gap variant — after a provider call, the same pair is disclosed as cached', async () => {
      const user = await seedUser('prev-gap-cached@x.co');
      await request(app)
        .post('/api/keyword-research/gap')
        .set('Cookie', user.cookie)
        .send({
          ownDomain: 'example.com',
          competitors: ['rival.example'],
          locationCode: 2840,
          languageCode: 'en',
        })
        .expect(200);
      const preview = await request(app)
        .post('/api/keyword-research/preview')
        .set('Cookie', user.cookie)
        .send({
          operation: 'gap',
          ownDomain: 'example.com',
          competitors: ['rival.example', 'rival-b.example'],
          locationCode: 2840,
          languageCode: 'en',
        });
      expect(preview.status).toBe(200);
      expect(preview.body.cachedUnits).toBe(1);
      expect(preview.body.freshUnits).toBe(1);
    });

    it('preview trends variant — reports the cached phrase', async () => {
      const user = await seedUser('prev-trends@x.co');
      const kw = 'seo audit tool';
      await request(app)
        .post('/api/keyword-research/trends')
        .set('Cookie', user.cookie)
        .send({ keywords: [kw], locationCode: 2840, languageCode: 'en' })
        .expect(200);
      const preview = await request(app)
        .post('/api/keyword-research/preview')
        .set('Cookie', user.cookie)
        .send({
          operation: 'trends',
          keywords: [kw],
          locationCode: 2840,
          languageCode: 'en',
        });
      expect(preview.status).toBe(200);
      expect(preview.body.cachedUnits).toBe(1);
      expect(preview.body.freshUnits).toBe(0);
    });

    it('preview rejects unauthenticated with 401', async () => {
      const res = await request(app).post('/api/keyword-research/preview').send({
        operation: 'overview',
        keywords: ['x'],
        locationCode: 1,
        languageCode: 'en',
      });
      expect(res.status).toBe(401);
    });
  });

});

// ---------------------------------------------------------------------------
// Feature-module isolation (spec 13 §4.4)
// ---------------------------------------------------------------------------

describe('architecture — modules/keyword-research imports nothing from modules/competitors', () => {
  it('no import/require of the sibling competitors module from any product source', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const root = new URL('.', import.meta.url).pathname;
    // Only inspect .ts sources (not tests) — tests are allowed to import from
    // anywhere; the module's PRODUCT code is what the rule guards.
    const productFiles = readdirSync(root).filter(
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
    );
    // Match `import ... from '...competitors...'` OR `require('...competitors...')`
    // — never a doc comment mention. The whole competitors dir is under
    // `../competitors` from this module's product files.
    const forbidden =
      /(?:from|require\()\s*['"][^'"]*(?:\.\.\/competitors|modules\/competitors)[^'"]*['"]/;
    for (const file of productFiles) {
      const contents = readFileSync(join(root, file), 'utf8');
      expect(
        forbidden.test(contents),
        `${file} imports from the sibling competitors module — spec 13 §4.4 forbids it`,
      ).toBe(false);
    }
  });
});

// Silence unused-import warnings in strict mode when future edits drop refs.
afterEach(() => {
  void normalizeCacheDomain;
});
