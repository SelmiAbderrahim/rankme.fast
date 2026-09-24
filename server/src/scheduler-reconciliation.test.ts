import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  refreshSingletonSchedulerAfterPromotion,
  reconcileSingletonScheduler,
  reconcileSchedulers,
  singletonScheduleMatches,
  startSchedulerReconciler,
  withSingletonSchedulerRefresh,
} from './scheduler-reconciliation.js';

const logger = pino({ enabled: false });

afterEach(() => {
  vi.useRealTimers();
});

describe('durable scheduler reconciliation', () => {
  it('creates only missing desired singletons and removes only present undesired ones', async () => {
    const queue = {
      getJobScheduler: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ key: 'tick' })
        .mockResolvedValueOnce({ key: 'tick' })
        .mockResolvedValueOnce(undefined),
      removeJobScheduler: vi.fn(async () => true),
    };
    const install = vi.fn(async () => undefined);
    await expect(
      reconcileSingletonScheduler(queue, 'tick', true, install),
    ).resolves.toBe('created');
    await expect(
      reconcileSingletonScheduler(queue, 'tick', true, install),
    ).resolves.toBe('existing');
    await expect(
      reconcileSingletonScheduler(queue, 'tick', false, install),
    ).resolves.toBe('removed');
    await expect(
      reconcileSingletonScheduler(queue, 'tick', false, install),
    ).resolves.toBe('absent');
    expect(install).toHaveBeenCalledOnce();
    expect(queue.removeJobScheduler).toHaveBeenCalledOnce();
  });

  it('compares complete every/cron singleton schedule signatures', () => {
    expect(singletonScheduleMatches({ every: 60_000 }, { every: 60_000 })).toBe(true);
    expect(singletonScheduleMatches({ every: 30_000 }, { every: 60_000 })).toBe(false);
    expect(
      singletonScheduleMatches(
        { pattern: '0 3 * * *', tz: 'UTC' },
        { pattern: '0 3 * * *', tz: 'UTC' },
      ),
    ).toBe(true);
    expect(
      singletonScheduleMatches(
        { pattern: '0 4 * * *', tz: 'UTC' },
        { pattern: '0 3 * * *', tz: 'UTC' },
      ),
    ).toBe(false);
    expect(singletonScheduleMatches(null, { every: 60_000 })).toBe(false);
  });

  it('repairs drift only after the matching scheduler iteration is promoted', async () => {
    const install = vi.fn(async () => undefined);
    const queue = {
      getJobScheduler: vi.fn(async () => ({ every: 30_000 })),
      removeJobScheduler: vi.fn(async () => true),
    };
    await expect(
      refreshSingletonSchedulerAfterPromotion(
        queue,
        'tick',
        true,
        { every: 60_000 },
        install,
        { opts: {} },
      ),
    ).resolves.toBe(false);
    await expect(
      refreshSingletonSchedulerAfterPromotion(
        queue,
        'tick',
        false,
        { every: 60_000 },
        install,
        { opts: { repeatJobKey: 'tick' } },
      ),
    ).resolves.toBe(false);
    await expect(
      refreshSingletonSchedulerAfterPromotion(
        queue,
        'tick',
        true,
        { every: 60_000 },
        install,
        { opts: { repeatJobKey: 'tick' } },
      ),
    ).resolves.toBe(true);
    expect(install).toHaveBeenCalledOnce();

    vi.mocked(queue.getJobScheduler).mockResolvedValueOnce({ every: 60_000 });
    await expect(
      refreshSingletonSchedulerAfterPromotion(
        queue,
        'tick',
        true,
        { every: 60_000 },
        install,
        { opts: { repeatJobKey: 'tick' } },
      ),
    ).resolves.toBe(false);
    expect(install).toHaveBeenCalledOnce();
  });

  it('never blocks an accepted tick when promotion-time refresh fails', async () => {
    const processor = vi.fn(async () => 'done');
    const warn = vi.fn();
    const wrapped = withSingletonSchedulerRefresh(processor, {
      queue: {
        getJobScheduler: vi.fn(async () => {
          throw new Error('redis reconnecting');
        }),
        removeJobScheduler: vi.fn(async () => true),
      },
      key: 'tick',
      desired: true,
      expected: { every: 60_000 },
      install: vi.fn(async () => undefined),
      logger: { warn },
    });
    const job = { opts: { repeatJobKey: 'tick' } };
    await expect(wrapped(job)).resolves.toBe('done');
    expect(processor).toHaveBeenCalledWith(job);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('passes through a successful promotion-time refresh', async () => {
    const processor = vi.fn(async () => 'done');
    const install = vi.fn(async () => undefined);
    const wrapped = withSingletonSchedulerRefresh(processor, {
      queue: {
        getJobScheduler: vi.fn(async () => ({ every: 30_000 })),
        removeJobScheduler: vi.fn(async () => true),
      },
      key: 'tick',
      desired: true,
      expected: { every: 60_000 },
      install,
      logger,
    });
    await expect(
      wrapped({ opts: { repeatJobKey: 'tick' } }),
    ).resolves.toBe('done');
    expect(install).toHaveBeenCalledOnce();
  });

  it('attempts every domain when one task fails', async () => {
    const first = vi.fn(async () => {
      throw new Error('redis unavailable');
    });
    const second = vi.fn(async () => undefined);

    await expect(
      reconcileSchedulers({
        logger,
        tasks: [
          { name: 'rank', run: first },
          { name: 'pulse', run: second },
        ],
      }),
    ).resolves.toEqual({ completed: 1, failures: 1 });
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });

  it('coalesces overlapping triggers and drains the active pass on close', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = vi.fn(async () => gate);
    const reconciler = startSchedulerReconciler(
      { logger, tasks: [{ name: 'rank', run }] },
      { intervalMs: 60_000 },
    );

    const first = reconciler.runNow();
    const second = reconciler.runNow();
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    release();
    await expect(first).resolves.toEqual({ completed: 1, failures: 0 });
    await expect(second).resolves.toEqual({ completed: 1, failures: 0 });
    await expect(reconciler.close()).resolves.toBeUndefined();
  });

  it('runs automatically on the default interval', async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => undefined);
    const reconciler = startSchedulerReconciler({
      logger,
      tasks: [{ name: 'rank', run }],
    });
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledOnce();
    await reconciler.close();
  });

  it('backs off after failures, caps the delay, then resets after recovery', async () => {
    vi.useFakeTimers();
    let failing = true;
    const run = vi.fn(async () => {
      if (failing) throw new Error('redis unavailable');
    });
    const reconciler = startSchedulerReconciler(
      { logger, tasks: [{ name: 'rank', run }] },
      { intervalMs: 10, maxBackoffMs: 15 },
    );

    await expect(reconciler.runNow()).resolves.toEqual({
      completed: 0,
      failures: 1,
    });
    failing = false;
    await vi.advanceTimersByTimeAsync(14);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10);
    expect(run).toHaveBeenCalledTimes(3);
    await reconciler.close();
  });

  it('closes while a pass is active and does not schedule another pass', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = vi.fn(async () => gate);
    const reconciler = startSchedulerReconciler(
      { logger, tasks: [{ name: 'rank', run }] },
      { intervalMs: 10 },
    );
    const active = reconciler.runNow();
    const closing = reconciler.close();
    release();
    await active;
    await closing;
    await vi.advanceTimersByTimeAsync(100);
    expect(run).toHaveBeenCalledOnce();
  });

  it('absorbs an active reconciliation rejection while closing', async () => {
    let rejectRun!: (reason: Error) => void;
    const gate = new Promise<void>((_resolve, reject) => {
      rejectRun = reject;
    });
    const run = vi.fn(async () => gate);
    const rejectingLogger = pino({ enabled: false });
    vi.spyOn(rejectingLogger, 'error').mockImplementation(() => {
      throw new Error('logger unavailable');
    });
    const reconciler = startSchedulerReconciler(
      { logger: rejectingLogger, tasks: [{ name: 'rank', run }] },
      { intervalMs: 60_000 },
    );

    const active = reconciler.runNow();
    const rejected = expect(active).rejects.toThrow('logger unavailable');
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    const closing = reconciler.close();
    rejectRun(new Error('redis unavailable'));

    await rejected;
    await expect(closing).resolves.toBeUndefined();
  });
});
