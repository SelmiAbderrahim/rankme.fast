import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnrecoverableError, type Job } from 'bullmq';
import mongoose from 'mongoose';
import { pino } from 'pino';
import { env } from '../../config/env.js';
import type { Db } from '../../db/client.js';
import {
  keywords as keywordsTable,
  rankings as rankingsTable,
} from '../../db/schema/keywords.js';
import { rankCheckJobItems } from '../../db/schema/rank-check-jobs.js';
import {
  createFakeRankProvider,
  type RankProvider,
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
import { Site } from '../sites/index.js';
import {
  createPostgresRankTargetsResolver,
  createRankProcessor,
} from './rank.processor.js';
import { createSerpCacheRepo, type SerpCacheRepo } from './serp-cache.service.js';
import { finalizeRankJob, insertRankCheckJob, readRankJob } from './rank-jobs.repo.js';
import { rankPeriodKey } from '../../shared/queue/queues.js';
import { rankCheckOutcomes } from '../../db/schema/rank-check-outcomes.js';
import { VendorMalformedError, VendorQuotaError, VendorTimeoutError } from '../../shared/providers/errors.js';

const logger = pino({ level: 'silent' });

function jobFor(data: unknown): Job {
  return { data, attemptsMade: 0, opts: { attempts: 3 } } as unknown as Job;
}

async function seedProcessorSite(): Promise<{ accountId: string; siteId: string }> {
  const accountId = new mongoose.Types.ObjectId();
  const site = await Site.create({
    accountId,
    url: 'https://example.com',
    domain: 'example.com',
  });
  return { accountId: accountId.toHexString(), siteId: site.id as string };
}

async function seedKeyword(
  ids: { accountId: string; siteId: string },
  engine: 'bing' | 'google' = 'bing',
) {
  const rows = await getTestDb()
    .insert(keywordsTable)
    .values({
      accountId: ids.accountId,
      siteId: ids.siteId,
      phrase: 'processor coverage phrase',
      locationCode: 2840,
      languageCode: 'en',
      device: 'desktop',
      engine,
    })
    .returning();
  return rows[0]!;
}

function payloadFor(ids: { accountId: string; siteId: string }) {
  return { ...ids, keywordIds: [], schedulerKey: 'manual', manual: true };
}

function makeProcessor(provider: RankProvider = createFakeRankProvider()) {
  const db = getTestDb() as unknown as never;
  return createRankProcessor({
    provider,
    db,
    cache: createSerpCacheRepo({ db, ttlHours: 24 }),
    resolveTargets: createPostgresRankTargetsResolver(db),
    logger,
  });
}

function wrapReturningWithoutId(builder: object): object {
  return new Proxy(builder, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') return value;
      if (property === 'returning') {
        return async (...args: unknown[]) => {
          await Reflect.apply(value, target, args);
          return [{}];
        };
      }
      return (...args: unknown[]) => {
        const result: unknown = Reflect.apply(value, target, args);
        return typeof result === 'object' && result !== null
          ? wrapReturningWithoutId(result)
          : result;
      };
    },
  });
}

/** Simulates a broken repository RETURNING projection after a successful insert. */
function dbWithMissingReturnedRankingId(): Db {
  const db = getTestDb();
  return new Proxy(db, {
    get(target, property, receiver) {
      if (property === 'insert') {
        return (table: unknown) => {
          const builder = target.insert(table as never);
          return table === rankingsTable ? wrapReturningWithoutId(builder) : builder;
        };
      }
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as unknown as Db;
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
  (env as { ALT_ENGINE_TRACKING_ENABLED: boolean }).ALT_ENGINE_TRACKING_ENABLED = true;
  vi.restoreAllMocks();
});

describe('rank processor alt-engine rollout coverage', () => {
  it('finishes an alt-engine job accepted before the feature is disabled', async () => {
    const ids = await seedProcessorSite();
    const keyword = await seedKeyword(ids);
    const provider = createFakeRankProvider();
    const check = vi.spyOn(provider, 'checkAltEngineRank');
    (env as { ALT_ENGINE_TRACKING_ENABLED: boolean }).ALT_ENGINE_TRACKING_ENABLED = false;

    const outcome = await makeProcessor(provider)(
      jobFor({ ...payloadFor(ids), altEnginesEnabledAtEnqueue: true }),
    );

    expect(outcome).toMatchObject({ checked: 1, skipped: 0, errors: 0 });
    expect(check).toHaveBeenCalledTimes(1);
    const rows = await getTestDb().select().from(rankingsTable);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.keywordId).toBe(keyword.id);
  });

  it('excludes alt-engine targets from a job enqueued while the feature was off', async () => {
    const ids = await seedProcessorSite();
    await seedKeyword(ids);
    const provider = createFakeRankProvider();
    const check = vi.spyOn(provider, 'checkAltEngineRank');

    const outcome = await makeProcessor(provider)(
      jobFor({ ...payloadFor(ids), altEnginesEnabledAtEnqueue: false }),
    );

    expect(outcome).toMatchObject({ checked: 0, skipped: 0, errors: 0 });
    expect(check).not.toHaveBeenCalled();
  });
});

describe('rank processor defensive rank-drop coverage', () => {
  it('fails closed when an inserted ranking is returned without its identifier', async () => {
    const ids = await seedProcessorSite();
    const keyword = await seedKeyword(ids, 'google');
    await getTestDb().insert(rankingsTable).values({
      keywordId: keyword.id,
      position: 3,
      rankAbsolute: 3,
      foundUrl: 'https://example.com/previous',
      checkedAt: new Date('2026-01-01T00:00:00.000Z'),
      source: 'fresh',
    });
    const db = dbWithMissingReturnedRankingId();
    const confirmRankDrop = vi.fn(async () => undefined);
    const processor = createRankProcessor({
      provider: createFakeRankProvider({
        result: {
          position: 12,
          foundUrl: 'https://example.com/current',
          checkedAt: new Date('2026-01-08T12:00:00.000Z'),
        },
      }),
      db,
      resolveTargets: async ({ domain }) => [
        {
          keywordId: keyword.id,
          input: {
            keyword: keyword.phrase,
            domain,
            locationCode: keyword.locationCode,
            languageCode: keyword.languageCode,
            device: keyword.device,
          },
          engine: 'google',
          engineTarget: null,
        },
      ],
      logger,
      clock: () => new Date('2026-01-08T12:00:00.000Z'),
      confirmRankDrop,
    });

    await expect(processor(jobFor(payloadFor(ids)))).resolves.toMatchObject({ checked: 1 });
    expect(confirmRankDrop).not.toHaveBeenCalled();
    expect(await getTestDb().select().from(rankingsTable)).toHaveLength(2);
  });
});

describe('rank processor stale and paused jobs', () => {
  it('closes an obsolete retry before resolving targets or calling the provider', async () => {
    const ids = await seedProcessorSite();
    const keyword = await seedKeyword(ids, 'google');
    const provider = createFakeRankProvider();
    const check = vi.spyOn(provider, 'checkRank');
    const resolveTargets = vi.fn(createPostgresRankTargetsResolver(getTestDb() as never));
    const at = new Date('2026-10-25T12:00:00.000Z');
    const outcome = await createRankProcessor({ provider, db: getTestDb() as never,
      resolveTargets, logger, clock: () => at })(jobFor({ ...payloadFor(ids),
      keywordIds: [keyword.id], retry: { periodKey: rankPeriodKey('weekly',
        new Date('2026-10-12T12:00:00.000Z')), attempt: 1 } }));
    expect(outcome).toMatchObject({ checked: 0, skipped: 1 });
    expect(resolveTargets).not.toHaveBeenCalled();
    expect(check).not.toHaveBeenCalled();
  });

  it('cancels a paused explicit job and records skipped scheduled work', async () => {
    const ids = await seedProcessorSite();
    const keyword = await seedKeyword(ids, 'google');
    await Site.updateOne({ _id: ids.siteId }, { $set: { paused: true } });
    const at = new Date('2026-10-25T12:00:00.000Z');
    const db = getTestDb() as never;
    const job = await insertRankCheckJob(db, { ...ids, scope: 'site',
      idempotencyKey: null, retryOfJobId: null, now: at,
      targets: [{ keywordId: keyword.id, engine: 'google', trackLocalPack: false }] });
    const result = await createRankProcessor({ provider: createFakeRankProvider(), db,
      resolveTargets: createPostgresRankTargetsResolver(db), logger, clock: () => at })(
      jobFor({ ...payloadFor(ids), rankJobId: job.id, keywordIds: [keyword.id], manual: false }));
    expect(result).toMatchObject({ checked: 0, errors: 0 });
    expect((await readRankJob(db, { ...ids, jobId: job.id }))?.items[0])
      .toMatchObject({ state: 'cancelled', reason: 'site_paused' });
    expect((await getTestDb().select().from(rankCheckOutcomes))[0])
      .toMatchObject({ keywordId: keyword.id, status: 'skipped', reason: 'site_paused' });
    await createRankProcessor({ provider: createFakeRankProvider(), db,
      resolveTargets: createPostgresRankTargetsResolver(db), logger, clock: () => at })(
      jobFor({ ...payloadFor(ids), manual: false, keywordIds: [] }));
  });

  it('keeps a posted task id after a transient poll failure', async () => {
    const ids = await seedProcessorSite();
    await seedKeyword(ids, 'google');
    let polls = 0;
    const provider = { ...createFakeRankProvider(),
      postSerpTasks: vi.fn(async () => [{ ok: true as const, vendorTaskId: 'posted-task' }]),
      pollSerpTask: vi.fn(async () => {
        if (++polls === 1) throw new VendorTimeoutError('transient poll timeout',
          { provider: 'rank', operation: 'serp-task-get' });
        return { state: 'ready' as const, result: { items: [], costUsd: 0,
          aiOverview: { present: false, references: [] },
          features: { features: [], featuredSnippet: null, paa: [] } } };
      }),
    };
    const at = new Date('2026-10-25T12:00:00.000Z');
    const outcome = await createRankProcessor({ provider, db: getTestDb() as never,
      resolveTargets: createPostgresRankTargetsResolver(getTestDb() as never), logger,
      clock: () => at, serpTaskPollIntervalMs: 0, sleep: async () => {} })(
      jobFor(payloadFor(ids)));
    expect(outcome).toMatchObject({ checked: 1, errors: 0 });
    expect(provider.postSerpTasks).toHaveBeenCalledTimes(1);
    expect(provider.pollSerpTask).toHaveBeenCalledTimes(2);
    expect(provider.pollSerpTask).toHaveBeenNthCalledWith(2, 'posted-task');
  });

  it('uses a cached batch result without posting a vendor task', async () => {
    const ids = await seedProcessorSite();
    await seedKeyword(ids, 'google');
    const at = new Date('2026-10-25T12:00:00.000Z');
    const provider = { ...createFakeRankProvider(),
      postSerpTasks: vi.fn(async () => []),
      pollSerpTask: vi.fn(async () => ({ state: 'pending' as const })),
    };
    const cache = { read: vi.fn(async () => ({ topResults: [], aiOverview: null,
      features: null, fetchedAt: at, expiresAt: new Date(at.getTime() + 60_000) })),
      write: vi.fn(async () => undefined) } as unknown as SerpCacheRepo;
    const outcome = await createRankProcessor({ provider, db: getTestDb() as never,
      cache, resolveTargets: createPostgresRankTargetsResolver(getTestDb() as never),
      logger, clock: () => at })(jobFor(payloadFor(ids)));
    expect(outcome).toMatchObject({ checked: 1, fromCache: 1, fromFresh: 0 });
    expect(provider.postSerpTasks).not.toHaveBeenCalled();
    expect(provider.pollSerpTask).not.toHaveBeenCalled();
  });

  it('stops reposting a task after two explicit provider failures', async () => {
    const ids = await seedProcessorSite();
    await seedKeyword(ids, 'google');
    let posts = 0;
    const provider = { ...createFakeRankProvider(),
      postSerpTasks: vi.fn(async () => [{ ok: true as const, vendorTaskId: `task-${++posts}` }]),
      pollSerpTask: vi.fn(async () => ({ state: 'failed' as const,
        error: new VendorMalformedError('task failed',
          { provider: 'rank', operation: 'serp-task-get' }) })),
    };
    const at = new Date('2026-10-25T12:00:00.000Z');
    const outcome = await createRankProcessor({ provider, db: getTestDb() as never,
      resolveTargets: createPostgresRankTargetsResolver(getTestDb() as never),
      logger, clock: () => at, serpTaskPollIntervalMs: 0, sleep: async () => {} })(
      jobFor(payloadFor(ids)));
    expect(outcome).toMatchObject({ checked: 0, errors: 1 });
    expect(provider.postSerpTasks).toHaveBeenCalledTimes(2);
    expect(provider.pollSerpTask).toHaveBeenCalledTimes(2);
  });

  it('skips a keyword when another worker claims its explicit job item first', async () => {
    const ids = await seedProcessorSite();
    const keyword = await seedKeyword(ids, 'google');
    const at = new Date('2026-10-25T12:00:00.000Z');
    const db = getTestDb();
    const job = await insertRankCheckJob(db as never, { ...ids, scope: 'keyword',
      idempotencyKey: null, retryOfJobId: null, now: at,
      targets: [{ keywordId: keyword.id, engine: 'google', trackLocalPack: false }] });
    const racedDb = new Proxy(db, { get(target, property, receiver) {
      if (property === 'update') return (table: unknown) => table === rankCheckJobItems
        ? { set: () => ({ where: () => ({ returning: async () => [] }) }) }
        : target.update(table as never);
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    } }) as unknown as Db;
    const provider = { ...createFakeRankProvider(),
      postSerpTasks: vi.fn(async () => []),
      pollSerpTask: vi.fn(async () => ({ state: 'pending' as const })),
    };
    const result = await createRankProcessor({ provider, db: racedDb,
      resolveTargets: createPostgresRankTargetsResolver(racedDb), logger, clock: () => at })(
      jobFor({ ...payloadFor(ids), rankJobId: job.id, keywordIds: [keyword.id] }));
    expect(result).toMatchObject({ checked: 0, skipped: 1 });
    expect(provider.postSerpTasks).not.toHaveBeenCalled();
  });

  it('records an attempt for a direct Google check in an explicit job', async () => {
    const ids = await seedProcessorSite();
    const keyword = await seedKeyword(ids, 'google');
    const at = new Date('2026-10-25T12:00:00.000Z');
    const db = getTestDb() as never;
    const job = await insertRankCheckJob(db, { ...ids, scope: 'keyword',
      idempotencyKey: null, retryOfJobId: null, now: at,
      targets: [{ keywordId: keyword.id, engine: 'google', trackLocalPack: false }] });
    const result = await createRankProcessor({ provider: createFakeRankProvider(), db,
      resolveTargets: createPostgresRankTargetsResolver(db), logger, clock: () => at })(
      jobFor({ ...payloadFor(ids), rankJobId: job.id, keywordIds: [keyword.id] }));
    expect(result).toMatchObject({ checked: 1, errors: 0 });
    expect((await readRankJob(db, { ...ids, jobId: job.id }))?.items[0])
      .toMatchObject({ state: 'succeeded', attempts: 1 });
  });

  it('refuses an explicit job that has already finished', async () => {
    const ids = await seedProcessorSite();
    const at = new Date('2026-10-25T12:00:00.000Z');
    const db = getTestDb() as never;
    const job = await insertRankCheckJob(db, { ...ids, scope: 'site',
      idempotencyKey: null, retryOfJobId: null, now: at, targets: [] });
    await finalizeRankJob(db, job.id, at);
    await expect(createRankProcessor({ provider: createFakeRankProvider(), db,
      resolveTargets: createPostgresRankTargetsResolver(db), logger, clock: () => at })(
      jobFor({ ...payloadFor(ids), rankJobId: job.id })))
      .rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('settles an explicit replay without a second provider check', async () => {
    const ids = await seedProcessorSite();
    const keyword = await seedKeyword(ids, 'google');
    const at = new Date('2026-10-25T12:00:00.000Z');
    await getTestDb().insert(rankingsTable).values({ keywordId: keyword.id,
      position: 3, source: 'fresh', checkedAt: at });
    const db = getTestDb() as never;
    const job = await insertRankCheckJob(db, { ...ids, scope: 'keyword',
      idempotencyKey: null, retryOfJobId: null, now: at,
      targets: [{ keywordId: keyword.id, engine: 'google', trackLocalPack: false }] });
    const provider = createFakeRankProvider();
    const check = vi.spyOn(provider, 'checkRank');
    const result = await createRankProcessor({ provider, db,
      resolveTargets: createPostgresRankTargetsResolver(db), logger, clock: () => at })(
      jobFor({ ...payloadFor(ids), rankJobId: job.id, keywordIds: [keyword.id] }));
    expect(result).toMatchObject({ checked: 0, skipped: 1 });
    expect(check).not.toHaveBeenCalled();
    expect((await readRankJob(db, { ...ids, jobId: job.id }))?.items[0])
      .toMatchObject({ state: 'succeeded', reason: 'already_checked' });
  });

  it('settles a successful alternate-engine explicit item', async () => {
    const ids = await seedProcessorSite();
    const keyword = await seedKeyword(ids);
    const at = new Date('2026-10-25T12:00:00.000Z');
    const db = getTestDb() as never;
    const job = await insertRankCheckJob(db, { ...ids, scope: 'keyword',
      idempotencyKey: null, retryOfJobId: null, now: at,
      targets: [{ keywordId: keyword.id, engine: 'bing', trackLocalPack: false }] });
    const provider = { ...createFakeRankProvider(),
      postSerpTasks: vi.fn(async () => []),
      pollSerpTask: vi.fn(async () => ({ state: 'pending' as const })),
    };
    const result = await createRankProcessor({ provider, db,
      resolveTargets: createPostgresRankTargetsResolver(db), logger, clock: () => at })(
      jobFor({ ...payloadFor(ids), rankJobId: job.id, keywordIds: [keyword.id],
        altEnginesEnabledAtEnqueue: true }));
    expect(result).toMatchObject({ checked: 1, errors: 0 });
    expect((await readRankJob(db, { ...ids, jobId: job.id }))?.items[0])
      .toMatchObject({ state: 'succeeded' });
    expect(provider.postSerpTasks).not.toHaveBeenCalled();
  });

  it('settles a keyword-scoped alternate-engine provider failure', async () => {
    const ids = await seedProcessorSite();
    const keyword = await seedKeyword(ids);
    const at = new Date('2026-10-25T12:00:00.000Z');
    const db = getTestDb() as never;
    const job = await insertRankCheckJob(db, { ...ids, scope: 'keyword',
      idempotencyKey: null, retryOfJobId: null, now: at,
      targets: [{ keywordId: keyword.id, engine: 'bing', trackLocalPack: false }] });
    const provider = createFakeRankProvider();
    vi.spyOn(provider, 'checkAltEngineRank').mockRejectedValueOnce(
      new VendorTimeoutError('alt check timed out', { provider: 'rank', operation: 'alt-rank' }));
    const result = await createRankProcessor({ provider, db,
      resolveTargets: createPostgresRankTargetsResolver(db), logger, clock: () => at })(
      jobFor({ ...payloadFor(ids), rankJobId: job.id, keywordIds: [keyword.id],
        altEnginesEnabledAtEnqueue: true }));
    expect(result).toMatchObject({ checked: 0, errors: 1 });
    expect((await readRankJob(db, { ...ids, jobId: job.id }))?.items[0])
      .toMatchObject({ state: 'failed', reason: 'vendor_timeout' });
  });

  it('skips a batch result that another worker claimed before posting', async () => {
    const ids = await seedProcessorSite();
    const keyword = await seedKeyword(ids, 'google');
    const at = new Date('2026-10-25T12:00:00.000Z');
    const db = getTestDb();
    const job = await insertRankCheckJob(db as never, { ...ids, scope: 'keyword',
      idempotencyKey: null, retryOfJobId: null, now: at,
      targets: [{ keywordId: keyword.id, engine: 'google', trackLocalPack: false }] });
    let claims = 0;
    const racedDb = new Proxy(db, { get(target, property, receiver) {
      if (property === 'update') return (table: unknown) => table === rankCheckJobItems && claims++ === 0
        ? { set: () => ({ where: () => ({ returning: async () => [] }) }) }
        : target.update(table as never);
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    } }) as unknown as Db;
    const provider = { ...createFakeRankProvider(),
      postSerpTasks: vi.fn(async () => []),
      pollSerpTask: vi.fn(async () => ({ state: 'pending' as const })),
    };
    const result = await createRankProcessor({ provider, db: racedDb,
      resolveTargets: createPostgresRankTargetsResolver(racedDb), logger, clock: () => at })(
      jobFor({ ...payloadFor(ids), rankJobId: job.id, keywordIds: [keyword.id] }));
    expect(result).toMatchObject({ checked: 0, skipped: 1 });
    expect(claims).toBeGreaterThanOrEqual(2);
    expect(provider.postSerpTasks).not.toHaveBeenCalled();
  });

  it('reports a malformed batch-post result for its attempted keyword', async () => {
    const ids = await seedProcessorSite();
    await seedKeyword(ids, 'google');
    const provider = { ...createFakeRankProvider(),
      postSerpTasks: vi.fn(async () => []),
      pollSerpTask: vi.fn(async () => ({ state: 'pending' as const })),
    };
    const result = await createRankProcessor({ provider, db: getTestDb() as never,
      resolveTargets: createPostgresRankTargetsResolver(getTestDb() as never),
      logger, clock: () => new Date('2026-10-25T12:00:00.000Z') })(
      jobFor(payloadFor(ids)));
    expect(result).toMatchObject({ checked: 0, errors: 1 });
    expect(provider.pollSerpTask).not.toHaveBeenCalled();
  });

  it('propagates an unexpected batch-post error', async () => {
    const ids = await seedProcessorSite();
    await seedKeyword(ids, 'google');
    const unexpected = new Error('unexpected post failure');
    const provider = { ...createFakeRankProvider(),
      postSerpTasks: vi.fn(async () => { throw unexpected; }),
      pollSerpTask: vi.fn(async () => ({ state: 'pending' as const })),
    };
    await expect(createRankProcessor({ provider, db: getTestDb() as never,
      resolveTargets: createPostgresRankTargetsResolver(getTestDb() as never),
      logger, clock: () => new Date('2026-10-25T12:00:00.000Z') })(
      jobFor(payloadFor(ids)))).rejects.toBe(unexpected);
  });

  it('propagates an unexpected poll error for an already-posted task', async () => {
    const ids = await seedProcessorSite();
    await seedKeyword(ids, 'google');
    const unexpected = new Error('unexpected poll failure');
    const provider = { ...createFakeRankProvider(),
      postSerpTasks: vi.fn(async () => [{ ok: true as const, vendorTaskId: 'task-1' }]),
      pollSerpTask: vi.fn(async () => { throw unexpected; }),
    };
    await expect(createRankProcessor({ provider, db: getTestDb() as never,
      resolveTargets: createPostgresRankTargetsResolver(getTestDb() as never),
      logger, clock: () => new Date('2026-10-25T12:00:00.000Z') })(
      jobFor(payloadFor(ids)))).rejects.toBe(unexpected);
  });

  it('writes a successful batch result with a null vendor cost to cache', async () => {
    const ids = await seedProcessorSite();
    await seedKeyword(ids, 'google');
    let polls = 0;
    const provider = { ...createFakeRankProvider(),
      postSerpTasks: vi.fn(async () => [{ ok: true as const, vendorTaskId: 'task-1' }]),
      pollSerpTask: vi.fn(async () => ++polls === 1
        ? { state: 'pending' as const }
        : { state: 'ready' as const, result: { items: [], costUsd: null,
          aiOverview: { present: false, references: [] },
          features: { features: [], featuredSnippet: null, paa: [] } } }),
    };
    const cache = { read: vi.fn(async () => null), write: vi.fn(async () => undefined) } as unknown as SerpCacheRepo;
    const result = await createRankProcessor({ provider, db: getTestDb() as never,
      cache, resolveTargets: createPostgresRankTargetsResolver(getTestDb() as never),
      logger, serpTaskPollIntervalMs: 0 })(jobFor(payloadFor(ids)));
    expect(result).toMatchObject({ checked: 1, fromFresh: 1 });
    expect(cache.write).toHaveBeenCalledWith(expect.objectContaining({
      costMicros: null,
    }));
  });

  it('reposts one retryable task-post failure before polling', async () => {
    const ids = await seedProcessorSite();
    await seedKeyword(ids, 'google');
    let posts = 0;
    const provider = { ...createFakeRankProvider(),
      postSerpTasks: vi.fn(async () => ++posts === 1
        ? [{ ok: false as const, error: new VendorTimeoutError('post timeout',
          { provider: 'rank', operation: 'serp-task-post' }) }]
        : [{ ok: true as const, vendorTaskId: 'retry-task' }]),
      pollSerpTask: vi.fn(async () => ({ state: 'ready' as const,
        result: { items: [], costUsd: 0,
          aiOverview: { present: false, references: [] },
          features: { features: [], featuredSnippet: null, paa: [] } } })),
    };
    const result = await createRankProcessor({ provider, db: getTestDb() as never,
      resolveTargets: createPostgresRankTargetsResolver(getTestDb() as never),
      logger, clock: () => new Date('2026-10-25T12:00:00.000Z'),
      serpTaskPollIntervalMs: 0, sleep: async () => {} })(jobFor(payloadFor(ids)));
    expect(result).toMatchObject({ checked: 1, errors: 0 });
    expect(provider.postSerpTasks).toHaveBeenCalledTimes(2);
    expect(provider.pollSerpTask).toHaveBeenCalledWith('retry-task');
  });

  it('settles a task after its second keyword-scoped post failure', async () => {
    const ids = await seedProcessorSite();
    await seedKeyword(ids, 'google');
    const provider = { ...createFakeRankProvider(),
      postSerpTasks: vi.fn(async () => [{ ok: false as const,
        error: new VendorTimeoutError('post timeout',
          { provider: 'rank', operation: 'serp-task-post' }) }]),
      pollSerpTask: vi.fn(async () => ({ state: 'pending' as const })),
    };
    const result = await createRankProcessor({ provider, db: getTestDb() as never,
      resolveTargets: createPostgresRankTargetsResolver(getTestDb() as never), logger,
      clock: () => new Date('2026-10-25T12:00:00.000Z') })(jobFor(payloadFor(ids)));
    expect(result).toMatchObject({ checked: 0, errors: 1 });
    expect(provider.postSerpTasks).toHaveBeenCalledTimes(2);
  });

  it('stops immediately when a task-post outcome reports account-wide quota exhaustion', async () => {
    const ids = await seedProcessorSite();
    await seedKeyword(ids, 'google');
    const provider = { ...createFakeRankProvider(),
      postSerpTasks: vi.fn(async () => [{ ok: false as const,
        error: new VendorQuotaError('quota exhausted',
          { provider: 'rank', operation: 'serp-task-post' }) }]),
      pollSerpTask: vi.fn(async () => ({ state: 'pending' as const })),
    };
    await expect(createRankProcessor({ provider, db: getTestDb() as never,
      resolveTargets: createPostgresRankTargetsResolver(getTestDb() as never), logger,
      clock: () => new Date('2026-10-25T12:00:00.000Z') })(jobFor(payloadFor(ids))))
      .rejects.toBeInstanceOf(VendorQuotaError);
    expect(provider.postSerpTasks).toHaveBeenCalledTimes(1);
  });

  it('does not post a second chunk after an account-wide failure', async () => {
    const ids = await seedProcessorSite();
    await getTestDb().insert(keywordsTable).values(Array.from({ length: 101 }, (_, i) => ({
      accountId: ids.accountId, siteId: ids.siteId, phrase: `chunk phrase ${i}`,
      locationCode: 2840, languageCode: 'en', engine: 'google' as const,
    })));
    const provider = { ...createFakeRankProvider(),
      postSerpTasks: vi.fn(async () => { throw new VendorQuotaError('quota exhausted',
        { provider: 'rank', operation: 'serp-task-post' }); }),
      pollSerpTask: vi.fn(async () => ({ state: 'pending' as const })),
    };
    await expect(createRankProcessor({ provider, db: getTestDb() as never,
      resolveTargets: createPostgresRankTargetsResolver(getTestDb() as never), logger,
      clock: () => new Date('2026-10-25T12:00:00.000Z') })(jobFor(payloadFor(ids))))
      .rejects.toBeInstanceOf(VendorQuotaError);
    expect(provider.postSerpTasks).toHaveBeenCalledTimes(1);
  });

  it('uses default job clocks and records a priced batch result in cache', async () => {
    const ids = await seedProcessorSite();
    const keyword = await seedKeyword(ids, 'google');
    const db = getTestDb() as never;
    const job = await insertRankCheckJob(db, { ...ids, scope: 'keyword',
      idempotencyKey: null, retryOfJobId: null, now: new Date(),
      targets: [{ keywordId: keyword.id, engine: 'google', trackLocalPack: false }] });
    const provider = { ...createFakeRankProvider(),
      postSerpTasks: vi.fn(async () => [{ ok: true as const, vendorTaskId: 'priced-task' }]),
      pollSerpTask: vi.fn(async () => ({ state: 'ready' as const,
        result: { items: [], costUsd: 0.01,
          aiOverview: { present: false, references: [] },
          features: { features: [], featuredSnippet: null, paa: [] } } })),
    };
    const cache = { read: vi.fn(async () => null), write: vi.fn(async () => undefined) } as unknown as SerpCacheRepo;
    const result = await createRankProcessor({ provider, db, cache,
      resolveTargets: createPostgresRankTargetsResolver(db), logger })(
      jobFor({ ...payloadFor(ids), rankJobId: job.id, keywordIds: [keyword.id] }));
    expect(result).toMatchObject({ checked: 1, errors: 0 });
    expect(cache.write).toHaveBeenCalledWith(expect.objectContaining({ costMicros: 10_000n }));
  });
});
