import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { keywords } from '../../db/schema/index.js';
import { getTestDb, startTestPostgres, stopTestPostgres, truncateAllTables } from '../../shared/testing/postgres.js';
import {
  expireOverdueRankJobs, findActiveRankJob, insertRankCheckJob, rankJobDeadlineMs,
  readRankJob, recordRankJobItemAttempts, settleOpenRankJobItems,
} from './rank-jobs.repo.js';

beforeAll(startTestPostgres);
afterAll(stopTestPostgres);
beforeEach(truncateAllTables);

const now = new Date('2026-10-25T12:00:00.000Z');
const siteId = '507f1f77bcf86cd799439011';
const accountId = 'owner';

async function seedKeyword(phrase: string) {
  const [row] = await getTestDb().insert(keywords).values({ accountId, siteId, phrase,
    locationCode: 2840, languageCode: 'en' }).returning();
  return row!;
}

describe('explicit rank jobs', () => {
  it('sizes a shared polling window per 100 Google tasks and caps it at one hour', () => {
    expect(rankJobDeadlineMs(0, 180_000)).toBe(900_000);
    expect(rankJobDeadlineMs(1, 180_000)).toBe(1_080_000);
    expect(rankJobDeadlineMs(101, 180_000)).toBe(1_260_000);
    expect(rankJobDeadlineMs(10_000, 180_000)).toBe(3_600_000);
  });

  it('persists a job without charging fields and scopes status reads to the account', async () => {
    const keyword = await seedKeyword('red shoes');
    const db = getTestDb() as never;
    const job = await insertRankCheckJob(db, { accountId, siteId, scope: 'site',
      idempotencyKey: 'request-1', retryOfJobId: null,
      targets: [{ keywordId: keyword.id, engine: 'google', trackLocalPack: false }], now });
    expect(job.totals).toMatchObject({ total: 1, queued: 1 });
    expect(job.totals).not.toHaveProperty('reservedUnits');
    expect(job.items[0]).not.toHaveProperty('units');
    expect((await findActiveRankJob(db, { accountId, siteId }))?.id).toBe(job.id);
    expect((await readRankJob(db, { accountId: 'foreign', siteId, jobId: job.id }))).toBeNull();
  });

  it('expires attempted work as failed and untouched work as not attempted', async () => {
    const first = await seedKeyword('first');
    const second = await seedKeyword('second');
    const db = getTestDb() as never;
    const job = await insertRankCheckJob(db, { accountId, siteId, scope: 'site',
      idempotencyKey: null, retryOfJobId: null, targets: [
        { keywordId: first.id, engine: 'google', trackLocalPack: false },
        { keywordId: second.id, engine: 'google', trackLocalPack: false },
      ], now });
    await recordRankJobItemAttempts(db, { jobId: job.id, keywordIds: [first.id], attempts: 1, now });
    const warn = vi.fn();
    expect(await expireOverdueRankJobs(db, { now: new Date(now.getTime() + 2_000_000), logger: { warn } }))
      .toEqual({ jobs: 1, items: 2 });
    const settled = await readRankJob(db, { accountId, siteId, jobId: job.id });
    expect(settled?.items.map((item) => [item.keywordId, item.reason]).sort())
      .toEqual([[first.id, 'deadline'], [second.id, 'not_attempted']].sort());
    const rows = await getTestDb().select().from(keywords);
    expect(rows.find((row) => row.id === first.id)?.lastFailedReason).toBe('vendor_timeout');
    expect(rows.find((row) => row.id === second.id)?.lastFailedCheckAt).toBeNull();
    expect(await settleOpenRankJobItems(db, { accountId, jobId: job.id, state: 'expired',
      reason: 'deadline', now: new Date(now.getTime() + 2_000_001), attempted: true })).toEqual([]);
  });
});
