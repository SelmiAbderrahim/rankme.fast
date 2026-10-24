/** Stored instants use the viewer's calendar; date-only values never shift. */
const DAY_MS = 86_400_000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
export type DateInput = string | number | Date;

export interface DateOptions {
  now?: number;
  timeZone?: string;
  granularity?: 'day';
}

export function resolveTimeZone(timeZone?: string): string {
  if (timeZone) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone });
      return timeZone;
    } catch {
      // Unsupported zones use the viewer's resolved zone.
    }
  }
  return new Intl.DateTimeFormat().resolvedOptions().timeZone;
}

const isDateOnly = (value: DateInput): value is string => typeof value === 'string' && DATE_ONLY.test(value);
const toInstant = (value: DateInput): number => value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
const dayPartFormatters = new Map<string, Intl.DateTimeFormat>();

function zonedDayNumber(instant: number, timeZone: string): number {
  let formatter = dayPartFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' });
    dayPartFormatters.set(timeZone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(instant).map((part) => [part.type, part.value]));
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) / DAY_MS;
}

/** Positive for past calendar dates, negative for future calendar dates. */
export function calendarDaysAgo(value: DateInput, options: DateOptions = {}): number {
  const timeZone = resolveTimeZone(options.timeZone);
  const then = isDateOnly(value) ? Date.parse(`${value}T00:00:00.000Z`) / DAY_MS : zonedDayNumber(toInstant(value), timeZone);
  return zonedDayNumber(options.now ?? Date.now(), timeZone) - then;
}

export function formatRelativeDate(value: DateInput, locale: string, options: DateOptions = {}): string {
  const now = options.now ?? Date.now();
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const days = -calendarDaysAgo(value, { ...options, now });
  if (days !== 0 || isDateOnly(value) || options.granularity === 'day') return format.format(days, 'day');
  const seconds = Math.round((toInstant(value) - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return format.format(seconds, 'second');
  if (abs < 3600) return format.format(Math.round(seconds / 60), 'minute');
  return format.format(Math.round(seconds / 3600), 'hour');
}

/** Preserve existing consumers while sharing the calendar-aware authority. */
export function formatRelativeTime(iso: string, locale: string, now: number = Date.now()): string {
  return formatRelativeDate(iso, locale, { now });
}

export interface AbsoluteDateOptions {
  timeZone?: string;
  withTime?: boolean;
}

export function formatAbsoluteDate(value: DateInput, locale: string, options: AbsoluteDateOptions = {}): string {
  if (isDateOnly(value)) {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(Date.parse(`${value}T00:00:00.000Z`));
  }
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    ...(options.withTime ? { timeStyle: 'short' as const } : {}),
    timeZone: resolveTimeZone(options.timeZone),
  }).format(toInstant(value));
}

export function formatYearMonth(year: number, month: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(Date.UTC(year, month - 1, 1));
}

/** Elapsed job durations use localized seconds, minutes and hours. */
export function formatDuration(ms: number, locale: string): string {
  const unit = (value: number, name: 'second' | 'minute' | 'hour') => new Intl.NumberFormat(locale, { style: 'unit', unit: name, unitDisplay: 'short' }).format(value);
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return unit(seconds, 'second');
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return unit(minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? unit(hours, 'hour') : new Intl.ListFormat(locale, { style: 'narrow', type: 'unit' }).format([unit(hours, 'hour'), unit(rest, 'minute')]);
}
