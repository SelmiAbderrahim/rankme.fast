import { afterEach, describe, expect, it, vi } from 'vitest';
import { calendarDaysAgo, formatAbsoluteDate, formatDuration, formatRelativeDate, formatRelativeTime, formatYearMonth, resolveTimeZone } from './datetime';

/** Fixed reference instant so every branch assertion is deterministic. */
const NOW = Date.parse('2026-08-01T12:00:00.000Z');

const isoAt = (offsetSeconds: number): string =>
  new Date(NOW + offsetSeconds * 1000).toISOString();

afterEach(() => {
  vi.restoreAllMocks();
});

describe('formatRelativeTime', () => {
  it('formats sub-minute differences in seconds', () => {
    expect(formatRelativeTime(isoAt(-30), 'en', NOW)).toBe('30 seconds ago');
  });

  it('numeric:auto yields a natural phrase for a zero difference', () => {
    expect(formatRelativeTime(isoAt(0), 'en', NOW)).toBe('now');
  });

  it('formats sub-hour differences in minutes (boundary at 60s)', () => {
    expect(formatRelativeTime(isoAt(-60), 'en', NOW)).toBe('1 minute ago');
    expect(formatRelativeTime(isoAt(5 * 60), 'en', NOW)).toBe('in 5 minutes');
  });

  it('formats sub-day differences in hours (boundary at 3600s)', () => {
    expect(formatRelativeTime(isoAt(-3600), 'en', NOW)).toBe('1 hour ago');
    expect(formatRelativeTime(isoAt(-3 * 3600), 'en', NOW)).toBe('3 hours ago');
  });

  it('formats everything else in days (boundary at 86400s)', () => {
    expect(formatRelativeTime(isoAt(-86_400), 'en', NOW)).toBe('yesterday');
    expect(formatRelativeTime(isoAt(-2 * 86_400), 'en', NOW)).toBe('2 days ago');
    expect(formatRelativeTime(isoAt(2 * 86_400), 'en', NOW)).toBe('in 2 days');
  });

  it('localizes through Intl for non-English locales', () => {
    expect(formatRelativeTime(isoAt(-2 * 86_400), 'fr', NOW)).toBe('avant-hier');
  });

  it('defaults `now` to Date.now() when omitted', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    expect(formatRelativeTime(isoAt(-30), 'en')).toBe('30 seconds ago');
  });
});

describe('calendar-aware date formatting', () => {
  const now = Date.parse('2026-10-06T18:00:00Z');
  const options = { now, timeZone: 'UTC' };

  it.each([['en', 'yesterday'], ['ar', 'أمس'], ['fr', 'hier'], ['de', 'gestern'], ['es', 'ayer'], ['ru', 'вчера'], ['zh', '昨天']])('reads yesterday by calendar date in %s', (locale, expected) => {
    expect(formatRelativeDate('2026-10-05T00:30:00Z', locale, options)).toBe(expected);
  });

  it('uses the viewer timezone at midnight and across daylight-saving changes', () => {
    const midnight = { now: Date.parse('2026-10-05T21:01:00Z'), timeZone: 'Asia/Riyadh' };
    expect(formatRelativeDate('2026-10-05T20:59:00Z', 'en', midnight)).toBe('yesterday');
    expect(formatRelativeDate('2026-10-05T20:59:00Z', 'en', { ...midnight, timeZone: 'UTC' })).toBe('2 minutes ago');
    expect(formatRelativeDate('2026-11-01T04:30:00Z', 'en', { now: Date.parse('2026-11-02T17:00:00Z'), timeZone: 'America/New_York' })).toBe('yesterday');
    expect(formatRelativeDate('2026-03-08T04:30:00Z', 'en', { now: Date.parse('2026-03-09T03:00:00Z'), timeZone: 'America/New_York' })).toBe('yesterday');
  });

  it('supports date-only values, future dates and day-granularity observations', () => {
    expect(formatRelativeDate('2026-10-06', 'en', { ...options, timeZone: 'America/Los_Angeles' })).toBe('today');
    expect(formatRelativeDate('2026-10-05', 'en', { ...options, timeZone: 'America/Los_Angeles' })).toBe('yesterday');
    expect(formatRelativeDate('2026-10-07T01:00:00Z', 'en', options)).toBe('tomorrow');
    expect(formatRelativeDate('2026-10-06T17:00:00Z', 'en', { ...options, granularity: 'day' })).toBe('today');
    expect(calendarDaysAgo('2026-10-08', options)).toBe(-2);
  });

  it('accepts Date and epoch values and defaults the clock and zone', () => {
    vi.spyOn(Date, 'now').mockReturnValue(now);
    expect(formatRelativeDate(new Date('2026-10-05T12:00:00Z'), 'en', { timeZone: 'UTC' })).toBe('yesterday');
    expect(formatRelativeDate(now - 30_000, 'en', options)).toBe('30 seconds ago');
    expect(calendarDaysAgo(now)).toBe(0);
    const browserZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(resolveTimeZone()).toBe(browserZone);
    expect(resolveTimeZone('Not/AZone')).toBe(browserZone);
    expect(resolveTimeZone('Asia/Riyadh')).toBe('Asia/Riyadh');
  });

  it('formats exact dates and preserves date-only values in every timezone', () => {
    expect(formatAbsoluteDate('2026-10-05T21:30:00Z', 'en', { timeZone: 'Asia/Riyadh' })).toBe('Oct 6, 2026');
    expect(formatAbsoluteDate('2026-10-05T21:30:00Z', 'en', { timeZone: 'UTC', withTime: true })).toBe('Oct 5, 2026, 9:30 PM');
    expect(formatAbsoluteDate('2026-10-05', 'de', { timeZone: 'America/Los_Angeles', withTime: true })).toBe('05.10.2026');
    expect(formatAbsoluteDate(now, 'en')).toContain('2026');
    expect(formatYearMonth(2026, 10, 'zh')).toBe('2026年10月');
    expect(formatYearMonth(2027, 1, 'en')).toBe('Jan 2027');
  });

  it('formats elapsed durations with localized unit names', () => {
    expect(formatDuration(-10, 'en')).toBe('0 sec');
    expect(formatDuration(45_000, 'en')).toBe('45 sec');
    expect(formatDuration(120_000, 'en')).toBe('2 min');
    expect(formatDuration(3_600_000, 'en')).toBe('1 hr');
    expect(formatDuration(3_900_000, 'en')).toBe('1 hr 5 min');
  });
});
