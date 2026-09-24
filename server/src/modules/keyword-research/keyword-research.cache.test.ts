import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { vendorCache, vendorResponses } from '../../db/schema/index.js';
import {
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
  getTestDb,
} from '../../shared/testing/postgres.js';
import {
  CPC_MICROS_PER_USD,
  computeKeywordCacheKey,
  cpcMicrosToDecimalString,
  cpcToMicros,
  createKeywordCacheRepo,
  normalizeCachePhrase,
} from './keyword-research.cache.js';

beforeAll(async () => {
  await startTestPostgres();
});
afterAll(async () => {
  await stopTestPostgres();
});
beforeEach(async () => {
  await truncateAllTables();
});

describe('normalizeCachePhrase', () => {
  it('lowercases + collapses whitespace + trims', () => {
    expect(normalizeCachePhrase('  SEO   Audit  ')).toBe('seo audit');
  });
});

describe('computeKeywordCacheKey', () => {
  it('is domain-independent — same phrase yields the same key', () => {
    const key = computeKeywordCacheKey({
      phrase: 'seo audit',
      locationCode: 2840,
      languageCode: 'en',
    });
    expect(key).toHaveLength(64);
  });
  it('differs when the language differs', () => {
    const en = computeKeywordCacheKey({ phrase: 'seo', locationCode: 2840, languageCode: 'en' });
    const de = computeKeywordCacheKey({ phrase: 'seo', locationCode: 2840, languageCode: 'de' });
    expect(en).not.toBe(de);
  });
  it('normalizes the phrase before hashing', () => {
    const a = computeKeywordCacheKey({ phrase: 'SEO Audit', locationCode: 1, languageCode: 'en' });
    const b = computeKeywordCacheKey({ phrase: 'seo audit', locationCode: 1, languageCode: 'en' });
    expect(a).toBe(b);
  });
});

describe('cpcToMicros / cpcMicrosToDecimalString', () => {
  it('round-trips a positive value', () => {
    expect(cpcToMicros(4.12)).toBe(4_120_000);
    expect(cpcMicrosToDecimalString(4_120_000)).toBe('4.120000');
  });
  it('preserves null', () => {
    expect(cpcToMicros(null)).toBeNull();
    expect(cpcMicrosToDecimalString(null)).toBeNull();
  });
  it('handles negative values (defensive — vendor should not send these)', () => {
    expect(cpcMicrosToDecimalString(-1_500_000)).toBe('-1.500000');
  });
  it('exposes the constant', () => {
    expect(CPC_MICROS_PER_USD).toBe(1_000_000);
  });
});

describe('KeywordCacheRepo', () => {
  const now = new Date('2026-07-01T00:00:00.000Z');
  const later = new Date('2026-08-01T00:00:00.000Z');

  it('readMetrics returns null on empty', async () => {
    const repo = createKeywordCacheRepo(getTestDb() as never);
    await expect(repo.readMetrics('key', now)).resolves.toBeNull();
  });

  it('writeMetrics upserts and readMetrics returns the row', async () => {
    const repo = createKeywordCacheRepo(getTestDb() as never);
    const key = computeKeywordCacheKey({
      phrase: 'seo audit',
      locationCode: 2840,
      languageCode: 'en',
    });
    await repo.writeMetrics({
      cacheKey: key,
      phrase: 'seo audit',
      locationCode: 2840,
      languageCode: 'EN',
      searchVolume: 5400,
      difficulty: 62,
      cpc: 4.12,
      monthlySearches: [{ year: 2025, month: 12, searchVolume: 5400 }],
      fetchedAt: now,
      expiresAt: later,
    });
    const hit = await repo.readMetrics(key, now);
    expect(hit).not.toBeNull();
    expect(hit?.searchVolume).toBe(5400);
    expect(hit?.difficulty).toBe(62);
    expect(hit?.cpc).toBe('4.120000');
    expect(hit?.cpcMicros).toBe(4_120_000);
    expect(hit?.monthlySearches).toHaveLength(1);
    expect(hit?.relatedKeywords).toBeNull();
  });

  it('readMetrics treats an expired row as a miss', async () => {
    const repo = createKeywordCacheRepo(getTestDb() as never);
    const key = 'expired';
    await repo.writeMetrics({
      cacheKey: key,
      phrase: 'old',
      locationCode: 1,
      languageCode: 'en',
      searchVolume: 1,
      difficulty: 1,
      cpc: 0,
      monthlySearches: [],
      fetchedAt: new Date('2026-01-01T00:00:00Z'),
      expiresAt: new Date('2026-02-01T00:00:00Z'),
    });
    const hit = await repo.readMetrics(key, new Date('2026-07-01T00:00:00Z'));
    expect(hit).toBeNull();
  });

  it('writeMetrics upsert overwrites existing row', async () => {
    const repo = createKeywordCacheRepo(getTestDb() as never);
    const key = 'k';
    await repo.writeMetrics({
      cacheKey: key,
      phrase: 'seo',
      locationCode: 1,
      languageCode: 'en',
      searchVolume: 100,
      difficulty: 20,
      cpc: 1,
      monthlySearches: [],
      fetchedAt: now,
      expiresAt: later,
    });
    await repo.writeMetrics({
      cacheKey: key,
      phrase: 'seo',
      locationCode: 1,
      languageCode: 'en',
      searchVolume: 200,
      difficulty: 30,
      cpc: 2,
      monthlySearches: [],
      fetchedAt: now,
      expiresAt: later,
    });
    const hit = await repo.readMetrics(key, now);
    expect(hit?.searchVolume).toBe(200);
    expect(hit?.difficulty).toBe(30);
  });

  it('writeRelated persists related-keyword rows and readRelated returns them', async () => {
    const repo = createKeywordCacheRepo(getTestDb() as never);
    const key = 'related';
    await repo.writeRelated({
      cacheKey: key,
      phrase: 'seo',
      locationCode: 1,
      languageCode: 'en',
      related: [
        {
          keyword: 'free seo audit tool',
          searchVolume: 3200,
          difficulty: 48,
          cpcMicros: 3_140_000,
          monthlySearches: [],
        },
      ],
      fetchedAt: now,
      expiresAt: later,
    });
    const hit = await repo.readRelated(key, now);
    expect(hit?.relatedKeywords).toHaveLength(1);
    expect(hit?.relatedKeywords?.[0]?.keyword).toBe('free seo audit tool');
  });

  it('readRelated ignores rows without a relatedKeywords payload', async () => {
    const repo = createKeywordCacheRepo(getTestDb() as never);
    const key = 'metrics-only';
    await repo.writeMetrics({
      cacheKey: key,
      phrase: 'seo',
      locationCode: 1,
      languageCode: 'en',
      searchVolume: 100,
      difficulty: 20,
      cpc: 1,
      monthlySearches: [],
      fetchedAt: now,
      expiresAt: later,
    });
    await expect(repo.readRelated(key, now)).resolves.toBeNull();
  });

  it('readRelated returns null for expired rows', async () => {
    const repo = createKeywordCacheRepo(getTestDb() as never);
    const key = 'related-old';
    await repo.writeRelated({
      cacheKey: key,
      phrase: 'seo',
      locationCode: 1,
      languageCode: 'en',
      related: [],
      fetchedAt: new Date('2026-01-01T00:00:00Z'),
      expiresAt: new Date('2026-02-01T00:00:00Z'),
    });
    await expect(
      repo.readRelated(key, new Date('2026-07-01T00:00:00Z')),
    ).resolves.toBeNull();
  });

  it('writeRelated upsert overwrites', async () => {
    const repo = createKeywordCacheRepo(getTestDb() as never);
    const key = 'r';
    await repo.writeRelated({
      cacheKey: key,
      phrase: 'seo',
      locationCode: 1,
      languageCode: 'en',
      related: [{ keyword: 'a', searchVolume: null, difficulty: null, cpcMicros: null, monthlySearches: [] }],
      fetchedAt: now,
      expiresAt: later,
    });
    await repo.writeRelated({
      cacheKey: key,
      phrase: 'seo',
      locationCode: 1,
      languageCode: 'en',
      related: [
        { keyword: 'a', searchVolume: null, difficulty: null, cpcMicros: null, monthlySearches: [] },
        { keyword: 'b', searchVolume: null, difficulty: null, cpcMicros: null, monthlySearches: [] },
      ],
      fetchedAt: now,
      expiresAt: later,
    });
    const hit = await repo.readRelated(key, now);
    expect(hit?.relatedKeywords).toHaveLength(2);
  });

  it('rowToCached path uses defaults when monthlySearches is empty jsonb', async () => {
    const repo = createKeywordCacheRepo(getTestDb() as never);
    await repo.writeMetrics({
      cacheKey: 'empty-ms',
      phrase: 'x',
      locationCode: 1,
      languageCode: 'en',
      searchVolume: null,
      difficulty: null,
      cpc: null,
      monthlySearches: [],
      fetchedAt: now,
      expiresAt: later,
    });
    const hit = await repo.readMetrics('empty-ms', now);
    expect(hit?.monthlySearches).toEqual([]);
    expect(hit?.cpc).toBeNull();
  });

  it('metrics and related are independent entries — related write never satisfies readMetrics', async () => {
    const repo = createKeywordCacheRepo(getTestDb() as never);
    const key = 'independent';
    await repo.writeRelated({
      cacheKey: key,
      phrase: 'seo',
      locationCode: 1,
      languageCode: 'en',
      related: [{ keyword: 'a', searchVolume: 1, difficulty: 1, cpcMicros: 1, monthlySearches: [] }],
      fetchedAt: now,
      expiresAt: later,
    });
    await expect(repo.readMetrics(key, now)).resolves.toBeNull();
  });

  it('every write appends an append-only vendor_responses archive row', async () => {
    const db = getTestDb();
    const repo = createKeywordCacheRepo(db as never);
    await repo.writeMetrics({
      cacheKey: 'arch',
      phrase: 'seo',
      locationCode: 2840,
      languageCode: 'EN',
      searchVolume: 10,
      difficulty: 5,
      cpc: 1,
      monthlySearches: [],
      fetchedAt: now,
      expiresAt: later,
    });
    await repo.writeMetrics({
      cacheKey: 'arch',
      phrase: 'seo',
      locationCode: 2840,
      languageCode: 'EN',
      searchVolume: 20,
      difficulty: 6,
      cpc: 2,
      monthlySearches: [],
      fetchedAt: now,
      expiresAt: later,
    });
    await repo.writeRelated({
      cacheKey: 'arch',
      phrase: 'seo',
      locationCode: 2840,
      languageCode: 'EN',
      related: [],
      fetchedAt: now,
      expiresAt: later,
    });
    const rows = await db.select().from(vendorResponses);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.capability === 'keyword')).toBe(true);
    expect(rows.map((r) => r.operation).sort()).toEqual(['metrics', 'metrics', 'related']);
    expect(rows.every((r) => r.accountId === null)).toBe(true);
    // Params store the lowered language + key inputs for debuggability.
    expect(rows[0]?.params).toEqual({ phrase: 'seo', locationCode: 2840, languageCode: 'en' });
  });

  it('writes persist the allocated vendor cost on archive rows', async () => {
    const db = getTestDb();
    const repo = createKeywordCacheRepo(db as never);
    await repo.writeMetrics({
      cacheKey: 'cost-m',
      phrase: 'seo',
      locationCode: 2840,
      languageCode: 'EN',
      searchVolume: 10,
      difficulty: 5,
      cpc: 1,
      monthlySearches: [],
      costMicros: 45_000n,
      fetchedAt: now,
      expiresAt: later,
    });
    await repo.writeIntent({
      cacheKey: 'cost-i',
      phrase: 'seo',
      locationCode: 2840,
      languageCode: 'EN',
      intent: null,
      confidence: null,
      costMicros: 1_000n,
      fetchedAt: now,
      expiresAt: later,
    });
    await repo.writeRelated({
      cacheKey: 'cost-r',
      phrase: 'seo',
      locationCode: 2840,
      languageCode: 'EN',
      related: [],
      costMicros: 25_000n,
      fetchedAt: now,
      expiresAt: later,
    });
    const rows = await db.select().from(vendorResponses);
    expect(new Map(rows.map((r) => [r.operation, r.costMicros]))).toEqual(
      new Map<string, bigint>([
        ['metrics', 45_000n],
        ['intent', 1_000n],
        ['related', 25_000n],
      ]),
    );
  });

  it('corrupt cached payloads read as a miss on both operations', async () => {
    const db = getTestDb();
    const repo = createKeywordCacheRepo(db as never);
    await db.insert(vendorCache).values([
      {
        capability: 'keyword',
        operation: 'metrics',
        cacheKey: 'corrupt',
        params: {},
        payload: { junk: true },
        fetchedAt: now,
        expiresAt: later,
      },
      {
        capability: 'keyword',
        operation: 'related',
        cacheKey: 'corrupt',
        params: {},
        payload: 'nope',
        fetchedAt: now,
        expiresAt: later,
      },
    ]);
    await expect(repo.readMetrics('corrupt', now)).resolves.toBeNull();
    await expect(repo.readRelated('corrupt', now)).resolves.toBeNull();
  });

  describe('ideas operation — writeIdeas / readIdeas', () => {
    it('writeIdeas upserts and readIdeas returns the row', async () => {
      const repo = createKeywordCacheRepo(getTestDb() as never);
      const key = computeKeywordCacheKey({
        phrase: 'seo audit',
        locationCode: 2840,
        languageCode: 'en',
      });
      await repo.writeIdeas({
        cacheKey: key,
        phrase: 'seo audit',
        locationCode: 2840,
        languageCode: 'EN',
        ideas: [
          {
            keyword: 'website audit checklist',
            searchVolume: 2900,
            difficulty: 41,
            cpcMicros: 2_350_000,
            monthlySearches: [{ year: 2025, month: 12, searchVolume: 2900 }],
          },
        ],
        fetchedAt: now,
        expiresAt: later,
      });
      const hit = await repo.readIdeas(key, now);
      expect(hit).toEqual({
        phrase: 'seo audit',
        ideas: [
          {
            keyword: 'website audit checklist',
            searchVolume: 2900,
            difficulty: 41,
            cpcMicros: 2_350_000,
            monthlySearches: [{ year: 2025, month: 12, searchVolume: 2900 }],
          },
        ],
        fetchedAt: now,
        expiresAt: later,
      });
    });

    it('readIdeas returns null on empty and for expired rows', async () => {
      const repo = createKeywordCacheRepo(getTestDb() as never);
      await expect(repo.readIdeas('missing', now)).resolves.toBeNull();
      await repo.writeIdeas({
        cacheKey: 'ideas-old',
        phrase: 'seo',
        locationCode: 1,
        languageCode: 'en',
        ideas: [],
        fetchedAt: new Date('2026-01-01T00:00:00Z'),
        expiresAt: new Date('2026-02-01T00:00:00Z'),
      });
      await expect(
        repo.readIdeas('ideas-old', new Date('2026-07-01T00:00:00Z')),
      ).resolves.toBeNull();
    });

    it('corrupt ideas payload reads as a miss', async () => {
      const db = getTestDb();
      const repo = createKeywordCacheRepo(db as never);
      await db.insert(vendorCache).values({
        capability: 'keyword',
        operation: 'ideas',
        cacheKey: 'corrupt-ideas',
        params: {},
        payload: { junk: true },
        fetchedAt: now,
        expiresAt: later,
      });
      await expect(repo.readIdeas('corrupt-ideas', now)).resolves.toBeNull();
    });

    it('corrupt long-tail payload reads as a miss', async () => {
      const db = getTestDb();
      const repo = createKeywordCacheRepo(db as never);
      await db.insert(vendorCache).values({
        capability: 'keyword',
        operation: 'long_tail',
        cacheKey: 'corrupt-long-tail',
        params: {},
        payload: { junk: true },
        fetchedAt: now,
        expiresAt: later,
      });
      await expect(repo.readLongTail('corrupt-long-tail', now)).resolves.toBeNull();
    });

    it('ideas is independent of related — same key, distinct operation rows', async () => {
      const repo = createKeywordCacheRepo(getTestDb() as never);
      const key = 'shared-key';
      await repo.writeRelated({
        cacheKey: key,
        phrase: 'seo',
        locationCode: 1,
        languageCode: 'en',
        related: [{ keyword: 'a', searchVolume: null, difficulty: null, cpcMicros: null, monthlySearches: [] }],
        fetchedAt: now,
        expiresAt: later,
      });
      // A related write never satisfies readIdeas…
      await expect(repo.readIdeas(key, now)).resolves.toBeNull();
      await repo.writeIdeas({
        cacheKey: key,
        phrase: 'seo',
        locationCode: 1,
        languageCode: 'en',
        ideas: [{ keyword: 'b', searchVolume: null, difficulty: null, cpcMicros: null, monthlySearches: [] }],
        fetchedAt: now,
        expiresAt: later,
      });
      // …and the ideas write leaves the related row untouched.
      const related = await repo.readRelated(key, now);
      expect(related?.relatedKeywords?.[0]?.keyword).toBe('a');
      const ideas = await repo.readIdeas(key, now);
      expect(ideas?.ideas[0]?.keyword).toBe('b');
    });

    it('writeIdeas appends an archive row with the vendor cost', async () => {
      const db = getTestDb();
      const repo = createKeywordCacheRepo(db as never);
      await repo.writeIdeas({
        cacheKey: 'ideas-cost',
        phrase: 'seo',
        locationCode: 1,
        languageCode: 'en',
        ideas: [],
        costMicros: 9n,
        fetchedAt: now,
        expiresAt: later,
      });
      const rows = await db.select().from(vendorResponses);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        capability: 'keyword',
        operation: 'ideas',
        accountId: null,
        costMicros: 9n,
      });
    });
  });

  describe('intent operation — writeIntent / readIntentMany', () => {
    it('writeIntent upserts and readIntentMany returns the row', async () => {
      const repo = createKeywordCacheRepo(getTestDb() as never);
      const key = computeKeywordCacheKey({
        phrase: 'seo audit tool',
        locationCode: 2840,
        languageCode: 'en',
      });
      await repo.writeIntent({
        cacheKey: key,
        phrase: 'seo audit tool',
        locationCode: 2840,
        languageCode: 'EN',
        intent: 'commercial',
        confidence: 0.82,
        fetchedAt: now,
        expiresAt: later,
      });
      const hits = await repo.readIntentMany([key], now);
      expect(hits.get(key)).toEqual({
        phrase: 'seo audit tool',
        intent: 'commercial',
        confidence: 0.82,
        fetchedAt: now,
        expiresAt: later,
      });
    });

    it('persists a null intent (unclassified keyword)', async () => {
      const repo = createKeywordCacheRepo(getTestDb() as never);
      await repo.writeIntent({
        cacheKey: 'null-intent',
        phrase: 'obscure',
        locationCode: 1,
        languageCode: 'en',
        intent: null,
        confidence: null,
        fetchedAt: now,
        expiresAt: later,
      });
      const hits = await repo.readIntentMany(['null-intent'], now);
      expect(hits.get('null-intent')).toMatchObject({ intent: null, confidence: null });
    });

    it('skips missing / expired / corrupt rows', async () => {
      const db = getTestDb();
      const repo = createKeywordCacheRepo(db as never);
      await repo.writeIntent({
        cacheKey: 'i1',
        phrase: 'a',
        locationCode: 1,
        languageCode: 'en',
        intent: 'informational',
        confidence: 0.9,
        fetchedAt: now,
        expiresAt: later,
      });
      await repo.writeIntent({
        cacheKey: 'i2-expired',
        phrase: 'b',
        locationCode: 1,
        languageCode: 'en',
        intent: 'transactional',
        confidence: 0.5,
        fetchedAt: new Date('2025-01-01T00:00:00Z'),
        expiresAt: new Date('2025-02-01T00:00:00Z'),
      });
      await db.insert(vendorCache).values({
        capability: 'keyword',
        operation: 'intent',
        cacheKey: 'i3-corrupt',
        params: {},
        payload: { junk: true },
        fetchedAt: now,
        expiresAt: later,
      });
      const hits = await repo.readIntentMany(
        ['i1', 'i2-expired', 'i3-corrupt', 'i4-missing'],
        now,
      );
      expect([...hits.keys()]).toEqual(['i1']);
    });

    it('empty input returns an empty map (no SQL issued)', async () => {
      const repo = createKeywordCacheRepo(getTestDb() as never);
      const hits = await repo.readIntentMany([], now);
      expect(hits.size).toBe(0);
    });

    it('intent is independent of metrics/related — one seed, three operation rows', async () => {
      const db = getTestDb();
      const repo = createKeywordCacheRepo(db as never);
      const key = 'shared-key';
      await repo.writeMetrics({
        cacheKey: key,
        phrase: 'seo',
        locationCode: 1,
        languageCode: 'en',
        searchVolume: 10,
        difficulty: 5,
        cpc: 1,
        monthlySearches: [],
        fetchedAt: now,
        expiresAt: later,
      });
      await repo.writeIntent({
        cacheKey: key,
        phrase: 'seo',
        locationCode: 1,
        languageCode: 'en',
        intent: 'commercial',
        confidence: 0.7,
        fetchedAt: now,
        expiresAt: later,
      });
      // The metrics row is untouched by the intent write and vice versa.
      expect((await repo.readMetrics(key, now))?.searchVolume).toBe(10);
      expect((await repo.readIntentMany([key], now)).get(key)?.intent).toBe('commercial');
      const archive = await db.select().from(vendorResponses);
      expect(archive.map((r) => r.operation).sort()).toEqual(['intent', 'metrics']);
    });
  });

  describe('ReadMetricsMany', () => {
    it('returns hits for the requested keys and skips misses / expired / corrupt rows', async () => {
      const db = getTestDb();
      const repo = createKeywordCacheRepo(db as never);
      await repo.writeMetrics({
        cacheKey: 'k1',
        phrase: 'seo audit',
        locationCode: 1,
        languageCode: 'en',
        searchVolume: 10,
        difficulty: 1,
        cpc: 1,
        monthlySearches: [],
        fetchedAt: now,
        expiresAt: later,
      });
      await repo.writeMetrics({
        cacheKey: 'k2-expired',
        phrase: 'old',
        locationCode: 1,
        languageCode: 'en',
        searchVolume: 5,
        difficulty: 5,
        cpc: 0.5,
        monthlySearches: [],
        fetchedAt: new Date('2025-01-01T00:00:00Z'),
        expiresAt: new Date('2025-02-01T00:00:00Z'),
      });
      // Corrupt row — should silently miss.
      await db.insert(vendorCache).values({
        capability: 'keyword',
        operation: 'metrics',
        cacheKey: 'k3-corrupt',
        params: {},
        payload: { junk: true },
        fetchedAt: now,
        expiresAt: later,
      });
      const hits = await repo.readMetricsMany(
        ['k1', 'k2-expired', 'k3-corrupt', 'k4-missing'],
        now,
      );
      expect([...hits.keys()]).toEqual(['k1']);
      expect(hits.get('k1')?.searchVolume).toBe(10);
    });

    it('empty input returns an empty map (no SQL issued)', async () => {
      const repo = createKeywordCacheRepo(getTestDb() as never);
      const hits = await repo.readMetricsMany([], now);
      expect(hits.size).toBe(0);
    });
  });
});
