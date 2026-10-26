import type { ScheduledReportInput } from './types';

/**
 * `monthdayUtc` sentinel for the explicit "last day of every month" mode. It
 * mirrors the server's `CLIENT_REPORT_LAST_DAY_OF_MONTH`; both sides accept
 * exactly this value or a whole day 1..28 (days 29-31 are not in every month).
 */
export const LAST_DAY_OF_MONTH = -1;
export const MONTHDAY_MIN = 1;
export const MONTHDAY_MAX = 28;

/** True for a whole day 1..28 or the explicit last-day sentinel. */
export function isValidMonthday(day: unknown): day is number {
  return (
    typeof day === 'number' &&
    Number.isInteger(day) &&
    ((day >= MONTHDAY_MIN && day <= MONTHDAY_MAX) || day === LAST_DAY_OF_MONTH)
  );
}

/**
 * Parses the day-of-month field. Only 1-2 plain digits in range count: no
 * signs, decimals, exponents, or empty text. `null` means "show an error".
 */
export function parseMonthdayInput(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,2}$/.test(trimmed)) return null;
  const day = Number(trimmed);
  return day >= MONTHDAY_MIN && day <= MONTHDAY_MAX ? day : null;
}

interface ZonedParts {
  year: number;
  /** 0-based, like `Date`. */
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month) - 1,
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function zoneOffsetMs(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  return Date.UTC(p.year, p.month, p.day, p.hour, p.minute) - Math.floor(instant.getTime() / 60_000) * 60_000;
}

/**
 * The UTC instant of a wall-clock time in `timeZone` — the same two-pass rule
 * as the server's scheduler, including "a time skipped by spring-forward runs
 * one hour later".
 */
export function zonedWallTimeToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const wall = Date.UTC(year, month, day, hour, minute);
  const first = wall - zoneOffsetMs(new Date(wall), timeZone);
  const second = wall - zoneOffsetMs(new Date(first), timeZone);
  const settled = zonedParts(new Date(second), timeZone);
  const target = new Date(wall);
  if (settled.hour === target.getUTCHours() && settled.minute === target.getUTCMinutes()) {
    return new Date(second);
  }
  return new Date(Math.max(first, second));
}

/** The reader's own zone, or UTC when the runtime cannot say. */
export function browserTimeZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return typeof zone === 'string' && zone !== '' ? zone : 'UTC';
}

/**
 * Every zone the runtime knows, UTC first, plus `extra` (a stored or browser
 * zone an older runtime may not list). Sorted for a predictable picker.
 */
export function scheduleTimeZones(extra: readonly string[] = []): string[] {
  const supported =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  const rest = [...new Set([...supported, ...extra])].filter((zone) => zone !== 'UTC').sort();
  return ['UTC', ...rest];
}

/** "America/Argentina/Buenos_Aires" → "Buenos Aires"; "UTC" stays "UTC". */
export function timeZoneCity(zone: string): string {
  return zone.split('/').pop()!.replace(/_/g, ' ');
}

/**
 * The next delivery moment for a schedule written in its own time zone
 *. The weekday and month day are wall-clock values in that zone,
 * and DST moves the UTC instant, never the local time.
 *
 * Returns `null` for a monthly day that is missing, not 1..28, or not the last-day mode:
 * `Date.UTC` would silently roll such a day into the next month (45 became
 * November 14, 0 became the previous month's last day), so it never reaches
 * the preview.
 */
export function nextScheduleOccurrence(
  schedule: Pick<ScheduledReportInput, 'frequency' | 'weekdayUtc' | 'monthdayUtc' | 'localHour' | 'timezone'>,
  now: Date,
  minute = 0,
): Date | null {
  const local = zonedParts(now, schedule.timezone);
  const at = (year: number, month: number, day: number) =>
    zonedWallTimeToUtc(schedule.timezone, year, month, day, schedule.localHour, minute);
  if (schedule.frequency === 'monthly') {
    const day = schedule.monthdayUtc;
    if (!isValidMonthday(day)) return null;
    // Day 0 of the following month is the last day of this one (Feb 28/29
    // included), so the explicit mode needs no month-length table.
    const occurrence = (offset: number): Date =>
      day === LAST_DAY_OF_MONTH
        ? at(local.year, local.month + offset + 1, 0)
        : at(local.year, local.month + offset, day);
    const thisMonth = occurrence(0);
    return thisMonth.getTime() > now.getTime() ? thisMonth : occurrence(1);
  }
  const weekday = schedule.weekdayUtc ?? 1;
  const today = new Date(Date.UTC(local.year, local.month, local.day)).getUTCDay();
  const ahead = (weekday - today + 7) % 7;
  const candidate = at(local.year, local.month, local.day + ahead);
  return candidate.getTime() > now.getTime() ? candidate : at(local.year, local.month, local.day + ahead + 7);
}
