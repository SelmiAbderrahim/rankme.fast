import { Queue, UnrecoverableError, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import {
  enqueueGscSyncJob,
  GOOGLE_SITE_AUTO_MATCH_JOB_NAME,
} from '../../shared/queue/index.js';
import {
  createTestQueueConnection,
  flushTestRedis,
} from '../../shared/testing/redis.js';
import { Site } from '../sites/index.js';
import { GoogleConnection } from './google-connection.model.js';
import { SCOPE_GSC } from './google-connections.schema.js';
import {
  GSC_DAILY_SYNC_CRON,
  GSC_DAILY_SYNC_SCHEDULER_KEY,
  GSC_DAILY_SYNC_SWEEP_JOB,
  configureGscDailySyncScheduler,
  createGscDailySyncProducer,
  createGscSyncQueueDispatcher,
  createMongoGscDailySyncRepository,
} from './gsc-daily-sync.producer.js';

const ACCOUNT_A = '000000000000000000000001';
const ACCOUNT_B = '000000000000000000000002';
const ACCOUNT_C = '000000000000000000000003';
const ACCOUNT_D = '000000000000000000000004';
const FIXED_NOW = new Date('2026-08-05T23:59:59.000Z');

const encryptedRefreshToken = {
  ciphertext: 'ciphertext',
  iv: '123456789012',
  authTag: '1234567890123456',
  keyVersion: 1,
};

function job(data: unknown, name = GSC_DAILY_SYNC_SWEEP_JOB): Job {
  return { data, name } as unknown as Job;
}

function fakeLogger() {
  return { info: vi.fn() } as unknown as Pick<Logger, 'info'>;
}

function fakeQueue() {
  const adds: Array<{ name: string; data: unknown; opts: unknown }> = [];
  const upserts: Array<{ key: string; repeat: unknown; template: unknown }> = [];
  const removes: string[] = [];
  const queue = {
    add: vi.fn(async (name: string, data: unknown, opts: unknown) => {
      adds.push({ name, data, opts });
      return { id: (opts as { jobId?: string }).jobId };
    }),
    upsertJobScheduler: vi.fn(
      async (key: string, repeat: unknown, template: unknown) => {
        upserts.push({ key, repeat, template });
        return {};
      },
    ),
    removeJobScheduler: vi.fn(async (key: string) => {
      removes.push(key);
      return true;
    }),
  } as unknown as Queue;
  return { queue, adds, upserts, removes };
}

async function createConnection(input: {
  accountId: string;
  status?: 'connected' | 'needs_reconnect' | 'revoked';
  scopes?: string[];
}) {
  await GoogleConnection.create({
    accountId: input.accountId,
    googleAccountEmail: `${input.accountId}@example.com`,
    encryptedRefreshToken,
    scopes: input.scopes ?? [SCOPE_GSC],
    status: input.status ?? 'connected',
    connectedAt: FIXED_NOW,
  });
}

let redis: Redis;
let realQueue: Queue;

beforeAll(async () => {
  await startMemoryMongo();
  redis = createTestQueueConnection();
  realQueue = new Queue('gsc-daily-sync-producer-test', { connection: redis });
});

afterAll(async () => {
  await realQueue.close();
  await redis.quit();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await flushTestRedis(redis);
});

describe('configureGscDailySyncScheduler', () => {
  it('upserts one stable UTC daily scheduler template across repeated boots', async () => {
    const { queue, upserts } = fakeQueue();

    await configureGscDailySyncScheduler(queue, true);
    await configureGscDailySyncScheduler(queue, true);

    expect(upserts).toEqual([
      {
        key: GSC_DAILY_SYNC_SCHEDULER_KEY,
        repeat: { pattern: GSC_DAILY_SYNC_CRON, tz: 'UTC' },
        template: {
          name: GSC_DAILY_SYNC_SWEEP_JOB,
          data: { source: 'daily-scheduler' },
        },
      },
      {
        key: GSC_DAILY_SYNC_SCHEDULER_KEY,
        repeat: { pattern: GSC_DAILY_SYNC_CRON, tz: 'UTC' },
        template: {
          name: GSC_DAILY_SYNC_SWEEP_JOB,
          data: { source: 'daily-scheduler' },
        },
      },
    ]);
    expect(GSC_DAILY_SYNC_SCHEDULER_KEY).not.toContain(':');
  });

  it('removes future scheduling when the feature is disabled', async () => {
    const { queue, upserts, removes } = fakeQueue();

    await configureGscDailySyncScheduler(queue, false);

    expect(upserts).toEqual([]);
    expect(removes).toEqual([GSC_DAILY_SYNC_SCHEDULER_KEY]);
  });

  it('converges to one durable BullMQ scheduler and removes it cleanly', async () => {
    await configureGscDailySyncScheduler(realQueue, true);
    await configureGscDailySyncScheduler(realQueue, true);

    const [scheduler] = await realQueue.getJobSchedulers();
    expect(await realQueue.getJobSchedulers()).toHaveLength(1);
    expect(scheduler?.key).toBe(GSC_DAILY_SYNC_SCHEDULER_KEY);
    expect(scheduler?.pattern).toBe(GSC_DAILY_SYNC_CRON);
    expect(scheduler?.name).toBe(GSC_DAILY_SYNC_SWEEP_JOB);
    expect(scheduler?.template?.data).toEqual({ source: 'daily-scheduler' });

    await configureGscDailySyncScheduler(realQueue, false);
    expect(await realQueue.getJobSchedulers()).toEqual([]);
  });
});

describe('createGscDailySyncProducer', () => {
  it('fans out only active, owned, Site-bound properties through deterministic daily jobs', async () => {
    await createConnection({ accountId: ACCOUNT_A });
    await createConnection({
      accountId: ACCOUNT_B,
      scopes: [],
    });
    await createConnection({
      accountId: ACCOUNT_C,
      status: 'needs_reconnect',
    });
    await createConnection({ accountId: ACCOUNT_D });

    const [owned] = await Site.create([
      {
        accountId: ACCOUNT_A,
        url: 'https://example.com',
        domain: 'example.com',
        gscPropertyUrl: 'sc-domain:example.com',
        gscBindingGenerationId: 'legacy',
        gscBindingSource: 'legacy',
      },
      {
        accountId: ACCOUNT_A,
        url: 'https://other.example',
        domain: 'other.example',
      },
      {
        accountId: ACCOUNT_A,
        url: 'https://paused.example.com',
        domain: 'paused.example.com',
        paused: true,
        gscPropertyUrl: 'sc-domain:example.com',
        gscBindingGenerationId: 'legacy',
        gscBindingSource: 'legacy',
      },
      {
        accountId: ACCOUNT_B,
        url: 'https://example.com',
        domain: 'example.com',
        gscPropertyUrl: 'sc-domain:example.com',
        gscBindingGenerationId: 'legacy',
        gscBindingSource: 'legacy',
      },
      {
        accountId: ACCOUNT_C,
        url: 'https://reconnect.example.com',
        domain: 'example.com',
        gscPropertyUrl: 'sc-domain:example.com',
        gscBindingGenerationId: 'legacy',
        gscBindingSource: 'legacy',
      },
      {
        accountId: ACCOUNT_D,
        url: 'https://no-property.example.com',
        domain: 'example.com',
      },
    ]);

    const { queue, adds } = fakeQueue();
    const logger = fakeLogger();
    const process = createGscDailySyncProducer({
      repository: createMongoGscDailySyncRepository(),
      enqueue: (payload, day) => enqueueGscSyncJob(queue, payload, day),
      now: () => FIXED_NOW,
      logger,
    });

    const result = await process(job({ source: 'daily-scheduler' }));

    expect(result).toEqual({
      day: '2026-08-05',
      connectionsScanned: 2,
      sitesScanned: 1,
      enqueued: 1,
    });
    expect(adds).toEqual([
      {
        name: 'gsc-sync',
        data: {
          accountId: ACCOUNT_A,
          siteId: String(owned!._id),
          domain: 'example.com',
        },
        opts: { jobId: `gsc-sync-${String(owned!._id)}-2026-08-05` },
      },
    ]);
    expect(logger.info).toHaveBeenCalledWith(
      result,
      'daily gsc sync producer completed',
    );

    await process(job({ source: 'daily-scheduler' }));
    expect((adds[1]!.opts as { jobId: string }).jobId).toBe(
      (adds[0]!.opts as { jobId: string }).jobId,
    );
  });

  it('returns an observable zero-work result without touching the queue', async () => {
    const { queue, adds } = fakeQueue();
    const logger = fakeLogger();
    const process = createGscDailySyncProducer({
      repository: createMongoGscDailySyncRepository(),
      enqueue: (payload, day) => enqueueGscSyncJob(queue, payload, day),
      now: () => FIXED_NOW,
      logger,
    });

    await expect(process(job({ source: 'daily-scheduler' }))).resolves.toEqual({
      day: '2026-08-05',
      connectionsScanned: 0,
      sitesScanned: 0,
      enqueued: 0,
    });
    expect(adds).toEqual([]);
    expect(logger.info).toHaveBeenCalledOnce();
  });

  it('rejects malformed sweep payloads before scanning or enqueueing', async () => {
    const scanConnectedAccounts = vi.fn();
    const enqueue = vi.fn();
    const process = createGscDailySyncProducer({
      repository: {
        scanConnectedAccounts,
        findActiveSites: vi.fn(),
      },
      enqueue,
      now: () => FIXED_NOW,
      logger: fakeLogger(),
    });

    await expect(process(job({ source: 'manual' }))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(scanConnectedAccounts).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('propagates enqueue failures so BullMQ retries the idempotent sweep', async () => {
    async function* connections() {
      yield { accountId: ACCOUNT_A };
    }
    const enqueueError = new Error('redis unavailable');
    const logger = fakeLogger();
    const process = createGscDailySyncProducer({
      repository: {
        scanConnectedAccounts: connections,
        findActiveSites: async () => [
          { siteId: '000000000000000000000099', domain: 'example.com' },
        ],
      },
      enqueue: vi.fn().mockRejectedValue(enqueueError),
      now: () => FIXED_NOW,
      logger,
    });

    await expect(process(job({ source: 'daily-scheduler' }))).rejects.toBe(
      enqueueError,
    );
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('stops future ticks without abandoning a sweep accepted before flag-off', async () => {
    async function* connections() {
      yield { accountId: ACCOUNT_A };
    }
    const { queue, adds, removes } = fakeQueue();
    await configureGscDailySyncScheduler(queue, false);
    const process = createGscDailySyncProducer({
      repository: {
        scanConnectedAccounts: connections,
        findActiveSites: async () => [
          { siteId: '000000000000000000000098', domain: 'example.com' },
        ],
      },
      enqueue: (payload, day) => enqueueGscSyncJob(queue, payload, day),
      now: () => FIXED_NOW,
      logger: fakeLogger(),
    });

    await expect(process(job({ source: 'daily-scheduler' }))).resolves.toMatchObject({
      enqueued: 1,
    });
    expect(removes).toEqual([GSC_DAILY_SYNC_SCHEDULER_KEY]);
    expect(adds).toHaveLength(1);
  });

  it('dispatches only the three trusted queue job names', async () => {
    const sync = vi.fn().mockResolvedValue({ status: 'ok' });
    const daily = vi.fn().mockResolvedValue({ enqueued: 1 });
    const autoMatch = vi.fn().mockResolvedValue({ status: 'matched' });
    const dispatch = createGscSyncQueueDispatcher(sync, daily, autoMatch);
    const syncJob = job({}, 'gsc-sync');
    const dailyJob = job({ source: 'daily-scheduler' });
    const autoMatchJob = job({}, GOOGLE_SITE_AUTO_MATCH_JOB_NAME);

    await expect(dispatch(syncJob)).resolves.toEqual({ status: 'ok' });
    await expect(dispatch(dailyJob)).resolves.toEqual({ enqueued: 1 });
    await expect(dispatch(autoMatchJob)).resolves.toEqual({ status: 'matched' });
    expect(sync).toHaveBeenCalledWith(syncJob);
    expect(daily).toHaveBeenCalledWith(dailyJob);
    expect(autoMatch).toHaveBeenCalledWith(autoMatchJob);

    await expect(dispatch(job({}, 'unexpected'))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(sync).toHaveBeenCalledOnce();
    expect(daily).toHaveBeenCalledOnce();
    expect(autoMatch).toHaveBeenCalledOnce();
  });

  it('rejects an auto-match job when no auto-match processor is installed', async () => {
    const dispatch = createGscSyncQueueDispatcher(vi.fn(), vi.fn());
    await expect(
      dispatch(job({}, GOOGLE_SITE_AUTO_MATCH_JOB_NAME)),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });
});
