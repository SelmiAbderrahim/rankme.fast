import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { keywords } from '../../db/schema/index.js';
import { getTestDb, startTestPostgres, stopTestPostgres, truncateAllTables } from '../../shared/testing/postgres.js';
import {
  claimRankJobItem, deriveRankJobStatus, expireOverdueRankJobs, finalizeRankJob,
  findActiveRankJob, findRankJobByIdempotencyKey, insertRankCheckJob, loadOpenRankJobItems,
  rankJobDeadlineMs, readRankJob, recordRankJobItemAttempts, settleOpenRankJobItems,
  settleRankJobItem, startRankJob, touchRankJob,
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

  it('tracks each item from queue through claim and terminal settlement', async () => {
    const keyword = await seedKeyword('gamma');
    const db = getTestDb() as never;
    const job = await insertRankCheckJob(db, { accountId, siteId, scope: 'keyword',
      idempotencyKey: 'gamma-1', retryOfJobId: null,
      targets: [{ keywordId: keyword.id, engine: 'google', trackLocalPack: false }], now });
    expect((await findRankJobByIdempotencyKey(db, { accountId, siteId,
      idempotencyKey: 'gamma-1' }))?.id).toBe(job.id);
    expect(await findRankJobByIdempotencyKey(db, { accountId, siteId,
      idempotencyKey: 'missing' })).toBeNull();
    expect((await loadOpenRankJobItems(db, job.id)).has(keyword.id)).toBe(true);
    expect(await startRankJob(db, job.id, now)).toEqual(job.deadlineAt && new Date(job.deadlineAt));
    await touchRankJob(db, job.id, now);
    await recordRankJobItemAttempts(db, { jobId: job.id, keywordIds: [], attempts: 2, now });
    await recordRankJobItemAttempts(db, { jobId: job.id, keywordIds: [keyword.id], attempts: 11, now });
    expect(await claimRankJobItem(db, { jobId: job.id, keywordId: keyword.id, now })).toBe(true);
    expect(await finalizeRankJob(db, job.id, now)).toBe('running');
    expect(await settleRankJobItem(db, { accountId: 'foreign', jobId: job.id,
      keywordId: keyword.id, state: 'succeeded', reason: null, now })).toBe(false);
    expect(await settleRankJobItem(db, { accountId, jobId: job.id,
      keywordId: keyword.id, state: 'succeeded', reason: null, attempts: 12, now })).toBe(true);
    expect(await settleRankJobItem(db, { accountId, jobId: job.id,
      keywordId: keyword.id, state: 'succeeded', reason: null, now })).toBe(false);
    expect((await loadOpenRankJobItems(db, job.id)).size).toBe(0);
    expect(await finalizeRankJob(db, job.id, now)).toBe('succeeded');
    expect((await readRankJob(db, { accountId, siteId, jobId: job.id }))?.items[0])
      .toMatchObject({ state: 'succeeded', attempts: 10, finishedAt: now.toISOString() });
    expect(await startRankJob(db, job.id, now)).toBeNull();
  });

  it('derives queued, cancelled, failed, and partial statuses from item histories', () => {
    const item = (state: 'queued' | 'running' | 'succeeded' | 'failed' | 'expired' | 'cancelled',
      attempts = 0, finishedAt: Date | null = null) => ({ state, attempts, finishedAt }) as never;
    expect(deriveRankJobStatus([])).toBe('cancelled');
    expect(deriveRankJobStatus([item('queued')])).toBe('queued');
    expect(deriveRankJobStatus([item('queued', 1)])).toBe('running');
    expect(deriveRankJobStatus([item('running')])).toBe('running');
    expect(deriveRankJobStatus([item('queued', 0, now)])).toBe('running');
    expect(deriveRankJobStatus([item('cancelled')])).toBe('cancelled');
    expect(deriveRankJobStatus([item('succeeded')])).toBe('succeeded');
    expect(deriveRankJobStatus([item('failed')])).toBe('failed');
    expect(deriveRankJobStatus([item('expired'), item('succeeded')])).toBe('partial');
  });

  it('can create an empty job and settle only selected open items', async () => {
    const first = await seedKeyword('delta');
    const second = await seedKeyword('epsilon');
    const db = getTestDb() as never;
    const empty = await insertRankCheckJob(db, { accountId, siteId, scope: 'site',
      idempotencyKey: null, retryOfJobId: null, targets: [], now });
    expect(empty.totals.total).toBe(0);
    expect(await finalizeRankJob(db, empty.id, now)).toBe('cancelled');
    const job = await insertRankCheckJob(db, { accountId, siteId, scope: 'site',
      idempotencyKey: null, retryOfJobId: null, targets: [
        { keywordId: first.id, engine: 'google', trackLocalPack: false },
        { keywordId: second.id, engine: 'bing', trackLocalPack: false },
      ], now });
    expect(await settleOpenRankJobItems(db, { accountId, jobId: job.id, state: 'cancelled',
      reason: 'enqueue_failed', now, keywordIds: [] })).toEqual([]);
    expect(await settleOpenRankJobItems(db, { accountId, jobId: job.id, state: 'cancelled',
      reason: 'enqueue_failed', now, keywordIds: [first.id] })).toEqual([first.id]);
    expect(await settleOpenRankJobItems(db, { accountId, jobId: job.id, state: 'cancelled',
      reason: 'enqueue_failed', now })).toEqual([second.id]);
    expect(await finalizeRankJob(db, job.id, now)).toBe('cancelled');
  });

  it('expires untouched work without marking its keyword as failed', async () => {
    const keyword = await seedKeyword('zeta');
    const db = getTestDb() as never;
    const job = await insertRankCheckJob(db, { accountId, siteId, scope: 'site',
      idempotencyKey: null, retryOfJobId: null,
      targets: [{ keywordId: keyword.id, engine: 'google', trackLocalPack: false }], now });
    expect(await expireOverdueRankJobs(db, { now: new Date(now.getTime() + 2_000_000),
      logger: { warn: vi.fn() } })).toEqual({ jobs: 1, items: 1 });
    expect((await getTestDb().select().from(keywords))[0]?.lastFailedCheckAt).toBeNull();
    expect((await readRankJob(db, { accountId, siteId, jobId: job.id }))?.items[0]?.reason)
      .toBe('not_attempted');
  });

  it('rejects a database insert that returns no job row', async () => {
    const db = { transaction: async (run: (tx: unknown) => Promise<unknown>) => run({
      insert: () => ({ values: () => ({ returning: async () => [] }) }),
    }) } as never;
    await expect(insertRankCheckJob(db, { accountId, siteId, scope: 'site',
      idempotencyKey: null, retryOfJobId: null, targets: [], now }))
      .rejects.toThrow('rank job insert returned no row');
  });
});
