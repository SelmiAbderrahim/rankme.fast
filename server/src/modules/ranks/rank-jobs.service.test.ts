import type { Queue } from 'bullmq';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { domainStates, keywords, rankings } from '../../db/schema/keywords.js';
import { env } from '../../config/env.js';
import { rankCheckJobs } from '../../db/schema/rank-check-jobs.js';
import { clearCollections, startMemoryMongo, stopMemoryMongo } from '../../shared/testing/mongo.js';
import { getTestDb, startTestPostgres, stopTestPostgres, truncateAllTables } from '../../shared/testing/postgres.js';
import { Site } from '../sites/index.js';
import { checkKeywordNow, checkSiteNow, enqueueRankCheckJob, getActiveRankCheckJob,
  getRankCheckJob, retryFailedRankCheckJob } from './rank-jobs.service.js';
import { claimRankJobItem, insertRankCheckJob, readRankJob, settleRankJobItem,
  finalizeRankJob } from './rank-jobs.repo.js';
import { altEngineWeeklyStamp } from './rank.processor.js';

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

async function fixture() {
  const accountId = new mongoose.Types.ObjectId().toHexString();
  const site = await Site.create({ accountId: new mongoose.Types.ObjectId(accountId),
    url: 'https://rank-job.example', domain: 'rank-job.example' });
  const siteId = site.id as string;
  const [keyword] = await getTestDb().insert(keywords).values({ accountId, siteId,
    phrase: 'rank job phrase', locationCode: 2840, languageCode: 'en' }).returning();
  return { accountId, siteId, keywordId: keyword!.id };
}

function queue(add = vi.fn(async () => ({}))) {
  return { queue: { add } as unknown as Queue, add };
}

describe('manual rank jobs', () => {
  it('validates site ownership and returns a no-queue result without creating a job', async () => {
    const ids = await fixture();
    const deps = { db: getTestDb() as never, ranksQueue: null };
    await expect(checkSiteNow({ accountId: ids.accountId, siteId: 'invalid',
      idempotencyKey: null }, deps)).rejects.toMatchObject({ status: 404 });
    expect(await checkSiteNow({ accountId: ids.accountId, siteId: ids.siteId,
      idempotencyKey: null }, deps)).toMatchObject({ queued: false, job: null });
    expect(await getActiveRankCheckJob(ids, deps.db)).toBeNull();
    await expect(checkSiteNow({ accountId: ids.accountId, siteId: ids.siteId,
      idempotencyKey: null }, deps)).rejects.toMatchObject({ status: 429 });
    await expect(checkKeywordNow({ accountId: ids.accountId, keywordId: 'not-a-uuid',
      idempotencyKey: null }, deps)).rejects.toMatchObject({ status: 404 });
    await expect(checkKeywordNow({ accountId: ids.accountId,
      keywordId: '00000000-0000-4000-8000-000000000001',
      idempotencyKey: null }, deps)).rejects.toMatchObject({ status: 404 });
  });

  it('replays the idempotency key and active site or keyword job', async () => {
    const ids = await fixture();
    const { queue: ranksQueue, add } = queue();
    const deps = { db: getTestDb() as never, ranksQueue };
    const first = await checkSiteNow({ ...ids, idempotencyKey: 'request-1' }, deps);
    expect(first).toMatchObject({ queued: true, reused: false });
    expect(add).toHaveBeenCalledTimes(1);
    expect(await checkSiteNow({ ...ids, idempotencyKey: 'request-1' }, deps))
      .toMatchObject({ reused: true, job: { id: first.job!.id } });
    expect(await checkSiteNow({ ...ids, idempotencyKey: null }, deps))
      .toMatchObject({ reused: true, job: { id: first.job!.id } });
    expect(await checkKeywordNow({ accountId: ids.accountId, keywordId: ids.keywordId,
      idempotencyKey: null }, deps)).toMatchObject({ reused: true, job: { id: first.job!.id } });
    expect(add).toHaveBeenCalledTimes(1);
    expect((await getActiveRankCheckJob(ids, deps.db))?.id).toBe(first.job!.id);
    expect((await getRankCheckJob({ ...ids, jobId: first.job!.id }, deps.db)).id).toBe(first.job!.id);
    await expect(getRankCheckJob({ ...ids, jobId: 'bad-id' }, deps.db))
      .rejects.toMatchObject({ status: 404 });
  });

  it('cancels items and restores cooldown when queueing fails', async () => {
    const ids = await fixture();
    const { queue: ranksQueue } = queue(vi.fn(async () => { throw new Error('queue offline'); }));
    const db = getTestDb() as never;
    await expect(checkKeywordNow({ accountId: ids.accountId, keywordId: ids.keywordId,
      idempotencyKey: null }, { db, ranksQueue })).rejects.toMatchObject({ status: 503 });
    const [state] = await getTestDb().select().from(domainStates);
    expect(state?.lastRankCheckAt).toBeNull();
    const [job] = await getTestDb().select({ id: rankCheckJobs.id }).from(rankCheckJobs);
    expect((await readRankJob(db, { ...ids, jobId: job!.id }))
      ?.items[0]?.state).toBe('cancelled');
  });

  it('retries only failed items after a finished job', async () => {
    const ids = await fixture();
    const { queue: ranksQueue, add } = queue();
    const deps = { db: getTestDb() as never, ranksQueue };
    const original = await checkSiteNow({ ...ids, idempotencyKey: null }, deps);
    await expect(retryFailedRankCheckJob({ ...ids, jobId: original.job!.id }, deps))
      .rejects.toMatchObject({ status: 409 });
    await settleRankJobItem(deps.db, { accountId: ids.accountId, jobId: original.job!.id,
      keywordId: ids.keywordId, state: 'failed', reason: 'vendor_timeout', now: new Date() });
    await finalizeRankJob(deps.db, original.job!.id, new Date());
    const retry = await retryFailedRankCheckJob({ ...ids, jobId: original.job!.id }, deps);
    expect(retry).toMatchObject({ queued: true, reused: false,
      job: { scope: 'retry', retryOfJobId: original.job!.id } });
    expect(add).toHaveBeenCalledTimes(2);
    expect(await retryFailedRankCheckJob({ ...ids, jobId: original.job!.id }, deps))
      .toMatchObject({ reused: true, job: { id: retry.job!.id } });
  });

  it('queues one keyword with its id in the job payload', async () => {
    const ids = await fixture();
    const { queue: ranksQueue, add } = queue();
    const db = getTestDb() as never;
    const result = await checkKeywordNow({ accountId: ids.accountId, keywordId: ids.keywordId,
      idempotencyKey: null }, { db, ranksQueue });
    expect(result.job).toMatchObject({ scope: 'keyword', totals: { total: 1 } });
    expect((add.mock.calls[0] as unknown[])[1]).toMatchObject({ keywordIds: [ids.keywordId] });
  });

  it('finds no job when a site has no active keywords and refuses paused sites', async () => {
    const ids = await fixture();
    const db = getTestDb() as never;
    const { queue: ranksQueue, add } = queue();
    await getTestDb().update(keywords).set({ active: false });
    expect(await checkSiteNow({ ...ids, idempotencyKey: null }, { db, ranksQueue }))
      .toMatchObject({ queued: false, job: null });
    expect(add).not.toHaveBeenCalled();
    await Site.updateOne({ _id: ids.siteId }, { $set: { paused: true } });
    await expect(checkSiteNow({ ...ids, idempotencyKey: null }, { db, ranksQueue }))
      .rejects.toMatchObject({ status: 409 });
  });

  it('skips an alternate-engine keyword already checked this week', async () => {
    const ids = await fixture();
    const db = getTestDb() as never;
    await getTestDb().update(keywords).set({ active: false });
    const [alt] = await getTestDb().insert(keywords).values({ accountId: ids.accountId,
      siteId: ids.siteId, phrase: 'video phrase', locationCode: 2840,
      languageCode: 'en', engine: 'bing' }).returning();
    const oldFlag = env.ALT_ENGINE_TRACKING_ENABLED;
    (env as { ALT_ENGINE_TRACKING_ENABLED: boolean }).ALT_ENGINE_TRACKING_ENABLED = true;
    try {
      await getTestDb().insert(rankings).values({ keywordId: alt!.id, position: 4,
        source: 'fresh', checkedAt: altEngineWeeklyStamp(new Date()) });
      const { queue: ranksQueue, add } = queue();
      expect(await enqueueRankCheckJob({ ...ids, scope: 'site', idempotencyKey: null,
        retryOfJobId: null, keywordIds: null }, { db, ranksQueue }))
        .toMatchObject({ queued: false, job: null });
      expect(add).not.toHaveBeenCalled();
    } finally {
      (env as { ALT_ENGINE_TRACKING_ENABLED: boolean }).ALT_ENGINE_TRACKING_ENABLED = oldFlag;
    }
  });

  it('reuses the winner when a concurrent insert wins the idempotency race', async () => {
    const ids = await fixture();
    const realDb = getTestDb();
    const { queue: ranksQueue, add } = queue();
    const racedDb = new Proxy(realDb, { get(target, property, receiver) {
      if (property === 'transaction') return async () => {
        await insertRankCheckJob(realDb as never, { ...ids, scope: 'site',
          idempotencyKey: 'same-request', retryOfJobId: null, now: new Date(),
          targets: [{ keywordId: ids.keywordId, engine: 'google', trackLocalPack: false }] });
        throw { code: '23505' };
      };
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    } }) as never;
    const result = await enqueueRankCheckJob({ ...ids, scope: 'site',
      idempotencyKey: 'same-request', retryOfJobId: null, keywordIds: null },
    { db: racedDb, ranksQueue });
    expect(result).toMatchObject({ queued: true, reused: true, job: { scope: 'site' } });
    expect(add).not.toHaveBeenCalled();
  });

  it('refuses to retry a completed job without failed items', async () => {
    const ids = await fixture();
    const { queue: ranksQueue } = queue();
    const deps = { db: getTestDb() as never, ranksQueue };
    const original = await checkSiteNow({ ...ids, idempotencyKey: null }, deps);
    await settleRankJobItem(deps.db, { accountId: ids.accountId, jobId: original.job!.id,
      keywordId: ids.keywordId, state: 'succeeded', reason: null, now: new Date() });
    await finalizeRankJob(deps.db, original.job!.id, new Date());
    await expect(retryFailedRankCheckJob({ ...ids, jobId: original.job!.id }, deps))
      .rejects.toMatchObject({ status: 409 });
  });

  it('reuses a running keyword item in an active job', async () => {
    const ids = await fixture();
    const { queue: ranksQueue } = queue();
    const db = getTestDb() as never;
    const first = await checkKeywordNow({ accountId: ids.accountId,
      keywordId: ids.keywordId, idempotencyKey: null }, { db, ranksQueue });
    await claimRankJobItem(db, { jobId: first.job!.id, keywordId: ids.keywordId, now: new Date() });
    expect(await checkKeywordNow({ accountId: ids.accountId,
      keywordId: ids.keywordId, idempotencyKey: null }, { db, ranksQueue }))
      .toMatchObject({ reused: true, job: { id: first.job!.id } });
  });

  it('propagates insert failures when there is no idempotency winner', async () => {
    const ids = await fixture();
    const realDb = getTestDb();
    const { queue: ranksQueue } = queue();
    const error = new Error('storage failed');
    const failingDb = (failure: unknown) => new Proxy(realDb, { get(target, property, receiver) {
      if (property === 'transaction') return async () => { throw failure; };
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    } }) as never;
    const input = { ...ids, scope: 'site' as const, idempotencyKey: null,
      retryOfJobId: null, keywordIds: null };
    await expect(enqueueRankCheckJob(input, { db: failingDb(error), ranksQueue }))
      .rejects.toBe(error);
    await expect(enqueueRankCheckJob({ ...input, idempotencyKey: 'orphan' },
      { db: failingDb({ code: '23505' }), ranksQueue })).rejects.toMatchObject({ code: '23505' });
  });
});
