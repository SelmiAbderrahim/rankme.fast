import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { vendorCache, vendorResponses } from '../../db/schema/index.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../testing/postgres.js';
import { recordVendorCostUsd } from '../providers/cost-capture.js';
import { computeVendorCacheKey } from './cache-key.js';
import { createReadThrough } from './read-through.js';
import { createSingleFlight, type SingleFlight } from './single-flight.js';
import { createVendorCacheRepo, type VendorCacheRepo } from './vendor-cache.repo.js';

beforeAll(async () => {
  await startTestPostgres();
});
afterAll(async () => {
  await stopTestPostgres();
});
beforeEach(async () => {
  await truncateAllTables();
});

const now = new Date('2026-07-01T00:00:00.000Z');
const payloadSchema = z.object({ score: z.number() });

function makeReadThrough(overrides?: {
  singleFlight?: SingleFlight;
  logger?: { warn: (c: Record<string, unknown>, m: string) => void };
  clock?: () => Date;
  repo?: VendorCacheRepo;
}) {
  const repo = overrides?.repo ?? createVendorCacheRepo(getTestDb() as never);
  return {
    repo,
    readThrough: createReadThrough({
      repo,
      singleFlight: overrides?.singleFlight ?? createSingleFlight(),
      logger: overrides?.logger,
      // Default clock to a deterministic value for the existing suites; the
      // production default is `() => new Date()`.
      clock: overrides?.clock ?? (() => now),
    }),
  };
}

function baseInput(fetchImpl: () => Promise<{ score: number }>, at: Date = now) {
  return {
    capability: 'backlink' as const,
    operation: 'summary',
    params: { domain: 'example.com' },
    ttlMs: 60 * 60 * 1000,
    payloadSchema,
    fetch: fetchImpl,
    now: at,
  };
}

describe('createReadThrough', () => {
  it('miss → fetches, archives one row, caches one row, returns cached:false', async () => {
    const db = getTestDb();
    const { readThrough } = makeReadThrough();
    let vendorCalls = 0;
    const result = await readThrough(
      baseInput(async () => {
        vendorCalls += 1;
        return { score: 42 };
      }),
    );
    expect(result).toEqual({ value: { score: 42 }, cached: false, fetchedAt: now });
    expect(vendorCalls).toBe(1);
    const archived = await db.select().from(vendorResponses);
    expect(archived).toHaveLength(1);
    expect(archived[0]?.payload).toEqual({ score: 42 });
    expect(archived[0]?.accountId).toBeNull();
    const cached = await db.select().from(vendorCache);
    expect(cached).toHaveLength(1);
    expect(cached[0]?.expiresAt.getTime()).toBe(now.getTime() + 60 * 60 * 1000);
  });

  it('hit → serves from DB with zero vendor calls and zero new archive rows', async () => {
    const db = getTestDb();
    const { readThrough } = makeReadThrough();
    let vendorCalls = 0;
    const fetch = async () => {
      vendorCalls += 1;
      return { score: 7 };
    };
    await readThrough(baseInput(fetch));
    const second = await readThrough(baseInput(fetch, new Date(now.getTime() + 1000)));
    expect(second.cached).toBe(true);
    expect(second.value).toEqual({ score: 7 });
    expect(second.fetchedAt.toISOString()).toBe(now.toISOString());
    expect(vendorCalls).toBe(1);
    await expect(db.select().from(vendorResponses)).resolves.toHaveLength(1);
  });

  it('expired row → refetches and overwrites', async () => {
    const db = getTestDb();
    const { readThrough } = makeReadThrough();
    let vendorCalls = 0;
    const fetch = async () => {
      vendorCalls += 1;
      return { score: vendorCalls };
    };
    await readThrough(baseInput(fetch));
    const afterExpiry = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const second = await readThrough(baseInput(fetch, afterExpiry));
    expect(second.cached).toBe(false);
    expect(second.value).toEqual({ score: 2 });
    expect(vendorCalls).toBe(2);
    // Cache row overwritten in place — still exactly one.
    await expect(db.select().from(vendorCache)).resolves.toHaveLength(1);
    // Archive keeps BOTH fetches forever.
    await expect(db.select().from(vendorResponses)).resolves.toHaveLength(2);
  });

  it('corrupt cached payload → warns, treats as miss, refetch overwrites', async () => {
    const db = getTestDb();
    const warns: string[] = [];
    const { readThrough } = makeReadThrough({
      logger: { warn: (_ctx, msg) => warns.push(msg) },
    });
    const cacheKey = computeVendorCacheKey({
      capability: 'backlink',
      operation: 'summary',
      params: { domain: 'example.com' },
    });
    await db.insert(vendorCache).values({
      capability: 'backlink',
      operation: 'summary',
      cacheKey,
      params: { domain: 'example.com' },
      payload: { totally: 'wrong-shape' },
      fetchedAt: now,
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    });
    let vendorCalls = 0;
    const result = await readThrough(
      baseInput(async () => {
        vendorCalls += 1;
        return { score: 9 };
      }),
    );
    expect(result.cached).toBe(false);
    expect(result.value).toEqual({ score: 9 });
    expect(vendorCalls).toBe(1);
    expect(warns.length).toBeGreaterThanOrEqual(1);
    const rows = await db.select().from(vendorCache).where(eq(vendorCache.cacheKey, cacheKey));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload).toEqual({ score: 9 });
  });

  it('corrupt payload without a logger still treats as miss (optional-logger branch)', async () => {
    const db = getTestDb();
    const { readThrough } = makeReadThrough();
    const cacheKey = computeVendorCacheKey({
      capability: 'backlink',
      operation: 'summary',
      params: { domain: 'example.com' },
    });
    await db.insert(vendorCache).values({
      capability: 'backlink',
      operation: 'summary',
      cacheKey,
      params: {},
      payload: 'not-an-object',
      fetchedAt: now,
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    });
    const result = await readThrough(baseInput(async () => ({ score: 1 })));
    expect(result.cached).toBe(false);
  });

  it('vendor error → propagates, writes neither cache nor archive', async () => {
    const db = getTestDb();
    const { readThrough } = makeReadThrough();
    await expect(
      readThrough(
        baseInput(async () => {
          throw new Error('quota exceeded');
        }),
      ),
    ).rejects.toThrow('quota exceeded');
    await expect(db.select().from(vendorCache)).resolves.toHaveLength(0);
    await expect(db.select().from(vendorResponses)).resolves.toHaveLength(0);
  });

  it('two concurrent misses on the same key → exactly one vendor call', async () => {
    const { readThrough } = makeReadThrough();
    let vendorCalls = 0;
    const fetch = async () => {
      vendorCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { score: 5 };
    };
    const [a, b] = await Promise.all([
      readThrough(baseInput(fetch)),
      readThrough(baseInput(fetch)),
    ]);
    expect(vendorCalls).toBe(1);
    expect(a.value).toEqual({ score: 5 });
    expect(b.value).toEqual({ score: 5 });
    // One of the two flights owns the fresh fetch; the other shares it.
    expect([a.cached, b.cached]).toContain(false);
  });

  it('double-check inside the flight → a row written while waiting is served, not refetched', async () => {
    const { repo, readThrough } = makeReadThrough({
      singleFlight: (() => {
        const gate = {
          run: async <T,>(key: string, task: () => Promise<T>): Promise<T> => {
            await repo.upsert({
              capability: 'backlink',
              operation: 'summary',
              cacheKey: key,
              params: { domain: 'example.com' },
              payload: { score: 99 },
              fetchedAt: now,
              expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
            });
            return task();
          },
          runLeaderAware: async <T,>(
            key: string,
            task: () => Promise<T>,
          ): Promise<{ value: T; joined: boolean }> => {
            const value = await gate.run(key, task);
            return { value, joined: false };
          },
        };
        return gate;
      })(),
    });
    let vendorCalls = 0;
    const result = await readThrough(
      baseInput(async () => {
        vendorCalls += 1;
        return { score: 1 };
      }),
    );
    expect(result.cached).toBe(true);
    expect(result.value).toEqual({ score: 99 });
    expect(vendorCalls).toBe(0);
  });

  it('forceRefresh: skips a fresh cache hit, re-fetches, overwrites cache, appends archive', async () => {
    const db = getTestDb();
    const { readThrough } = makeReadThrough();
    let vendorCalls = 0;
    const fetch = async () => {
      vendorCalls += 1;
      return { score: vendorCalls };
    };
    await readThrough(baseInput(fetch));
    // Well inside the 1h TTL — a normal read would be a hit.
    const later = new Date(now.getTime() + 1000);
    const forced = await readThrough({ ...baseInput(fetch, later), forceRefresh: true });
    expect(forced.cached).toBe(false);
    expect(forced.value).toEqual({ score: 2 });
    expect(vendorCalls).toBe(2);
    // Cache row overwritten in place; archive keeps both fetches.
    const cached = await db.select().from(vendorCache);
    expect(cached).toHaveLength(1);
    expect(cached[0]?.payload).toEqual({ score: 2 });
    await expect(db.select().from(vendorResponses)).resolves.toHaveLength(2);
  });

  it('forceRefresh: skips the in-flight double-check too', async () => {
    const { repo, readThrough } = makeReadThrough({
      singleFlight: (() => {
        const gate = {
          run: async <T,>(key: string, task: () => Promise<T>): Promise<T> => {
            await repo.upsert({
              capability: 'backlink',
              operation: 'summary',
              cacheKey: key,
              params: { domain: 'example.com' },
              payload: { score: 99 },
              fetchedAt: now,
              expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
            });
            return task();
          },
          runLeaderAware: async <T,>(
            key: string,
            task: () => Promise<T>,
          ): Promise<{ value: T; joined: boolean }> => {
            const value = await gate.run(key, task);
            return { value, joined: false };
          },
        };
        return gate;
      })(),
    });
    let vendorCalls = 0;
    const result = await readThrough({
      ...baseInput(async () => {
        vendorCalls += 1;
        return { score: 1 };
      }),
      forceRefresh: true,
    });
    expect(result.cached).toBe(false);
    expect(result.value).toEqual({ score: 1 });
    expect(vendorCalls).toBe(1);
  });

  it('persists the vendor cost captured during the fetch on the archive row', async () => {
    const db = getTestDb();
    const { readThrough } = makeReadThrough();
    await readThrough(
      baseInput(async () => {
        // Simulates dataForSeoRequest recording two envelope costs.
        recordVendorCostUsd(0.002);
        recordVendorCostUsd(0.0006);
        return { score: 42 };
      }),
    );
    const rows = await db.select().from(vendorResponses);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.costMicros).toBe(2_600n);
  });

  it('archives costMicros null when the fetch records no cost', async () => {
    const db = getTestDb();
    const { readThrough } = makeReadThrough();
    await readThrough(baseInput(async () => ({ score: 1 })));
    const rows = await db.select().from(vendorResponses);
    expect(rows[0]?.costMicros).toBeNull();
  });

  it('stores accountId on the archive row for private capabilities', async () => {
    const db = getTestDb();
    const { readThrough } = makeReadThrough();
    await readThrough({
      ...baseInput(async () => ({ score: 3 })),
      capability: 'gsc',
      operation: 'inspect-url',
      params: { accountId: 'acc-9', inspectionUrl: 'https://example.com/' },
      accountId: 'acc-9',
    });
    const rows = await db.select().from(vendorResponses);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.accountId).toBe('acc-9');
  });

  it('single-flight joiners report cached:true while the leader reports cached:false', async () => {
    const { readThrough } = makeReadThrough();
    let vendorCalls = 0;
    const fetch = async () => {
      vendorCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { score: 5 };
    };
    const [a, b] = await Promise.all([
      readThrough(baseInput(fetch)),
      readThrough(baseInput(fetch)),
    ]);
    expect(vendorCalls).toBe(1);
    // Exactly one call is the leader (cached:false); every other awaiter is
    // cache-effective (cached:true).
    const cachedFlags = [a.cached, b.cached].sort();
    expect(cachedFlags).toEqual([false, true]);
    expect(a.value).toEqual({ score: 5 });
    expect(b.value).toEqual({ score: 5 });
  });

  it('fetchedAt is stamped from the injected clock AFTER the vendor fetch resolves', async () => {
    // The clock advances DURING the vendor fetch — so the value returned to
    // the caller reflects the timestamp AT completion, not at request arrival.
    let vendorCompletedAt: Date | undefined;
    let clockCalls = 0;
    const laterStamp = new Date('2026-07-01T00:00:03.000Z');
    const clock = () => {
      clockCalls += 1;
      // Only produce the later stamp AFTER the vendor's fetch flag flipped.
      return vendorCompletedAt ? laterStamp : new Date('2026-07-01T00:00:00.000Z');
    };
    const { readThrough } = makeReadThrough({ clock });
    const result = await readThrough(
      baseInput(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        vendorCompletedAt = new Date();
        return { score: 12 };
      }),
    );
    expect(clockCalls).toBeGreaterThan(0);
    expect(result.fetchedAt.toISOString()).toBe('2026-07-01T00:00:03.000Z');
  });

  it('defaults to a real-clock stamp when no clock is injected', async () => {
    const repo = createVendorCacheRepo(getTestDb() as never);
    // Bypass makeReadThrough (whose default stubs the clock) — go direct.
    const readThrough = createReadThrough({
      repo,
      singleFlight: createSingleFlight(),
    });
    const before = Date.now();
    const result = await readThrough(baseInput(async () => ({ score: 1 })));
    const after = Date.now();
    expect(result.fetchedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.fetchedAt.getTime()).toBeLessThanOrEqual(after);
  });

  it('an archive write failure logs a warning and still returns the fetched value', async () => {
    const baseRepo = createVendorCacheRepo(getTestDb() as never);
    const warns: string[] = [];
    const repo = {
      ...baseRepo,
      appendResponse: async () => {
        throw new Error('archive down');
      },
    };
    const { readThrough } = makeReadThrough({
      repo,
      logger: { warn: (_ctx, msg) => warns.push(msg) },
    });
    const result = await readThrough(baseInput(async () => ({ score: 1 })));
    expect(result.value).toEqual({ score: 1 });
    expect(result.cached).toBe(false);
    expect(warns.some((m) => /archive/i.test(m))).toBe(true);
    // Upsert still happened → cache row exists.
    const rows = await getTestDb().select().from(vendorCache);
    expect(rows).toHaveLength(1);
  });

  it('a cache upsert failure logs a warning and still returns the fetched value', async () => {
    const baseRepo = createVendorCacheRepo(getTestDb() as never);
    const warns: string[] = [];
    const repo = {
      ...baseRepo,
      upsert: async () => {
        throw new Error('cache down');
      },
    };
    const { readThrough } = makeReadThrough({
      repo,
      logger: { warn: (_ctx, msg) => warns.push(msg) },
    });
    const result = await readThrough(baseInput(async () => ({ score: 2 })));
    expect(result.value).toEqual({ score: 2 });
    expect(result.cached).toBe(false);
    expect(warns.some((m) => /upsert/i.test(m))).toBe(true);
    // No logger seat: also passes silently (branch coverage below).
  });

  it('write failures without a logger are still tolerated', async () => {
    const baseRepo = createVendorCacheRepo(getTestDb() as never);
    const repo = {
      ...baseRepo,
      appendResponse: async () => {
        throw new Error('archive down');
      },
      upsert: async () => {
        throw new Error('cache down');
      },
    };
    const { readThrough } = makeReadThrough({ repo });
    const result = await readThrough(baseInput(async () => ({ score: 3 })));
    expect(result.value).toEqual({ score: 3 });
  });
});
