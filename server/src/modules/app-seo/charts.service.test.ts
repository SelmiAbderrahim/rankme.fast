import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../config/env.js';
import { appChartSnapshots } from '../../db/schema/index.js';
import { appSeoChartJobId, enqueueAppSeoChartJob } from '../../shared/queue/index.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import { loadOwnedSite } from '../sites/sites.guard.js';
import { appKeywordIsoWeek, appKeywordWeekStart } from './weekly-checks.js';

const mocked = vi.hoisted(() => ({
  profileFind: vi.fn(),
  subscriptionCreate: vi.fn(),
  subscriptionDelete: vi.fn(),
  subscriptionExists: vi.fn(),
  subscriptionFind: vi.fn(),
  subscriptionFindOne: vi.fn(),
  subscriptionLean: vi.fn(),
  subscriptionSort: vi.fn(),
  enqueue: vi.fn(),
  getJob: vi.fn(),
  getQueue: vi.fn(),
  loadSite: vi.fn(),
}));

vi.mock('./app-profile.model.js', () => ({ AppProfile: { findOne: mocked.profileFind } }));
vi.mock('./charts.model.js', () => ({
  AppChartSubscription: {
    create: mocked.subscriptionCreate,
    deleteOne: mocked.subscriptionDelete,
    exists: mocked.subscriptionExists,
    find: mocked.subscriptionFind,
    findOne: mocked.subscriptionFindOne,
  },
}));
vi.mock('../sites/sites.guard.js', () => ({ loadOwnedSite: mocked.loadSite }));
vi.mock(import('../../shared/queue/index.js'), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, enqueueAppSeoChartJob: mocked.enqueue };
});
vi.mock('./keywords.queue-holder.js', () => ({ getAppSeoTrackingQueue: mocked.getQueue }));

import {
  appChartServiceTestables as internals,
  createAppChartSubscription,
  deleteAppChartSubscription,
  getAppChartHistory,
  listAppChartSubscriptions,
  previewAppChartCheck,
  recheckAppChartSubscription,
} from './charts.service.js';

const accountId = 'chart-service-account';
const siteId = '507f1f77bcf86cd799439011';
const profileId = '507f1f77bcf86cd799439012';
const subscriptionId = '507f1f77bcf86cd799439013';
const secondSubscriptionId = '507f1f77bcf86cd799439014';
const AT = new Date('2026-08-10T12:00:00.000Z');
const EARLIER = new Date('2026-08-03T12:00:00.000Z');
const OLDEST = new Date('2026-07-27T12:00:00.000Z');
const OBSERVATION = {
  sourceKind: 'estimate' as const,
  sourceLabel: null,
  observedAt: AT.toISOString(),
  freshUntil: null,
  freshness: 'unknown' as const,
  market: null,
  sampleCount: 1,
  coverageNoteKey: null,
};
const queue = { name: 'app-seo-chart-fixture', getJob: mocked.getJob };

function database(): ApplicationDb {
  return getTestDb();
}

function profile(input: { playPackageId?: string | null; appStoreId?: string | null } = {}) {
  return {
    _id: profileId,
    playPackageId: input.playPackageId === undefined ? 'com.example.rankme' : input.playPackageId,
    appStoreId: input.appStoreId === undefined ? '123456789' : input.appStoreId,
  };
}

function subscription(input: {
  id?: string;
  store?: 'google_play' | 'app_store';
  chartId?: string;
  categoryId?: string;
  createdAt?: Date;
} = {}) {
  return {
    _id: input.id ?? subscriptionId,
    accountId,
    siteId,
    profileId,
    store: input.store ?? 'google_play',
    chartId: input.chartId ?? 'topselling_free',
    categoryId: input.categoryId ?? 'business',
    locationCode: 2840,
    languageCode: 'en',
    slot: 0,
    createdAt: input.createdAt ?? AT,
    updatedAt: input.createdAt ?? AT,
  };
}

function createInput(input: {
  store?: 'google_play' | 'app_store';
  chartId?: string;
  categoryId?: string;
  languageCode?: string;
} = {}) {
  return {
    accountId,
    siteId,
    subscription: {
      profileId,
      store: input.store ?? 'google_play',
      chartId: input.chartId ?? 'topselling_free',
      categoryId: input.categoryId ?? 'business',
      locationCode: 2840,
      languageCode: input.languageCode ?? 'EN',
    },
  };
}

async function insertSnapshot(input: {
  checkedAt: Date;
  position: number | null;
  store?: 'google_play' | 'app_store';
  chartId?: string;
  categoryId?: string | null;
}): Promise<void> {
  await getTestDb().insert(appChartSnapshots).values({
    accountId,
    siteId,
    profileId,
    store: input.store ?? 'google_play',
    chartId: input.chartId ?? 'topselling_free',
    categoryId: input.categoryId === undefined ? 'business' : input.categoryId,
    position: input.position,
    checkedAt: input.checkedAt,
    observationMeta: OBSERVATION,
  });
}

const originalFlags = {
  appSeo: env.APP_SEO_ENABLED,
  charts: env.APP_CHART_TRACKING_ENABLED,
};

beforeAll(startTestPostgres);
afterAll(stopTestPostgres);

beforeEach(async () => {
  await truncateAllTables();
  env.APP_SEO_ENABLED = true;
  env.APP_CHART_TRACKING_ENABLED = true;
  mocked.profileFind.mockReset().mockResolvedValue(profile());
  mocked.subscriptionCreate.mockReset().mockResolvedValue(subscription());
  mocked.subscriptionDelete.mockReset().mockResolvedValue({ deletedCount: 1 });
  mocked.subscriptionExists.mockReset().mockResolvedValue(null);
  mocked.subscriptionFindOne.mockReset().mockResolvedValue(subscription());
  mocked.subscriptionLean.mockReset().mockResolvedValue([]);
  mocked.subscriptionSort.mockReset().mockResolvedValue([]);
  mocked.subscriptionFind.mockReset().mockImplementation(() => ({
    lean: mocked.subscriptionLean,
    sort: mocked.subscriptionSort,
  }));
  mocked.loadSite.mockReset().mockResolvedValue({ id: siteId });
  mocked.enqueue.mockReset().mockResolvedValue(undefined);
  mocked.getJob.mockReset().mockResolvedValue(undefined);
  mocked.getQueue.mockReset().mockReturnValue(queue);
});

afterEach(() => {
  env.APP_SEO_ENABLED = originalFlags.appSeo;
  env.APP_CHART_TRACKING_ENABLED = originalFlags.charts;
  vi.restoreAllMocks();
});

describe('app chart helpers and ownership', () => {
  it('evaluates rollout flags, store targets, duplicate errors, slots, and snapshot keys', () => {
    expect(internals.chartTrackingEnabled()).toBe(true);
    expect(() => internals.requireChartTrackingEnabled()).not.toThrow();
    env.APP_SEO_ENABLED = false;
    expect(internals.chartTrackingEnabled()).toBe(false);
    expect(() => internals.requireChartTrackingEnabled()).toThrow();
    env.APP_SEO_ENABLED = true;
    env.APP_CHART_TRACKING_ENABLED = false;
    expect(internals.chartTrackingEnabled()).toBe(false);
    expect(() => internals.requireChartTrackingEnabled()).toThrow();

    expect(internals.targetAppId(profile(), 'google_play')).toBe('com.example.rankme');
    expect(internals.targetAppId(profile(), 'app_store')).toBe('123456789');
    expect(internals.targetAppId(profile({ playPackageId: null }), 'google_play')).toBeNull();
    expect(internals.targetAppId(profile({ appStoreId: null }), 'app_store')).toBeNull();

    const duplicate = Object.assign(new Error('duplicate'), { code: 11000 });
    expect(internals.isMongoDuplicateError(duplicate)).toBe(true);
    expect(internals.isMongoDuplicateError(Object.assign(new Error('other'), { code: 42 }))).toBe(false);
    expect(internals.isMongoDuplicateError({ code: 11000 })).toBe(false);
    expect(internals.nextAvailableChartSlot([])).toBe(0);
    expect(internals.nextAvailableChartSlot([{ slot: 0 }])).toBe(1);
    expect(internals.nextAvailableChartSlot([{ slot: 1 }])).toBe(0);
    expect(internals.snapshotKey('google_play', 'free', null)).toBe('google_play\u0000free\u0000');
    expect(internals.snapshotKey('app_store', 'paid', 'games')).toBe('app_store\u0000paid\u0000games');
  });

  it('fails closed for invalid, missing, and nested profile/subscription ownership', async () => {
    await expect(internals.requireOwnedProfile(accountId, siteId, 'invalid', false))
      .rejects.toMatchObject({ status: 404 });
    mocked.profileFind.mockResolvedValueOnce(null);
    await expect(internals.requireOwnedProfile(accountId, siteId, profileId, true))
      .rejects.toMatchObject({ status: 404 });
    await expect(internals.requireOwnedProfile(accountId, siteId, profileId, false))
      .resolves.toMatchObject({ _id: profileId });

    await expect(internals.requireOwnedSubscription(accountId, siteId, 'invalid', true))
      .rejects.toMatchObject({ status: 404 });
    mocked.subscriptionFindOne.mockResolvedValueOnce(null);
    await expect(internals.requireOwnedSubscription(accountId, siteId, subscriptionId, true))
      .rejects.toMatchObject({ status: 404 });
    await expect(internals.requireOwnedSubscription(accountId, siteId, subscriptionId, false))
      .resolves.toMatchObject({ _id: subscriptionId });
    expect(loadOwnedSite).toHaveBeenCalledWith(accountId, siteId, { allowPaused: false });
  });
});

describe('app chart subscription lifecycle', () => {
  it('creates normalized subscriptions in the first free stable slot', async () => {
    const created = await createAppChartSubscription(createInput());
    expect(created).toEqual({
      id: subscriptionId,
      profileId,
      store: 'google_play',
      chartId: 'topselling_free',
      categoryId: 'business',
      locationCode: 2840,
      languageCode: 'en',
      latestPosition: null,
      previousPosition: null,
      delta: null,
      lastCheckedAt: null,
      createdAt: AT.toISOString(),
    });
    expect(mocked.subscriptionCreate).toHaveBeenCalledWith(expect.objectContaining({
      languageCode: 'en', slot: 0,
    }));

    mocked.subscriptionLean.mockResolvedValueOnce([{ slot: 0 }]);
    await createAppChartSubscription(createInput({
      store: 'app_store', chartId: 'top_free_ios', categoryId: 'games',
    }));
    expect(mocked.subscriptionCreate).toHaveBeenLastCalledWith(expect.objectContaining({ slot: 1 }));
  });

  it('rejects missing app ids, invalid selections, duplicates, and a full profile', async () => {
    mocked.profileFind.mockResolvedValueOnce(profile({ playPackageId: null }));
    await expect(createAppChartSubscription(createInput())).rejects.toMatchObject({ status: 404 });
    mocked.profileFind.mockResolvedValueOnce(profile({ appStoreId: null }));
    await expect(createAppChartSubscription(createInput({
      store: 'app_store', chartId: 'top_free_ios', categoryId: 'games',
    }))).rejects.toMatchObject({ status: 404 });
    await expect(createAppChartSubscription(createInput({ chartId: 'not-a-chart' })))
      .rejects.toMatchObject({ status: 400 });

    mocked.subscriptionExists.mockResolvedValueOnce({ _id: subscriptionId });
    await expect(createAppChartSubscription(createInput())).rejects.toMatchObject({ status: 409 });
    mocked.subscriptionLean.mockResolvedValueOnce([{ slot: 0 }, { slot: 1 }]);
    await expect(createAppChartSubscription(createInput())).rejects.toMatchObject({ status: 409 });
  });

  it('maps competing Mongo inserts to duplicate or slot conflicts and preserves other failures', async () => {
    const duplicate = Object.assign(new Error('duplicate key'), { code: 11000 });
    mocked.subscriptionCreate.mockRejectedValueOnce(duplicate);
    mocked.subscriptionExists.mockResolvedValueOnce(null).mockResolvedValueOnce({ _id: subscriptionId });
    await expect(createAppChartSubscription(createInput()))
      .rejects.toMatchObject({ status: 409, message: 'appSeo.errors.duplicateChartSubscription' });

    mocked.subscriptionCreate.mockRejectedValueOnce(duplicate);
    mocked.subscriptionExists.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    await expect(createAppChartSubscription(createInput()))
      .rejects.toMatchObject({ status: 409, message: 'appSeo.errors.chartSubscriptionLimit' });

    const storageFailure = new Error('mongo unavailable');
    mocked.subscriptionCreate.mockRejectedValueOnce(storageFailure);
    mocked.subscriptionExists.mockResolvedValueOnce(null);
    await expect(createAppChartSubscription(createInput())).rejects.toBe(storageFailure);
  });

  it('deletes only the verified owned subscription', async () => {
    await expect(deleteAppChartSubscription({ accountId, siteId, subscriptionId })).resolves.toBeUndefined();
    expect(mocked.subscriptionDelete).toHaveBeenCalledWith({ _id: subscriptionId, accountId });
  });
});

describe('app chart listing and history', () => {
  it('joins only the two newest matching positions and exposes the rollout state', async () => {
    await insertSnapshot({ checkedAt: AT, position: 3 });
    await insertSnapshot({ checkedAt: EARLIER, position: 9 });
    await insertSnapshot({ checkedAt: OLDEST, position: 20 });
    await insertSnapshot({
      checkedAt: AT, position: null, store: 'app_store', chartId: 'top_free_ios', categoryId: 'games',
    });
    await insertSnapshot({ checkedAt: AT, position: 1, chartId: 'unmatched', categoryId: null });
    mocked.subscriptionSort.mockResolvedValueOnce([
      subscription(),
      subscription({
        id: secondSubscriptionId,
        store: 'app_store',
        chartId: 'top_free_ios',
        categoryId: 'games',
      }),
      subscription({ id: '507f1f77bcf86cd799439015', chartId: 'without-history' }),
    ]);

    const result = await listAppChartSubscriptions({ accountId, siteId, profileId }, database());
    expect(result).toMatchObject({ limit: 2, trackingEnabled: true });
    expect(result).not.toHaveProperty('appSeoAddonActive');
    expect(result.catalogs.google_play.store).toBe('google_play');
    expect(result.items).toEqual([
      expect.objectContaining({
        id: subscriptionId,
        latestPosition: 3,
        previousPosition: 9,
        delta: 6,
        lastCheckedAt: AT.toISOString(),
      }),
      expect.objectContaining({
        id: secondSubscriptionId,
        latestPosition: null,
        previousPosition: null,
        delta: null,
        lastCheckedAt: AT.toISOString(),
      }),
      expect.objectContaining({
        latestPosition: null,
        previousPosition: null,
        delta: null,
        lastCheckedAt: null,
      }),
    ]);
  });

  it('returns chronological scoped history with nullable positions and a caller limit', async () => {
    await insertSnapshot({ checkedAt: OLDEST, position: 20 });
    await insertSnapshot({ checkedAt: EARLIER, position: null });
    await insertSnapshot({ checkedAt: AT, position: 3 });
    await insertSnapshot({ checkedAt: AT, position: 1, chartId: 'unmatched' });

    await expect(getAppChartHistory({
      accountId, siteId, subscriptionId, limit: 2,
    }, database())).resolves.toEqual([
      { checkedAt: EARLIER.toISOString(), position: null },
      { checkedAt: AT.toISOString(), position: 3 },
    ]);
  });
});

describe('app chart spend preview and enqueue', () => {
  const community = { deploymentMode: 'community', capacityEnforced: false };

  it('returns the community spend preview without queueing when confirm is false', async () => {
    expect(previewAppChartCheck()).toEqual(community);
    await expect(recheckAppChartSubscription({
      accountId, siteId, subscriptionId, confirm: false,
    }, database())).resolves.toEqual({
      preview: community,
      queued: false,
      reservationStamp: null,
    });
    expect(mocked.getQueue).not.toHaveBeenCalled();
    expect(loadOwnedSite).toHaveBeenCalledWith(accountId, siteId, { allowPaused: true });
  });

  it('fails closed when the rollout flag is off or the tracking queue is unavailable', async () => {
    env.APP_CHART_TRACKING_ENABLED = false;
    await expect(recheckAppChartSubscription({
      accountId, siteId, subscriptionId, confirm: true,
    }, database())).rejects.toMatchObject({ status: 503 });
    env.APP_CHART_TRACKING_ENABLED = true;
    mocked.getQueue.mockReturnValueOnce(null);
    await expect(recheckAppChartSubscription({
      accountId, siteId, subscriptionId, confirm: true,
    }, database())).rejects.toMatchObject({ status: 503 });
    expect(enqueueAppSeoChartJob).not.toHaveBeenCalled();
  });

  it('does not queue a second check once this week is already stored', async () => {
    const stamp = appKeywordIsoWeek(new Date());
    await insertSnapshot({ checkedAt: appKeywordWeekStart(stamp), position: 4 });
    await expect(recheckAppChartSubscription({
      accountId, siteId, subscriptionId, confirm: true,
    }, database())).resolves.toEqual({ preview: community, queued: false, reservationStamp: stamp });
    expect(mocked.getJob).not.toHaveBeenCalled();
    expect(enqueueAppSeoChartJob).not.toHaveBeenCalled();
  });

  it('enqueues this week\'s check with the owned profile and week stamp', async () => {
    await insertSnapshot({ checkedAt: new Date('2020-01-06T00:00:00.000Z'), position: 4 });
    const result = await recheckAppChartSubscription({
      accountId, siteId, subscriptionId, confirm: true,
    }, database());
    expect(result).toEqual({ preview: community, queued: true, reservationStamp: appKeywordIsoWeek(new Date()) });
    expect(mocked.getJob).toHaveBeenCalledWith(appSeoChartJobId(subscriptionId, result.reservationStamp!));
    expect(enqueueAppSeoChartJob).toHaveBeenCalledWith(queue, {
      accountId,
      siteId,
      profileId,
      subscriptionId,
      reservationStamp: result.reservationStamp,
      manual: true,
    });
  });

  it('retries a failed weekly job in place and propagates enqueue failures', async () => {
    const retry = vi.fn().mockResolvedValue(undefined);
    mocked.getJob.mockResolvedValueOnce({ getState: async () => 'failed', retry, remove: vi.fn() });
    await expect(recheckAppChartSubscription({
      accountId, siteId, subscriptionId, confirm: true,
    }, database())).resolves.toMatchObject({ queued: true });
    expect(retry).toHaveBeenCalledWith('failed');
    expect(enqueueAppSeoChartJob).not.toHaveBeenCalled();

    const enqueueFailure = new Error('redis unavailable');
    mocked.enqueue.mockRejectedValueOnce(enqueueFailure);
    await expect(recheckAppChartSubscription({
      accountId, siteId, subscriptionId, confirm: true,
    }, database())).rejects.toBe(enqueueFailure);
  });
});
