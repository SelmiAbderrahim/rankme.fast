import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../config/env.js';
import {
  appKeywords,
  appRankSnapshots,
  type AppSeoStore,
} from '../../db/schema/index.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import { loadOwnedSite } from '../sites/sites.guard.js';
import { appKeywordIsoWeek, appKeywordWeekStart } from './weekly-checks.js';

const mocked = vi.hoisted(() => ({
  enqueue: vi.fn(),
  getQueue: vi.fn(),
  loadSite: vi.fn(),
  profileFind: vi.fn(),
}));

vi.mock('./app-profile.model.js', () => ({ AppProfile: { findOne: mocked.profileFind } }));
vi.mock('../sites/sites.guard.js', () => ({ loadOwnedSite: mocked.loadSite }));
vi.mock('../../shared/queue/index.js', () => ({
  appSeoTrackingJobId: (keywordId: string, stamp: string) => `job-${keywordId}-${stamp}`,
  enqueueAppSeoTrackingJob: mocked.enqueue,
}));
vi.mock('./keywords.queue-holder.js', () => ({ getAppSeoTrackingQueue: mocked.getQueue }));

import {
  appKeywordServiceTestables as internals,
  deleteAppKeyword,
  getAppKeywordHistory,
  listAppKeywords,
  mintAppKeyword,
  previewAppKeywordCheck,
  previewMintAppKeyword,
  recheckAppKeyword,
} from './keywords.service.js';

const accountId = 'keyword-service-account';
const siteId = '507f1f77bcf86cd799439011';
const profileId = '507f1f77bcf86cd799439012';
const AT = new Date('2026-08-10T12:00:00.000Z');
const EARLIER = new Date('2026-08-03T12:00:00.000Z');
const OBSERVATION = {
  sourceKind: 'estimate', sourceLabel: null, observedAt: AT.toISOString(),
  freshUntil: null, freshness: 'unknown', market: null, sampleCount: 1, coverageNoteKey: null,
} as const;
const COMMUNITY_PREVIEW = { deploymentMode: 'community', capacityEnforced: false };

interface FakeJob {
  state: string;
  finishedOn?: number;
  getState: ReturnType<typeof vi.fn>;
  retry: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}

function fakeJob(state: string, finishedOn?: number): FakeJob {
  return {
    state,
    ...(finishedOn === undefined ? {} : { finishedOn }),
    getState: vi.fn().mockResolvedValue(state),
    retry: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  };
}

function fakeQueue(jobs: Record<string, FakeJob> = {}) {
  return { getJob: vi.fn(async (id: string) => jobs[id]) };
}

function database(): ApplicationDb {
  return getTestDb();
}

function currentStamp(): string {
  return appKeywordIsoWeek(new Date());
}

function profileQuery(input: {
  playPackageId?: string | null;
  appStoreId?: string | null;
} = {}) {
  return {
    _id: profileId,
    playPackageId: input.playPackageId === undefined ? 'com.example.app' : input.playPackageId,
    appStoreId: input.appStoreId === undefined ? '123456789' : input.appStoreId,
  };
}

async function insertKeyword(input: {
  phrase: string;
  active?: boolean;
  createdAt?: Date;
}) {
  const [row] = await getTestDb().insert(appKeywords).values({
    accountId,
    siteId,
    profileId,
    store: 'google_play',
    phrase: input.phrase,
    locationCode: 2840,
    languageCode: 'en',
    active: input.active ?? true,
    createdAt: input.createdAt ?? AT,
  }).returning();
  if (!row) throw new Error('keyword fixture failed');
  return row;
}

async function insertSnapshot(
  keywordId: string,
  checkedAt: Date,
  position: number | null,
): Promise<void> {
  await getTestDb().insert(appRankSnapshots).values({
    accountId,
    siteId,
    keywordId,
    position,
    rankAbsolute: position === null ? null : position + 1,
    foundAppId: position === null ? null : 'com.example.app',
    checkedAt,
    observationMeta: OBSERVATION,
  });
}

function mintInput(store: AppSeoStore = 'google_play', phrase = 'SEO Audit') {
  return {
    accountId,
    siteId,
    profileId,
    keyword: { store, phrase, locationCode: 2840, languageCode: 'EN' },
  };
}

const originalFlags = {
  appSeo: env.APP_SEO_ENABLED,
  tracking: env.APP_KEYWORD_TRACKING_ENABLED,
};

beforeAll(startTestPostgres);
afterAll(stopTestPostgres);

beforeEach(async () => {
  await truncateAllTables();
  env.APP_SEO_ENABLED = true;
  env.APP_KEYWORD_TRACKING_ENABLED = true;
  mocked.profileFind.mockReset().mockResolvedValue(profileQuery());
  mocked.loadSite.mockReset().mockResolvedValue({ id: siteId });
  mocked.enqueue.mockReset().mockResolvedValue(undefined);
  mocked.getQueue.mockReset().mockReturnValue(fakeQueue());
});

afterEach(() => {
  env.APP_SEO_ENABLED = originalFlags.appSeo;
  env.APP_KEYWORD_TRACKING_ENABLED = originalFlags.tracking;
});

describe('app keyword guards', () => {
  it('enforces both rollout flags and classifies direct and nested unique violations', () => {
    expect(internals.isUniqueViolation({ code: '23505' })).toBe(false);
    expect(internals.isUniqueViolation(Object.assign(new Error('duplicate'), { code: '23505' }))).toBe(true);
    expect(internals.isUniqueViolation(Object.assign(new Error('duplicate'), { cause: { code: '23505' } }))).toBe(true);
    expect(internals.isUniqueViolation(new Error('other'))).toBe(false);
    env.APP_SEO_ENABLED = false;
    expect(() => internals.requireTrackingEnabled()).toThrow();
    env.APP_SEO_ENABLED = true;
    env.APP_KEYWORD_TRACKING_ENABLED = false;
    expect(() => internals.requireTrackingEnabled()).toThrow();
    env.APP_KEYWORD_TRACKING_ENABLED = true;
    expect(() => internals.requireTrackingEnabled()).not.toThrow();
  });

  it('fails closed for invalid, missing, and foreign keyword/profile ownership', async () => {
    await expect(internals.requireOwnedProfile(accountId, siteId, 'invalid'))
      .rejects.toMatchObject({ status: 404 });
    mocked.profileFind.mockResolvedValueOnce(null);
    await expect(internals.requireOwnedProfile(accountId, siteId, profileId))
      .rejects.toMatchObject({ status: 404 });
    await expect(internals.requireOwnedKeyword(database(), accountId, siteId, randomUUID()))
      .rejects.toMatchObject({ status: 404 });
    const keyword = await insertKeyword({ phrase: 'owned keyword' });
    await expect(internals.requireOwnedKeyword(database(), accountId, siteId, keyword.id, false))
      .resolves.toMatchObject({ keyword: { id: keyword.id } });
    expect(loadOwnedSite).toHaveBeenLastCalledWith(accountId, siteId, { allowPaused: true });
  });
});

describe('app keyword mint and previews', () => {
  it('returns the community check preview for both stores and rejects missing store ids', async () => {
    expect(previewAppKeywordCheck()).toEqual(COMMUNITY_PREVIEW);
    await expect(previewMintAppKeyword({ accountId, siteId, profileId, store: 'google_play' }))
      .resolves.toEqual({ check: COMMUNITY_PREVIEW });
    await expect(previewMintAppKeyword({ accountId, siteId, profileId, store: 'app_store' }))
      .resolves.toEqual({ check: COMMUNITY_PREVIEW });
    mocked.profileFind.mockResolvedValueOnce(profileQuery({ playPackageId: null }));
    await expect(previewMintAppKeyword({ accountId, siteId, profileId, store: 'google_play' }))
      .rejects.toMatchObject({ status: 404 });
    mocked.profileFind.mockResolvedValueOnce(profileQuery({ appStoreId: null }));
    await expect(previewMintAppKeyword({ accountId, siteId, profileId, store: 'app_store' }))
      .rejects.toMatchObject({ status: 404 });
    env.APP_KEYWORD_TRACKING_ENABLED = false;
    await expect(previewMintAppKeyword({ accountId, siteId, profileId, store: 'google_play' }))
      .rejects.toMatchObject({ status: 503 });
  });

  it('mints normalized keywords without a slot cap and maps duplicate conflicts', async () => {
    const first = await mintAppKeyword(mintInput(), database());
    expect(first).toMatchObject({
      profileId, store: 'google_play', phrase: 'SEO Audit', languageCode: 'en', active: true,
      latestPosition: null, previousPosition: null, delta: null,
      lastCheckedAt: null, lastFailedCheckAt: null, checkStatus: 'idle',
    });
    await expect(mintAppKeyword(mintInput(), database())).rejects.toMatchObject({ status: 409 });
    for (let index = 0; index < 5; index += 1) {
      await expect(mintAppKeyword(mintInput('app_store', `Apple SEO ${index}`), database()))
        .resolves.toMatchObject({ store: 'app_store' });
    }
    mocked.profileFind.mockResolvedValueOnce(profileQuery({ appStoreId: null }));
    await expect(mintAppKeyword(mintInput('app_store', 'Missing App'), database()))
      .rejects.toMatchObject({ status: 404 });

    const broken = {
      insert: () => ({ values: () => ({ returning: () => Promise.reject(new Error('database failed')) }) }),
    } as unknown as ApplicationDb;
    await expect(mintAppKeyword(mintInput('google_play', 'Other'), broken))
      .rejects.toThrow('database failed');
  });
});

describe('app keyword listing and history', () => {
  it('returns an empty list and reflects disabled read-only rollout state', async () => {
    env.APP_SEO_ENABLED = false;
    const result = await listAppKeywords({ accountId, siteId, profileId }, database());
    expect(result).toEqual({ items: [], trackingEnabled: false });
  });

  it('keeps two newest snapshots, computes safe deltas, and derives check status from the queue', async () => {
    const deltaKeyword = await insertKeyword({ phrase: 'delta', createdAt: new Date('2026-08-01T00:00:00Z') });
    const oneKeyword = await insertKeyword({ phrase: 'one', createdAt: new Date('2026-08-02T00:00:00Z') });
    const latestNull = await insertKeyword({ phrase: 'latest null', createdAt: new Date('2026-08-03T00:00:00Z') });
    const previousNull = await insertKeyword({ phrase: 'previous null', createdAt: new Date('2026-08-04T00:00:00Z') });
    const noSnapshot = await insertKeyword({ phrase: 'no snapshot', createdAt: new Date('2026-08-05T00:00:00Z') });
    await insertKeyword({ phrase: 'inactive', active: false });

    await insertSnapshot(deltaKeyword.id, AT, 3);
    await insertSnapshot(deltaKeyword.id, EARLIER, 7);
    await insertSnapshot(deltaKeyword.id, new Date('2026-07-01T00:00:00Z'), 20);
    await insertSnapshot(oneKeyword.id, AT, 5);
    await insertSnapshot(latestNull.id, AT, null);
    await insertSnapshot(latestNull.id, EARLIER, 8);
    await insertSnapshot(previousNull.id, AT, 2);
    await insertSnapshot(previousNull.id, EARLIER, null);

    const stamp = currentStamp();
    const failedAt = Date.parse('2026-08-11T08:00:00.000Z');
    const queue = fakeQueue({
      [`job-${deltaKeyword.id}-${stamp}`]: fakeJob('failed', failedAt),
      [`job-${oneKeyword.id}-${stamp}`]: fakeJob('completed'),
      [`job-${latestNull.id}-${stamp}`]: fakeJob('failed'),
      [`job-${noSnapshot.id}-${stamp}`]: fakeJob('waiting'),
    });
    mocked.getQueue.mockReturnValue(queue);

    const result = await listAppKeywords({ accountId, siteId, profileId }, database());
    expect(result.items).toHaveLength(5);
    expect(result.items.find((item) => item.id === deltaKeyword.id)).toMatchObject({
      latestPosition: 3, previousPosition: 7, delta: 4,
      lastCheckedAt: AT.toISOString(),
      lastFailedCheckAt: new Date(failedAt).toISOString(),
      checkStatus: 'failed',
    });
    expect(result.items.find((item) => item.id === oneKeyword.id)).toMatchObject({
      previousPosition: null, delta: null, lastFailedCheckAt: null, checkStatus: 'succeeded',
    });
    expect(result.items.find((item) => item.id === latestNull.id)).toMatchObject({
      latestPosition: null, delta: null, lastFailedCheckAt: null, checkStatus: 'failed',
    });
    expect(result.items.find((item) => item.id === previousNull.id)).toMatchObject({
      previousPosition: null, delta: null, checkStatus: 'succeeded',
    });
    expect(result.items.find((item) => item.id === noSnapshot.id)).toMatchObject({
      latestPosition: null, previousPosition: null, delta: null, lastCheckedAt: null, checkStatus: 'queued',
    });
    expect(result).toMatchObject({ trackingEnabled: true });

    mocked.getQueue.mockReturnValue(null);
    const withoutQueue = await listAppKeywords({ accountId, siteId, profileId }, database());
    expect(withoutQueue.items.find((item) => item.id === deltaKeyword.id)).toMatchObject({
      checkStatus: 'succeeded', lastFailedCheckAt: null,
    });
    expect(withoutQueue.items.find((item) => item.id === noSnapshot.id)).toMatchObject({ checkStatus: 'idle' });

    const history = await getAppKeywordHistory({
      accountId, siteId, keywordId: deltaKeyword.id, limit: 2,
    }, database());
    expect(history.map((point) => point.checkedAt)).toEqual([EARLIER.toISOString(), AT.toISOString()]);
  });
});

describe('app keyword deletion and manual recheck', () => {
  it('deletes only the owned keyword and cascades its history', async () => {
    const keyword = await insertKeyword({ phrase: 'delete me' });
    await insertSnapshot(keyword.id, AT, 1);
    await deleteAppKeyword({ accountId, siteId, keywordId: keyword.id }, database());
    expect(await getTestDb().select().from(appKeywords)).toEqual([]);
    expect(await getTestDb().select().from(appRankSnapshots)).toEqual([]);
  });

  it('previews without queueing, fails without a queue, and short-circuits a stored weekly check', async () => {
    const keyword = await insertKeyword({ phrase: 'recheck' });
    await expect(recheckAppKeyword({
      accountId, siteId, keywordId: keyword.id, confirm: false,
    }, database())).resolves.toEqual({
      preview: COMMUNITY_PREVIEW, queued: false, reservationStamp: null,
    });
    expect(loadOwnedSite).toHaveBeenLastCalledWith(accountId, siteId, { allowPaused: true });
    expect(mocked.getQueue).not.toHaveBeenCalled();

    mocked.getQueue.mockReturnValueOnce(null);
    await expect(recheckAppKeyword({
      accountId, siteId, keywordId: keyword.id, confirm: true,
    }, database())).rejects.toMatchObject({ status: 503 });

    const stamp = currentStamp();
    await insertSnapshot(keyword.id, appKeywordWeekStart(stamp), 4);
    await expect(recheckAppKeyword({
      accountId, siteId, keywordId: keyword.id, confirm: true,
    }, database())).resolves.toEqual({
      preview: COMMUNITY_PREVIEW, queued: false, reservationStamp: stamp,
    });
    expect(mocked.enqueue).not.toHaveBeenCalled();
  });

  it('queues a manual weekly check and retries a failed weekly job in place', async () => {
    const keyword = await insertKeyword({ phrase: 'enqueue' });
    const queue = fakeQueue();
    mocked.getQueue.mockReturnValue(queue);
    const stamp = currentStamp();
    await expect(recheckAppKeyword({
      accountId, siteId, keywordId: keyword.id, confirm: true,
    }, database())).resolves.toEqual({ preview: COMMUNITY_PREVIEW, queued: true, reservationStamp: stamp });
    expect(loadOwnedSite).toHaveBeenCalledWith(accountId, siteId, { allowPaused: false });
    expect(queue.getJob).toHaveBeenCalledWith(`job-${keyword.id}-${stamp}`);
    expect(mocked.enqueue).toHaveBeenCalledWith(queue, {
      accountId, siteId, profileId, keywordId: keyword.id, reservationStamp: stamp, manual: true,
    });

    const failed = fakeJob('failed');
    mocked.getQueue.mockReturnValue(fakeQueue({ [`job-${keyword.id}-${stamp}`]: failed }));
    mocked.enqueue.mockClear();
    await expect(recheckAppKeyword({
      accountId, siteId, keywordId: keyword.id, confirm: true,
    }, database())).resolves.toMatchObject({ queued: true });
    expect(failed.retry).toHaveBeenCalledWith('failed');
    expect(mocked.enqueue).not.toHaveBeenCalled();

    mocked.getQueue.mockReturnValue(fakeQueue());
    mocked.enqueue.mockRejectedValueOnce(new Error('queue unavailable'));
    await expect(recheckAppKeyword({
      accountId, siteId, keywordId: keyword.id, confirm: true,
    }, database())).rejects.toThrow('queue unavailable');
  });

  it('refuses rechecks while tracking is disabled', async () => {
    env.APP_KEYWORD_TRACKING_ENABLED = false;
    await expect(recheckAppKeyword({
      accountId, siteId, keywordId: randomUUID(), confirm: true,
    }, database())).rejects.toMatchObject({ status: 503 });
    await expect(deleteAppKeyword({ accountId, siteId, keywordId: randomUUID() }, database()))
      .rejects.toMatchObject({ status: 503 });
  });
});

describe('app keyword queue status helper', () => {
  it('returns an empty map without a queue and omits keywords with no pending job', async () => {
    mocked.getQueue.mockReturnValueOnce(null);
    await expect(internals.currentWeekJobStatuses(['a'])).resolves.toEqual(new Map());
    const stamp = currentStamp();
    mocked.getQueue.mockReturnValueOnce(fakeQueue({ [`job-b-${stamp}`]: fakeJob('active') }));
    await expect(internals.currentWeekJobStatuses(['a', 'b'])).resolves.toEqual(
      new Map([['b', { status: 'queued' }]]),
    );
  });
});
