import type { TFunction } from 'i18next';
import type { RankJob } from './types';

const storageKey = (siteId: string): string => `rmf.rankJob.${siteId}`;

/** Remember a requested check so its result survives leaving the page. */
export function rememberTrackedRankJob(siteId: string, jobId: string): void {
  try { window.localStorage.setItem(storageKey(siteId), jobId); } catch { /* Storage may be unavailable. */ }
}

export function readTrackedRankJob(siteId: string): string | null {
  try { return window.localStorage.getItem(storageKey(siteId)); } catch { return null; }
}

export function forgetTrackedRankJob(siteId: string, jobId: string): void {
  try {
    if (window.localStorage.getItem(storageKey(siteId)) === jobId) window.localStorage.removeItem(storageKey(siteId));
  } catch { /* The active-job endpoint can still recover the current check. */ }
}

export const rankJobToastId = (jobId: string): string => `rank-job-${jobId}`;
export const newIdempotencyKey = (): string => window.crypto.randomUUID();
export const isRankJobFinished = (job: RankJob): boolean => job.finishedAt !== null;

export interface RankJobOutcome {
  tone: 'success' | 'warning' | 'error' | 'info';
  title: string;
  description?: string;
  failed: number;
}

/** Expired before vendor submission; this is a missed check, not a failed one. */
export const notCheckedInTimeCount = (job: RankJob): number =>
  job.items.filter((item) => item.state === 'expired' && item.attempts === 0).length;

export function rankJobOutcome(t: TFunction, job: RankJob): RankJobOutcome {
  const { succeeded, failed, expired, total, cancelled } = job.totals;
  const requested = total - cancelled;
  if (requested === 0) return { tone: 'info', title: t('ranks:jobOutcome.cancelled'), failed: 0 };
  if (failed + expired === 0) {
    return { tone: 'success', title: t('ranks:jobOutcome.allChecked', { count: requested }), failed: 0 };
  }
  const notChecked = notCheckedInTimeCount(job);
  const failedChecks = failed + expired - notChecked;
  const description = [
    failedChecks > 0 ? t('ranks:jobOutcome.failed', { count: failedChecks }) : null,
    notChecked > 0 ? t('ranks:jobOutcome.notCheckedInTime', { count: notChecked }) : null,
  ].filter((part): part is string => part !== null).join(' ');
  return {
    tone: succeeded === 0 ? 'error' : 'warning',
    title: t('ranks:jobOutcome.checked', { count: requested, checked: succeeded }),
    description,
    failed: failed + expired,
  };
}
