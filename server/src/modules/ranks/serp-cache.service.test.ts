import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  cacheKeyToAdvisoryLockId,
  computeSerpCacheKey,
  createSerpCacheRepo,
  normalizePhrase,
} from './serp-cache.service.js';
import { vendorCache, vendorResponses } from '../../db/schema/index.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';

beforeAll(async () => {
  await startTestPostgres();
});
afterAll(async () => {
  await stopTestPostgres();
});
beforeEach(async () => {
  await truncateAllTables();
});

describe('computeSerpCacheKey', () => {
  it('produces sha256 hex for the canonicalized tuple', () => {
    const k = computeSerpCacheKey({
      phrase: '  Best SEO  Tool ',
      locationCode: 2840,
      languageCode: 'EN',
      device: 'DESKTOP',
    });
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    const same = computeSerpCacheKey({
      phrase: 'best seo tool',
      locationCode: 2840,
      languageCode: 'en',
      device: 'desktop',
    });
    expect(same).toBe(k);
  });

  it('differs across tuples', () => {
    const a = computeSerpCacheKey({ phrase: 'a', locationCode: 1, languageCode: 'en', device: 'desktop' });
    const b = computeSerpCacheKey({ phrase: 'a', locationCode: 2, languageCode: 'en', device: 'desktop' });
    expect(a).not.toBe(b);
  });
});

describe('normalizePhrase', () => {
  it('collapses internal whitespace and lowercases', () => {
    expect(normalizePhrase('   HELLO   world  ')).toBe('hello world');
  });
});

describe('cacheKeyToAdvisoryLockId', () => {
  it('returns a positive bigint under 2^63 for hex input', () => {
    const id = cacheKeyToAdvisoryLockId('ffffffffffffffff' + '0'.repeat(48));
    expect(id).toBeLessThan(1n << 63n);
    expect(id).toBeGreaterThanOrEqual(0n);
  });
  it('hashes non-hex input rather than throwing', () => {
    const id = cacheKeyToAdvisoryLockId('not-a-hex-key');
    expect(id).toBeGreaterThan(0n);
    expect(id).toBeLessThan(1n << 63n);
  });
});

describe('createSerpCacheRepo', () => {
  it('read returns null when the row does not exist', async () => {
    const repo = createSerpCacheRepo({ db: getTestDb() as unknown as never });
    expect(await repo.read('missing', new Date())).toBeNull();
  });

  it('write then read returns the cached row until expiry', async () => {
    const repo = createSerpCacheRepo({ db: getTestDb() as unknown as never });
    const now = new Date('2026-07-05T00:00:00.000Z');
    await repo.write({
      cacheKey: 'k1',
      topResults: [{ domain: 'a.example', url: 'https://a.example/', rankGroup: 1, rankAbsolute: 1 }],
      aiOverview: {
        present: true,
        references: [{ domain: 'a.example', url: 'https://a.example/answer', title: 'Answer' }],
      },
      fetchedAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
    });
    const read = await repo.read('k1', now);
    expect(read?.topResults).toHaveLength(1);
    expect(read?.aiOverview).toEqual({
      present: true,
      references: [{ domain: 'a.example', url: 'https://a.example/answer', title: 'Answer' }],
    });
    const expired = await repo.read('k1', new Date(now.getTime() + 60_001));
    expect(expired).toBeNull();
  });

  it('withSingleFlightLock runs the task inside a transaction (PGlite fallback path)', async () => {
    const repo = createSerpCacheRepo({ db: getTestDb() as unknown as never });
    const key = 'a1b2c3d4e5f6a1b2';
    const result = await repo.withSingleFlightLock(key, async () => 'value');
    expect(result).toBe('value');
  });

  it('two concurrent misses on one key → exactly one vendor call (single-flight)', async () => {
    const repo = createSerpCacheRepo({ db: getTestDb() as unknown as never });
    let calls = 0;
    const task = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return calls;
    };
    const key = 'aabbccddeeff1122';
    const [a, b] = await Promise.all([
      repo.withSingleFlightLock(key, task),
      repo.withSingleFlightLock(key, task),
    ]);
    expect(calls).toBe(1);
    expect(a).toBe(1);
    expect(b).toBe(1);
  });

  it('leader-aware single-flight marks only concurrent joiners', async () => {
    const repo = createSerpCacheRepo({ db: getTestDb() as unknown as never });
    let calls = 0;
    const task = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return 'shared';
    };
    const [first, second] = await Promise.all([
      repo.withSingleFlightLockLeaderAware('leader-aware', task),
      repo.withSingleFlightLockLeaderAware('leader-aware', task),
    ]);
    expect(calls).toBe(1);
    expect(first).toEqual({ value: 'shared', joined: false });
    expect(second).toEqual({ value: 'shared', joined: true });
  });

  it('single-flight releases after the promise settles — next call fires afresh', async () => {
    const repo = createSerpCacheRepo({ db: getTestDb() as unknown as never });
    let calls = 0;
    const task = async () => {
      calls += 1;
      return calls;
    };
    await repo.withSingleFlightLock('k-single', task);
    await repo.withSingleFlightLock('k-single', task);
    expect(calls).toBe(2);
  });

  it('single-flight surfaces the underlying error to all callers', async () => {
    const repo = createSerpCacheRepo({ db: getTestDb() as unknown as never });
    const boom = async (): Promise<number> => {
      throw new Error('boom');
    };
    await expect(repo.withSingleFlightLock('errkey', boom)).rejects.toThrow('boom');
    // Slot should have been released — a subsequent call runs again.
    let called = false;
    await repo.withSingleFlightLock('errkey', async () => { called = true; });
    expect(called).toBe(true);
  });

  it('write() upserts under a unique constraint (single-flight fallback safety)', async () => {
    const repo = createSerpCacheRepo({ db: getTestDb() as unknown as never });
    const now = new Date('2026-07-05T00:00:00.000Z');
    await repo.write({
      cacheKey: 'k3',
      topResults: [],
      aiOverview: null,
      fetchedAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
    });
    // Second writer overrides — no unique-violation exception thrown.
    await repo.write({
      cacheKey: 'k3',
      topResults: [{ domain: 'b.example', url: 'https://b.example/', rankGroup: 1, rankAbsolute: 1 }],
      aiOverview: null,
      fetchedAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
    });
    const read = await repo.read('k3', now);
    expect(read?.topResults).toHaveLength(1);
    // Row written with no AI signal reads back as null (pre-feature parity).
    expect(read?.aiOverview).toBeNull();
  });

  it('every write appends a vendor_responses archive row (params stored when given)', async () => {
    const db = getTestDb();
    const repo = createSerpCacheRepo({ db: db as unknown as never });
    const now = new Date('2026-07-05T00:00:00.000Z');
    const params = { phrase: 'seo tool', locationCode: 2840, languageCode: 'en', device: 'desktop' };
    await repo.write({
      cacheKey: 'k-archive',
      topResults: [{ domain: 'a.example', url: 'https://a.example/', rankGroup: 1, rankAbsolute: 1 }],
      aiOverview: null,
      fetchedAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
      params,
    });
    await repo.write({
      cacheKey: 'k-archive',
      topResults: [],
      aiOverview: null,
      fetchedAt: new Date(now.getTime() + 1_000),
      expiresAt: new Date(now.getTime() + 61_000),
      params,
    });
    const archived = await db
      .select()
      .from(vendorResponses)
      .where(eq(vendorResponses.cacheKey, 'k-archive'));
    // Append-only: the overwrite kept BOTH fetches in the archive.
    expect(archived).toHaveLength(2);
    expect(archived[0]?.capability).toBe('rank');
    expect(archived[0]?.operation).toBe('serp');
    expect(archived[0]?.accountId).toBeNull();
    expect(archived.map((r) => r.params)).toEqual([params, params]);
    // The read-through cache row itself is singular (upsert).
    const cacheRows = await db.select().from(vendorCache).where(eq(vendorCache.cacheKey, 'k-archive'));
    expect(cacheRows).toHaveLength(1);
  });

  it('write persists the captured vendor cost on the archive row; absent cost stores null', async () => {
    const db = getTestDb();
    const repo = createSerpCacheRepo({ db: db as unknown as never });
    const now = new Date('2026-07-05T00:00:00.000Z');
    await repo.write({
      cacheKey: 'k-cost',
      topResults: [],
      aiOverview: null,
      fetchedAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
      costMicros: 4_650n,
    });
    await repo.write({
      cacheKey: 'k-cost',
      topResults: [],
      aiOverview: null,
      fetchedAt: new Date(now.getTime() + 1_000),
      expiresAt: new Date(now.getTime() + 61_000),
    });
    const archived = await db
      .select()
      .from(vendorResponses)
      .where(eq(vendorResponses.cacheKey, 'k-cost'));
    archived.sort((a, b) => a.fetchedAt.getTime() - b.fetchedAt.getTime());
    expect(archived.map((r) => r.costMicros)).toEqual([4_650n, null]);
  });

  it('a corrupt cached payload reads as a miss (stale-shape tolerance)', async () => {
    const db = getTestDb();
    const repo = createSerpCacheRepo({ db: db as unknown as never });
    const now = new Date('2026-07-05T00:00:00.000Z');
    await db.insert(vendorCache).values({
      capability: 'rank',
      operation: 'serp',
      cacheKey: 'k-corrupt',
      params: {},
      payload: { legacyShape: true },
      fetchedAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
    });
    expect(await repo.read('k-corrupt', now)).toBeNull();
  });
});
