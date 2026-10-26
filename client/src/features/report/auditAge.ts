import { calendarDaysAgo } from '@shared/lib/datetime';

const DAY_MS = 86_400_000;

export type AuditAgeState = 'never' | 'running' | 'fresh' | 'stale';

export interface AuditAge {
  state: AuditAgeState;
  /**
   * Calendar days since the audit finished in the viewer's zone (the same
   * count every relative date in the app uses); null when there is no usable
   * date.
   */
  days: number | null;
}

/**
 * How old the newest audit is, judged at call time (never a stored age).
 *
 * `freshDays` is the server-owned threshold (`auditFreshDays` on the report,
 * the same constant the Actions evidence uses). An audit turns stale once it
 * is strictly older than that many days, matching the server's `freshUntil`.
 * Without a threshold the audit is reported fresh so no prompt is invented.
 * Staleness stays elapsed-time based for server parity; only the displayed
 * day count follows the shared calendar-day rule.
 */
export function auditAge(input: {
  runAt: string | null | undefined;
  running: boolean;
  freshDays: number | undefined;
  now: number;
  /** Viewer zone override for tests. */
  timeZone?: string;
}): AuditAge {
  if (input.running) return { state: 'running', days: null };
  const ranAt = input.runAt ? Date.parse(input.runAt) : Number.NaN;
  if (Number.isNaN(ranAt)) return { state: 'never', days: null };
  const elapsed = Math.max(0, input.now - ranAt);
  const days = Math.max(0, calendarDaysAgo(ranAt, { now: input.now, timeZone: input.timeZone }));
  const stale = input.freshDays !== undefined && elapsed > input.freshDays * DAY_MS;
  return { state: stale ? 'stale' : 'fresh', days };
}
