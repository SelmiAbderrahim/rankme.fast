import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  browserTimeZone,
  isValidMonthday,
  nextScheduleOccurrence,
  parseMonthdayInput,
  scheduleTimeZones,
  timeZoneCity,
  zonedWallTimeToUtc,
} from './scheduleTime';

// 2026-09-29 is a Tuesday (UTC day 2).
const now = new Date('2026-09-29T10:30:00.000Z');

describe('nextScheduleOccurrence', () => {
  it('finds the next weekly slot later this week, today, or a week out', () => {
    const weekly = { frequency: 'weekly' as const, monthdayUtc: null };
    expect(
      nextScheduleOccurrence({ ...weekly, weekdayUtc: 4, timezone: 'UTC', localHour: 9 }, now)!.toISOString(),
    ).toBe('2026-10-01T09:00:00.000Z');
    expect(
      nextScheduleOccurrence({ ...weekly, weekdayUtc: 2, timezone: 'UTC', localHour: 15 }, now)!.toISOString(),
    ).toBe('2026-09-29T15:00:00.000Z');
    expect(
      nextScheduleOccurrence({ ...weekly, weekdayUtc: 2, timezone: 'UTC', localHour: 9 }, now)!.toISOString(),
    ).toBe('2026-10-06T09:00:00.000Z');
    expect(
      nextScheduleOccurrence({ ...weekly, weekdayUtc: null, timezone: 'UTC', localHour: 9 }, now)!.toISOString(),
    ).toBe('2026-10-05T09:00:00.000Z');
  });

  it('finds the next monthly slot this month or next month', () => {
    const monthly = { frequency: 'monthly' as const, weekdayUtc: null };
    expect(
      nextScheduleOccurrence({ ...monthly, monthdayUtc: 28, timezone: 'UTC', localHour: 12 }, now)!.toISOString(),
    ).toBe('2026-10-28T12:00:00.000Z');
    expect(nextScheduleOccurrence({ ...monthly, monthdayUtc: 29, timezone: 'UTC', localHour: 12 }, now)).toBeNull();
    expect(
      nextScheduleOccurrence({ ...monthly, monthdayUtc: 1, timezone: 'UTC', localHour: 9 }, now)!.toISOString(),
    ).toBe('2026-10-01T09:00:00.000Z');
    // A monthly schedule without a day has no occurrence (it used to default to 1).
    expect(nextScheduleOccurrence({ ...monthly, monthdayUtc: null, timezone: 'UTC', localHour: 9 }, now)).toBeNull();
  });

  it('never rolls an out-of-range day into another month', () => {
    const monthly = { frequency: 'monthly' as const, weekdayUtc: null, timezone: 'UTC', localHour: 10 };
    for (const monthdayUtc of [0, 29, 31, 45, -2, 1.5, Number.NaN]) {
      expect(nextScheduleOccurrence({ ...monthly, monthdayUtc }, now)).toBeNull();
    }
  });

  it('schedules the explicit last-day mode, including February and leap years', () => {
    const lastDay = {
      frequency: 'monthly' as const,
      weekdayUtc: null,
      monthdayUtc: -1,
      timezone: 'UTC', localHour: 10,
    };
    const next = (iso: string) => nextScheduleOccurrence(lastDay, new Date(iso))?.toISOString();
    expect(next('2026-09-29T10:30:00.000Z')).toBe('2026-09-30T10:00:00.000Z');
    expect(next('2026-09-30T10:00:00.000Z')).toBe('2026-10-31T10:00:00.000Z');
    expect(next('2026-01-31T11:00:00.000Z')).toBe('2026-02-28T10:00:00.000Z');
    expect(next('2028-02-01T00:00:00.000Z')).toBe('2028-02-29T10:00:00.000Z');
    expect(next('2100-02-01T00:00:00.000Z')).toBe('2100-02-28T10:00:00.000Z');
    expect(next('2026-12-31T23:00:00.000Z')).toBe('2027-01-31T10:00:00.000Z');
  });

  it('keeps the 1 and 28 boundaries on their own calendar day', () => {
    const monthly = { frequency: 'monthly' as const, weekdayUtc: null, timezone: 'UTC', localHour: 10 };
    expect(
      nextScheduleOccurrence(
        { ...monthly, monthdayUtc: 28 },
        new Date('2026-01-29T00:00:00.000Z'),
      )?.toISOString(),
    ).toBe('2026-02-28T10:00:00.000Z');
    expect(
      nextScheduleOccurrence(
        { ...monthly, monthdayUtc: 1 },
        new Date('2026-12-01T10:00:00.000Z'),
      )?.toISOString(),
    ).toBe('2027-01-01T10:00:00.000Z');
  });
});

describe('isValidMonthday / parseMonthdayInput', () => {
  it('accepts exactly 1..28 and the last-day sentinel', () => {
    for (const day of [1, 2, 27, 28, -1]) expect(isValidMonthday(day)).toBe(true);
    for (const day of [0, 29, 31, 45, -2, 1.5, Number.NaN, '12', null, undefined]) {
      expect(isValidMonthday(day)).toBe(false);
    }
  });

  it('parses plain whole days only', () => {
    expect(parseMonthdayInput(' 7 ')).toBe(7);
    expect(parseMonthdayInput('28')).toBe(28);
    expect(parseMonthdayInput('01')).toBe(1);
    for (const text of ['', ' ', '0', '29', '45', '-1', '1.5', '1e1', 'abc', '100', '+3']) {
      expect(parseMonthdayInput(text)).toBeNull();
    }
  });
});

describe('time zones', () => {
  afterEach(() => vi.restoreAllMocks());
  const weekly = (timezone: string, localHour = 9, weekdayUtc = 1) => ({
    frequency: 'weekly' as const,
    weekdayUtc,
    monthdayUtc: null,
    timezone,
    localHour,
  });
  const iso = (value: Date | null) => value!.toISOString();

  it('keeps Riyadh (no DST) at a fixed UTC hour and New York at 09:00 local across DST', () => {
    expect(iso(nextScheduleOccurrence(weekly('Asia/Riyadh'), new Date('2026-03-04T00:00:00Z')))).toBe('2026-03-09T06:00:00.000Z');
    expect(iso(nextScheduleOccurrence(weekly('America/New_York'), new Date('2026-03-01T00:00:00Z')))).toBe('2026-03-02T14:00:00.000Z');
    expect(iso(nextScheduleOccurrence(weekly('America/New_York'), new Date('2026-03-03T00:00:00Z')))).toBe('2026-03-09T13:00:00.000Z');
    expect(iso(nextScheduleOccurrence(weekly('America/New_York'), new Date('2026-10-27T00:00:00Z')))).toBe('2026-11-02T14:00:00.000Z');
  });

  it('walks the local calendar and passes a slot that already went by today', () => {
    expect(iso(nextScheduleOccurrence(weekly('Asia/Riyadh', 1), new Date('2026-10-18T12:00:00Z')))).toBe('2026-10-18T22:00:00.000Z');
    expect(iso(nextScheduleOccurrence(weekly('Asia/Riyadh', 1), new Date('2026-10-18T23:00:00Z')))).toBe('2026-10-25T22:00:00.000Z');
    const monthly = { frequency: 'monthly' as const, weekdayUtc: null, monthdayUtc: 1, timezone: 'Asia/Riyadh', localHour: 1 };
    expect(iso(nextScheduleOccurrence(monthly, new Date('2026-10-15T00:00:00Z')))).toBe('2026-10-31T22:00:00.000Z');
    expect(iso(nextScheduleOccurrence(weekly('Asia/Kolkata', 9), new Date('2026-10-18T00:00:00Z'), 15))).toBe('2026-10-19T03:45:00.000Z');
  });

  it('moves a wall time skipped by spring-forward one hour later', () => {
    expect(zonedWallTimeToUtc('America/New_York', 2026, 2, 8, 2, 30).toISOString()).toBe('2026-03-08T07:30:00.000Z');
    expect(zonedWallTimeToUtc('Europe/London', 2026, 6, 1, 9, 0).toISOString()).toBe('2026-07-01T08:00:00.000Z');
  });

  it('lists UTC first, sorted zones after it, and keeps extra zones the runtime omits', () => {
    const zones = scheduleTimeZones(['Asia/Riyadh', 'Legacy/Zone']);
    expect(zones[0]).toBe('UTC');
    expect(zones).toContain('Asia/Riyadh');
    expect(zones).toContain('Legacy/Zone');
    expect(zones.filter((zone) => zone === 'UTC')).toHaveLength(1);
    expect([...zones.slice(1)].sort()).toEqual(zones.slice(1));
  });

  it('falls back to the given zones when Intl cannot list them', () => {
    const original = Intl.supportedValuesOf;
    Object.defineProperty(Intl, 'supportedValuesOf', { value: undefined, configurable: true });
    try {
      expect(scheduleTimeZones(['Asia/Riyadh'])).toEqual(['UTC', 'Asia/Riyadh']);
      expect(scheduleTimeZones()).toEqual(['UTC']);
    } finally {
      Object.defineProperty(Intl, 'supportedValuesOf', { value: original, configurable: true });
    }
  });

  it('names the city of a zone and the reader zone, with a UTC fallback', () => {
    expect(timeZoneCity('America/Argentina/Buenos_Aires')).toBe('Buenos Aires');
    expect(timeZoneCity('UTC')).toBe('UTC');
    expect(browserTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ timeZone: '' } as Intl.ResolvedDateTimeFormatOptions);
    expect(browserTimeZone()).toBe('UTC');
  });
});
