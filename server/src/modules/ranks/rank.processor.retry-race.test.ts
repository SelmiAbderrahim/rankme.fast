import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import mongoose from 'mongoose';
import { pino } from 'pino';
import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { keywords, rankings } from '../../db/schema/keywords.js';
import { rankCheckOutcomes } from '../../db/schema/rank-check-outcomes.js';
import { createFakeRankProvider } from '../../shared/providers/index.js';
import { rankPeriodKey } from '../../shared/queue/queues.js';
import { clearCollections, startMemoryMongo, stopMemoryMongo } from '../../shared/testing/mongo.js';
import { getTestDb, startTestPostgres, stopTestPostgres, truncateAllTables } from '../../shared/testing/postgres.js';
import { Site } from '../sites/index.js';
import { createPostgresRankTargetsResolver, createRankProcessor } from './rank.processor.js';
import { planRetry, recordOutcome } from './rank-outcomes.repo.js';

const logger = pino({ level: 'silent' });
const now = new Date('2026-10-20T12:00:00.000Z');

function job(data: unknown): Job {
  return { data, attemptsMade: 0, opts: { attempts: 3 } } as unknown as Job;
}

async function seedSite() {
  const accountId = new mongoose.Types.ObjectId();
  const site = await Site.create({ accountId, url: 'https://example.com', domain: 'example.com' });
  return { accountId: accountId.toHexString(), siteId: site.id as string };
}

async function seedKeyword(ids: { accountId: string; siteId: string }, phrase: string) {
  const [keyword] = await getTestDb().insert(keywords).values({ ...ids, phrase,
    locationCode: 2840, languageCode: 'en' }).returning();
  return keyword!;
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

describe('rank retry scheduling and insert races', () => {
  it('leaves a future retry alone and forwards the enqueue-time engine flag for due work', async () => {
    const ids = await seedSite();
    const future = await seedKeyword(ids, 'future retry');
    const due = await seedKeyword(ids, 'due retry');
    const periodKey = rankPeriodKey('weekly', now);
    const firstAttempt = new Date('2026-10-20T11:00:00.000Z');
    for (const keyword of [future, due]) {
      await recordOutcome(getTestDb() as never, { ...ids, keywordId: keyword.id,
        periodKey, status: 'failed', reason: 'vendor_timeout', at: firstAttempt,
        cadence: 'weekly' });
    }
    const futureRetryAt = new Date('2026-10-20T12:30:00.000Z');
    await planRetry(getTestDb() as never, { keywordIds: [future.id], periodKey,
      nextRetryAt: futureRetryAt, at: firstAttempt });
    const queue = { add: vi.fn(async () => ({ id: 'retry' })) };
    const provider = createFakeRankProvider();
    const checkRank = vi.spyOn(provider, 'checkRank');
    const process = createRankProcessor({ provider, db: getTestDb() as never,
      resolveTargets: async () => [], retryQueue: queue as never, logger,
      clock: () => now });

    await expect(process(job({ ...ids, keywordIds: [], schedulerKey: 'weekly',
      altEnginesEnabledAtEnqueue: false }))).resolves.toMatchObject({ checked: 0 });

    expect(checkRank).not.toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith('rank', expect.objectContaining({
      keywordIds: [due.id], altEnginesEnabledAtEnqueue: false,
      retry: { periodKey, attempt: 1 },
    }), expect.objectContaining({ delay: 0 }));
    const rows = await getTestDb().select().from(rankCheckOutcomes);
    expect(rows.find((row) => row.keywordId === future.id)?.nextRetryAt).toEqual(futureRetryAt);
    expect(rows.find((row) => row.keywordId === due.id)?.nextRetryAt)
      .toEqual(new Date('2026-10-20T11:30:00.000Z'));
  });

  it('preserves the winning row and failure marker when a concurrent insert wins after replay lookup', async () => {
    const ids = await seedSite();
    const keyword = await seedKeyword(ids, 'insert race');
    const failedAt = new Date('2026-10-19T10:00:00.000Z');
    await getTestDb().update(keywords).set({ lastFailedCheckAt: failedAt,
      lastFailedReason: 'vendor_timeout' }).where(eq(keywords.id, keyword.id));
    const baseDb = getTestDb();
    let raced = false;
    const db = new Proxy(baseDb, {
      get(target, property, receiver) {
        if (property !== 'insert') {
          const value: unknown = Reflect.get(target, property, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        }
        return (table: unknown) => {
          if (table !== rankings) return target.insert(table as never);
          return { values: (values: typeof rankings.$inferInsert) => {
            const wrap = (builder: object): object => new Proxy(builder, {
              get(step, method, stepReceiver) {
                const value: unknown = Reflect.get(step, method, stepReceiver);
                if (typeof value !== 'function') return value;
                if (method === 'returning') return async (...args: unknown[]) => {
                  const [winner] = await baseDb.insert(rankings).values({ ...values,
                    position: 2, rankAbsolute: 2 }).returning();
                  raced = true;
                  expect(winner?.keywordId).toBe(keyword.id);
                  return Reflect.apply(value, step, args);
                };
                return (...args: unknown[]) => {
                  const result: unknown = Reflect.apply(value, step, args);
                  return typeof result === 'object' && result !== null ? wrap(result) : result;
                };
              },
            });
            return wrap(target.insert(rankings).values(values));
          } };
        };
      },
    }) as unknown as Db;
    const provider = createFakeRankProvider({ result: { position: 9,
      foundUrl: 'https://example.com/loser', checkedAt: now } });
    const checkRank = vi.spyOn(provider, 'checkRank');
    const confirmRankDrop = vi.fn(async () => undefined);
    const process = createRankProcessor({ provider, db, logger,
      resolveTargets: createPostgresRankTargetsResolver(db), clock: () => now,
      confirmRankDrop });

    await expect(process(job({ ...ids, keywordIds: [keyword.id],
      schedulerKey: 'manual', manual: true }))).resolves.toMatchObject({ checked: 1 });

    expect(raced).toBe(true);
    expect(checkRank).toHaveBeenCalledTimes(1);
    const stored = await baseDb.select().from(rankings);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ keywordId: keyword.id, position: 2 });
    expect(confirmRankDrop).not.toHaveBeenCalled();
    const [after] = await baseDb.select().from(keywords).where(eq(keywords.id, keyword.id));
    expect(after).toMatchObject({ lastFailedReason: 'vendor_timeout',
      lastFailedCheckAt: failedAt });
  });
});
