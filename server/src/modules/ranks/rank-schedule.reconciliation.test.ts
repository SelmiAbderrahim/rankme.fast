import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { Types } from 'mongoose';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { domainStates, keywords } from '../../db/schema/keywords.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import { createTestQueueConnection, flushTestRedis } from '../../shared/testing/redis.js';
import {
  RANKS_QUEUE,
  rankCronPattern,
  rankSchedulerKey,
} from '../../shared/queue/index.js';
import {
  reconcileRankSchedules,
  refreshRankScheduleAfterPromotion,
} from './rank-schedule.reconciliation.js';

const ACCOUNT = new Types.ObjectId().toHexString();
const WEEKLY_SITE = new Types.ObjectId().toHexString();
const DAILY_SITE = new Types.ObjectId().toHexString();

let connection: Redis;
let queue: Queue;

beforeAll(async () => {
  await startTestPostgres();
  connection = createTestQueueConnection();
  queue = new Queue(RANKS_QUEUE, { connection });
});

afterAll(async () => {
  await queue.close();
  await connection.quit();
  await stopTestPostgres();
});

beforeEach(async () => {
  await truncateAllTables();
  await flushTestRedis(connection);
});

async function seedKeyword(siteId: string, phrase: string, active = true): Promise<void> {
  await getTestDb().insert(keywords).values({
    accountId: ACCOUNT,
    siteId,
    phrase,
    locationCode: 2840,
    languageCode: 'en',
    active,
  });
}

describe('reconcileRankSchedules', () => {
  it('is a no-op when Postgres has no active tracked keywords', async () => {
    await expect(reconcileRankSchedules(getTestDb(), queue, false)).resolves.toBe(0);
    expect(await queue.getJobSchedulers()).toEqual([]);
  });

  it('removes a prefix-scoped orphan after its last active keyword is disabled', async () => {
    await seedKeyword(WEEKLY_SITE, 'one');
    await reconcileRankSchedules(getTestDb(), queue, false);
    expect(await queue.getJobScheduler(rankSchedulerKey(WEEKLY_SITE))).toBeDefined();
    await queue.upsertJobScheduler(
      'another-feature-scheduler',
      { every: 60_000 },
      { name: 'another-feature', data: {} },
    );

    await getTestDb()
      .update(keywords)
      .set({ active: false })
      .where(eq(keywords.siteId, WEEKLY_SITE));
    await expect(reconcileRankSchedules(getTestDb(), queue, false)).resolves.toBe(0);
    expect((await queue.getJobSchedulers()).map((row) => row.key)).toEqual([
      'another-feature-scheduler',
    ]);
  });

  it('recovers missing schedulers without rewriting an accepted flag snapshot', async () => {
    await seedKeyword(WEEKLY_SITE, 'one');
    await seedKeyword(WEEKLY_SITE, 'two');
    await seedKeyword(DAILY_SITE, 'daily');
    await seedKeyword(new Types.ObjectId().toHexString(), 'inactive', false);
    await getTestDb().insert(domainStates).values({ siteId: DAILY_SITE, cadence: 'daily' });

    await expect(reconcileRankSchedules(getTestDb(), queue, false)).resolves.toBe(2);
    let schedulers = await queue.getJobSchedulers(0, -1, true);
    expect(schedulers).toHaveLength(2);
    expect(schedulers.find((row) => row.template?.data.siteId === WEEKLY_SITE)?.pattern).toBe(
      rankCronPattern('weekly', WEEKLY_SITE),
    );
    expect(schedulers.find((row) => row.template?.data.siteId === DAILY_SITE)?.pattern).toBe(
      rankCronPattern('daily', DAILY_SITE),
    );
    expect(schedulers.every((row) => row.template?.data.altEnginesEnabledAtEnqueue === false)).toBe(
      true,
    );
    expect(
      (await queue.getJobs(['delayed', 'waiting'])).every(
        (job) => job.data.altEnginesEnabledAtEnqueue === false,
      ),
    ).toBe(true);

    await expect(reconcileRankSchedules(getTestDb(), queue, true)).resolves.toBe(2);
    schedulers = await queue.getJobSchedulers(0, -1, true);
    expect(schedulers).toHaveLength(2);
    // Recovery is not an edit operation. BullMQ upsert would replace the
    // delayed iteration, so both its payload and the scheduler template retain
    // the snapshot that was accepted before the flag changed.
    expect(schedulers.every((row) => row.template?.data.altEnginesEnabledAtEnqueue === false)).toBe(
      true,
    );
    expect(
      (await queue.getJobs(['delayed', 'waiting'])).every(
        (job) => job.data.altEnginesEnabledAtEnqueue === false,
      ),
    ).toBe(true);

    // A genuine Redis loss leaves no accepted iteration to preserve, so the
    // live-worker recovery recreates both schedules with the current snapshot.
    await flushTestRedis(connection);
    await expect(reconcileRankSchedules(getTestDb(), queue, true)).resolves.toBe(2);
    schedulers = await queue.getJobSchedulers(0, -1, true);
    expect(schedulers.every((row) => row.template?.data.altEnginesEnabledAtEnqueue === true)).toBe(
      true,
    );
  });

  it('refreshes only a promoted scheduler iteration backed by active keywords', async () => {
    const payload = {
      accountId: ACCOUNT,
      siteId: WEEKLY_SITE,
      keywordIds: [],
      schedulerKey: rankSchedulerKey(WEEKLY_SITE),
      altEnginesEnabledAtEnqueue: true,
    };
    await expect(
      refreshRankScheduleAfterPromotion(getTestDb(), queue, payload, false),
    ).resolves.toBe(false);
    await seedKeyword(WEEKLY_SITE, 'one');
    await expect(
      refreshRankScheduleAfterPromotion(getTestDb(), queue, { ...payload, manual: true }, false),
    ).resolves.toBe(false);
    await expect(
      refreshRankScheduleAfterPromotion(
        getTestDb(),
        queue,
        { ...payload, schedulerKey: 'manual' },
        false,
      ),
    ).resolves.toBe(false);
    await expect(
      refreshRankScheduleAfterPromotion(getTestDb(), queue, payload, false),
    ).resolves.toBe(true);
    expect(
      (await queue.getJobScheduler(rankSchedulerKey(WEEKLY_SITE)))?.template?.data
        .altEnginesEnabledAtEnqueue,
    ).toBe(false);
    await expect(
      refreshRankScheduleAfterPromotion(getTestDb(), queue, { crafted: true }, false),
    ).resolves.toBe(false);
  });
});
