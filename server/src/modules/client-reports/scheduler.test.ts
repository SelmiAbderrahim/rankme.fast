import type { Queue } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import type { ScheduledReportRow } from '../../db/schema/index.js';
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
    hourUtc: 11,
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
