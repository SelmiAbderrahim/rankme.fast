import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n, initI18n } from '@shared/i18n';
import type { TFunction } from 'i18next';
import type { RankJob } from './types';
import { forgetTrackedRankJob, isRankJobFinished, notCheckedInTimeCount, rankJobOutcome,
  readTrackedRankJob, rememberTrackedRankJob } from './rankJobs';

const job = (overrides: Partial<RankJob> = {}): RankJob => ({
  id: 'job-1', siteId: 'site-1', scope: 'site', status: 'queued', retryOfJobId: null,
  createdAt: '2026-10-25T00:00:00.000Z', startedAt: null, finishedAt: null,
  deadlineAt: '2026-10-25T00:20:00.000Z', totals: { total: 2, queued: 2,
    running: 0, succeeded: 0, failed: 0, expired: 0, cancelled: 0 }, items: [], ...overrides,
});
const t = i18n.t.bind(i18n) as TFunction;

beforeEach(() => { initI18n({ initialLocale: 'en' }); window.localStorage.clear(); vi.restoreAllMocks(); });

describe('tracked rank job', () => {
  it('retains a job until the matching result is reported', () => {
    rememberTrackedRankJob('site-1', 'job-1');
    expect(readTrackedRankJob('site-1')).toBe('job-1');
    forgetTrackedRankJob('site-1', 'job-2');
    expect(readTrackedRankJob('site-1')).toBe('job-1');
    forgetTrackedRankJob('site-1', 'job-1');
    expect(readTrackedRankJob('site-1')).toBeNull();
  });

  it('continues without browser storage', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('unavailable'); });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('unavailable'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('unavailable'); });
    expect(() => rememberTrackedRankJob('site-1', 'job-1')).not.toThrow();
    expect(readTrackedRankJob('site-1')).toBeNull();
    expect(() => forgetTrackedRankJob('site-1', 'job-1')).not.toThrow();
  });

  it('distinguishes failed checks from items that were never attempted', () => {
    const finished = job({ status: 'partial', finishedAt: '2026-10-25T00:02:00.000Z',
      totals: { total: 3, queued: 0, running: 0, succeeded: 1, failed: 1, expired: 1, cancelled: 0 },
      items: [{ keywordId: 'a', engine: 'google', state: 'failed', reason: 'vendor_timeout',
        attempts: 1, finishedAt: '2026-10-25T00:02:00.000Z' },
      { keywordId: 'b', engine: 'google', state: 'expired', reason: 'not_attempted', attempts: 0,
        finishedAt: '2026-10-25T00:02:00.000Z' }] });
    expect(isRankJobFinished(finished)).toBe(true);
    expect(notCheckedInTimeCount(finished)).toBe(1);
    expect(rankJobOutcome(t, finished)).toMatchObject({ tone: 'warning', failed: 2,
      description: expect.stringContaining('not checked in time') });
    expect(rankJobOutcome(t, finished).description).not.toMatch(/refund|unit|allowance/i);
  });

  it('summarizes fully checked, canceled and fully failed jobs', () => {
    expect(isRankJobFinished(job())).toBe(false);
    expect(rankJobOutcome(t, job({ totals: { total: 1, queued: 0, running: 0,
      succeeded: 1, failed: 0, expired: 0, cancelled: 0 } })).tone).toBe('success');
    expect(rankJobOutcome(t, job({ totals: { total: 1, queued: 0, running: 0,
      succeeded: 0, failed: 0, expired: 0, cancelled: 1 } })).tone).toBe('info');
    expect(rankJobOutcome(t, job({ totals: { total: 1, queued: 0, running: 0,
      succeeded: 0, failed: 1, expired: 0, cancelled: 0 } })).tone).toBe('error');
    expect(rankJobOutcome(t, job({ totals: { total: 1, queued: 0, running: 0,
      succeeded: 0, failed: 0, expired: 1, cancelled: 0 },
      items: [{ keywordId: 'a', engine: 'google', state: 'expired', reason: 'not_attempted',
        attempts: 0, finishedAt: '2026-10-25T00:02:00.000Z' }] })).description)
      .toContain('not checked in time');
  });
});
