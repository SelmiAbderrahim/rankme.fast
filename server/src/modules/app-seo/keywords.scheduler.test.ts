import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { appKeywords } from '../../db/schema/index.js';
import {
  APP_SEO_TRACKING_JOB_NAME,
  enqueueAppSeoTrackingJob,
} from '../../shared/queue/index.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import { Site } from '../sites/index.js';

const mocked = vi.hoisted(() => ({
  enqueue: vi.fn(),
  siteFind: vi.fn(),
  siteLean: vi.fn(),
}));

vi.mock('../sites/index.js', () => ({ Site: { find: mocked.siteFind } }));
vi.mock(import('../../shared/queue/index.js'), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, enqueueAppSeoTrackingJob: mocked.enqueue };
});

import {
  APP_SEO_WEEKLY_CRON,
  APP_SEO_WEEKLY_SCHEDULER_KEY,
  APP_SEO_WEEKLY_SWEEP_JOB,
  appKeywordSchedulerTestables as internals,
  createAppKeywordWeeklySweep,
  createAppSeoTrackingDispatcher,
  upsertAppSeoTrackingSchedulers,
  type AppKeywordSweepDeps,
} from './keywords.scheduler.js';

const accountId = 'keyword-scheduler-account';
const activeSiteId = '507f1f77bcf86cd799439011';
const inactiveSiteId = '507f1f77bcf86cd799439012';
const profileId = '507f1f77bcf86cd799439013';
const NOW = new Date('2026-08-12T12:00:00.000Z');
const STAMP = '2026-W33';

function dependencies(input: {
  enabled?: boolean;
  now?: () => Date;
} = {}): AppKeywordSweepDeps {
  return {
    db: getTestDb(),
    queue: { add: vi.fn() },
    logger: { error: vi.fn() },
    enabled: () => input.enabled ?? true,
    ...(input.now === undefined ? { now: () => NOW } : { now: input.now }),
  };
}

async function insertKeyword(input: {
  siteId?: string;
  phrase?: string;
  active?: boolean;
} = {}) {
  const [row] = await getTestDb().insert(appKeywords).values({
    accountId,
    siteId: input.siteId ?? activeSiteId,
    profileId,
    store: 'google_play',
    phrase: input.phrase ?? `keyword-${randomUUID()}`,
    locationCode: 2840,
    languageCode: 'en',
    active: input.active ?? true,
    createdAt: NOW,
  }).returning();
  if (!row) throw new Error('keyword fixture failed');
  return row;
}

beforeAll(startTestPostgres);
afterAll(stopTestPostgres);

beforeEach(async () => {
  await truncateAllTables();
  mocked.siteLean.mockReset().mockResolvedValue([{ _id: activeSiteId }]);
  mocked.siteFind.mockReset().mockReturnValue({ lean: mocked.siteLean });
  mocked.enqueue.mockReset().mockResolvedValue(undefined);
});

describe('app keyword scheduler helpers', () => {
  it('resolves injected and real time and filters unique active site ids', async () => {
    expect(internals.schedulerNow(() => NOW)).toBe(NOW);
    const before = Date.now();
    expect(internals.schedulerNow().getTime()).toBeGreaterThanOrEqual(before);
    await expect(internals.activeSiteIds([activeSiteId, activeSiteId, inactiveSiteId]))
      .resolves.toEqual(new Set([activeSiteId]));
    expect(Site.find).toHaveBeenCalledWith({
      _id: { $in: [activeSiteId, inactiveSiteId] }, paused: false, deletionStartedAt: null,
    }, { _id: 1 });
  });
});

describe('app keyword weekly sweep', () => {
  it('does not query tracked keywords while disabled', async () => {
    await expect(createAppKeywordWeeklySweep(dependencies({ enabled: false }))())
      .resolves.toEqual({ enqueued: 0, skipped: 0 });
    expect(mocked.siteFind).not.toHaveBeenCalled();
  });

  it('enqueues active keywords with the week stamp and isolates queue and inactive-site outcomes', async () => {
    const keywords: Array<Awaited<ReturnType<typeof insertKeyword>>> = [];
    for (let index = 0; index < 4; index += 1) {
      keywords.push(await insertKeyword({
        siteId: index === 2 ? inactiveSiteId : activeSiteId,
        phrase: `tracked-${index}`,
      }));
    }
    await insertKeyword({ phrase: 'disabled-keyword', active: false });
    const queueFailure = new Error('redis unavailable');
    mocked.enqueue.mockImplementation(async (_queue, payload) => {
      if (payload.keywordId === keywords[3]?.id) throw queueFailure;
    });
    const deps = dependencies();
    await expect(createAppKeywordWeeklySweep(deps)()).resolves.toEqual({ enqueued: 2, skipped: 2 });
    expect(enqueueAppSeoTrackingJob).toHaveBeenCalledTimes(3);
    expect(enqueueAppSeoTrackingJob).toHaveBeenCalledWith(deps.queue, {
      accountId, siteId: activeSiteId, profileId, keywordId: keywords[0]!.id,
      reservationStamp: STAMP, manual: false,
    });
    expect(deps.logger.error).toHaveBeenCalledOnce();
    expect(deps.logger.error).toHaveBeenCalledWith(
      { err: queueFailure, keywordId: keywords[3]!.id, siteId: activeSiteId },
      'app seo weekly keyword enqueue failed',
    );
  });
});

describe('app keyword dispatch and scheduler registration', () => {
  it('dispatches every known job and rejects foreign work', async () => {
    const weeklySweep = vi.fn().mockResolvedValue('weekly');
    const processKeyword = vi.fn().mockResolvedValue('keyword');
    const dispatch = createAppSeoTrackingDispatcher({ processKeyword, weeklySweep });
    await expect(dispatch({ name: APP_SEO_WEEKLY_SWEEP_JOB, data: {} })).resolves.toBe('weekly');
    await expect(dispatch({ name: APP_SEO_TRACKING_JOB_NAME, data: {} })).resolves.toBe('keyword');
    expect(() => dispatch({ name: 'app-seo-reconciliation', data: {} }))
      .toThrow('unknown app seo tracking job');
  });

  it('registers only the weekly UTC scheduler', async () => {
    const upsertJobScheduler = vi.fn().mockResolvedValue(undefined);
    await upsertAppSeoTrackingSchedulers({ upsertJobScheduler });
    expect(upsertJobScheduler).toHaveBeenCalledOnce();
    expect(upsertJobScheduler).toHaveBeenCalledWith(
      APP_SEO_WEEKLY_SCHEDULER_KEY,
      { pattern: APP_SEO_WEEKLY_CRON, tz: 'UTC' },
      { name: APP_SEO_WEEKLY_SWEEP_JOB, data: {} },
    );
  });
});
