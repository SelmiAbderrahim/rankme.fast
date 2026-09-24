import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { vendorCache, vendorResponses } from '../../db/schema/index.js';
import type { PageSpeedProvider, PageSpeedResult } from '../providers/index.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../testing/postgres.js';
import { createCachedPageSpeedProvider } from './pagespeed-cache.js';
import { createReadThrough } from './read-through.js';
import { createSingleFlight } from './single-flight.js';
import { createVendorCacheRepo } from './vendor-cache.repo.js';

beforeAll(async () => {
  await startTestPostgres();
});
afterAll(async () => {
  await stopTestPostgres();
});
beforeEach(async () => {
  await truncateAllTables();
});

const HOUR_MS = 60 * 60 * 1000;

/** Mirrors the Google adapter: PageSpeedResult + extra fieldDataLevel marker. */
type AnalyzedLike = PageSpeedResult & { fieldDataLevel: 'url' | 'origin' | 'none' };

function makeCached(opts?: {
  now?: () => Date;
  failure?: Error;
  cacheNamespace?: string;
}) {
  let calls = 0;
  const inner: PageSpeedProvider = {
    async analyze(input) {
      calls += 1;
      if (opts?.failure) throw opts.failure;
      const analyzed: AnalyzedLike = {
        labScores: { performance: 88, seo: 92, accessibility: 90, bestPractices: 85 },
        coreWebVitals: { lcpMs: 2100, inp: 180, cls: 0.05, category: 'good' },
        mobileFriendly: input.strategy === 'mobile',
        fieldDataLevel: 'origin',
      };
      return analyzed;
    },
  };
  const readThrough = createReadThrough({
    repo: createVendorCacheRepo(getTestDb() as never),
    singleFlight: createSingleFlight(),
    ...(opts?.now ? { clock: opts.now } : {}),
  });
  const provider = createCachedPageSpeedProvider({
    inner,
    readThrough,
    cacheNamespace: opts?.cacheNamespace ?? 'google-psi-crux:v1',
    ttlMs: 24 * HOUR_MS,
    ...(opts?.now ? { now: opts.now } : {}),
  });
  return { provider, calls: () => calls };
}

describe('createCachedPageSpeedProvider', () => {
  const now = new Date('2026-07-01T00:00:00.000Z');

  it('second analyze of the same (url, strategy) is served from the DB — one vendor call', async () => {
    const { provider, calls } = makeCached({ now: () => now });
    const first = await provider.analyze({ url: 'https://example.com/', strategy: 'mobile' });
    const second = await provider.analyze({ url: 'https://example.com/', strategy: 'mobile' });
    expect(calls()).toBe(1);
    expect(second.labScores).toEqual(first.labScores);
    expect(second.coreWebVitals).toEqual(first.coreWebVitals);
  });

  it('preserves the out-of-interface fieldDataLevel marker across the cache roundtrip', async () => {
    const { provider, calls } = makeCached({ now: () => now });
    await provider.analyze({ url: 'https://example.com/', strategy: 'mobile' });
    const cached = await provider.analyze({ url: 'https://example.com/', strategy: 'mobile' });
    expect(calls()).toBe(1);
    // The audit processor reads this via cast — the passthrough schema must
    // carry it or CrUX labeling silently regresses on cache hits.
    expect((cached as AnalyzedLike).fieldDataLevel).toBe('origin');
  });

  it('a different strategy for the same url is a different key', async () => {
    const { provider, calls } = makeCached({ now: () => now });
    const mobile = await provider.analyze({ url: 'https://example.com/', strategy: 'mobile' });
    const desktop = await provider.analyze({ url: 'https://example.com/', strategy: 'desktop' });
    expect(calls()).toBe(2);
    expect(mobile.mobileFriendly).toBe(true);
    expect(desktop.mobileFriendly).toBe(false);
  });

  it('expired entries refetch (TTL respected via injected clock)', async () => {
    let calls = 0;
    const inner: PageSpeedProvider = {
      async analyze() {
        calls += 1;
        return {
          labScores: { performance: calls, seo: 1, accessibility: 1, bestPractices: 1 },
        };
      },
    };
    let clock = new Date('2026-07-01T00:00:00.000Z');
    const readThrough = createReadThrough({
      repo: createVendorCacheRepo(getTestDb() as never),
      singleFlight: createSingleFlight(),
      clock: () => clock,
    });
    const provider = createCachedPageSpeedProvider({
      inner,
      readThrough,
      cacheNamespace: 'google-psi-crux:v1',
      ttlMs: 24 * HOUR_MS,
      now: () => clock,
    });
    await provider.analyze({ url: 'https://x.example/', strategy: 'mobile' });
    clock = new Date('2026-07-02T01:00:00.000Z'); // 25h later — past TTL
    const refreshed = await provider.analyze({ url: 'https://x.example/', strategy: 'mobile' });
    expect(calls).toBe(2);
    expect(refreshed.labScores.performance).toBe(2);
  });

  it('defaults its clock to the wall clock when `now` is not injected', async () => {
    const { provider, calls } = makeCached();
    await provider.analyze({ url: 'https://wall.example/', strategy: 'mobile' });
    expect(calls()).toBe(1);
  });

  it('never serves a fake or Google entry after switching to DataForSEO', async () => {
    const readThrough = createReadThrough({
      repo: createVendorCacheRepo(getTestDb() as never),
      singleFlight: createSingleFlight(),
      clock: () => now,
    });
    let fakeCalls = 0;
    let liveCalls = 0;
    const fake = createCachedPageSpeedProvider({
      inner: {
        async analyze() {
          fakeCalls += 1;
          return {
            labScores: {
              performance: 1,
              seo: 1,
              accessibility: 1,
              bestPractices: 1,
            },
          };
        },
      },
      readThrough,
      cacheNamespace: 'fake:v1',
      ttlMs: 24 * HOUR_MS,
      now: () => now,
    });
    const live = createCachedPageSpeedProvider({
      inner: {
        async analyze() {
          liveCalls += 1;
          return {
            labScores: {
              performance: 91,
              seo: 92,
              accessibility: 93,
              bestPractices: 94,
            },
          };
        },
      },
      readThrough,
      cacheNamespace: 'dataforseo-lighthouse-live:v1',
      ttlMs: 24 * HOUR_MS,
      now: () => now,
    });

    await fake.analyze({ url: 'https://switch.example/', strategy: 'mobile' });
    const result = await live.analyze({
      url: 'https://switch.example/',
      strategy: 'mobile',
    });

    expect(fakeCalls).toBe(1);
    expect(liveCalls).toBe(1);
    expect(result.labScores.performance).toBe(91);
  });

  it('vendor errors pass through and write neither cache nor archive', async () => {
    const db = getTestDb();
    const { provider } = makeCached({ now: () => now, failure: new Error('PSI quota') });
    await expect(
      provider.analyze({ url: 'https://example.com/', strategy: 'mobile' }),
    ).rejects.toThrow('PSI quota');
    await expect(db.select().from(vendorCache)).resolves.toHaveLength(0);
    await expect(db.select().from(vendorResponses)).resolves.toHaveLength(0);
  });

  it('fresh fetches land in the vendor_responses archive under pagespeed/analyze', async () => {
    const db = getTestDb();
    const { provider } = makeCached({ now: () => now });
    await provider.analyze({ url: 'https://example.com/', strategy: 'desktop' });
    const rows = await db.select().from(vendorResponses);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.capability).toBe('pagespeed');
    expect(rows[0]?.operation).toBe('analyze');
    expect(rows[0]?.params).toEqual({
      cacheNamespace: 'google-psi-crux:v1',
      url: 'https://example.com/',
      strategy: 'desktop',
    });
    expect(rows[0]?.accountId).toBeNull();
  });
});
