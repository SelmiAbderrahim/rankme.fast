import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_SEO_CHART_JOB_NAME } from '../../shared/queue/index.js';
import { Site } from '../sites/index.js';

const mocked = vi.hoisted(() => ({
  siteFind: vi.fn(),
  siteLean: vi.fn(),
  subscriptionFind: vi.fn(),
  subscriptionFindLean: vi.fn(),
  enqueue: vi.fn(),
}));

vi.mock('../sites/index.js', () => ({ Site: { find: mocked.siteFind } }));
vi.mock('./charts.model.js', () => ({
  AppChartSubscription: { find: mocked.subscriptionFind },
}));
vi.mock(import('../../shared/queue/index.js'), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, enqueueAppSeoChartJob: mocked.enqueue };
});

import {
  APP_CHART_WEEKLY_CRON,
  APP_CHART_WEEKLY_SCHEDULER_KEY,
  APP_CHART_WEEKLY_SWEEP_JOB,
  appChartSchedulerTestables as internals,
  createAppChartWeeklySweep,
  dispatchAppChartJob,
  upsertAppChartSchedulers,
  type AppChartSweepDeps,
} from './charts.scheduler.js';

const accountId = 'chart-scheduler-account';
const activeSiteId = '507f1f77bcf86cd799439011';
const inactiveSiteId = '507f1f77bcf86cd799439012';
const profileId = '507f1f77bcf86cd799439013';
const NOW = new Date('2026-08-12T12:00:00.000Z');
const STAMP = '2026-W33';

function subscription(id: string, siteId = activeSiteId) {
  return { _id: id, accountId, siteId, profileId };
}

function dependencies(input: {
  enabled?: boolean;
  now?: () => Date;
} = {}): AppChartSweepDeps {
  return {
    queue: { add: vi.fn() },
    logger: { error: vi.fn() },
    enabled: () => input.enabled ?? true,
    ...(input.now === undefined ? { now: () => NOW } : { now: input.now }),
  };
}

beforeEach(() => {
  mocked.siteLean.mockReset().mockResolvedValue([{ _id: activeSiteId }]);
  mocked.siteFind.mockReset().mockReturnValue({ lean: mocked.siteLean });
  mocked.subscriptionFindLean.mockReset().mockResolvedValue([]);
  mocked.subscriptionFind.mockReset().mockReturnValue({ lean: mocked.subscriptionFindLean });
  mocked.enqueue.mockReset().mockResolvedValue(undefined);
});

describe('app chart scheduler helpers', () => {
  it('resolves injected and real time and owner-filters a deduplicated active-site set', async () => {
    expect(internals.schedulerNow(() => NOW)).toBe(NOW);
    const before = Date.now();
    const actual = internals.schedulerNow();
    expect(actual.getTime()).toBeGreaterThanOrEqual(before);
    expect(actual.getTime()).toBeLessThanOrEqual(Date.now());
    await expect(internals.activeSiteIds([activeSiteId, activeSiteId, inactiveSiteId]))
      .resolves.toEqual(new Set([activeSiteId]));
    expect(Site.find).toHaveBeenCalledWith({
      _id: { $in: [activeSiteId, inactiveSiteId] },
      paused: false,
      deletionStartedAt: null,
    }, { _id: 1 });
  });
});

describe('app chart weekly sweep', () => {
  it('is inert while disabled', async () => {
    await expect(createAppChartWeeklySweep(dependencies({ enabled: false }))())
      .resolves.toEqual({ enqueued: 0, skipped: 0 });
    expect(mocked.subscriptionFind).not.toHaveBeenCalled();
  });

  it('enqueues one deterministic weekly job per active subscription and counts skips', async () => {
    const ids = Array.from({ length: 3 }, (_, index) => `507f1f77bcf86cd7994390${20 + index}`);
    mocked.subscriptionFindLean.mockResolvedValueOnce([
      subscription(ids[0]!),
      subscription(ids[1]!, inactiveSiteId),
      subscription(ids[2]!),
    ]);
    const enqueueFailure = new Error('redis unavailable');
    mocked.enqueue.mockImplementation(async (_queue, payload) => {
      if (payload.subscriptionId === ids[2]) throw enqueueFailure;
    });
    const deps = dependencies();
    await expect(createAppChartWeeklySweep(deps)()).resolves.toEqual({ enqueued: 1, skipped: 2 });
    expect(mocked.enqueue).toHaveBeenCalledTimes(2);
    expect(mocked.enqueue).toHaveBeenCalledWith(deps.queue, {
      accountId,
      siteId: activeSiteId,
      profileId,
      subscriptionId: ids[0],
      reservationStamp: STAMP,
      manual: false,
    });
    expect(vi.mocked(deps.logger.error)).toHaveBeenCalledOnce();
    expect(vi.mocked(deps.logger.error)).toHaveBeenCalledWith(
      { err: enqueueFailure, subscriptionId: ids[2], siteId: activeSiteId },
      'app chart weekly enqueue failed',
    );
  });
});

describe('app chart dispatch and scheduler registration', () => {
  it('dispatches every known job and returns null for foreign queue work', async () => {
    const weeklySweep = vi.fn().mockResolvedValue('weekly');
    const processChart = vi.fn().mockResolvedValue('chart');
    await expect(dispatchAppChartJob({
      job: { name: APP_CHART_WEEKLY_SWEEP_JOB }, processChart, weeklySweep,
    })).resolves.toBe('weekly');
    await expect(dispatchAppChartJob({
      job: { name: APP_SEO_CHART_JOB_NAME }, processChart, weeklySweep,
    })).resolves.toBe('chart');
    expect(dispatchAppChartJob({
      job: { name: 'foreign-job' }, processChart, weeklySweep,
    })).toBeNull();
  });

  it('registers only the weekly UTC cron', async () => {
    const upsertJobScheduler = vi.fn().mockResolvedValue(undefined);
    await upsertAppChartSchedulers({ upsertJobScheduler });
    expect(upsertJobScheduler).toHaveBeenCalledOnce();
    expect(upsertJobScheduler).toHaveBeenCalledWith(
      APP_CHART_WEEKLY_SCHEDULER_KEY,
      { pattern: APP_CHART_WEEKLY_CRON, tz: 'UTC' },
      { name: APP_CHART_WEEKLY_SWEEP_JOB, data: {} },
    );
  });
});
