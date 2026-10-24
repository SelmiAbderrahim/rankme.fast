import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JOB_STATUS_DEFAULTS, useJobStatus, type UseJobStatusOptions } from './useJobStatus';

type Job = { done: boolean; value: number };
const pending: Job = { done: false, value: 1 };
const finished: Job = { done: true, value: 2 };
const isTerminal = (job: Job) => job.done;
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const options = (fetchJob: UseJobStatusOptions<Job>['fetchJob']): UseJobStatusOptions<Job> => ({
  jobId: 'one',
  fetchJob,
  isTerminal,
  initialDelayMs: 100,
  maxDelayMs: 200,
  backoff: 2,
  capMs: 1000,
});
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('job status polling', () => {
  it('stays idle without a job and accepts a terminal initial snapshot without reading', async () => {
    const fetchJob = vi.fn();
    const opts = options(fetchJob);
    const hook = renderHook(
      ({ jobId, initialJob }) => useJobStatus({ ...opts, jobId, initialJob }),
      { initialProps: { jobId: null as string | null, initialJob: null as Job | null } },
    );
    expect(hook.result.current).toEqual({ phase: 'idle', job: null });
    await advance(500);
    expect(fetchJob).not.toHaveBeenCalled();
    hook.rerender({ jobId: 'two', initialJob: finished });
    expect(hook.result.current).toEqual({ phase: 'terminal', job: finished });
    await advance(1000);
    expect(fetchJob).not.toHaveBeenCalled();
  });

  it('backs off transient failures, retains the last value, caps delay and stops on terminal', async () => {
    const fetchJob = vi
      .fn()
      .mockResolvedValueOnce(pending)
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce(finished);
    const hook = renderHook(() => useJobStatus(options(fetchJob)));
    expect(hook.result.current).toEqual({ job: null, phase: 'polling' });
    await advance(99);
    expect(fetchJob).not.toHaveBeenCalled();
    await advance(1);
    expect(hook.result.current.job).toEqual(pending);
    await advance(199);
    expect(fetchJob).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(hook.result.current.job).toEqual(pending);
    await advance(200);
    expect(hook.result.current).toEqual({ job: finished, phase: 'terminal' });
    await advance(2000);
    expect(fetchJob).toHaveBeenCalledTimes(3);
  });

  it('enforces the deadline before a scheduled read and aborts a stalled read', async () => {
    const fetchJob = vi.fn().mockImplementation(() => new Promise<Job>(() => undefined));
    const first = renderHook(() =>
      useJobStatus({ ...options(fetchJob), initialDelayMs: 200, capMs: 100 }),
    );
    await advance(100);
    expect(first.result.current.phase).toBe('capped');
    expect(fetchJob).not.toHaveBeenCalled();
    first.unmount();
    const second = renderHook(() =>
      useJobStatus({ ...options(fetchJob), initialJob: pending, capMs: 250 }),
    );
    await advance(100);
    const signal = fetchJob.mock.calls[0]?.[1] as AbortSignal;
    expect(signal.aborted).toBe(false);
    await advance(150);
    expect(second.result.current).toEqual({ job: pending, phase: 'capped' });
    expect(signal.aborted).toBe(true);
  });

  it('ignores late success after the cap and late rejection after unmount', async () => {
    let resolve!: (job: Job) => void;
    const fetchJob = vi.fn(
      () =>
        new Promise<Job>((r) => {
          resolve = r;
        }),
    );
    const hook = renderHook(() => useJobStatus({ ...options(fetchJob), capMs: 150 }));
    await advance(100);
    await advance(50);
    await act(async () => resolve(finished));
    expect(hook.result.current.phase).toBe('capped');
    hook.unmount();
    let reject!: (reason: unknown) => void;
    const late = vi.fn(
      () =>
        new Promise<Job>((_, r) => {
          reject = r;
        }),
    );
    const mounted = renderHook(() => useJobStatus(options(late)));
    await advance(100);
    mounted.unmount();
    await act(async () => reject(new Error('late')));
    await advance(1000);
    expect(late).toHaveBeenCalledTimes(1);
  });

  it('aborts old jobs and uses fresh callbacks without restarting the schedule', async () => {
    let resolve!: (job: Job) => void;
    const oldRead = vi.fn<UseJobStatusOptions<Job>['fetchJob']>().mockImplementation(
      () =>
        new Promise<Job>((r) => {
          resolve = r;
        }),
    );
    const freshRead = vi.fn().mockResolvedValue(finished);
    const hook = renderHook(
      ({ jobId, fetchJob, initialJob }) =>
        useJobStatus({ ...options(fetchJob), jobId, initialJob }),
      {
        initialProps: {
          jobId: 'old',
          fetchJob: oldRead as UseJobStatusOptions<Job>['fetchJob'],
          initialJob: pending,
        },
      },
    );
    await advance(100);
    const signal = oldRead.mock.calls[0]?.[1] as AbortSignal;
    hook.rerender({ jobId: 'new', fetchJob: freshRead, initialJob: pending });
    expect(signal.aborted).toBe(true);
    await act(async () => resolve(finished));
    expect(hook.result.current).toEqual({ job: pending, phase: 'polling' });
    await advance(40);
    const latestRead = vi.fn().mockResolvedValue(finished);
    hook.rerender({ jobId: 'new', fetchJob: latestRead, initialJob: finished });
    await advance(60);
    expect(freshRead).not.toHaveBeenCalled();
    expect(latestRead).toHaveBeenCalledWith('new', expect.any(AbortSignal));
    expect(hook.result.current.phase).toBe('terminal');
  });

  it('uses defaults and caps immediately for a zero budget', async () => {
    const fetchJob = vi.fn().mockResolvedValue(finished);
    const first = renderHook(() => useJobStatus({ jobId: 'one', fetchJob, isTerminal }));
    await advance(JOB_STATUS_DEFAULTS.initialDelayMs - 1);
    expect(fetchJob).not.toHaveBeenCalled();
    await advance(1);
    expect(first.result.current.phase).toBe('terminal');
    first.unmount();
    const zero = renderHook(() => useJobStatus({ ...options(fetchJob), capMs: 0 }));
    expect(zero.result.current.phase).toBe('capped');
  });
});
