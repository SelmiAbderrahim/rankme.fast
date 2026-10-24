import { resolveTimeZone } from './datetime';

const DAY_MS = 86_400_000;
/** Parse a calendar day at UTC midnight, rejecting rollover dates. */
export function parseDateOnly(value: string | null | undefined): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const time = Date.UTC(year!, month! - 1, day!);
  return toDateOnly(time) === value ? time : null;
}
export function toDateOnly(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}
export function addDays(time: number, days: number): number {
  return time + days * DAY_MS;
}
export function addMonths(time: number, months: number): number {
  const date = new Date(time);
  const target = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1);
  const last = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months + 1, 0),
  ).getUTCDate();
  return addDays(target, Math.min(date.getUTCDate(), last) - 1);
}
export function startOfMonth(time: number): number {
  const date = new Date(time);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}
export function isSameMonth(a: number, b: number): boolean {
  const left = new Date(a),
    right = new Date(b);
  return (
    left.getUTCFullYear() === right.getUTCFullYear() && left.getUTCMonth() === right.getUTCMonth()
  );
}
/** Today's calendar day in the viewer's time zone, represented at UTC midnight. */
export function todayDateOnly(now = Date.now(), timeZone?: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: resolveTimeZone(timeZone),
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
}
export function clampDateOnly(time: number, min: number | null, max: number | null): number {
  if (min !== null && time < min) return min;
  if (max !== null && time > max) return max;
  return time;
}
type WeekInfoLocale = { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } };
/** Browser CLDR week starts as a Date weekday index; Monday is the fallback. */
export function firstDayOfWeek(locale: string): number {
  let firstDay = 1;
  try {
    const value = new Intl.Locale(locale) as Intl.Locale & WeekInfoLocale;
    firstDay = value.getWeekInfo?.().firstDay ?? value.weekInfo?.firstDay ?? 1;
  } catch {
    /* Keep the default for invalid locale tags. */
  }
  return firstDay % 7;
}
