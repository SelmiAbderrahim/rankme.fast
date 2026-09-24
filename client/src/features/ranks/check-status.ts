import type { Keyword } from './types';

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
