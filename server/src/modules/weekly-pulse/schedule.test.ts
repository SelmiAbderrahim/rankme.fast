import { describe, expect, it } from 'vitest';

import {
  computeSchedule,
  fnv1a32,
  isoWeekUtc,
  nextRunAt,
} from './schedule.js';

describe('fnv1a32', () => {
  it('is deterministic and non-negative', () => {
    const a = fnv1a32('site-alpha');
    const b = fnv1a32('site-alpha');
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThanOrEqual(0xffffffff);
  });

  it('differs on distinct inputs', () => {
    expect(fnv1a32('a')).not.toBe(fnv1a32('b'));
  });

  it('handles a long input without overflow', () => {
    const long = 'x'.repeat(2048);
    expect(fnv1a32(long)).toBeGreaterThanOrEqual(0);
  });

  it('handles unicode input', () => {
    expect(fnv1a32('site-📈')).not.toBe(fnv1a32('site-📊'));
  });
});

describe('computeSchedule', () => {
  it('is pure — same siteId always yields the same schedule', () => {
    const a = computeSchedule('site-42');
    const b = computeSchedule('site-42');
    expect(a).toEqual(b);
  });

  it('rejects an empty siteId', () => {
    expect(() => computeSchedule('')).toThrow(/must not be empty/);
  });

  it('places every site inside the Mon–Sat 09..14 UTC envelope', () => {
    for (let i = 0; i < 512; i += 1) {
      const schedule = computeSchedule(`stagger-${i}`);
      expect(schedule.weekday).toBeGreaterThanOrEqual(1);
      expect(schedule.weekday).toBeLessThanOrEqual(6);
      expect(schedule.hour).toBeGreaterThanOrEqual(9);
      expect(schedule.hour).toBeLessThanOrEqual(14);
      expect(schedule.minute).toBeGreaterThanOrEqual(0);
      expect(schedule.minute).toBeLessThanOrEqual(59);
      expect(schedule.cron).toBe(
        `${schedule.minute} ${schedule.hour} * * ${schedule.weekday}`,
      );
      expect(schedule.scheduleKey).toBeGreaterThanOrEqual(0);
      expect(schedule.scheduleKey).toBeLessThan(3600);
    }
  });

  it('distributes 10 000 fake site ids across every weekday and hour', () => {
    const weekdays = new Set<number>();
    const hours = new Set<number>();
    const minutes = new Set<number>();
    for (let i = 0; i < 10_000; i += 1) {
      const { weekday, hour, minute } = computeSchedule(
        `site-${i.toString(36)}-abcdef`,
      );
      weekdays.add(weekday);
      hours.add(hour);
      minutes.add(minute);
    }
    // With 10k samples we should see every weekday (6) and every hour (6).
    expect(weekdays.size).toBe(6);
    expect(hours.size).toBe(6);
    // Minute pattern is (schedule_key * 7) mod 60 → gcd(7,60)=1 → covers all 60.
    expect(minutes.size).toBeGreaterThanOrEqual(59);
  });
});

describe('isoWeekUtc', () => {
  it('returns YYYY-Www for a mid-week UTC date', () => {
    // Wednesday 2026-01-07 UTC → ISO week 2026-W02.
    expect(isoWeekUtc(new Date('2026-01-07T00:00:00Z'))).toBe('2026-W02');
  });

  it('respects the ISO 8601 year boundary', () => {
    // 2020-01-01 is a Wednesday → 2020-W01, not 2019-W53.
    expect(isoWeekUtc(new Date('2020-01-01T00:00:00Z'))).toBe('2020-W01');
    // 2016-01-01 is a Friday → belongs to 2015-W53.
    expect(isoWeekUtc(new Date('2016-01-01T00:00:00Z'))).toBe('2015-W53');
    // 2021-01-04 is Monday of 2021-W01.
    expect(isoWeekUtc(new Date('2021-01-04T00:00:00Z'))).toBe('2021-W01');
  });

  it('is a pure function of the UTC timestamp', () => {
    // Two dates that are the same instant expressed differently.
    const utcMidnight = new Date('2026-07-01T00:00:00Z');
    const explicitUtc = new Date(Date.UTC(2026, 6, 1, 0, 0, 0));
    expect(isoWeekUtc(utcMidnight)).toBe(isoWeekUtc(explicitUtc));
  });

  it('keeps a Sunday in the week that just ended, not the one starting', () => {
    // ISO weeks run Mon..Sun, so Sunday is day 7 of the PRECEDING Monday's
    // week — the `getUTCDay() === 0 → 7` remap is what makes that true.
    // Sun 2026-07-19 closes the week opened by Mon 2026-07-13 (2026-W29).
    expect(isoWeekUtc(new Date('2026-07-19T00:00:00Z'))).toBe('2026-W29');
    expect(isoWeekUtc(new Date('2026-07-13T00:00:00Z'))).toBe('2026-W29');
    // The following Monday starts the next week.
    expect(isoWeekUtc(new Date('2026-07-20T00:00:00Z'))).toBe('2026-W30');
  });

  it('rejects invalid dates', () => {
    expect(() => isoWeekUtc(new Date('not-a-date'))).toThrow(/invalid Date/);
  });
});

describe('nextRunAt', () => {
  it('returns a tick strictly greater than the from timestamp', () => {
    const schedule = computeSchedule('site-alpha');
    // Sat 2026-07-18 12:00 UTC — pick any weekday from the schedule.
    const from = new Date('2026-07-18T12:00:00Z');
    const next = nextRunAt(schedule, from);
    expect(next.getTime()).toBeGreaterThan(from.getTime());
    expect(next.getUTCHours()).toBe(schedule.hour);
    expect(next.getUTCMinutes()).toBe(schedule.minute);
    // ISO day of week matches.
    const isoDow = next.getUTCDay() === 0 ? 7 : next.getUTCDay();
    expect(isoDow).toBe(schedule.weekday);
  });

  it('rolls to the following week when today equals the target and time has passed', () => {
    // Force a schedule pinned to Monday 09:00 by hand-picking a siteId whose
    // scheduleKey mod 6 is 0.
    const schedule = { weekday: 1 as const, hour: 9, minute: 0, cron: '', scheduleKey: 0 };
    const from = new Date('2026-07-13T10:00:00Z'); // Mon 10:00 — past 09:00
    const next = nextRunAt(schedule, from);
    expect(next.toISOString()).toBe('2026-07-20T09:00:00.000Z');
  });

  it('returns today when the from timestamp is before today’s cadence tick', () => {
    const schedule = { weekday: 1 as const, hour: 9, minute: 0, cron: '', scheduleKey: 0 };
    const from = new Date('2026-07-13T08:00:00Z'); // Mon 08:00 — before 09:00
    const next = nextRunAt(schedule, from);
    expect(next.toISOString()).toBe('2026-07-13T09:00:00.000Z');
  });

  it('treats a Sunday `from` as day 7, so Monday is one day ahead', () => {
    // Sunday is ISO day 7 — the tick for a Monday-scheduled site is the very
    // next day. Reading Sunday as JS day 0 would wrongly push it a week out.
    const schedule = { weekday: 1 as const, hour: 9, minute: 0, cron: '', scheduleKey: 0 };
    const from = new Date('2026-07-19T23:30:00Z'); // Sunday
    expect(nextRunAt(schedule, from).toISOString()).toBe('2026-07-20T09:00:00.000Z');
  });

  it('rolls a Sunday `from` forward a full week for a Saturday schedule', () => {
    const schedule = { weekday: 6 as const, hour: 14, minute: 30, cron: '', scheduleKey: 0 };
    const from = new Date('2026-07-19T00:00:00Z'); // Sunday
    expect(nextRunAt(schedule, from).toISOString()).toBe('2026-07-25T14:30:00.000Z');
  });

  it('rejects invalid from dates', () => {
    const schedule = computeSchedule('x');
    expect(() => nextRunAt(schedule, new Date('nope'))).toThrow(/invalid from Date/);
  });
});
