import { UnrecoverableError, type Queue } from 'bullmq';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { env } from '../../config/env.js';
import { trafficSnapshots } from '../../db/schema/index.js';
import {
  createFakeCompetitorProvider,
  VendorUnavailableError,
  type CompetitorProvider,
} from '../../shared/providers/index.js';
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
  AllTrafficOperationsFailedError,
  buildTrafficSnapshotPayload,
  createTrafficSnapshotProcessor,
  fetchTrafficProviderBundle,
} from './traffic-snapshots.processor.js';
import {
  TrafficSnapshotRun,
} from './traffic-snapshots.model.js';
import {
  decodeTrafficSnapshotCursor,
  enqueueSnapshot,
  getSnapshot,
  getSnapshotsForDomain,
  listSnapshots,
  resolveOwnedTrafficSnapshotSiteId,
  settleRun,
} from './traffic-snapshots.service.js';
import type {
  TrafficProviderBundle,
  TrafficRetainedOps,
} from './traffic-snapshots.schema.js';
import {
  createTrafficSnapshotSchema,
  trafficSnapshotDomainSchema,
  trafficSnapshotListQuerySchema,
} from './traffic-snapshots.schema.js';
import { Site } from '../sites/index.js';

const ACCOUNT = 'a'.repeat(24);
const ORIGINAL_TRAFFIC_INSIGHTS_ENABLED = env.TRAFFIC_INSIGHTS_ENABLED;

function bundle(retainedOps: TrafficRetainedOps): TrafficProviderBundle {
  return {
    traffic: retainedOps.traffic
      ? [{ domain: 'example.com', monthlyOrganicVisits: 1000, topCountries: [{ countryCode: 'US', visits: 700 }] }]
      : null,
    rankOverview: retainedOps.rankOverview
      ? { domain: 'example.com', rank: 42, keywordsCount: 50, estimatedMonthlyOrganicVisits: 900 }
      : null,
    history: retainedOps.history
      ? { domain: 'example.com', points: [{ year: 2026, month: 6, rank: 40, organicKeywords: 45, organicEtv: 850 }] }
      : null,
    retainedOps,
    retryableFailures: {
      traffic: retainedOps.traffic ? null : true,
      rankOverview: retainedOps.rankOverview ? null : true,
      history: retainedOps.history ? null : true,
    },
  };
}

async function makeRun(
  targetDomain = 'example.com',
  siteId: mongoose.Types.ObjectId | null = null,
) {
  return TrafficSnapshotRun.create({
    accountId: ACCOUNT,
    siteId,
    targetDomain,
    inputs: { locationCode: 2840, languageCode: 'en', historyMonths: 24 },
    status: 'running',
    retainedOps: { traffic: false, rankOverview: false, history: false },
    completedAt: null,
  });
}

function queueWith(add: Queue['add']): Queue {
  return { add } as unknown as Queue;
}

beforeAll(async () => {
  await startMemoryMongo();
  await startTestPostgres();
});

afterAll(async () => {
  (env as { TRAFFIC_INSIGHTS_ENABLED: boolean }).TRAFFIC_INSIGHTS_ENABLED =
    ORIGINAL_TRAFFIC_INSIGHTS_ENABLED;
  await stopTestPostgres();
  await stopMemoryMongo();
});

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(async () => {
  (env as { TRAFFIC_INSIGHTS_ENABLED: boolean }).TRAFFIC_INSIGHTS_ENABLED = true;
  await clearCollections();
  await truncateAllTables();
});

describe('Traffic snapshot service', () => {
  it('applies safe run defaults and validates domain/list edge cases', async () => {
    const run = await TrafficSnapshotRun.create({
      accountId: ACCOUNT,
      targetDomain: 'example.com',
      inputs: { locationCode: 2840, languageCode: 'en', historyMonths: 24 },
    });
    expect(run.status).toBe('queued');
    expect(run.retainedOps).toMatchObject({
      traffic: false,
      rankOverview: false,
      history: false,
    });
    expect(trafficSnapshotDomainSchema.safeParse('https://example.com').success).toBe(false);
    expect(trafficSnapshotDomainSchema.safeParse('localhost').success).toBe(false);
    expect(trafficSnapshotDomainSchema.parse('WWW.Example.com')).toBe('example.com');
    expect(createTrafficSnapshotSchema.parse({ targetDomain: 'example.com' })).toMatchObject({
      locationCode: 2840,
      languageCode: 'en',
      historyMonths: 24,
    });
    expect(trafficSnapshotListQuerySchema.safeParse({ from: '2026-07-23', to: '2026-07-22' }).success).toBe(false);
    expect(trafficSnapshotListQuerySchema.safeParse({ from: '2026-07-22' }).success).toBe(true);
    expect(trafficSnapshotListQuerySchema.safeParse({ to: '2026-07-22' }).success).toBe(true);
    expect(trafficSnapshotListQuerySchema.safeParse({ from: '2026-07-22', to: '2026-07-23' }).success).toBe(true);
  });

  it.each([
    [false, false, false],
    [true, false, false],
    [false, true, false],
    [false, false, true],
    [true, true, false],
    [true, false, true],
    [false, true, true],
    [true, true, true],
  ] as const)(
    'settlement truth table traffic=%s rank=%s history=%s',
    async (traffic, rankOverview, history) => {
      const run = await makeRun();
      const retainedOps = { traffic, rankOverview, history };
      const capturedAt = new Date('2026-07-22T12:00:00.000Z');
      const result = await settleRun(
        {
          accountId: ACCOUNT,
          runId: String(run._id),
          retainedOps,
          payload:
            traffic || rankOverview || history
              ? buildTrafficSnapshotPayload(bundle(retainedOps), run, capturedAt)
              : null,
          capturedAt,
        },
        { db: getTestDb() as never },
      );
      const retained = Number(traffic) + Number(rankOverview) + Number(history);
      expect(result).toEqual({
        status: retained === 0 ? 'failed' : retained === 3 ? 'succeeded' : 'partial',
      });
      expect(result.status).toBe(
        retained === 0 ? 'failed' : retained === 3 ? 'succeeded' : 'partial',
      );
      await settleRun(
        {
          accountId: ACCOUNT,
          runId: String(run._id),
          retainedOps,
          payload:
            retained > 0
              ? buildTrafficSnapshotPayload(bundle(retainedOps), run, capturedAt)
              : null,
          capturedAt,
        },
        { db: getTestDb() as never },
      );
      expect(await getTestDb().select().from(trafficSnapshots)).toHaveLength(
        retained === 0 ? 0 : 1,
      );
    },
  );

  it('returns domain rows newest first and isolates accounts/domains', async () => {
    await expect(
      getSnapshotsForDomain(ACCOUNT, 'missing.example', getTestDb() as never),
    ).resolves.toEqual([]);
    const liveSite = await Site.create({
      accountId: ACCOUNT,
      url: 'https://live-traffic.example',
      domain: 'live-traffic.example',
    });
    const times = [
      new Date('2026-07-20T00:00:00.000Z'),
      new Date('2026-07-22T00:00:00.000Z'),
      new Date('2026-07-21T00:00:00.000Z'),
    ];
    for (const [index, capturedAt] of times.entries()) {
      const run = await makeRun(
        index === 2 ? 'other.example' : 'example.com',
        index === 0 ? liveSite._id : null,
      );
      const retainedOps = { traffic: true, rankOverview: true, history: true };
      await settleRun(
        {
          accountId: ACCOUNT,
          runId: String(run._id),
          retainedOps,
          payload: buildTrafficSnapshotPayload(bundle(retainedOps), run, capturedAt),
          capturedAt,
        },
        { db: getTestDb() as never },
      );
    }
    const foreignRun = new mongoose.Types.ObjectId().toString();
    const sample = buildTrafficSnapshotPayload(
      bundle({ traffic: true, rankOverview: true, history: true }),
      { inputs: { locationCode: 2840, languageCode: 'en' } },
      times[0]!,
    );
    await getTestDb().insert(trafficSnapshots).values({
      accountId: 'b'.repeat(24),
      runId: foreignRun,
      targetDomain: 'example.com',
      payload: sample,
      capturedAt: new Date('2026-07-23T00:00:00.000Z'),
    });

    const rows = await getSnapshotsForDomain(
      ACCOUNT,
      'example.com',
      getTestDb() as never,
    );
    expect(rows.map((row) => row.capturedAt.toISOString())).toEqual([
      '2026-07-22T00:00:00.000Z',
      '2026-07-20T00:00:00.000Z',
    ]);
  });

  it('preserves estimate metadata on every numeric DTO field after JSON round-trip', () => {
    const payload = buildTrafficSnapshotPayload(
      bundle({ traffic: true, rankOverview: true, history: true }),
      { inputs: { locationCode: 2840, languageCode: 'en' } },
      new Date('2026-07-22T00:00:00.000Z'),
    );
    const roundTrip = JSON.parse(JSON.stringify(payload)) as typeof payload;
    const labelled = [
      roundTrip.monthlyOrganicVisits,
      roundTrip.domainRank,
      roundTrip.keywordCount,
      ...roundTrip.topCountries.map((row) => row.visits),
      ...roundTrip.history.flatMap((point) => [
        point.rank,
        point.traffic,
        point.keywordCount,
      ]),
    ];
    expect(labelled.length).toBeGreaterThan(3);
    expect(labelled.every((field) => field.observation.sourceKind === 'estimate')).toBe(true);
  });

  it('propagates run-creation failures and marks queue failures failed', async () => {
      const input = createTrafficSnapshotSchema.parse({ targetDomain: 'example.com' });
    const createSpy = vi
      .spyOn(TrafficSnapshotRun, 'create')
      .mockRejectedValueOnce(new Error('mongo unavailable'));
    await expect(
      enqueueSnapshot(ACCOUNT, input, {
        db: getTestDb() as never,
        queue: queueWith(vi.fn().mockResolvedValue({}) as never),
      }),
    ).rejects.toThrow('mongo unavailable');
    createSpy.mockRestore();
    expect(await TrafficSnapshotRun.countDocuments()).toBe(0);

    await expect(
      enqueueSnapshot(ACCOUNT, input, {
        db: getTestDb() as never,
        queue: queueWith(vi.fn().mockRejectedValue(new Error('redis unavailable')) as never),
        now: () => new Date('2026-07-22T09:00:00.000Z'),
      }),
    ).rejects.toMatchObject({ status: 503 });
    const failed = await TrafficSnapshotRun.findOne({ accountId: ACCOUNT });
    expect(failed).toMatchObject({ status: 'failed' });
    expect(failed?.completedAt?.toISOString()).toBe('2026-07-22T09:00:00.000Z');
  });

  it('rejects malformed owned-site ids before any run is created', async () => {
    await expect(
      enqueueSnapshot(
        ACCOUNT,
        { ...createTrafficSnapshotSchema.parse({ targetDomain: 'example.com' }), siteId: 'bad' },
        { db: getTestDb() as never, queue: queueWith(vi.fn() as never) },
      ),
    ).rejects.toMatchObject({ status: 404 });

    await expect(
      enqueueSnapshot(
        ACCOUNT,
        {
          ...createTrafficSnapshotSchema.parse({ targetDomain: 'example.com' }),
          siteId: new mongoose.Types.ObjectId().toHexString(),
        },
        { db: getTestDb() as never, queue: queueWith(vi.fn() as never) },
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('rejects retained settlements without payloads or owned runs', async () => {
    const run = await makeRun();
    const retainedOps = { traffic: true, rankOverview: false, history: false };
    await expect(
      settleRun(
        {
          accountId: ACCOUNT,
          runId: String(run._id),
          retainedOps,
          payload: null,
          capturedAt: new Date(),
        },
        { db: getTestDb() as never },
      ),
    ).rejects.toThrow('require a payload');
    await expect(
      settleRun(
        {
          accountId: ACCOUNT,
          runId: new mongoose.Types.ObjectId().toString(),
          retainedOps,
          payload: buildTrafficSnapshotPayload(bundle(retainedOps), run, new Date()),
          capturedAt: new Date(),
        },
        { db: getTestDb() as never },
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('reads queued runs without rows, rejects unknown runs, and cursor-paginates filters', async () => {
    const liveSite = await Site.create({
      accountId: ACCOUNT,
      url: 'https://cursor-live.example',
      domain: 'cursor-live.example',
    });
    const queued = await TrafficSnapshotRun.create({
      accountId: ACCOUNT,
      siteId: liveSite._id,
      targetDomain: 'example.com',
      inputs: { locationCode: 2840, languageCode: 'en', historyMonths: 24 },
      status: 'queued',
      retainedOps: { traffic: false, rankOverview: false, history: false },
      completedAt: null,
    });
    const detail = await getSnapshot(ACCOUNT, String(queued._id), getTestDb() as never);
    expect(detail).toMatchObject({
      siteId: String(queued.siteId),
      completedAt: null,
      snapshot: null,
    });
    await expect(resolveOwnedTrafficSnapshotSiteId(ACCOUNT, String(queued._id))).resolves.toBe(
      String(liveSite._id),
    );
    await expect(
      getSnapshot(ACCOUNT, new mongoose.Types.ObjectId().toString(), getTestDb() as never),
    ).rejects.toMatchObject({ status: 404 });

    const retainedOps = { traffic: true, rankOverview: true, history: true };
    for (const capturedAt of [
      new Date('2026-07-22T12:00:00.000Z'),
      new Date('2026-07-21T12:00:00.000Z'),
    ]) {
      const run = await makeRun();
      await settleRun(
        {
          accountId: ACCOUNT,
          runId: String(run._id),
          retainedOps,
          payload: buildTrafficSnapshotPayload(bundle(retainedOps), run, capturedAt),
          capturedAt,
        },
        { db: getTestDb() as never },
      );
    }
    const first = await listSnapshots(
      ACCOUNT,
      {
        domain: 'example.com',
        from: new Date('2026-07-20T00:00:00.000Z'),
        to: new Date('2026-07-23T00:00:00.000Z'),
        limit: 1,
      },
      getTestDb() as never,
    );
    expect(first.snapshots).toHaveLength(1);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await listSnapshots(
      ACCOUNT,
      { cursor: first.nextCursor!, limit: 1 },
      getTestDb() as never,
    );
    expect(second.snapshots).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(() => decodeTrafficSnapshotCursor('not-json')).toThrow();
    expect(() =>
      decodeTrafficSnapshotCursor(
        Buffer.from(JSON.stringify({ capturedAt: 'bad', id: 'bad' })).toString('base64url'),
      ),
    ).toThrow();
  });

  it('omits denied and account-wide snapshots from a selected Site scope', async () => {
    const [allowedSite, deniedSite] = await Site.create([
      { accountId: ACCOUNT, url: 'https://allowed.example', domain: 'allowed.example' },
      { accountId: ACCOUNT, url: 'https://denied.example', domain: 'denied.example' },
    ]);
    const retainedOps = { traffic: true, rankOverview: true, history: true };
    const seeded = await Promise.all([
      makeRun('allowed.example', allowedSite!._id),
      makeRun('denied.example', deniedSite!._id),
      makeRun('account-wide.example'),
    ]);
    for (const [index, run] of seeded.entries()) {
      const capturedAt = new Date(`2026-07-2${index + 1}T12:00:00.000Z`);
      await settleRun(
        {
          accountId: ACCOUNT,
          runId: String(run._id),
          retainedOps,
          payload: buildTrafficSnapshotPayload(bundle(retainedOps), run, capturedAt),
          capturedAt,
        },
        { db: getTestDb() as never },
      );
    }

    const scoped = await listSnapshots(
      ACCOUNT,
      { limit: 20 },
      getTestDb() as never,
      [String(allowedSite!._id)],
    );
    expect(scoped.snapshots).toHaveLength(1);
    expect(scoped.snapshots[0]).toMatchObject({
      siteId: String(allowedSite!._id),
      targetDomain: 'allowed.example',
    });

    const emptyScope = await listSnapshots(
      ACCOUNT,
      { limit: 20 },
      getTestDb() as never,
      [],
    );
    expect(emptyScope.snapshots).toEqual([]);
  });
});

describe('Traffic snapshot processor edge states', () => {
  const job = (accountId: string, runId: string) => ({ data: { accountId, runId } }) as never;

  it('normalizes empty traffic and uses rank, history, and zero fallbacks', async () => {
    const fake = createFakeCompetitorProvider();
    const result = await fetchTrafficProviderBundle(
      { targetDomain: 'example.com', inputs: { locationCode: 2840, languageCode: 'en', historyMonths: 24 } },
      { ...fake, getTrafficEstimation: vi.fn().mockResolvedValue([]) },
    );
    expect(result.traffic).toEqual([]);
    expect(buildTrafficSnapshotPayload(result, { inputs: { locationCode: 2840, languageCode: 'en' } }, new Date()).monthlyOrganicVisits.value).toBe(
      result.rankOverview?.estimatedMonthlyOrganicVisits,
    );
    const historyOnly = bundle({ traffic: false, rankOverview: false, history: true });
    expect(buildTrafficSnapshotPayload(historyOnly, { inputs: { locationCode: 2840, languageCode: 'en' } }, new Date()).monthlyOrganicVisits.value).toBe(850);
    const emptyHistory = { ...historyOnly, history: { domain: 'example.com', points: [] } };
    expect(buildTrafficSnapshotPayload(emptyHistory, { inputs: { locationCode: 2840, languageCode: 'en' } }, new Date()).monthlyOrganicVisits.value).toBe(0);
  });

  it('captures missing optional provider operations', async () => {
    const fake = createFakeCompetitorProvider();
    await expect(
      fetchTrafficProviderBundle(
        { targetDomain: 'example.com', inputs: { locationCode: 2840, languageCode: 'en', historyMonths: 24 } },
        {
          ...fake,
          getTrafficEstimation: undefined,
          getDomainRankOverview: undefined,
          getHistoricalRankOverview: undefined,
        },
      ),
    ).rejects.toBeInstanceOf(AllTrafficOperationsFailedError);
  });

  it('no-ops missing and terminal jobs and replays partial/succeeded stored rows', async () => {
    const provider = createFakeCompetitorProvider();
    const processor = createTrafficSnapshotProcessor({ db: getTestDb() as never, provider });
    await processor(job(ACCOUNT, new mongoose.Types.ObjectId().toString()));
    const terminal = await makeRun();
    terminal.status = 'succeeded';
    await terminal.save();
    await processor(job(ACCOUNT, String(terminal._id)));

    for (const retainedOps of [
      { traffic: true, rankOverview: false, history: false },
      { traffic: true, rankOverview: true, history: true },
    ]) {
      const run = await makeRun();
      const capturedAt = new Date('2026-07-22T12:00:00.000Z');
      await settleRun(
        {
          accountId: ACCOUNT,
          runId: String(run._id),
          retainedOps,
          payload: buildTrafficSnapshotPayload(bundle(retainedOps), run, capturedAt),
          capturedAt,
        },
        { db: getTestDb() as never },
      );
      await TrafficSnapshotRun.updateOne({ _id: run._id }, { $set: { status: 'queued' } });
      await processor(job(ACCOUNT, String(run._id)));
      const replayed = await TrafficSnapshotRun.findById(run._id);
      expect(replayed?.status).toBe(retainedOps.rankOverview ? 'succeeded' : 'partial');
    }
  });

  it('settles partial data then dead-letters a non-provider failure', async () => {
    const run = await makeRun('nonretry.example');
    const fake = createFakeCompetitorProvider();
    const provider: CompetitorProvider = {
      ...fake,
      getTrafficEstimation: vi.fn().mockRejectedValue(new Error('malformed vendor response')),
    };
    const processor = createTrafficSnapshotProcessor({
      db: getTestDb() as never,
      provider,
      now: () => new Date('2026-07-22T13:00:00.000Z'),
    });
    await expect(processor(job(ACCOUNT, String(run._id)))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(await TrafficSnapshotRun.findById(run._id)).toMatchObject({
      status: 'partial',
      retainedOps: { traffic: false, rankOverview: true, history: true },
    });
  });

  it('fails and dead-letters when all operations fail non-retryably', async () => {
    const run = await makeRun('dead.example');
    const provider: CompetitorProvider = {
      ...createFakeCompetitorProvider(),
      getTrafficEstimation: vi.fn().mockRejectedValue(new Error('bad traffic')),
      getDomainRankOverview: vi.fn().mockRejectedValue(new VendorUnavailableError('rank', { provider: 'fake', operation: 'rank' })),
      getHistoricalRankOverview: vi.fn().mockRejectedValue(new VendorUnavailableError('history', { provider: 'fake', operation: 'history' })),
    };
    await expect(
      createTrafficSnapshotProcessor({ db: getTestDb() as never, provider })(
        job(ACCOUNT, String(run._id)),
      ),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    expect(await TrafficSnapshotRun.findById(run._id)).toMatchObject({ status: 'failed' });
  });

  it('retries an all-retryable empty run before settling it failed', async () => {
    const run = await makeRun('retry.example');
    const unavailable = new VendorUnavailableError('unavailable', {
      provider: 'fake',
      operation: 'traffic',
    });
    const provider: CompetitorProvider = {
      ...createFakeCompetitorProvider(),
      getTrafficEstimation: vi.fn().mockRejectedValue(unavailable),
      getDomainRankOverview: vi.fn().mockRejectedValue(unavailable),
      getHistoricalRankOverview: vi.fn().mockRejectedValue(unavailable),
    };
    const processor = createTrafficSnapshotProcessor({
      db: getTestDb() as never,
      provider,
    });
    await expect(
      processor({ data: { accountId: ACCOUNT, runId: String(run._id) }, attemptsMade: 0, opts: { attempts: 3 } } as never),
    ).rejects.toBe(unavailable);
    expect(await TrafficSnapshotRun.findById(run._id)).toMatchObject({
      status: 'running',
    });

    await expect(
      processor({ data: { accountId: ACCOUNT, runId: String(run._id) }, attemptsMade: 2, opts: { attempts: 3 } } as never),
    ).rejects.toBe(unavailable);
    expect(await TrafficSnapshotRun.findById(run._id)).toMatchObject({
      status: 'failed',
    });
  });

  it('dead-letters mixed all-operation failures when a later error is non-retryable', async () => {
    const run = await makeRun('mixed.example');
    const retryable = new VendorUnavailableError('traffic unavailable', {
      provider: 'fake',
      operation: 'traffic',
    });
    const provider: CompetitorProvider = {
      ...createFakeCompetitorProvider(),
      getTrafficEstimation: vi.fn().mockRejectedValue(retryable),
      getDomainRankOverview: vi.fn().mockRejectedValue(new Error('bad rank payload')),
      getHistoricalRankOverview: vi.fn().mockRejectedValue(retryable),
    };
    await expect(
      createTrafficSnapshotProcessor({ db: getTestDb() as never, provider })({
        data: { accountId: ACCOUNT, runId: String(run._id) },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as never),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    expect(await TrafficSnapshotRun.findById(run._id)).toMatchObject({ status: 'failed' });
  });
});
