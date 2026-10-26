import type { Queue } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import {
  CLIENT_REPORT_LAST_DAY_OF_MONTH,
  type ScheduledReportRow,
} from '../../db/schema/index.js';
import { clientReportJobId } from '../../shared/queue/index.js';
import {
  clientReportCron,
  clientReportScheduleMinute,
  clientReportSchedulerKey,
  nextClientReportRunAt,
  reconcileClientReportSchedulers,
  removeClientReportScheduler,
  upsertClientReportScheduler,
} from './scheduler.js';

function row(overrides: Partial<ScheduledReportRow> = {}): ScheduledReportRow {
  return {
    id: '3f918d5c-2f24-4a78-a82e-adf466d53ee5',
    accountId: '000000000000000000000001',
    siteId: '000000000000000000000002',
    name: 'Client report',
    frequency: 'weekly',
    weekdayUtc: 2,
    monthdayUtc: null,
    timezone: 'UTC',
    localHour: 11,
    minuteUtc: 37,
    locale: 'en',
    recipients: ['client@example.test'],
    sections: { audit: true, ranks: true, gsc: true },
    enabled: true,
    nextRunAt: new Date('2026-07-28T11:37:00.000Z'),
    lastRunAt: null,
    createdAt: new Date('2026-07-20T00:00:00.000Z'),
    updatedAt: new Date('2026-07-20T00:00:00.000Z'),
    ...overrides,
  };
}

describe('client report scheduler', () => {
  it('derives a stable minute and weekly/monthly UTC cron', () => {
    const id = row().id;
    expect(clientReportScheduleMinute(id)).toBe(clientReportScheduleMinute(id));
    expect(clientReportScheduleMinute(id)).toBeGreaterThanOrEqual(0);
    expect(clientReportScheduleMinute(id)).toBeLessThan(60);
    expect(() => clientReportScheduleMinute('')).toThrow();
    expect(clientReportCron(row())).toBe('37 11 * * 2');
    expect(clientReportCron(row({
      frequency: 'monthly',
      weekdayUtc: null,
      monthdayUtc: 14,
    }))).toBe('37 11 14 * *');
  });

  it('calculates the next weekly and monthly ticks strictly after the input', () => {
    expect(nextClientReportRunAt(
      row(),
      new Date('2026-07-28T11:37:00.000Z'),
    ).toISOString()).toBe('2026-08-04T11:37:00.000Z');
    expect(nextClientReportRunAt(
      row({ frequency: 'monthly', weekdayUtc: null, monthdayUtc: 14 }),
      new Date('2026-07-14T11:37:00.000Z'),
    ).toISOString()).toBe('2026-08-14T11:37:00.000Z');
    expect(nextClientReportRunAt(
      row({ weekdayUtc: 1 }),
      new Date('2026-07-28T09:00:00.000Z'),
    ).toISOString()).toBe('2026-08-03T11:37:00.000Z');
    expect(nextClientReportRunAt(
      row({ weekdayUtc: 2 }),
      new Date('2026-07-28T09:00:00.000Z'),
    ).toISOString()).toBe('2026-07-28T11:37:00.000Z');
    expect(nextClientReportRunAt(
      row({ frequency: 'monthly', weekdayUtc: null, monthdayUtc: 20 }),
      new Date('2026-07-14T11:37:00.000Z'),
    ).toISOString()).toBe('2026-07-20T11:37:00.000Z');
    expect(nextClientReportRunAt(
      row({ frequency: 'monthly', weekdayUtc: null, monthdayUtc: 14 }),
      new Date('2026-12-14T11:37:00.000Z'),
    ).toISOString()).toBe('2027-01-14T11:37:00.000Z');
  });

  it('schedules the explicit last-day mode through cron L and the same calendar math', () => {
    const lastDay = (overrides: Partial<ScheduledReportRow> = {}) => row({
      frequency: 'monthly',
      weekdayUtc: null,
      monthdayUtc: CLIENT_REPORT_LAST_DAY_OF_MONTH,
      ...overrides,
    });
    expect(clientReportCron(lastDay())).toBe('37 11 L * *');
    const next = (from: string) => nextClientReportRunAt(lastDay(), new Date(from)).toISOString();
    // Mid-month: this month's last day, 30- and 31-day months alike.
    expect(next('2026-01-10T00:00:00.000Z')).toBe('2026-01-31T11:37:00.000Z');
    expect(next('2026-04-10T00:00:00.000Z')).toBe('2026-04-30T11:37:00.000Z');
    // February: 28 days, then 29 in a leap year; century rules hold.
    expect(next('2026-01-31T11:37:00.000Z')).toBe('2026-02-28T11:37:00.000Z');
    expect(next('2028-02-01T00:00:00.000Z')).toBe('2028-02-29T11:37:00.000Z');
    expect(next('2100-02-01T00:00:00.000Z')).toBe('2100-02-28T11:37:00.000Z');
    expect(next('2000-02-01T00:00:00.000Z')).toBe('2000-02-29T11:37:00.000Z');
    // Strictly after the input: a tick at the exact moment rolls forward.
    expect(next('2026-04-30T11:37:00.000Z')).toBe('2026-05-31T11:37:00.000Z');
    expect(next('2026-04-30T12:00:00.000Z')).toBe('2026-05-31T11:37:00.000Z');
    // December rolls into January of the next year.
    expect(next('2026-12-31T11:37:00.000Z')).toBe('2027-01-31T11:37:00.000Z');
  });

  it('keeps day 1 and day 28 on their own calendar day in every month', () => {
    const monthly = (day: number) => row({ frequency: 'monthly', weekdayUtc: null, monthdayUtc: day });
    expect(nextClientReportRunAt(monthly(1), new Date('2026-01-01T11:37:00.000Z')).toISOString())
      .toBe('2026-02-01T11:37:00.000Z');
    expect(nextClientReportRunAt(monthly(28), new Date('2026-01-29T00:00:00.000Z')).toISOString())
      .toBe('2026-02-28T11:37:00.000Z');
  });

  it('rejects an invalid date and schedules missing their cadence field', () => {
    expect(() => nextClientReportRunAt(row(), new Date(Number.NaN))).toThrow('invalid schedule date');
    expect(() => nextClientReportRunAt(row({ weekdayUtc: null }), new Date())).toThrow('weekly schedule needs weekdayUtc');
    expect(() => nextClientReportRunAt(row({ frequency: 'monthly', weekdayUtc: null, monthdayUtc: null }), new Date()))
      .toThrow('monthly schedule needs monthdayUtc');
  });

  describe('time zones', () => {
    const zoned = (timezone: string, overrides: Partial<ScheduledReportRow> = {}) =>
      row({ timezone, weekdayUtc: 1, localHour: 9, minuteUtc: 0, ...overrides });
    const next = (schedule: ScheduledReportRow, from: string) =>
      nextClientReportRunAt(schedule, new Date(from)).toISOString();

    it('builds the cron in the schedule zone and hands BullMQ that zone', async () => {
      expect(clientReportCron(zoned('Asia/Riyadh'))).toBe('0 9 * * 1');
      const queue = { upsertJobScheduler: vi.fn(async () => ({})) } as unknown as Queue;
      await upsertClientReportScheduler(queue, zoned('Asia/Riyadh'));
      const [, repeat] = vi.mocked(queue.upsertJobScheduler).mock.calls[0]!;
      expect(repeat).toEqual({ pattern: '0 9 * * 1', tz: 'Asia/Riyadh' });
    });

    it('keeps Monday 09:00 Riyadh at 06:00 UTC all year (no DST)', () => {
      const riyadh = zoned('Asia/Riyadh');
      expect(next(riyadh, '2026-03-04T00:00:00.000Z')).toBe('2026-03-09T06:00:00.000Z');
      expect(next(riyadh, '2026-11-02T05:59:00.000Z')).toBe('2026-11-02T06:00:00.000Z');
      expect(next(riyadh, '2026-11-02T06:00:00.000Z')).toBe('2026-11-09T06:00:00.000Z');
    });

    it('follows New York across both DST changes so 09:00 stays 09:00 local', () => {
      const newYork = zoned('America/New_York');
      // Before spring-forward (EST, UTC-5) and after it (EDT, UTC-4): 2026-03-08.
      expect(next(newYork, '2026-03-03T00:00:00.000Z')).toBe('2026-03-09T13:00:00.000Z');
      expect(next(newYork, '2026-03-01T00:00:00.000Z')).toBe('2026-03-02T14:00:00.000Z');
      // Fall-back on 2026-11-01: EDT Monday Oct 26, EST Monday Nov 2.
      expect(next(newYork, '2026-10-20T00:00:00.000Z')).toBe('2026-10-26T13:00:00.000Z');
      expect(next(newYork, '2026-10-27T00:00:00.000Z')).toBe('2026-11-02T14:00:00.000Z');
    });

    it('walks the local calendar, not the UTC one, for weekday and month day', () => {
      // Monday 01:00 in Riyadh is Sunday 22:00 UTC.
      const early = zoned('Asia/Riyadh', { localHour: 1 });
      expect(next(early, '2026-10-18T12:00:00.000Z')).toBe('2026-10-18T22:00:00.000Z');
      // From Sunday 23:00 UTC it is already Monday 02:00 in Riyadh: next week.
      expect(next(early, '2026-10-18T23:00:00.000Z')).toBe('2026-10-25T22:00:00.000Z');
      // The 1st at 01:00 in Riyadh is the last day of the previous month in UTC.
      const monthly = zoned('Asia/Riyadh', {
        frequency: 'monthly', weekdayUtc: null, monthdayUtc: 1, localHour: 1,
      });
      expect(next(monthly, '2026-10-15T00:00:00.000Z')).toBe('2026-10-31T22:00:00.000Z');
      const lastDay = zoned('Australia/Sydney', {
        frequency: 'monthly', weekdayUtc: null, monthdayUtc: CLIENT_REPORT_LAST_DAY_OF_MONTH,
      });
      // Sydney is on AEDT (UTC+11) on 2026-10-31.
      expect(next(lastDay, '2026-10-05T00:00:00.000Z')).toBe('2026-10-30T22:00:00.000Z');
    });

    it('moves a wall time skipped by spring-forward one hour later, and keeps minutes', () => {
      // 02:30 does not exist in New York on 2026-03-08 (Sunday = 0).
      const gap = zoned('America/New_York', { weekdayUtc: 0, localHour: 2, minuteUtc: 30 });
      expect(next(gap, '2026-03-07T00:00:00.000Z')).toBe('2026-03-08T07:30:00.000Z');
      // Half-hour zones keep their offset minutes (India, UTC+5:30).
      const kolkata = zoned('Asia/Kolkata', { minuteUtc: 15 });
      expect(next(kolkata, '2026-10-18T00:00:00.000Z')).toBe('2026-10-19T03:45:00.000Z');
    });
  });

  it('reuses BullMQ upsert/remove with a stable colon-free key and payload', async () => {
    const queue = {
      upsertJobScheduler: vi.fn(async () => ({})),
      removeJobScheduler: vi.fn(async () => true),
    } as unknown as Queue;
    const schedule = row();
    await upsertClientReportScheduler(queue, schedule);
    await upsertClientReportScheduler(queue, { ...schedule, nextRunAt: null });
    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(2);
    const [key, repeat, template] = vi.mocked(queue.upsertJobScheduler).mock.calls[0]!;
    expect(key).toBe(clientReportSchedulerKey(schedule.id));
    expect(key).not.toContain(':');
    expect(repeat).toEqual({ pattern: '37 11 * * 2', tz: 'UTC' });
    expect(template).toMatchObject({
      name: 'client-report',
      data: {
        scheduleId: schedule.id,
        runKey: 'template',
        scheduledFor: schedule.nextRunAt!.toISOString(),
      },
    });
    expect(clientReportJobId(schedule.id, '202607281137')).not.toContain(':');
    await expect(removeClientReportScheduler(queue, schedule.id)).resolves.toBe(true);
    expect(queue.removeJobScheduler).toHaveBeenCalledWith(key);
  });

  it('rehydrates missing schedulers without rewriting accepted iterations', async () => {
    const schedules = [row(), row({ id: '15274364-dcf8-41a3-8796-b30778aa83a8' })];
    const queue = {
      upsertJobScheduler: vi.fn(async () => ({})),
      removeJobScheduler: vi.fn(async () => true),
      getJobSchedulers: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(schedules.map((schedule) => ({
          key: clientReportSchedulerKey(schedule.id),
          name: 'client-report',
        }))),
    } as unknown as Queue;

    await reconcileClientReportSchedulers(queue, schedules, true);
    await reconcileClientReportSchedulers(queue, schedules, true);
    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(2);
    expect(queue.removeJobScheduler).not.toHaveBeenCalled();

    vi.mocked(queue.upsertJobScheduler).mockClear();
    vi.mocked(queue.getJobSchedulers).mockResolvedValueOnce(schedules.map((schedule) => ({
      key: clientReportSchedulerKey(schedule.id),
      name: 'client-report',
    })));
    await reconcileClientReportSchedulers(queue, schedules, false);
    expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
    expect(queue.removeJobScheduler).toHaveBeenNthCalledWith(
      1,
      clientReportSchedulerKey(schedules[0]!.id),
    );
    expect(queue.removeJobScheduler).toHaveBeenNthCalledWith(
      2,
      clientReportSchedulerKey(schedules[1]!.id),
    );
  });

  it('removes orphaned report schedulers while preserving desired and unrelated jobs', async () => {
    const schedule = row();
    const orphanKey = clientReportSchedulerKey('15274364-dcf8-41a3-8796-b30778aa83a8');
    const queue = {
      upsertJobScheduler: vi.fn(async () => ({})),
      removeJobScheduler: vi.fn(async () => true),
      getJobSchedulers: vi.fn(async () => [
        { key: clientReportSchedulerKey(schedule.id), name: 'client-report' },
        { key: orphanKey, name: 'client-report' },
        { key: 'another-feature-scheduler', name: 'unrelated' },
      ]),
    } as unknown as Queue;

    await reconcileClientReportSchedulers(queue, [schedule], true);

    expect(queue.removeJobScheduler).toHaveBeenCalledTimes(1);
    expect(queue.removeJobScheduler).toHaveBeenCalledWith(orphanKey);
    expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
  });

  it('rejects impossible cadence shapes and invalid clocks', () => {
    expect(() => clientReportCron(row({ weekdayUtc: null }))).toThrow();
    expect(() => clientReportCron(row({
      frequency: 'monthly',
      weekdayUtc: null,
      monthdayUtc: null,
    }))).toThrow();
    expect(() => nextClientReportRunAt(row(), new Date('invalid'))).toThrow();
    expect(() => nextClientReportRunAt(row({ weekdayUtc: null }), new Date())).toThrow();
    expect(() => nextClientReportRunAt(row({
      frequency: 'monthly',
      weekdayUtc: null,
      monthdayUtc: null,
    }), new Date())).toThrow();
  });
});
