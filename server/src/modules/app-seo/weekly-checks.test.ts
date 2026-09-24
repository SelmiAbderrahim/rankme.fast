import { describe, expect, it, vi } from 'vitest';
import {
  appKeywordIsoWeek,
  appKeywordWeekStart,
  ensureWeeklyCheckJob,
  readWeeklyCheckJobStatus,
  type WeeklyCheckJob,
} from './weekly-checks.js';

function job(state: string, finishedOn?: number) {
  return {
    getState: vi.fn().mockResolvedValue(state),
    retry: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    ...(finishedOn === undefined ? {} : { finishedOn }),
  };
}

function queue(existing?: WeeklyCheckJob) {
  return { getJob: vi.fn().mockResolvedValue(existing) };
}

describe('ISO week stamps', () => {
  it('formats ISO weeks across year boundaries and Sundays', () => {
    expect(appKeywordIsoWeek(new Date('2026-08-12T12:00:00.000Z'))).toBe('2026-W33');
    expect(appKeywordIsoWeek(new Date('2026-08-16T23:59:59.000Z'))).toBe('2026-W33');
    expect(appKeywordIsoWeek(new Date('2027-01-01T00:00:00.000Z'))).toBe('2026-W53');
    expect(appKeywordIsoWeek(new Date('2024-12-30T00:00:00.000Z'))).toBe('2025-W01');
    expect(appKeywordIsoWeek(new Date('2026-01-05T00:00:00.000Z'))).toBe('2026-W02');
  });

  it('resolves the UTC Monday of a stamp, ignoring any retry suffix', () => {
    expect(appKeywordWeekStart('2026-W33')).toEqual(new Date('2026-08-10T00:00:00.000Z'));
    expect(appKeywordWeekStart('2026-W33-r000001')).toEqual(new Date('2026-08-10T00:00:00.000Z'));
    expect(appKeywordWeekStart('2025-W01')).toEqual(new Date('2024-12-30T00:00:00.000Z'));
    expect(appKeywordWeekStart('2026-W53')).toEqual(new Date('2026-12-28T00:00:00.000Z'));
    expect(appKeywordWeekStart('2027-W01')).toEqual(new Date('2027-01-04T00:00:00.000Z'));
    expect(appKeywordIsoWeek(appKeywordWeekStart('2026-W33'))).toBe('2026-W33');
  });
});

describe('ensureWeeklyCheckJob', () => {
  it('enqueues when no deterministic job is retained', async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const fake = queue();
    await ensureWeeklyCheckJob(fake, 'job-id', enqueue);
    expect(fake.getJob).toHaveBeenCalledWith('job-id');
    expect(enqueue).toHaveBeenCalledOnce();
  });

  it('retries a failed job in place', async () => {
    const enqueue = vi.fn();
    const failed = job('failed');
    await ensureWeeklyCheckJob(queue(failed), 'job-id', enqueue);
    expect(failed.retry).toHaveBeenCalledWith('failed');
    expect(failed.remove).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('replaces a completed job', async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const completed = job('completed');
    await ensureWeeklyCheckJob(queue(completed), 'job-id', enqueue);
    expect(completed.remove).toHaveBeenCalledOnce();
    expect(enqueue).toHaveBeenCalledOnce();
  });

  it('leaves waiting, active, and delayed jobs untouched', async () => {
    const enqueue = vi.fn();
    for (const state of ['waiting', 'active', 'delayed']) {
      const pending = job(state);
      await ensureWeeklyCheckJob(queue(pending), 'job-id', enqueue);
      expect(pending.retry).not.toHaveBeenCalled();
      expect(pending.remove).not.toHaveBeenCalled();
    }
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe('readWeeklyCheckJobStatus', () => {
  it('returns null for missing, completed, and unknown jobs', async () => {
    await expect(readWeeklyCheckJobStatus(queue(), 'job-id')).resolves.toBeNull();
    await expect(readWeeklyCheckJobStatus(queue(job('completed')), 'job-id')).resolves.toBeNull();
    await expect(readWeeklyCheckJobStatus(queue(job('unknown')), 'job-id')).resolves.toBeNull();
  });

  it('reports failed jobs with and without a finish time', async () => {
    const finishedOn = Date.parse('2026-08-12T08:00:00.000Z');
    await expect(readWeeklyCheckJobStatus(queue(job('failed', finishedOn)), 'job-id'))
      .resolves.toEqual({ status: 'failed', failedAt: new Date(finishedOn) });
    await expect(readWeeklyCheckJobStatus(queue(job('failed')), 'job-id'))
      .resolves.toEqual({ status: 'failed', failedAt: null });
  });

  it('reports pending jobs as queued', async () => {
    for (const state of ['waiting', 'active', 'delayed', 'prioritized']) {
      await expect(readWeeklyCheckJobStatus(queue(job(state)), 'job-id'))
        .resolves.toEqual({ status: 'queued' });
    }
  });
});
