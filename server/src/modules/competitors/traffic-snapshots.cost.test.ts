import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  vendorResponses,
} from '../../db/schema/index.js';
import { recordVendorCostUsd } from '../../shared/providers/index.js';
import type { CompetitorProvider } from '../../shared/providers/index.js';
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
import { createVendorCacheRepo } from '../../shared/vendor-cache/index.js';
import {
  captureTrafficSnapshotOperationCost,
  pinnedTrafficOperationCostMicros,
  recordCachedTrafficSnapshotCosts,
} from './traffic-snapshots.cost.js';
import {
  createTrafficSnapshotProcessor,
  fetchTrafficProviderBundle,
} from './traffic-snapshots.processor.js';
import { TrafficSnapshotRun } from './traffic-snapshots.model.js';
import { settleRun } from './traffic-snapshots.service.js';
import type { TrafficProviderBundle } from './traffic-snapshots.schema.js';

const ACCOUNT = 'c'.repeat(24);
const NOW = new Date('2026-07-22T12:00:00.000Z');
const runInput = {
  targetDomain: 'example.com',
  inputs: { locationCode: 2840, languageCode: 'en', historyMonths: 24 },
};

const bundle: TrafficProviderBundle = {
  traffic: [
    {
      domain: 'example.com',
      monthlyOrganicVisits: 1_000,
      topCountries: [{ countryCode: 'US', visits: 700 }],
    },
  ],
  rankOverview: {
    domain: 'example.com',
    rank: 20,
    keywordsCount: 100,
    estimatedMonthlyOrganicVisits: 900,
  },
  history: {
    domain: 'example.com',
    points: [
      { year: 2026, month: 4, rank: 22, organicKeywords: 90, organicEtv: 800 },
      { year: 2026, month: 5, rank: 21, organicKeywords: 95, organicEtv: 850 },
      { year: 2026, month: 6, rank: 20, organicKeywords: 100, organicEtv: 900 },
    ],
  },
  retainedOps: { traffic: true, rankOverview: true, history: true },
  retryableFailures: { traffic: null, rankOverview: null, history: null },
};

function provider(): CompetitorProvider {
  return {
    getCompetitors: vi.fn(),
    getSerpCompetitors: vi.fn(),
    getDomainIntersection: vi.fn(),
    getTechnologies: vi.fn(),
    getTrafficEstimation: vi.fn().mockResolvedValue(bundle.traffic),
    getDomainRankOverview: vi.fn().mockResolvedValue(bundle.rankOverview),
    getHistoricalRankOverview: vi.fn().mockResolvedValue(bundle.history),
  };
}

beforeAll(async () => {
  await startMemoryMongo();
  await startTestPostgres();
});

afterAll(async () => {
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
});

describe('Traffic snapshot cost capture', () => {
  it('lands the three pinned sub-operation rows with task/item math', async () => {
    await fetchTrafficProviderBundle(runInput, provider(), {
      db: getTestDb() as never,
      now: () => NOW,
    });
    const rows = await getTestDb().select().from(vendorResponses);
    expect(rows).toHaveLength(3);
    expect(
      rows.map((row) => ({
        capability: row.capability,
        operation: row.operation,
        params: row.params,
        costMicros: row.costMicros,
      })),
    ).toEqual([
      {
        capability: 'competitor',
        operation: 'traffic',
        params: {
          targetDomain: 'example.com',
          subOperation: 'traffic-estimation',
          tasks: 1,
          items: 1,
          cached: false,
        },
        costMicros: 6_400n,
      },
      {
        capability: 'competitor',
        operation: 'traffic',
        params: {
          targetDomain: 'example.com',
          subOperation: 'rank-overview',
          tasks: 1,
          items: 1,
          cached: false,
        },
        costMicros: 6_000n,
      },
      {
        capability: 'competitor',
        operation: 'traffic',
        params: {
          targetDomain: 'example.com',
          subOperation: 'rank-overview-history',
          tasks: 1,
          items: 3,
          cached: false,
        },
        costMicros: 6_600n,
      },
    ]);
    expect(pinnedTrafficOperationCostMicros('rank-overview-history', 31)).toBe(12_000n);
    expect(pinnedTrafficOperationCostMicros('rank-overview-history', -1)).toBe(6_000n);
  });

  it('uses reported vendor cost, records failed calls, then rethrows the provider error', async () => {
    const reported = await captureTrafficSnapshotOperationCost(
      { db: getTestDb() as never },
      {
        targetDomain: 'reported.example',
        subOperation: 'rank-overview',
        fallbackItems: 1,
        itemsFromValue: () => 1,
      },
      async () => {
        recordVendorCostUsd(0.007);
        return { ok: true };
      },
    );
    expect(reported).toEqual({ ok: true });

    const failure = new Error('vendor failed');
    await expect(
      captureTrafficSnapshotOperationCost(
        { db: getTestDb() as never, now: () => NOW },
        {
          targetDomain: 'failed.example',
          subOperation: 'rank-overview-history',
          fallbackItems: 45,
          itemsFromValue: () => 0,
        },
        async () => {
          throw failure;
        },
      ),
    ).rejects.toBe(failure);
    const rows = await getTestDb().select().from(vendorResponses);
    expect(rows.map((row) => row.costMicros)).toEqual([7_000n, 12_000n]);
    expect(rows[1]?.params).toMatchObject({ items: 30, cached: false });
    expect(rows[1]?.payload).toMatchObject({ successful: false });
  });

  it('emits only cost=0 cached rows on a processor cache hit', async () => {
    const repo = createVendorCacheRepo(getTestDb() as never);
    await repo.upsert({
      capability: 'competitor',
      operation: 'traffic',
      cacheKey: 'example.com',
      params: { targetDomain: 'example.com' },
      payload: bundle,
      fetchedAt: NOW,
      expiresAt: new Date(NOW.getTime() + 60_000),
    });
    const run = await TrafficSnapshotRun.create({
      accountId: ACCOUNT,
      targetDomain: 'example.com',
      inputs: runInput.inputs,
      status: 'queued',
      retainedOps: { traffic: false, rankOverview: false, history: false },
    });
    const cachedProvider = provider();
    await createTrafficSnapshotProcessor({
      db: getTestDb() as never,
      provider: cachedProvider,
      now: () => new Date('2026-07-22T12:00:30.000Z'),
    })({ data: { accountId: ACCOUNT, runId: String(run._id) } } as never);

    const rows = await getTestDb().select().from(vendorResponses);
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.costMicros === 0n)).toBe(true);
    expect(rows.every((row) => (row.params as { cached: boolean }).cached)).toBe(true);
    expect(cachedProvider.getTrafficEstimation).not.toHaveBeenCalled();
    expect(cachedProvider.getDomainRankOverview).not.toHaveBeenCalled();
    expect(cachedProvider.getHistoricalRankOverview).not.toHaveBeenCalled();
  });

  it('tags cached partial bundles and keeps failed settlement idempotent', async () => {
    await recordCachedTrafficSnapshotCosts(
      { db: getTestDb() as never, now: () => NOW },
      'partial.example',
      {
        ...bundle,
        history: null,
        retainedOps: { traffic: true, rankOverview: true, history: false },
        retryableFailures: { traffic: null, rankOverview: null, history: true },
      },
    );
    const cachedRows = await getTestDb().select().from(vendorResponses);
    expect(cachedRows[2]?.params).toMatchObject({ items: 0, cached: true });
    expect(cachedRows[2]?.payload).toMatchObject({ successful: false });

    const run = await TrafficSnapshotRun.create({
      accountId: ACCOUNT,
      targetDomain: 'failed.example',
      inputs: runInput.inputs,
      status: 'running',
      retainedOps: { traffic: false, rankOverview: false, history: false },
    });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await settleRun(
        {
          accountId: ACCOUNT,
          runId: String(run._id),
          retainedOps: { traffic: false, rankOverview: false, history: false },
          payload: null,
          capturedAt: NOW,
        },
        { db: getTestDb() as never },
      );
      expect(result).toEqual({ status: 'failed' });
    }
    expect(await TrafficSnapshotRun.findById(run._id)).toMatchObject({ status: 'failed' });
  });
});
