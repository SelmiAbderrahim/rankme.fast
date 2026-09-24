import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
  getTestDb,
} from '../../shared/testing/postgres.js';
import {
  VendorQuotaError,
  createFakeKeywordProvider,
  recordVendorCostUsd,
  type KeywordProvider,
} from '../../shared/providers/index.js';
import { vendorResponses } from '../../db/schema/index.js';
import {
  allocateBatchCostMicros,
  classifyIntentCached,
  getIdeasCached,
  getLongTailSuggestionsCached,
  getMetricsCached,
  getRelatedCached,
} from './keyword-research.service.js';
import { HttpError } from '../../shared/utils/http-error.js';
import type {
  IntentResult,
  KeywordHistoricalVolume,
  KeywordMetrics,
  KeywordOverview,
} from '../../shared/providers/index.js';

beforeAll(async () => {
  await startTestPostgres();
});
afterAll(async () => {
  await stopTestPostgres();
});
beforeEach(async () => {
  await truncateAllTables();
});

const NOW = new Date('2026-07-01T00:00:00.000Z');

function makeDeps(overrides: {
  provider: KeywordProvider;
  now?: () => Date;
}) {
  return {
    db: getTestDb() as never,
    provider: overrides.provider,
    ttlDays: 30,
    now: overrides.now ?? (() => NOW),
  };
}

describe('allocateBatchCostMicros', () => {
  it('passes null through untouched', () => {
    expect(allocateBatchCostMicros(null, 3, 0)).toBeNull();
    expect(allocateBatchCostMicros(null, 3, 2)).toBeNull();
  });

  it('splits evenly and parks the remainder on the first row', () => {
    expect([0, 1, 2].map((i) => allocateBatchCostMicros(10n, 3, i))).toEqual([4n, 3n, 3n]);
  });

  it('exact division leaves no remainder anywhere', () => {
    expect([0, 1].map((i) => allocateBatchCostMicros(10n, 2, i))).toEqual([5n, 5n]);
  });

  it('a single-row batch takes the whole cost', () => {
    expect(allocateBatchCostMicros(7n, 1, 0)).toBe(7n);
  });
});

describe('vendor cost capture lands on archive rows', () => {
  const noopRest = {
    async getRelated(): Promise<KeywordMetrics[]> {
      return [];
    },
    async classifyIntent(): Promise<IntentResult[]> {
      return [];
    },
    async getIdeas(): Promise<KeywordMetrics[]> {
      return [];
    },
    async getOverview(): Promise<KeywordOverview[]> {
      return [];
    },
    async getHistoricalVolume(): Promise<KeywordHistoricalVolume[]> {
      return [];
    },
  };

  it('getMetricsCached allocates the recorded batch cost across per-phrase rows', async () => {
    const provider: KeywordProvider = {
      async getLongTailSuggestions() { return []; },
      ...noopRest,
      async getMetrics(kws) {
        recordVendorCostUsd(0.00001); // 10 micros across 3 phrases → 4/3/3
        return kws.map((k) => ({
          keyword: k,
          searchVolume: 1,
          difficulty: 1,
          cpc: null,
          monthlySearches: [],
        }));
      },
    };
    await getMetricsCached(
      { keywords: ['a', 'b', 'c'], locationCode: 2840, languageCode: 'en' },
      makeDeps({ provider }),
    );
    const rows = await getTestDb().select().from(vendorResponses);
    const costs = rows
      .map((r) => r.costMicros)
      .sort((x, y) => Number((x ?? 0n) - (y ?? 0n)));
    expect(costs).toEqual([3n, 3n, 4n]);
  });

  it('getMetricsCached stores null cost when the provider records nothing', async () => {
    const provider: KeywordProvider = {
      async getLongTailSuggestions() { return []; },
      ...noopRest,
      async getMetrics(kws) {
        return kws.map((k) => ({
          keyword: k,
          searchVolume: 1,
          difficulty: 1,
          cpc: null,
          monthlySearches: [],
        }));
      },
    };
    await getMetricsCached(
      { keywords: ['a'], locationCode: 2840, languageCode: 'en' },
      makeDeps({ provider }),
    );
    const rows = await getTestDb().select().from(vendorResponses);
    expect(rows.map((r) => r.costMicros)).toEqual([null]);
  });

  it('getRelatedCached stores the full recorded cost on its single row', async () => {
    const provider: KeywordProvider = {
      async getLongTailSuggestions() { return []; },
      ...noopRest,
      async getMetrics(): Promise<KeywordMetrics[]> {
        return [];
      },
      async getRelated() {
        recordVendorCostUsd(0.025);
        return [];
      },
    };
    await getRelatedCached(
      { keyword: 'seo', locationCode: 2840, languageCode: 'en' },
      makeDeps({ provider }),
    );
    const rows = await getTestDb().select().from(vendorResponses);
    expect(rows.map((r) => r.costMicros)).toEqual([25_000n]);
  });

  it('classifyIntentCached allocates the recorded batch cost like metrics', async () => {
    const provider: KeywordProvider = {
      async getLongTailSuggestions() { return []; },
      ...noopRest,
      async getMetrics(): Promise<KeywordMetrics[]> {
        return [];
      },
      async classifyIntent(kws) {
        recordVendorCostUsd(0.000003); // 3 micros across 2 phrases → 2/1
        return kws.map((k) => ({ keyword: k, intent: null, confidence: null }));
      },
    };
    await classifyIntentCached(
      { keywords: ['a', 'b'], locationCode: 2840, languageCode: 'en' },
      makeDeps({ provider }),
    );
    const rows = await getTestDb().select().from(vendorResponses);
    const costs = rows
      .map((r) => r.costMicros)
      .sort((x, y) => Number((x ?? 0n) - (y ?? 0n)));
    expect(costs).toEqual([1n, 2n]);
  });
});

describe('getMetricsCached — misses populate cache and hits skip vendor', () => {
  it('populates the cache on miss then serves from cache on repeat', async () => {
    let vendorCalls = 0;
    const provider: KeywordProvider = {
      async getLongTailSuggestions() { return []; },
      async getMetrics(kws) {
        vendorCalls += 1;
        return kws.map((k) => ({
          keyword: k,
          searchVolume: 100,
          difficulty: 30,
          cpc: 1.5,
          monthlySearches: [{ year: 2026, month: 6, searchVolume: 100 }],
        }));
      },
      async getRelated() {
        return [];
      },
      async classifyIntent() { return []; },
      async getIdeas() { return []; },
      async getOverview() { return []; },
      async getHistoricalVolume() { return []; },
    };
    const deps = makeDeps({ provider });

    const first = await getMetricsCached(
      { keywords: ['seo audit', 'rank tracker'], locationCode: 2840, languageCode: 'en' },
      deps,
    );
    expect(first).toHaveLength(2);
    expect(first[0]?.cached).toBe(false);
    expect(first[0]?.cpc).toBe('1.500000');
    expect(vendorCalls).toBe(1);

    const second = await getMetricsCached(
      { keywords: ['seo audit', 'rank tracker'], locationCode: 2840, languageCode: 'en' },
      deps,
    );
    expect(second.every((r) => r.cached)).toBe(true);
    expect(vendorCalls).toBe(1);
  });

  it('cross-user hit: fresh account after cache write skips vendor', async () => {
    let calls = 0;
    const provider: KeywordProvider = {
      async getLongTailSuggestions() { return []; },
      async getMetrics(kws) {
        calls += 1;
        return kws.map((k) => ({
          keyword: k,
          searchVolume: 1,
          difficulty: 1,
          cpc: null,
          monthlySearches: [],
        }));
      },
      async getRelated() { return []; },
      async classifyIntent() { return []; },
      async getIdeas() { return []; },
      async getOverview() { return []; },
      async getHistoricalVolume() { return []; },
    };
    await getMetricsCached(
      { keywords: ['a'], locationCode: 1, languageCode: 'en' },
      makeDeps({ provider }),
    );
    // Different "account" — cache is domain-independent + not account scoped.
    const result = await getMetricsCached(
      { keywords: ['a'], locationCode: 1, languageCode: 'en' },
      makeDeps({ provider }),
    );
    expect(calls).toBe(1);
    expect(result[0]?.cached).toBe(true);
    expect(result[0]?.cpc).toBeNull();
  });

  it('dedupes duplicate input phrases before hitting the vendor', async () => {
    let calls = 0;
    const provider: KeywordProvider = {
      async getLongTailSuggestions() { return []; },
      async getMetrics(kws) {
        calls += 1;
        expect(kws).toEqual(['seo']);
        return [{ keyword: 'seo', searchVolume: 1, difficulty: null, cpc: null, monthlySearches: [] }];
      },
      async getRelated() { return []; },
      async classifyIntent() { return []; },
      async getIdeas() { return []; },
      async getOverview() { return []; },
      async getHistoricalVolume() { return []; },
    };
    const result = await getMetricsCached(
      { keywords: ['SEO', 'seo', '  seo  '], locationCode: 1, languageCode: 'en' },
      makeDeps({ provider }),
    );
    expect(calls).toBe(1);
    expect(result).toHaveLength(1);
  });

  it('falls back to null-metrics rows when vendor omits a keyword', async () => {
    const provider: KeywordProvider = {
      async getLongTailSuggestions() { return []; },
      async getMetrics() {
        // vendor omits both keywords
        return [];
      },
      async getRelated() { return []; },
      async classifyIntent() { return []; },
      async getIdeas() { return []; },
      async getOverview() { return []; },
      async getHistoricalVolume() { return []; },
    };
    const result = await getMetricsCached(
      { keywords: ['a', 'b'], locationCode: 1, languageCode: 'en' },
      makeDeps({ provider }),
    );
    expect(result).toEqual([
      expect.objectContaining({ keyword: 'a', searchVolume: null, difficulty: null }),
      expect.objectContaining({ keyword: 'b', searchVolume: null, difficulty: null }),
    ]);
  });

  it('wraps ProviderError as 503 HttpError', async () => {
    const provider: KeywordProvider = {
      async getLongTailSuggestions() { return []; },
      async getMetrics() {
        throw new VendorQuotaError('exhausted', { provider: 'x', operation: 'y' });
      },
      async getRelated() {
        throw new VendorQuotaError('exhausted', { provider: 'x', operation: 'y' });
      },
      async classifyIntent() { return []; },
      async getIdeas() { return []; },
      async getOverview() { return []; },
      async getHistoricalVolume() { return []; },
    };
    await expect(
      getMetricsCached(
        { keywords: ['a'], locationCode: 1, languageCode: 'en' },
        makeDeps({ provider }),
      ),
    ).rejects.toMatchObject({ status: 503, message: 'keywordResearch.errors.unavailable' });
  });

  it('rethrows non-ProviderError errors unchanged', async () => {
    const provider: KeywordProvider = {
      async getLongTailSuggestions() { return []; },
      async getMetrics() {
        throw new TypeError('bug');
      },
      async getRelated() { return []; },
      async classifyIntent() { return []; },
      async getIdeas() { return []; },
      async getOverview() { return []; },
      async getHistoricalVolume() { return []; },
    };
    await expect(
      getMetricsCached(
        { keywords: ['a'], locationCode: 1, languageCode: 'en' },
        makeDeps({ provider }),
      ),
    ).rejects.toBeInstanceOf(TypeError);
  });

  it('returns [] when every input is blank', async () => {
    const provider = createFakeKeywordProvider();
    const result = await getMetricsCached(
      { keywords: ['', '   '], locationCode: 1, languageCode: 'en' },
      makeDeps({ provider }),
    );
    expect(result).toEqual([]);
  });

  it('uses default now() when deps.now is unset', async () => {
    const provider = createFakeKeywordProvider();
    const deps = {
      db: getTestDb() as never,
      provider,
      ttlDays: 30,
    };
    const result = await getMetricsCached(
      { keywords: ['x'], locationCode: 1, languageCode: 'en' },
      deps,
    );
    expect(result[0]?.fetchedAt).toBeDefined();
  });
});

describe('getRelatedCached', () => {
  it('populates the cache on miss then serves from cache on repeat', async () => {
    let calls = 0;
    const provider: KeywordProvider = {
      async getLongTailSuggestions() { return []; },
      async getMetrics() { return []; },
      async getRelated(seed) {
        calls += 1;
        return [
          { keyword: `${seed} tool`, searchVolume: 100, difficulty: 40, cpc: 2, monthlySearches: [] },
        ];
      },
      async classifyIntent() { return []; },
      async getIdeas() { return []; },
      async getOverview() { return []; },
      async getHistoricalVolume() { return []; },
    };
    const deps = makeDeps({ provider });
    const first = await getRelatedCached(
      { keyword: 'seo audit', locationCode: 1, languageCode: 'en' },
      deps,
    );
    expect(first.cached).toBe(false);
    expect(first.related).toHaveLength(1);
    expect(first.related[0]?.cpc).toBe('2.000000');
    const second = await getRelatedCached(
      { keyword: 'seo audit', locationCode: 1, languageCode: 'en' },
      deps,
    );
    expect(second.cached).toBe(true);
    expect(calls).toBe(1);
  });

  it('honours the explicit limit argument', async () => {
    let seenLimit = 0;
    const provider: KeywordProvider = {
      async getLongTailSuggestions() { return []; },
      async getMetrics() { return []; },
      async getRelated(_seed, _loc, _lang, limit) {
        seenLimit = limit;
        return [];
      },
      async classifyIntent() { return []; },
      async getIdeas() { return []; },
      async getOverview() { return []; },
      async getHistoricalVolume() { return []; },
    };
    await getRelatedCached(
      { keyword: 'seed', locationCode: 1, languageCode: 'en', limit: 50 },
      makeDeps({ provider }),
    );
    expect(seenLimit).toBe(50);
  });

  it('clamps limit to the vendor ceiling', async () => {
    let seen = 0;
    const provider: KeywordProvider = {
      async getLongTailSuggestions() { return []; },
      async getMetrics() { return []; },
      async getRelated(_s, _l, _lang, l) {
        seen = l;
        return [];
      },
      async classifyIntent() { return []; },
      async getIdeas() { return []; },
      async getOverview() { return []; },
      async getHistoricalVolume() { return []; },
    };
    await getRelatedCached(
      { keyword: 'seed', locationCode: 1, languageCode: 'en', limit: 5000 },
      makeDeps({ provider }),
    );
    expect(seen).toBe(1000);
  });

  it('clamps limit up to 1 when caller sends 0', async () => {
    let seen = 0;
    const provider: KeywordProvider = {
      async getLongTailSuggestions() { return []; },
      async getMetrics() { return []; },
      async getRelated(_s, _l, _lang, l) {
        seen = l;
        return [];
      },
      async classifyIntent() { return []; },
      async getIdeas() { return []; },
      async getOverview() { return []; },
      async getHistoricalVolume() { return []; },
    };
    await getRelatedCached(
      { keyword: 'seed', locationCode: 1, languageCode: 'en', limit: 0 },
      makeDeps({ provider }),
    );
    expect(seen).toBe(1);
  });

  it('wraps ProviderError as 503', async () => {
    const provider: KeywordProvider = {
      async getLongTailSuggestions() { return []; },
      async getMetrics() { return []; },
      async getRelated() {
        throw new VendorQuotaError('nope', { provider: 'x', operation: 'y' });
      },
      async classifyIntent() { return []; },
      async getIdeas() { return []; },
      async getOverview() { return []; },
      async getHistoricalVolume() { return []; },
    };
    await expect(
      getRelatedCached(
        { keyword: 'seed', locationCode: 1, languageCode: 'en' },
        makeDeps({ provider }),
      ),
    ).rejects.toBeInstanceOf(HttpError);
  });

  it('rethrows non-ProviderError errors unchanged', async () => {
    const provider: KeywordProvider = {
      async getLongTailSuggestions() { return []; },
      async getMetrics() { return []; },
      async getRelated() {
        throw new TypeError('bug');
      },
      async classifyIntent() { return []; },
      async getIdeas() { return []; },
      async getOverview() { return []; },
      async getHistoricalVolume() { return []; },
    };
    await expect(
      getRelatedCached(
        { keyword: 'seed', locationCode: 1, languageCode: 'en' },
        makeDeps({ provider }),
      ),
    ).rejects.toBeInstanceOf(TypeError);
  });

  it('uses default now() when deps.now is unset', async () => {
    const provider = createFakeKeywordProvider();
    const deps = { db: getTestDb() as never, provider, ttlDays: 30 };
    const result = await getRelatedCached(
      { keyword: 'seed', locationCode: 1, languageCode: 'en' },
      deps,
    );
    expect(result.related.length).toBeGreaterThanOrEqual(0);
  });

  it('uses default limit 25 when omitted', async () => {
    let seen = 0;
    const provider: KeywordProvider = {
      async getLongTailSuggestions() { return []; },
      async getMetrics() { return []; },
      async getRelated(_s, _l, _lang, l) {
        seen = l;
        return [];
      },
      async classifyIntent() { return []; },
      async getIdeas() { return []; },
      async getOverview() { return []; },
      async getHistoricalVolume() { return []; },
    };
    await getRelatedCached(
      { keyword: 'seed', locationCode: 1, languageCode: 'en' },
      makeDeps({ provider }),
    );
    expect(seen).toBe(25);
  });
});

function intentProvider(
  onCall: (kws: string[]) => IntentResult[],
  counter?: { n: number },
): KeywordProvider {
  return {
    async getLongTailSuggestions() { return []; },
    async getMetrics() { return []; },
    async getRelated() { return []; },
    async classifyIntent(kws) {
      if (counter) counter.n += 1;
      return onCall(kws);
    },
    async getIdeas() { return []; },
    async getOverview() { return []; },
    async getHistoricalVolume() { return []; },
  };
}

describe('classifyIntentCached', () => {
  it('populates the cache on miss then serves from cache on repeat (one row per input)', async () => {
    const calls = { n: 0 };
    const provider = intentProvider(
      (kws) =>
        kws.map((k) => ({
          keyword: k,
          intent: 'commercial' as const,
          confidence: 0.8,
        })),
      calls,
    );
    const deps = makeDeps({ provider });
    const first = await classifyIntentCached(
      { keywords: ['seo audit', 'rank tracker'], locationCode: 2840, languageCode: 'en' },
      deps,
    );
    expect(first).toHaveLength(2);
    expect(first[0]).toMatchObject({ keyword: 'seo audit', intent: 'commercial', confidence: 0.8, cached: false });
    expect(calls.n).toBe(1);

    const second = await classifyIntentCached(
      { keywords: ['seo audit', 'rank tracker'], locationCode: 2840, languageCode: 'en' },
      deps,
    );
    expect(second.every((r) => r.cached)).toBe(true);
    expect(second[0]?.intent).toBe('commercial');
    expect(calls.n).toBe(1);
  });

  it('normalizes a vendor-omitted keyword to null intent — never drops it', async () => {
    // Vendor only classifies the first keyword; the second must still appear.
    const provider = intentProvider((kws) => [
      { keyword: kws[0]!, intent: 'informational', confidence: 0.9 },
    ]);
    const result = await classifyIntentCached(
      { keywords: ['what is seo', 'obscure phrase'], locationCode: 1, languageCode: 'en' },
      makeDeps({ provider }),
    );
    expect(result).toEqual([
      expect.objectContaining({ keyword: 'what is seo', intent: 'informational', confidence: 0.9 }),
      expect.objectContaining({ keyword: 'obscure phrase', intent: null, confidence: null }),
    ]);
  });

  it('dedupes duplicate input phrases before hitting the vendor', async () => {
    const calls = { n: 0 };
    const provider = intentProvider((kws) => {
      expect(kws).toEqual(['seo']);
      return [{ keyword: 'seo', intent: 'commercial', confidence: 0.5 }];
    }, calls);
    const result = await classifyIntentCached(
      { keywords: ['SEO', 'seo', '  seo  '], locationCode: 1, languageCode: 'en' },
      makeDeps({ provider }),
    );
    expect(calls.n).toBe(1);
    expect(result).toHaveLength(1);
  });

  it('returns [] when every input is blank (no vendor call)', async () => {
    const calls = { n: 0 };
    const provider = intentProvider(() => [], calls);
    const result = await classifyIntentCached(
      { keywords: ['', '   '], locationCode: 1, languageCode: 'en' },
      makeDeps({ provider }),
    );
    expect(result).toEqual([]);
    expect(calls.n).toBe(0);
  });

  it('wraps ProviderError as 503 HttpError', async () => {
    const provider: KeywordProvider = {
      async getLongTailSuggestions() { return []; },
      async getMetrics() { return []; },
      async getRelated() { return []; },
      async classifyIntent() {
        throw new VendorQuotaError('exhausted', { provider: 'x', operation: 'y' });
      },
      async getIdeas() { return []; },
      async getOverview() { return []; },
      async getHistoricalVolume() { return []; },
    };
    await expect(
      classifyIntentCached(
        { keywords: ['a'], locationCode: 1, languageCode: 'en' },
        makeDeps({ provider }),
      ),
    ).rejects.toMatchObject({ status: 503, message: 'keywordResearch.errors.unavailable' });
  });

  it('rethrows non-ProviderError errors unchanged', async () => {
    const provider: KeywordProvider = {
      async getLongTailSuggestions() { return []; },
      async getMetrics() { return []; },
      async getRelated() { return []; },
      async classifyIntent() {
        throw new TypeError('bug');
      },
      async getIdeas() { return []; },
      async getOverview() { return []; },
      async getHistoricalVolume() { return []; },
    };
    await expect(
      classifyIntentCached(
        { keywords: ['a'], locationCode: 1, languageCode: 'en' },
        makeDeps({ provider }),
      ),
    ).rejects.toBeInstanceOf(TypeError);
  });

  it('uses default now() when deps.now is unset', async () => {
    const provider = createFakeKeywordProvider({
      intent: [{ keyword: 'x', intent: 'navigational', confidence: 0.6 }],
    });
    const deps = { db: getTestDb() as never, provider, ttlDays: 30 };
    const result = await classifyIntentCached(
      { keywords: ['x'], locationCode: 1, languageCode: 'en' },
      deps,
    );
    expect(result[0]?.fetchedAt).toBeDefined();
    expect(result[0]?.intent).toBe('navigational');
  });
});

function ideasProvider(
  rows: KeywordMetrics[],
  counter: { n: number },
): KeywordProvider {
  return {
    async getLongTailSuggestions() { return []; },
    async getMetrics() { return []; },
    async getRelated() { return []; },
    async classifyIntent() { return []; },
    async getIdeas(_seed, _loc, _lang, limit) {
      counter.n += 1;
      return rows.slice(0, limit);
    },
    async getOverview() { return []; },
    async getHistoricalVolume() { return []; },
  };
}

describe('getIdeasCached', () => {
  const IDEA: KeywordMetrics = {
    keyword: 'website audit checklist',
    searchVolume: 2900,
    difficulty: 41,
    cpc: 2.35,
    monthlySearches: [{ year: 2025, month: 12, searchVolume: 2900 }],
  };

  it('caches by seed — identical repeated seed serves the second call from cache', async () => {
    const calls = { n: 0 };
    const deps = makeDeps({ provider: ideasProvider([IDEA], calls) });
    const first = await getIdeasCached(
      { seed: 'seo audit', locationCode: 2840, languageCode: 'en' },
      deps,
    );
    expect(first.seed).toBe('seo audit');
    expect(first.cached).toBe(false);
    expect(first.ideas[0]).toMatchObject({ keyword: 'website audit checklist', cpc: '2.350000' });
    const second = await getIdeasCached(
      { seed: 'SEO   Audit ', locationCode: 2840, languageCode: 'EN' },
      deps,
    );
    expect(second.cached).toBe(true);
    expect(second.ideas[0]).toMatchObject({ keyword: 'website audit checklist', cpc: '2.350000' });
    expect(calls.n).toBe(1);
  });

  it('different locationCode is a distinct cache entry', async () => {
    const calls = { n: 0 };
    const deps = makeDeps({ provider: ideasProvider([IDEA], calls) });
    await getIdeasCached({ seed: 'seo audit', locationCode: 2840, languageCode: 'en' }, deps);
    await getIdeasCached({ seed: 'seo audit', locationCode: 2826, languageCode: 'en' }, deps);
    expect(calls.n).toBe(2);
  });

  it('expired entries refetch from the provider', async () => {
    const calls = { n: 0 };
    const clock = { value: NOW };
    const deps = makeDeps({
      provider: ideasProvider([IDEA], calls),
      now: () => clock.value,
    });
    await getIdeasCached({ seed: 'seo audit', locationCode: 2840, languageCode: 'en' }, deps);
    // 31 days later — past the 30-day TTL.
    clock.value = new Date(NOW.getTime() + 31 * 24 * 60 * 60 * 1000);
    const stale = await getIdeasCached(
      { seed: 'seo audit', locationCode: 2840, languageCode: 'en' },
      deps,
    );
    expect(stale.cached).toBe(false);
    expect(calls.n).toBe(2);
  });

  it('honours an explicit limit and clamps it to the vendor ceiling', async () => {
    let seen = 0;
    const provider: KeywordProvider = {
      async getLongTailSuggestions() { return []; },
      async getMetrics() { return []; },
      async getRelated() { return []; },
      async classifyIntent() { return []; },
      async getIdeas(_s, _l, _lang, l) {
        seen = l;
        return [];
      },
      async getOverview() { return []; },
      async getHistoricalVolume() { return []; },
    };
    await getIdeasCached(
      { seed: 'seed a', locationCode: 1, languageCode: 'en', limit: 5000 },
      makeDeps({ provider }),
    );
    expect(seen).toBe(1000);
    await getIdeasCached(
      { seed: 'seed b', locationCode: 1, languageCode: 'en', limit: 0 },
      makeDeps({ provider }),
    );
    expect(seen).toBe(1);
    await getIdeasCached(
      { seed: 'seed c', locationCode: 1, languageCode: 'en' },
      makeDeps({ provider }),
    );
    expect(seen).toBe(25);
  });

  it('captured vendor cost lands on the ideas archive row', async () => {
    const provider: KeywordProvider = {
      async getLongTailSuggestions() { return []; },
      async getMetrics() { return []; },
      async getRelated() { return []; },
      async classifyIntent() { return []; },
      async getIdeas() {
        recordVendorCostUsd(0.000007); // 7 micros
        return [IDEA];
      },
      async getOverview() { return []; },
      async getHistoricalVolume() { return []; },
    };
    await getIdeasCached(
      { seed: 'seo audit', locationCode: 2840, languageCode: 'en' },
      makeDeps({ provider }),
    );
    const rows = await getTestDb().select().from(vendorResponses);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ capability: 'keyword', operation: 'ideas', accountId: null });
    expect(rows[0]?.costMicros).toBe(7n);
  });

  it('uses default now() when deps.now is unset', async () => {
    const calls = { n: 0 };
    const deps = { db: getTestDb() as never, provider: ideasProvider([IDEA], calls), ttlDays: 30 };
    const result = await getIdeasCached(
      { seed: 'seo audit', locationCode: 2840, languageCode: 'en' },
      deps,
    );
    expect(result.cached).toBe(false);
    expect(result.ideas).toHaveLength(1);
  });

  it('wraps ProviderError as 503 HttpError', async () => {
    const provider: KeywordProvider = {
      async getLongTailSuggestions() { return []; },
      async getMetrics() { return []; },
      async getRelated() { return []; },
      async classifyIntent() { return []; },
      async getIdeas() {
        throw new VendorQuotaError('nope', { provider: 'x', operation: 'y' });
      },
      async getOverview() { return []; },
      async getHistoricalVolume() { return []; },
    };
    await expect(
      getIdeasCached(
        { seed: 'seed', locationCode: 1, languageCode: 'en' },
        makeDeps({ provider }),
      ),
    ).rejects.toBeInstanceOf(HttpError);
  });

  it('rethrows non-ProviderError errors unchanged', async () => {
    const provider: KeywordProvider = {
      async getLongTailSuggestions() { return []; },
      async getMetrics() { return []; },
      async getRelated() { return []; },
      async classifyIntent() { return []; },
      async getIdeas() {
        throw new TypeError('bug');
      },
      async getOverview() { return []; },
      async getHistoricalVolume() { return []; },
    };
    await expect(
      getIdeasCached(
        { seed: 'seed', locationCode: 1, languageCode: 'en' },
        makeDeps({ provider }),
      ),
    ).rejects.toBeInstanceOf(TypeError);
  });
});

describe('getLongTailSuggestionsCached', () => {
  it('always requests and returns at most the fixed 25 suggestions', async () => {
    const fake = createFakeKeywordProvider();
    const rows = Array.from({ length: 30 }, (_, index): KeywordMetrics => ({
      keyword: `seo audit tool for niche ${index}`,
      searchVolume: index,
      difficulty: index,
      cpc: null,
      monthlySearches: [],
    }));
    const getLongTailSuggestions = vi.fn().mockResolvedValue(rows);
    const provider: KeywordProvider = { ...fake, getLongTailSuggestions };

    const result = await getLongTailSuggestionsCached(
      { seed: 'SEO Audit Tool', locationCode: 2840, languageCode: 'en' },
      makeDeps({ provider }),
    );

    expect(getLongTailSuggestions).toHaveBeenCalledWith('seo audit tool', 2840, 'en', 25);
    expect(result.suggestions).toHaveLength(25);
  });
});
