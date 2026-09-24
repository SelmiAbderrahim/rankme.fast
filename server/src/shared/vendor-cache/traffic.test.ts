import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../testing/postgres.js';
import {
  computeVendorCacheKey,
  createReadThrough,
  createSingleFlight,
  createVendorCacheRepo,
  probeReadThrough,
} from './index.js';
import { trafficProviderBundleSchema } from '../../modules/competitors/traffic-snapshots.schema.js';

beforeAll(startTestPostgres);
afterAll(stopTestPostgres);
beforeEach(truncateAllTables);

describe('Traffic Insights vendor-cache wiring', () => {
  it('calls the vendor bundle once across two account snapshots within the TTL', async () => {
    const repo = createVendorCacheRepo(getTestDb() as never);
    const readThrough = createReadThrough({ repo, singleFlight: createSingleFlight() });
    const fetch = vi.fn().mockResolvedValue({
      traffic: [{ domain: 'example.com', monthlyOrganicVisits: 100, topCountries: [] }],
      rankOverview: {
        domain: 'example.com',
        rank: 10,
        keywordsCount: 20,
        estimatedMonthlyOrganicVisits: 100,
      },
      history: { domain: 'example.com', points: [] },
      retainedOps: { traffic: true, rankOverview: true, history: true },
      retryableFailures: { traffic: null, rankOverview: null, history: null },
    });
    const now = new Date('2026-07-22T00:00:00.000Z');
    const input = {
      capability: 'competitor' as const,
      operation: 'traffic',
      cacheKey: 'example.com',
      params: { targetDomain: 'example.com' },
      ttlMs: 60_000,
      payloadSchema: trafficProviderBundleSchema,
      now,
      fetch,
    };
    const first = await readThrough(input);
    const probe = await probeReadThrough(repo, input);
    const second = await readThrough({
      ...input,
      now: new Date(now.getTime() + 1_000),
    });
    expect(first.cached).toBe(false);
    expect(probe).toMatchObject({ cached: true, value: first.value });
    expect(second).toMatchObject({ cached: true, value: first.value });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('computes probe keys and treats missing or malformed cache rows as misses', async () => {
    const repo = createVendorCacheRepo(getTestDb() as never);
    const now = new Date('2026-07-22T00:00:00.000Z');
    const params = { targetDomain: 'example.com' };
    await expect(
      probeReadThrough(repo, {
        capability: 'competitor',
        operation: 'traffic',
        params,
        payloadSchema: trafficProviderBundleSchema,
        now,
      }),
    ).resolves.toEqual({ cached: false, value: null, fetchedAt: null });

    await repo.upsert({
      capability: 'competitor',
      operation: 'traffic',
      cacheKey: computeVendorCacheKey({
        capability: 'competitor',
        operation: 'traffic',
        params,
      }),
      params,
      payload: { invalid: true },
      fetchedAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
    });
    await expect(
      probeReadThrough(repo, {
        capability: 'competitor',
        operation: 'traffic',
        params,
        payloadSchema: trafficProviderBundleSchema,
        now,
      }),
    ).resolves.toEqual({ cached: false, value: null, fetchedAt: null });
  });
});
