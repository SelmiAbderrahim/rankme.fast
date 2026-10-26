import { RANK_CHECK_FAILURE_REASONS, type Keyword, type RankJobItem } from './types';

export type KeywordCheckState =
  | { kind: 'queued' }
  | { kind: 'checking' }
  | { kind: 'failed'; at: string; reason: string | null }
  | { kind: 'checked'; at: string }
  | { kind: 'never' };

/** Monday 00:00 UTC for an epoch timestamp. Mirrors the server weekly stamp. */
export function altEngineWeeklyStampMs(epochMs: number): number {
  const stamp = new Date(epochMs);
  const day = stamp.getUTCDay() || 7;
  stamp.setUTCHours(0, 0, 0, 0);
  stamp.setUTCDate(stamp.getUTCDate() - (day - 1));
  return stamp.getTime();
}

function parsedAt(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * A manual check is terminal when it has either a successful snapshot or a
 * recorded failed attempt. Alt-engine success is compared with the weekly
 * period floor because those rows intentionally never carry the trigger time.
 */
export function rankCheckReachedTerminal(keyword: Keyword, startedAt: number): boolean {
  const successAt = parsedAt(keyword.lastCheckedAt);
  const failureAt = parsedAt(keyword.lastFailedCheckAt);
  const successThreshold =
    keyword.engine === 'google' ? startedAt : altEngineWeeklyStampMs(startedAt);
  return (
    (successAt !== null && successAt >= successThreshold) ||
    (failureAt !== null && failureAt >= startedAt)
  );
}

/** A job failure counts only when the provider was actually attempted. */
function attemptedFailure(item: RankJobItem): boolean {
  return item.attempts > 0 && (item.state === 'failed' || item.state === 'expired');
}

function itemFailureReason(item: RankJobItem): string | null {
  if (item.state === 'expired') return 'vendor_timeout';
  return item.reason && RANK_CHECK_FAILURE_REASONS.some((reason) => reason === item.reason)
    ? item.reason : null;
}

/** Prefer live job state, then the newest observed success or attempted failure. */
export function keywordCheckState(keyword: Keyword, item?: RankJobItem): KeywordCheckState {
  if (item?.state === 'queued') return { kind: 'queued' };
  if (item?.state === 'running') return { kind: 'checking' };
  const checkedAt = parsedAt(keyword.lastCheckedAt);
  const failedAt = parsedAt(keyword.lastFailedCheckAt);
  const itemAt = item && attemptedFailure(item) ? parsedAt(item.finishedAt) : null;
  if (itemAt !== null && (checkedAt === null || itemAt > checkedAt)) {
    return { kind: 'failed', at: item!.finishedAt!, reason: itemFailureReason(item!) };
  }
  if (failedAt !== null && (checkedAt === null || failedAt > checkedAt)) {
    return { kind: 'failed', at: keyword.lastFailedCheckAt!, reason: keyword.lastFailedReason };
  }
  if (checkedAt !== null) return { kind: 'checked', at: keyword.lastCheckedAt! };
  return { kind: 'never' };
}
