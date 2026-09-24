/**
 * Job-scheduler tests — real Redis (see vitest.global-setup.ts).
 */
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { createTestQueueConnection, flushTestRedis } from '../testing/redis.js';
import {
  RANK_JOB_NAME,
  RANKS_QUEUE,
  minuteOffset,
  rankCronPattern,
  rankSchedulerKey,
  removeRankSchedule,
  upsertRankSchedule,
} from './index.js';

const hex = (n: number) => n.toString(16).padStart(24, '0');
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const siteId = hex(7);
const accountId = hex(1);

let connection: Redis;
let queue: Queue;

beforeAll(() => {
  connection = createTestQueueConnection();
  queue = new Queue(RANKS_QUEUE, { connection });
});

afterAll(async () => {
  await queue.close();
  await connection.quit();
});

beforeEach(async () => {
  await flushTestRedis(connection);
});

describe('minuteOffset', () => {
  it('is deterministic and inside 0–59', () => {
    expect(minuteOffset(siteId)).toBe(minuteOffset(siteId));
    for (const id of [hex(1), hex(2), hex(3), 'example.com', '']) {
      const m = minuteOffset(id);
      expect(m).toBeGreaterThanOrEqual(0);
      expect(m).toBeLessThan(60);
    }
  });

  it('spreads different sites across minutes', () => {
    const offsets = new Set(
      Array.from({ length: 50 }, (_, i) => minuteOffset(hex(i + 100))),
    );
    expect(offsets.size).toBeGreaterThan(10);
  });
});

describe('rankCronPattern', () => {
  it('weekly fires Mondays 06:xx UTC, daily every day 06:xx UTC', () => {
    const m = minuteOffset(siteId);
    expect(rankCronPattern('weekly', siteId)).toBe(`0 ${m} 6 * * 1`);
    expect(rankCronPattern('daily', siteId)).toBe(`0 ${m} 6 * * *`);
  });
});

describe('upsertRankSchedule / removeRankSchedule', () => {
  it('upserting twice yields exactly one scheduler', async () => {
    await upsertRankSchedule(queue, {
      accountId,
      siteId,
      cadence: 'weekly',
      altEnginesEnabled: true,
    });
    await upsertRankSchedule(queue, {
      accountId,
      siteId,
      cadence: 'weekly',
      altEnginesEnabled: true,
    });

    const schedulers = await queue.getJobSchedulers();
    expect(schedulers).toHaveLength(1);
    expect(schedulers[0]?.key).toBe(rankSchedulerKey(siteId));
    expect(schedulers[0]?.pattern).toBe(rankCronPattern('weekly', siteId));
    expect(schedulers[0]?.name).toBe(RANK_JOB_NAME);
  });

  it('carries a validated payload with accountId + schedulerKey', async () => {
    await upsertRankSchedule(queue, {
      accountId,
      siteId,
      cadence: 'weekly',
      keywordIds: [uuid(9)],
      altEnginesEnabled: false,
    });
    const [scheduler] = await queue.getJobSchedulers();
    expect(scheduler?.template?.data).toEqual({
      accountId,
      siteId,
      keywordIds: [uuid(9)],
      schedulerKey: rankSchedulerKey(siteId),
      altEnginesEnabledAtEnqueue: false,
    });
  });

  it('switching cadence updates the pattern in place', async () => {
    await upsertRankSchedule(queue, {
      accountId,
      siteId,
      cadence: 'weekly',
      altEnginesEnabled: true,
    });
    await upsertRankSchedule(queue, {
      accountId,
      siteId,
      cadence: 'daily',
      altEnginesEnabled: true,
    });

    const schedulers = await queue.getJobSchedulers();
    expect(schedulers).toHaveLength(1);
    expect(schedulers[0]?.pattern).toBe(rankCronPattern('daily', siteId));
  });

  it('remove deletes the scheduler and reports existence', async () => {
    await upsertRankSchedule(queue, {
      accountId,
      siteId,
      cadence: 'weekly',
      altEnginesEnabled: true,
    });
    expect(await removeRankSchedule(queue, siteId)).toBe(true);
    expect(await queue.getJobSchedulers()).toHaveLength(0);
    expect(await removeRankSchedule(queue, siteId)).toBe(false);
  });

  it('rejects invalid ids before touching Redis', async () => {
    await expect(
      upsertRankSchedule(queue, {
        accountId: 'evil',
        siteId,
        cadence: 'weekly',
        altEnginesEnabled: true,
      }),
    ).rejects.toThrow(ZodError);
    expect(await queue.getJobSchedulers()).toHaveLength(0);
  });
});
