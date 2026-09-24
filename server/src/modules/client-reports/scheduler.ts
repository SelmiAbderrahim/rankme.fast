import type { Queue } from 'bullmq';
import type { ScheduledReportRow } from '../../db/schema/index.js';
import { CLIENT_REPORT_JOB_NAME, type ClientReportJob, } from '../../shared/queue/index.js';
import { fnv1a32 } from '../weekly-pulse/index.js';
export function clientReportScheduleMinute(scheduleId: string): number {
    if (scheduleId.length === 0)
        throw new Error('schedule id must not be empty');
    return fnv1a32(scheduleId) % 60;
}
export function clientReportSchedulerKey(scheduleId: string): string {
    return `client-report-${scheduleId}`;
}
const CLIENT_REPORT_SCHEDULER_PREFIX = 'client-report-';
export function clientReportCron(schedule: Pick<ScheduledReportRow, 'frequency' | 'weekdayUtc' | 'monthdayUtc' | 'hourUtc' | 'minuteUtc'>): string {
    if (schedule.frequency === 'weekly') {
        if (schedule.weekdayUtc === null)
            throw new Error('weekly schedule needs weekdayUtc');
        return `${schedule.minuteUtc} ${schedule.hourUtc} * * ${schedule.weekdayUtc}`;
    }
    if (schedule.monthdayUtc === null)
        throw new Error('monthly schedule needs monthdayUtc');
    return `${schedule.minuteUtc} ${schedule.hourUtc} ${schedule.monthdayUtc} * *`;
}
export function nextClientReportRunAt(schedule: Pick<ScheduledReportRow, 'frequency' | 'weekdayUtc' | 'monthdayUtc' | 'hourUtc' | 'minuteUtc'>, from: Date): Date {
    if (Number.isNaN(from.getTime()))
        throw new Error('invalid schedule date');
    if (schedule.frequency === 'weekly') {
        if (schedule.weekdayUtc === null)
            throw new Error('weekly schedule needs weekdayUtc');
        const candidate = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), schedule.hourUtc, schedule.minuteUtc));
        let days = schedule.weekdayUtc - from.getUTCDay();
        if (days < 0 || (days === 0 && candidate.getTime() <= from.getTime()))
            days += 7;
        candidate.setUTCDate(candidate.getUTCDate() + days);
        return candidate;
    }
    if (schedule.monthdayUtc === null)
        throw new Error('monthly schedule needs monthdayUtc');
    let year = from.getUTCFullYear();
    let month = from.getUTCMonth();
    let candidate = new Date(Date.UTC(year, month, schedule.monthdayUtc, schedule.hourUtc, schedule.minuteUtc));
    if (candidate.getTime() <= from.getTime()) {
        month += 1;
        if (month > 11) {
            month = 0;
            year += 1;
        }
        candidate = new Date(Date.UTC(year, month, schedule.monthdayUtc, schedule.hourUtc, schedule.minuteUtc));
    }
    return candidate;
}
export async function upsertClientReportScheduler(queue: Queue, schedule: ScheduledReportRow): Promise<void> {
    const scheduledFor = schedule.nextRunAt ?? nextClientReportRunAt(schedule, new Date(0));
    const template: ClientReportJob = {
        accountId: schedule.accountId,
        siteId: schedule.siteId,
        scheduleId: schedule.id,
        runKey: 'template',
        scheduledFor: scheduledFor.toISOString(),
    };
    await queue.upsertJobScheduler(clientReportSchedulerKey(schedule.id), { pattern: clientReportCron(schedule), tz: 'UTC' }, { name: CLIENT_REPORT_JOB_NAME, data: template });
}
export async function removeClientReportScheduler(queue: Queue, scheduleId: string): Promise<boolean> {
    return queue.removeJobScheduler(clientReportSchedulerKey(scheduleId));
}
export async function reconcileClientReportSchedulers(queue: Queue, schedules: readonly ScheduledReportRow[], enabled: boolean): Promise<void> {
    const desiredSchedules = enabled
        ? schedules.filter((schedule) => schedule.enabled)
        : [];
    const desiredKeys = new Set(desiredSchedules.map((schedule) => clientReportSchedulerKey(schedule.id)));
    // Converge queue state from the database instead of only touching rows the
    // database still knows about. A crash between deleting/disabling a row and
    // removing its BullMQ scheduler otherwise leaves an immortal recurring job;
    // the global kill switch must also clear those orphaned schedulers.
    const existingSchedulers = await queue.getJobSchedulers(0, -1, true);
    const existingKeys = new Set(existingSchedulers.map((scheduler) => scheduler.key));
    for (const scheduler of existingSchedulers) {
        if (scheduler.key.startsWith(CLIENT_REPORT_SCHEDULER_PREFIX)
            && !desiredKeys.has(scheduler.key)) {
            await queue.removeJobScheduler(scheduler.key);
        }
    }
    for (const schedule of desiredSchedules) {
        // Recovery must preserve the payload snapshot of an already accepted
        // delayed iteration. User-driven schedule edits still call the explicit
        // upsert path; this periodic reconciler only recreates missing state.
        if (!existingKeys.has(clientReportSchedulerKey(schedule.id))) {
            await upsertClientReportScheduler(queue, schedule);
        }
    }
}
