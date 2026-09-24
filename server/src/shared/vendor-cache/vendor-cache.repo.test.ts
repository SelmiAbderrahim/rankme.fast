import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { vendorResponses } from '../../db/schema/index.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../testing/postgres.js';
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

const now = new Date('2026-07-01T00:00:00.000Z');
const later = new Date('2026-07-02T00:00:00.000Z');
const address = { capability: 'backlink', operation: 'summary', cacheKey: 'k1' } as const;

describe('VendorCacheRepo.read', () => {
  it('returns null on a cold table', async () => {
    const repo = createVendorCacheRepo(getTestDb() as never);
    await expect(repo.read(address, now)).resolves.toBeNull();
  });

  it('returns null when the row is expired', async () => {
    const repo = createVendorCacheRepo(getTestDb() as never);
    await repo.upsert({ ...address, params: { d: 1 }, payload: { v: 1 }, fetchedAt: now, expiresAt: later });
    await expect(repo.read(address, later)).resolves.toBeNull();
  });

  it('returns the row while fresh, with params + payload roundtripped', async () => {
    const repo = createVendorCacheRepo(getTestDb() as never);
    const payload = { rows: [{ url: 'https://a.example/', n: 3 }], nested: { deep: true } };
    await repo.upsert({ ...address, params: { domain: 'a.example' }, payload, fetchedAt: now, expiresAt: later });
    const hit = await repo.read(address, now);
    expect(hit).not.toBeNull();
    expect(hit?.payload).toEqual(payload);
    expect(hit?.params).toEqual({ domain: 'a.example' });
    expect(hit?.fetchedAt.toISOString()).toBe(now.toISOString());
    expect(hit?.expiresAt.toISOString()).toBe(later.toISOString());
  });

  it('is keyed by (capability, operation, cacheKey) — sibling operations do not collide', async () => {
    const repo = createVendorCacheRepo(getTestDb() as never);
    await repo.upsert({ ...address, params: {}, payload: { v: 'summary' }, fetchedAt: now, expiresAt: later });
    await expect(
      repo.read({ ...address, operation: 'list-first-page' }, now),
    ).resolves.toBeNull();
    await expect(repo.read({ ...address, capability: 'competitor' }, now)).resolves.toBeNull();
  });
});

describe('VendorCacheRepo.upsert', () => {
  it('updates in place on conflict — one row, latest payload wins', async () => {
    const repo = createVendorCacheRepo(getTestDb() as never);
    await repo.upsert({ ...address, params: { v: 1 }, payload: { v: 1 }, fetchedAt: now, expiresAt: later });
    const refreshedExpiry = new Date('2026-07-03T00:00:00.000Z');
    await repo.upsert({
      ...address,
      params: { v: 2 },
      payload: { v: 2 },
      fetchedAt: later,
      expiresAt: refreshedExpiry,
    });
    const hit = await repo.read(address, later);
    expect(hit?.payload).toEqual({ v: 2 });
    expect(hit?.params).toEqual({ v: 2 });
    expect(hit?.fetchedAt.toISOString()).toBe(later.toISOString());
  });
});

describe('VendorCacheRepo.invalidateByParams', () => {
  it('deletes every (capability, operation) row whose params contain the match — all limit variants', async () => {
    const repo = createVendorCacheRepo(getTestDb() as never);
    const listAddress = { capability: 'backlink', operation: 'list-first-page' } as const;
    await repo.upsert({
      ...listAddress,
      cacheKey: 'k-limit-100',
      params: { domain: 'a.example', limit: 100 },
      payload: { rows: [] },
      fetchedAt: now,
      expiresAt: later,
    });
    await repo.upsert({
      ...listAddress,
      cacheKey: 'k-limit-50',
      params: { domain: 'a.example', limit: 50 },
      payload: { rows: [] },
      fetchedAt: now,
      expiresAt: later,
    });
    await repo.invalidateByParams(listAddress, { domain: 'a.example' });
    await expect(repo.read({ ...listAddress, cacheKey: 'k-limit-100' }, now)).resolves.toBeNull();
    await expect(repo.read({ ...listAddress, cacheKey: 'k-limit-50' }, now)).resolves.toBeNull();
  });

  it('leaves other domains, other operations, and the archive untouched', async () => {
    const db = getTestDb();
    const repo = createVendorCacheRepo(db as never);
    const listAddress = { capability: 'backlink', operation: 'list-first-page' } as const;
    await repo.upsert({
      ...listAddress,
      cacheKey: 'k-a',
      params: { domain: 'a.example', limit: 100 },
      payload: { rows: [] },
      fetchedAt: now,
      expiresAt: later,
    });
    await repo.upsert({
      ...listAddress,
      cacheKey: 'k-b',
      params: { domain: 'b.example', limit: 100 },
      payload: { rows: [] },
      fetchedAt: now,
      expiresAt: later,
    });
    // Same params on a sibling operation must survive.
    await repo.upsert({
      ...address,
      params: { domain: 'a.example' },
      payload: { v: 1 },
      fetchedAt: now,
      expiresAt: later,
    });
    await repo.appendResponse({
      ...listAddress,
      cacheKey: 'k-a',
      params: { domain: 'a.example', limit: 100 },
      payload: { rows: [] },
      fetchedAt: now,
    });
    await repo.invalidateByParams(listAddress, { domain: 'a.example' });
    await expect(repo.read({ ...listAddress, cacheKey: 'k-b' }, now)).resolves.not.toBeNull();
    await expect(repo.read(address, now)).resolves.not.toBeNull();
    await expect(db.select().from(vendorResponses)).resolves.toHaveLength(1);
  });
});

describe('VendorCacheRepo.appendResponse', () => {
  it('appends — two writes produce two archive rows', async () => {
    const db = getTestDb();
    const repo = createVendorCacheRepo(db as never);
    await repo.appendResponse({ ...address, params: { d: 1 }, payload: { v: 1 }, fetchedAt: now });
    await repo.appendResponse({ ...address, params: { d: 1 }, payload: { v: 2 }, fetchedAt: later });
    const rows = await db
      .select()
      .from(vendorResponses)
      .where(eq(vendorResponses.cacheKey, address.cacheKey));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.payload)).toEqual(expect.arrayContaining([{ v: 1 }, { v: 2 }]));
  });

  it('stores costMicros when given and null when omitted', async () => {
    const db = getTestDb();
    const repo = createVendorCacheRepo(db as never);
    await repo.appendResponse({
      ...address,
      params: {},
      payload: { v: 1 },
      costMicros: 2_600n,
      fetchedAt: now,
    });
    await repo.appendResponse({
      ...address,
      cacheKey: 'k-no-cost',
      params: {},
      payload: { v: 2 },
      fetchedAt: now,
    });
    const rows = await db.select().from(vendorResponses);
    const byKey = new Map(rows.map((r) => [r.cacheKey, r]));
    expect(byKey.get(address.cacheKey)?.costMicros).toBe(2_600n);
    expect(byKey.get('k-no-cost')?.costMicros).toBeNull();
  });

  it('stores accountId when given and null when omitted', async () => {
    const db = getTestDb();
    const repo = createVendorCacheRepo(db as never);
    await repo.appendResponse({
      capability: 'gsc',
      operation: 'inspect-url',
      cacheKey: 'private-key',
      params: { accountId: 'acc-1' },
      payload: { verdict: 'PASS' },
      accountId: 'acc-1',
      fetchedAt: now,
    });
    await repo.appendResponse({ ...address, params: {}, payload: { v: 1 }, fetchedAt: now });
    const rows = await db.select().from(vendorResponses);
    const byCap = new Map(rows.map((r) => [r.capability, r]));
    expect(byCap.get('gsc')?.accountId).toBe('acc-1');
    expect(byCap.get('backlink')?.accountId).toBeNull();
  });
});
