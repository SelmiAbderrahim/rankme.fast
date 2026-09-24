import type { Job } from 'bullmq';
import mongoose from 'mongoose';
import type { Logger } from 'pino';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  recordVendorCostUsd,
  ProviderError,
  VendorMalformedError,
  VendorQuotaError,
  VendorTimeoutError,
  type DomainComparisonResult,
  type DomainComparisonRow,
} from '../../../shared/providers/index.js';
import { clearCollections, startMemoryMongo, stopMemoryMongo } from '../../../shared/testing/mongo.js';
import { getTestDb, startTestPostgres, stopTestPostgres, truncateAllTables } from '../../../shared/testing/postgres.js';
import type { VendorCacheRepo } from '../../../shared/vendor-cache/index.js';
import { Site } from '../../sites/index.js';
import {
  CompetitorLandscapeLegCheckpoint,
  CompetitorLandscapeReportPage,
  CompetitorLandscapeRun,
} from './landscape.model.js';
import {
  createCompetitorLandscapeProcessor,
  onCompetitorLandscapeJobExhausted,
  publishLandscape,
  reconcileCompetitorLandscapeRuns,
} from './landscape.processor.js';
import { aggregateLandscape } from './landscape.aggregate.js';
import { sha256CanonicalLandscape } from './landscape.canonical.js';

const PROFILE_A = '11111111-1111-4111-8111-111111111111';
const PROFILE_B = '22222222-2222-4222-8222-222222222222';
let mongoUri: string;

function providerRow(keyword = 'seo audit'): DomainComparisonRow {
  return {
    keyword,
    normalizedKeyword: keyword,
    ownedPosition: 8,
    competitorPosition: 2,
    ownedRankAbsolute: 9,
    competitorRankAbsolute: 3,
    ownedUrl: 'https://owned.example/seo-audit',
    competitorUrl: 'https://rival.example/seo-audit',
    searchVolume: 500,
    keywordDifficulty: 50,
    intent: 'commercial',
    observationMeta: {
      sourceKind: 'provider_observation',
      sourceLabel: 'dataforseo',
      observedAt: '2026-08-09T10:00:00.000Z',
      freshUntil: null,
      freshness: 'fresh',
      market: null,
      sampleCount: 1,
      coverageNoteKey: null,
    },
  };
}

function comparison(keyword = 'seo audit'): DomainComparisonResult {
  return {
    shared: [providerRow(keyword)],
    ownedOnly: [],
    competitorOnly: [],
  };
}

function cachedPayload(
  leg: 'shared' | 'owned_only' | 'competitor_only',
  rows: unknown[] = [],
) {
  return {
    params: {},
    payload: {
      rows,
      provenance: {
        provider: 'dataforseo',
        operation: 'domain_intersection_live',
        leg,
        intersections: leg === 'shared',
        targetOrder: leg === 'competitor_only' ? 'competitor_owned' : 'owned_competitor',
        itemTypes: ['organic'],
        limit: 100,
        cache: 'miss',
        status: 'success',
        capturedAt: '2026-08-09T10:00:00.000Z',
        returnedRows: rows.length,
        truncated: false,
      },
    },
    fetchedAt: new Date('2026-08-09T10:00:00.000Z'),
    expiresAt: new Date('2026-08-10T00:00:00.000Z'),
  };
}

function normalizedRow(keyword = 'cached keyword') {
  const row = providerRow(keyword);
  const { observationMeta: _observationMeta, ...normalized } = row;
  return normalized;
}

function memoryCache(): VendorCacheRepo {
  const values = new Map<string, { params: unknown; payload: unknown; fetchedAt: Date; expiresAt: Date }>();
  return {
    read: vi.fn(async (address, now) => {
      const value = values.get(address.cacheKey);
      return value && value.expiresAt > now ? value : null;
    }),
    upsert: vi.fn(async (input) => {
      values.set(input.cacheKey, {
        params: input.params,
        payload: input.payload,
        fetchedAt: input.fetchedAt,
        expiresAt: input.expiresAt,
      });
    }),
    appendResponse: vi.fn(async () => undefined),
    invalidateByParams: vi.fn(async () => undefined),
  };
}

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as Logger;

async function seedRun(input: {
  competitors?: Array<{ profileId: string; domain: string }>;
  checkpointStates?: Partial<Record<'shared' | 'owned_only' | 'competitor_only', 'pending' | 'dispatched' | 'succeeded'>>;
}) {
  const accountId = new mongoose.Types.ObjectId().toHexString();
  const siteId = new mongoose.Types.ObjectId().toHexString();
  const runId = new mongoose.Types.ObjectId();
  const competitors = input.competitors ?? [{ profileId: PROFILE_A, domain: 'rival.example' }];
  await Site.create({
    _id: siteId,
    accountId,
    url: 'https://owned.example',
    domain: 'owned.example',
    displayName: 'Owned',
  });
  const stageSummary = competitors.flatMap((competitor) =>
    (['shared', 'owned_only', 'competitor_only'] as const).map((leg) => ({
      competitorProfileId: competitor.profileId,
      leg,
      state: input.checkpointStates?.[leg] ?? 'pending',
      returnedRows: input.checkpointStates?.[leg] === 'succeeded' && leg === 'shared' ? 1 : 0,
    })),
  );
  await CompetitorLandscapeRun.create({
    _id: runId,
    accountId,
    siteId,
    requestedByUserId: accountId,
    ownedDomain: 'owned.example',
    locale: 'en',
    state: 'queued',
    progress: { completedLegs: 0, totalLegs: stageSummary.length, stage: 'queued' },
    market: {
      locationCode: 2840,
      languageCode: 'en',
      source: 'default',
      eligibleTrackedKeywords: 0,
    },
    competitors,
    idempotencyKey: `run-${runId}`,
    requestFingerprint: runId.toHexString().padEnd(64, '0'),
    queueJobId: `competitor-landscape-${runId}`,
    cancelRequestedAt: null,
    firstProviderDispatchAt: null,
    stageSummary,
    reportManifest: null,
    contentHash: null,
    safeFailureCode: null,
    reportVersion: 1,
    schemaVersion: 'competitor-landscape/1',
    taxonomyVersion: '2026-08-08.1',
    suggestionRubricVersion: '2026-08-08.1',
    opportunityRubricVersion: '2026-08-08.1',
    startedAt: null,
    completedAt: null,
    expiresAt: null,
  });
  for (const summary of stageSummary) {
    const succeeded = summary.state === 'succeeded';
    await CompetitorLandscapeLegCheckpoint.create({
      accountId,
      siteId,
      runId,
      competitorProfileId: summary.competitorProfileId,
      leg: summary.leg,
      state: summary.state,
      attempt: summary.state === 'pending' ? 0 : 1,
      cache: 'miss',
      dispatchMarkedAt: summary.state === 'pending' ? null : new Date(),
      safeErrorCode: null,
      provenance: succeeded
        ? {
            provider: 'dataforseo',
            operation: 'domain_intersection_live',
            leg: summary.leg,
            intersections: summary.leg === 'shared',
            targetOrder: summary.leg === 'competitor_only' ? 'competitor_owned' : 'owned_competitor',
            itemTypes: ['organic'],
            limit: 100,
            cache: 'miss',
            status: 'success',
            capturedAt: '2026-08-09T10:00:00.000Z',
            returnedRows: summary.leg === 'shared' ? 1 : 0,
            truncated: false,
          }
        : null,
      rows: succeeded && summary.leg === 'shared'
        ? [{
            keyword: 'stored success',
            normalizedKeyword: 'stored success',
            ownedPosition: 7,
            competitorPosition: 2,
            ownedRankAbsolute: 8,
            competitorRankAbsolute: 3,
            ownedUrl: 'https://owned.example/stored',
            competitorUrl: 'https://rival.example/stored',
            searchVolume: null,
            keywordDifficulty: null,
            intent: null,
          }]
        : [],
      expiresAt: null,
    });
  }
  return { accountId, siteId, runId: runId.toHexString() };
}

function job(runId: string): Job {
  return { data: { runId }, attemptsMade: 0 } as Job;
}

beforeAll(async () => {
  mongoUri = await startMemoryMongo();
  await mongoose.connect(mongoUri);
  await startTestPostgres();
});

afterAll(async () => {
  await mongoose.disconnect();
  await stopMemoryMongo();
  await stopTestPostgres();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  vi.clearAllMocks();
});

afterEach(async () => {
  await clearCollections();
  await truncateAllTables();
});

describe('competitor landscape processor', () => {
  it('invokes one comparison per competitor and keeps another competitor after a timeout', async () => {
    const seed = await seedRun({
      competitors: [
        { profileId: PROFILE_A, domain: 'timeout.example' },
        { profileId: PROFILE_B, domain: 'working.example' },
      ],
    });
    const compareDomains = vi.fn(async (input: { competitorDomain: string }) => {
      if (input.competitorDomain === 'timeout.example') {
        throw new VendorTimeoutError('secret timeout detail', {
          provider: 'fake',
          operation: 'comparison',
        });
      }
      return comparison('working keyword');
    });
    const process = createCompetitorLandscapeProcessor({
      db: getTestDb(),
      provider: { compareDomains: compareDomains as never },
      cache: memoryCache(),
      logger,
      now: () => new Date('2026-08-09T12:00:00.000Z'),
    });
    await expect(process(job(seed.runId))).resolves.toMatchObject({ state: 'partial' });
    expect(compareDomains).toHaveBeenCalledTimes(2);
    const run = await CompetitorLandscapeRun.findById(seed.runId).lean();
    expect(run).toMatchObject({ state: 'partial', safeFailureCode: null });
    expect(run?.reportManifest).toMatchObject({
      coverage: { usableCompetitors: 1, failedLegs: 3 },
    });
    const warningCalls = (logger.warn as unknown as { mock: { calls: unknown[] } }).mock.calls;
    expect(JSON.stringify(warningCalls)).not.toContain('secret timeout detail');
  });

  it.each([
    new VendorQuotaError('quota payload', { provider: 'fake', operation: 'comparison' }),
    new VendorMalformedError('malformed payload', { provider: 'fake', operation: 'comparison' }),
  ])('settles provider %s errors without redispatch', async (providerError) => {
    const seed = await seedRun({
      competitors: [
        { profileId: PROFILE_A, domain: 'failed.example' },
        { profileId: PROFILE_B, domain: 'working.example' },
      ],
    });
    const compareDomains = vi.fn(async (input: { competitorDomain: string }) => {
      if (input.competitorDomain === 'failed.example') throw providerError;
      return comparison();
    });
    const process = createCompetitorLandscapeProcessor({
      db: getTestDb(),
      provider: { compareDomains: compareDomains as never },
      cache: memoryCache(),
      logger,
    });
    await process(job(seed.runId));
    await process(job(seed.runId));
    expect(compareDomains).toHaveBeenCalledTimes(2);
  });

  it('isolates one malformed returned leg and publishes the other legs', async () => {
    const seed = await seedRun({});
    const malformed = comparison();
    malformed.ownedOnly = [providerRow('x')];
    malformed.ownedOnly[0]!.ownedPosition = 0;
    const compareDomains = vi.fn(async () => malformed);
    const process = createCompetitorLandscapeProcessor({
      db: getTestDb(),
      provider: { compareDomains },
      cache: memoryCache(),
      logger,
    });
    await expect(process(job(seed.runId))).resolves.toMatchObject({ state: 'partial' });
    const checkpoints = await CompetitorLandscapeLegCheckpoint.find({ runId: seed.runId }).lean();
    expect(checkpoints.find((entry) => entry.leg === 'owned_only')).toMatchObject({
      state: 'failed',
      safeErrorCode: 'MALFORMED',
    });
    expect(checkpoints.filter((entry) => entry.state === 'succeeded')).toHaveLength(2);
  });

  it('honors a cancellation race between provider completion and leg persistence', async () => {
    const seed = await seedRun({});
    const compareDomains = vi.fn(async () => {
      await CompetitorLandscapeRun.updateOne(
        { _id: seed.runId },
        {
          $set: {
            state: 'cancelled',
            'progress.stage': 'cancelled',
            cancelRequestedAt: new Date(),
            completedAt: new Date(),
          },
        },
      );
      return comparison();
    });
    const process = createCompetitorLandscapeProcessor({
      db: getTestDb(),
      provider: { compareDomains },
      cache: memoryCache(),
      logger,
    });
    await expect(process(job(seed.runId))).resolves.toMatchObject({ state: 'cancelled' });
    const run = await CompetitorLandscapeRun.findById(seed.runId).lean();
    expect(run?.reportManifest).toBeNull();
  });

  it('reuses a stored successful leg and never repeats dispatched paid work', async () => {
    const seed = await seedRun({
      checkpointStates: {
        shared: 'succeeded',
        owned_only: 'dispatched',
        competitor_only: 'dispatched',
      },
    });
    const compareDomains = vi.fn(async () => comparison());
    const process = createCompetitorLandscapeProcessor({
      db: getTestDb(),
      provider: { compareDomains },
      cache: memoryCache(),
      logger,
    });
    await expect(process(job(seed.runId))).resolves.toMatchObject({ state: 'partial' });
    expect(compareDomains).not.toHaveBeenCalled();
    const run = await CompetitorLandscapeRun.findById(seed.runId).lean();
    expect(run?.reportManifest).toMatchObject({ rowCount: 1 });
  });

  it('publishes a complete fresh report and preserves measured-cost allocation', async () => {
    const seed = await seedRun({});
    const compareDomains = vi.fn(async () => {
      recordVendorCostUsd(0.000001);
      return comparison();
    });
    const cache = memoryCache();
    const process = createCompetitorLandscapeProcessor({
      db: getTestDb(),
      provider: { compareDomains },
      cache,
      logger,
    });
    await expect(process(job(seed.runId))).resolves.toMatchObject({ state: 'completed' });
    expect(compareDomains).toHaveBeenCalledOnce();
    const costs = (cache.appendResponse as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => (call[0] as { costMicros: bigint }).costMicros,
    );
    expect(costs).toEqual([1n, 0n, 0n]);
  });

  it('uses all valid cached legs without dispatching and tolerates malformed cache entries', async () => {
    const cachedSeed = await seedRun({});
    const cachedReads = [
      cachedPayload('shared', [normalizedRow()]),
      cachedPayload('owned_only'),
      cachedPayload('competitor_only'),
    ];
    const cachedRepo = memoryCache();
    (cachedRepo.read as ReturnType<typeof vi.fn>).mockImplementation(async () => cachedReads.shift() ?? null);
    const compareDomains = vi.fn(async () => comparison());
    const cachedProcess = createCompetitorLandscapeProcessor({
      db: getTestDb(),
      provider: { compareDomains },
      cache: cachedRepo,
      logger,
      now: () => new Date('2026-08-09T12:00:00.000Z'),
    });
    await expect(cachedProcess(job(cachedSeed.runId))).resolves.toMatchObject({ state: 'completed' });
    expect(compareDomains).not.toHaveBeenCalled();

    await clearCollections();
    await truncateAllTables();
    const malformedSeed = await seedRun({});
    const malformedReads = [
      { ...cachedPayload('shared'), payload: null },
      { ...cachedPayload('owned_only'), payload: { rows: 'bad', provenance: {} } },
      { ...cachedPayload('competitor_only'), payload: { rows: [], provenance: { bad: true } } },
    ];
    const malformedRepo = memoryCache();
    (malformedRepo.read as ReturnType<typeof vi.fn>).mockImplementation(
      async () => malformedReads.shift() as never,
    );
    const malformedProcess = createCompetitorLandscapeProcessor({
      db: getTestDb(),
      provider: { compareDomains },
      cache: malformedRepo,
      logger,
    });
    await expect(malformedProcess(job(malformedSeed.runId))).resolves.toMatchObject({
      state: 'completed',
    });
    expect(compareDomains).toHaveBeenCalledOnce();
  });

  it('fails zero-usable runs when the capability is unavailable', async () => {
    const seed = await seedRun({});
    const process = createCompetitorLandscapeProcessor({
      db: getTestDb(),
      provider: {} as never,
      cache: memoryCache(),
      logger,
    });
    await expect(process(job(seed.runId))).resolves.toMatchObject({ state: 'failed' });
    const run = await CompetitorLandscapeRun.findById(seed.runId).lean();
    expect(run).toMatchObject({
      state: 'failed',
      safeFailureCode: 'ZERO_USABLE_PROVIDER_FAILURE',
      reportManifest: null,
    });
  });

  it.each([true, false])('maps generic provider failures without leaking details (retryable=%s)', async (retryable) => {
    const seed = await seedRun({});
    const cache = memoryCache();
    if (!retryable) {
      (cache.appendResponse as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('archive unavailable'),
      );
    }
    const process = createCompetitorLandscapeProcessor({
      db: getTestDb(),
      provider: {
        compareDomains: vi.fn(async () => {
          if (retryable) recordVendorCostUsd(0.000001);
          throw new ProviderError('private provider detail', retryable, {
            provider: 'fake',
            operation: 'comparison',
          });
        }),
      },
      cache,
      logger,
    });
    await expect(process(job(seed.runId))).resolves.toMatchObject({ state: 'failed' });
  });

  it('cancels a paused site before spend and returns missing for an absent run', async () => {
    const seed = await seedRun({});
    await Site.updateOne({ _id: seed.siteId }, { $set: { paused: true } });
    const compareDomains = vi.fn(async () => comparison());
    const process = createCompetitorLandscapeProcessor({
      db: getTestDb(),
      provider: { compareDomains },
      cache: memoryCache(),
      logger,
      now: () => new Date('2026-08-09T12:00:00.000Z'),
    });
    await expect(process(job(seed.runId))).resolves.toEqual({ state: 'cancelled', replayed: false });
    expect(compareDomains).not.toHaveBeenCalled();
    await expect(process(job(new mongoose.Types.ObjectId().toHexString()))).resolves.toEqual({
      state: 'missing',
      replayed: true,
    });

    await clearCollections();
    await truncateAllTables();
    const dispatched = await seedRun({});
    await CompetitorLandscapeRun.updateOne(
      { _id: dispatched.runId },
      { $set: { firstProviderDispatchAt: new Date() } },
    );
    await Site.updateOne({ _id: dispatched.siteId }, { $set: { paused: true } });
    const withoutClock = createCompetitorLandscapeProcessor({
      db: getTestDb(),
      provider: { compareDomains },
      cache: memoryCache(),
      logger,
    });
    await expect(withoutClock(job(dispatched.runId))).resolves.toMatchObject({ state: 'cancelled' });
  });

  it('stops safely when ownership availability changes during cache reads, claims, or competitors', async () => {
    for (const stopAt of ['leg-read', 'claim', 'next-competitor'] as const) {
      await clearCollections();
      await truncateAllTables();
      const seed = await seedRun({
        competitors:
          stopAt === 'next-competitor'
            ? [
                { profileId: PROFILE_A, domain: 'first.example' },
                { profileId: PROFILE_B, domain: 'second.example' },
              ]
            : undefined,
      });
      let reads = 0;
      const cache = memoryCache();
      (cache.read as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        reads += 1;
        if (stopAt === 'leg-read' && reads === 1) {
          await Site.updateOne({ _id: seed.siteId }, { $set: { paused: true } });
        }
        if (stopAt === 'claim' && reads === 3) {
          await Site.updateOne({ _id: seed.siteId }, { $set: { paused: true } });
        }
        return null;
      });
      const compareDomains = vi.fn(async () => {
        if (stopAt === 'next-competitor') {
          await Site.updateOne({ _id: seed.siteId }, { $set: { paused: true } });
        }
        return comparison();
      });
      const process = createCompetitorLandscapeProcessor({
        db: getTestDb(),
        provider: { compareDomains },
        cache,
        logger,
      });
      await expect(process(job(seed.runId))).resolves.toMatchObject({ state: 'cancelled' });
    }
  });

  it('handles lost checkpoint claims without dispatching paid work', async () => {
    const seed = await seedRun({});
    await CompetitorLandscapeLegCheckpoint.updateMany(
      { runId: seed.runId },
      { $set: { attempt: 1 } },
    );
    const compareDomains = vi.fn(async () => comparison());
    const process = createCompetitorLandscapeProcessor({
      db: getTestDb(),
      provider: { compareDomains },
      cache: memoryCache(),
      logger,
    });
    await expect(process(job(seed.runId))).resolves.toMatchObject({ state: 'failed' });
    expect(compareDomains).not.toHaveBeenCalled();
  });

  it('returns a missing settlement if deletion wins after a successful publish', async () => {
    const seed = await seedRun({});
    const originalFindById = CompetitorLandscapeRun.findById.bind(CompetitorLandscapeRun);
    let calls = 0;
    const spy = vi.spyOn(CompetitorLandscapeRun, 'findById').mockImplementation((...args: unknown[]) => {
      calls += 1;
      if (calls === 3) return { lean: async () => null } as never;
      return originalFindById(...(args as Parameters<typeof originalFindById>));
    });
    const process = createCompetitorLandscapeProcessor({
      db: getTestDb(),
      provider: { compareDomains: vi.fn(async () => comparison()) },
      cache: memoryCache(),
      logger,
    });
    await expect(process(job(seed.runId))).resolves.toEqual({ state: 'missing', replayed: false });
    spy.mockRestore();
  });

  it('records mixed cache provenance and can use the durable cache repository', async () => {
    const mixedSeed = await seedRun({});
    const cache = memoryCache();
    const reads = [cachedPayload('shared', [normalizedRow()]), null, null];
    (cache.read as ReturnType<typeof vi.fn>).mockImplementation(async () => reads.shift() ?? null);
    const process = createCompetitorLandscapeProcessor({
      db: getTestDb(),
      provider: { compareDomains: vi.fn(async () => comparison()) },
      cache,
      logger,
    });
    await expect(process(job(mixedSeed.runId))).resolves.toMatchObject({ state: 'completed' });

    await clearCollections();
    await truncateAllTables();
    const durableSeed = await seedRun({});
    const durableProcess = createCompetitorLandscapeProcessor({
      db: getTestDb(),
      provider: { compareDomains: vi.fn(async () => comparison()) },
      logger,
    });
    await expect(durableProcess(job(durableSeed.runId))).resolves.toMatchObject({
      state: 'completed',
    });
  });

  it('reuses identical report pages and rejects conflicting or noncontiguous pages', async () => {
    for (const mode of ['identical', 'conflict', 'extra'] as const) {
      await clearCollections();
      await truncateAllTables();
      const seed = await seedRun({
        checkpointStates: { shared: 'succeeded', owned_only: 'succeeded', competitor_only: 'succeeded' },
      });
      const run = await CompetitorLandscapeRun.findById(seed.runId).lean();
      const checkpoints = await CompetitorLandscapeLegCheckpoint.find({ runId: seed.runId }).lean();
      const aggregation = aggregateLandscape({
        ownedDomain: run!.ownedDomain,
        locale: run!.locale,
        market: run!.market,
        competitors: run!.competitors,
        checkpoints: checkpoints.map((checkpoint) => ({
          competitorProfileId: checkpoint.competitorProfileId,
          leg: checkpoint.leg,
          state: checkpoint.state,
          safeErrorCode: checkpoint.safeErrorCode ?? null,
          provenance: checkpoint.provenance as never,
          rows: checkpoint.rows as never,
        })),
        completedAt: new Date('2026-08-09T12:00:00.000Z'),
      });
      const rows = aggregation.rows;
      await CompetitorLandscapeReportPage.create({
        accountId: seed.accountId,
        siteId: seed.siteId,
        runId: seed.runId,
        pageIndex: 0,
        rows,
        rowCount: rows.length,
        pageHash: mode === 'conflict' ? 'f'.repeat(64) : sha256CanonicalLandscape(rows),
        expiresAt: null,
      });
      if (mode === 'extra') {
        await CompetitorLandscapeReportPage.create({
          accountId: seed.accountId,
          siteId: seed.siteId,
          runId: seed.runId,
          pageIndex: 1,
          rows,
          rowCount: rows.length,
          pageHash: sha256CanonicalLandscape(rows),
          expiresAt: null,
        });
      }
      const process = createCompetitorLandscapeProcessor({
        db: getTestDb(),
        provider: { compareDomains: vi.fn(async () => comparison()) },
        cache: memoryCache(),
        logger,
        now: () => new Date('2026-08-09T12:00:00.000Z'),
      });
      if (mode === 'identical') {
        await expect(process(job(seed.runId))).resolves.toMatchObject({ state: 'completed' });
      } else {
        await expect(process(job(seed.runId))).rejects.toThrow(
          mode === 'conflict' ? 'page hash conflict' : 'not contiguous',
        );
      }
    }
  });

  it('settles terminal publish compare-and-set races without overwriting a winner', async () => {
    for (const winnerState of ['completed', 'cancelled', 'active', 'missing'] as const) {
      await clearCollections();
      await truncateAllTables();
      const seed = await seedRun({
        checkpointStates: { shared: 'succeeded', owned_only: 'succeeded', competitor_only: 'succeeded' },
      });
      const originalUpdate = CompetitorLandscapeRun.updateOne.bind(CompetitorLandscapeRun);
      const spy = vi.spyOn(CompetitorLandscapeRun, 'updateOne').mockImplementation(((
        filter: unknown,
        update: unknown,
        options?: unknown,
      ) => {
        const record = update as { $set?: { completedAt?: Date } };
        if (record.$set?.completedAt) {
          return (async () => {
            if (winnerState === 'missing') {
              await CompetitorLandscapeRun.collection.deleteOne({
                _id: new mongoose.Types.ObjectId(seed.runId),
              });
            } else if (winnerState !== 'active') {
              await CompetitorLandscapeRun.collection.updateOne(
                { _id: new mongoose.Types.ObjectId(seed.runId) },
                {
                  $set: {
                    state: winnerState,
                    'progress.stage': winnerState,
                    completedAt: new Date(),
                  },
                },
              );
            }
            return { modifiedCount: 0 };
          })() as never;
        }
        return originalUpdate(filter as never, update as never, options as never);
      }) as never);
      const deps = {
        db: getTestDb(),
        provider: { compareDomains: vi.fn(async () => comparison()) },
        cache: memoryCache(),
        logger,
      };
      if (winnerState === 'completed' || winnerState === 'cancelled') {
        await expect(publishLandscape(seed.runId, deps)).resolves.toBeUndefined();
      } else {
        await expect(publishLandscape(seed.runId, deps)).rejects.toThrow(
          'landscape terminal publish lost compare-and-set',
        );
      }
      spy.mockRestore();
      if (winnerState === 'cancelled') {
        expect(await CompetitorLandscapeReportPage.countDocuments({ runId: seed.runId })).toBe(0);
      }
    }
  });

  it('reconciles missing queue jobs and marks exhausted dispatched legs once', async () => {
    const first = await seedRun({ checkpointStates: { shared: 'dispatched' } });
    const _second = await seedRun({});
    const queue = {
      getJob: vi.fn(async (id: string) => (id.includes(first.runId) ? { id } : null)),
      add: vi.fn(async () => ({ id: 'added' })),
    };
    await expect(reconcileCompetitorLandscapeRuns(queue as never, 0)).resolves.toEqual({
      examined: 1,
      enqueued: 0,
    });
    await expect(reconcileCompetitorLandscapeRuns(queue as never, 999)).resolves.toEqual({
      examined: 2,
      enqueued: 1,
    });
    expect(queue.add).toHaveBeenCalledOnce();
    await onCompetitorLandscapeJobExhausted(job(first.runId));
    expect(
      await CompetitorLandscapeLegCheckpoint.countDocuments({
        runId: first.runId,
        state: 'failed',
      }),
    ).toBe(3);
    expect(
      await CompetitorLandscapeLegCheckpoint.countDocuments({
        runId: first.runId,
        safeErrorCode: 'UNKNOWN_AFTER_DISPATCH',
      }),
    ).toBe(1);
    expect(
      await CompetitorLandscapeLegCheckpoint.countDocuments({
        runId: first.runId,
        safeErrorCode: 'WORKER_EXHAUSTED',
      }),
    ).toBe(2);
    await onCompetitorLandscapeJobExhausted(job(first.runId));
    expect(
      await CompetitorLandscapeLegCheckpoint.countDocuments({
        runId: first.runId,
        state: 'failed',
      }),
    ).toBe(3);
    await expect(onCompetitorLandscapeJobExhausted({ data: {} } as Job)).resolves.toBeUndefined();
    await expect(
      onCompetitorLandscapeJobExhausted({ data: { runId: 'invalid' } } as Job),
    ).resolves.toBeUndefined();
  });

  it('settles exhausted jobs through cancellation, publish, and terminal fallback paths', async () => {
    const fixedNow = new Date('2026-08-12T12:30:00.000Z');
    const deps = {
      db: getTestDb(),
      provider: { compareDomains: vi.fn(async () => comparison()) },
      cache: memoryCache(),
      logger,
      now: () => fixedNow,
    };

    const paused = await seedRun({});
    await Site.updateOne({ _id: paused.siteId }, { $set: { paused: true } });
    await expect(
      onCompetitorLandscapeJobExhausted(job(paused.runId), deps),
    ).resolves.toBeUndefined();
    expect(await CompetitorLandscapeRun.findById(paused.runId).lean()).toMatchObject({
      state: 'cancelled',
      safeFailureCode: 'SITE_UNAVAILABLE',
      completedAt: fixedNow,
    });

    await clearCollections();
    await truncateAllTables();
    const publishable = await seedRun({});
    await expect(
      onCompetitorLandscapeJobExhausted(job(publishable.runId), deps),
    ).resolves.toBeUndefined();
    expect(await CompetitorLandscapeRun.findById(publishable.runId).lean()).toMatchObject({
      state: 'failed',
      safeFailureCode: 'ZERO_USABLE_PROVIDER_FAILURE',
    });

    await clearCollections();
    await truncateAllTables();
    const fallback = await seedRun({});
    await CompetitorLandscapeLegCheckpoint.updateOne(
      { runId: fallback.runId, leg: 'shared' },
      { $set: { cache: 'hit' } },
    );
    await expect(
      onCompetitorLandscapeJobExhausted(job(fallback.runId), {
        ...deps,
        publishFn: async () => Promise.reject(new Error('unpublishable')),
      }),
    ).resolves.toBeUndefined();
    expect(await CompetitorLandscapeRun.findById(fallback.runId).lean()).toMatchObject({
      state: 'failed',
      safeFailureCode: 'WORKER_EXHAUSTED',
      reportManifest: null,
      contentHash: null,
      completedAt: fixedNow,
    });
    expect(logger.error).toHaveBeenCalledWith(
      { runId: fallback.runId, state: 'failed', code: 'WORKER_EXHAUSTED' },
      'competitor landscape exhausted without a publishable report',
    );

    await clearCollections();
    await truncateAllTables();
    const deleted = await seedRun({});
    const { now: _now, ...depsWithoutClock } = deps;
    await expect(
      onCompetitorLandscapeJobExhausted(job(deleted.runId), {
        ...depsWithoutClock,
        publishFn: async () => Promise.reject(new Error('unpublishable')),
        beforeExhaustedSettlement: async () => {
          await CompetitorLandscapeRun.deleteOne({ _id: deleted.runId });
        },
      }),
    ).resolves.toBeUndefined();
    expect(await CompetitorLandscapeRun.findById(deleted.runId)).toBeNull();
  });

  it('treats a terminal replay as a no-op and rejects malformed consumed payloads', async () => {
    const seed = await seedRun({});
    await CompetitorLandscapeRun.updateOne(
      { _id: seed.runId },
      { $set: { state: 'cancelled', 'progress.stage': 'cancelled', completedAt: new Date() } },
    );
    const compareDomains = vi.fn(async () => comparison());
    const process = createCompetitorLandscapeProcessor({
      db: getTestDb(),
      provider: { compareDomains },
      cache: memoryCache(),
      logger,
    });
    await expect(process(job(seed.runId))).resolves.toEqual({ state: 'cancelled', replayed: true });
    expect(compareDomains).not.toHaveBeenCalled();
    await expect(process({ data: { runId: 'bad', keyword: 'must-not-log' } } as Job)).rejects.toThrow();
  });
});
