import type { Queue } from 'bullmq';
import { CLIENT_REPORT_LAST_DAY_OF_MONTH, type ScheduledReportRow } from '../../db/schema/index.js';
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
type ScheduleTiming = Pick<ScheduledReportRow, 'frequency' | 'weekdayUtc' | 'monthdayUtc' | 'localHour' | 'minuteUtc' | 'timezone'>;
/**
 * Cron pattern in the schedule's own zone. BullMQ evaluates it with
 * `tz: schedule.timezone`, so the zone's DST rules move the UTC instant and the
 * local wall-clock time stays put. `weekdayUtc` / `monthdayUtc` are wall-clock
 * values in that zone despite their historical column names.
 */
export function clientReportCron(schedule: ScheduleTiming): string {
    if (schedule.frequency === 'weekly') {
        if (schedule.weekdayUtc === null)
            throw new Error('weekly schedule needs weekdayUtc');
        return `${schedule.minuteUtc} ${schedule.localHour} * * ${schedule.weekdayUtc}`;
    }
    if (schedule.monthdayUtc === null)
        throw new Error('monthly schedule needs monthdayUtc');
    const dayOfMonth = schedule.monthdayUtc === CLIENT_REPORT_LAST_DAY_OF_MONTH ? 'L' : schedule.monthdayUtc;
    return `${schedule.minuteUtc} ${schedule.localHour} ${dayOfMonth} * *`;
}
interface ZonedParts {
    year: number;
    /** 0-based, like `Date`. */
    month: number;
    day: number;
    hour: number;
    minute: number;
}
const zonedFormatters = new Map<string, Intl.DateTimeFormat>();
function zonedParts(instant: Date, timeZone: string): ZonedParts {
    let formatter = zonedFormatters.get(timeZone);
    if (!formatter) {
        formatter = new Intl.DateTimeFormat('en-US', {
            timeZone,
            hourCycle: 'h23',
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
        });
        zonedFormatters.set(timeZone, formatter);
    }
    const parts = Object.fromEntries(formatter.formatToParts(instant).map((part) => [part.type, part.value]));
    return {
        year: Number(parts.year),
        month: Number(parts.month) - 1,
        day: Number(parts.day),
        hour: Number(parts.hour),
        minute: Number(parts.minute),
    };
}
/** Milliseconds the zone is ahead of UTC at `instant` (whole minutes). */
function zoneOffsetMs(instant: Date, timeZone: string): number {
    const p = zonedParts(instant, timeZone);
    const asUtc = Date.UTC(p.year, p.month, p.day, p.hour, p.minute);
    return asUtc - Math.floor(instant.getTime() / 60_000) * 60_000;
}
/**
 * The UTC instant of a wall-clock time in `timeZone`. Two passes settle the
 * offset on either side of a DST change; a time skipped by a spring-forward
 * gap lands one offset later (09:30 that does not exist runs at 10:30).
 */
export function zonedWallTimeToUtc(timeZone: string, year: number, month: number, day: number, hour: number, minute: number): Date {
    const wall = Date.UTC(year, month, day, hour, minute);
    const first = wall - zoneOffsetMs(new Date(wall), timeZone);
    const second = wall - zoneOffsetMs(new Date(first), timeZone);
    const settled = zonedParts(new Date(second), timeZone);
    const target = new Date(wall);
    if (settled.hour === target.getUTCHours() && settled.minute === target.getUTCMinutes()) {
        return new Date(second);
    }
    // Inside a spring-forward gap the two passes straddle the missing hour.
    return new Date(Math.max(first, second));
}
/**
 * Next send strictly after `from`, honouring the schedule's zone and its DST
 * rules. The calendar walk runs on the zone's local date, so "Monday 09:00
 * Riyadh" is Monday in Riyadh even when that is Sunday in UTC.
 */
export function nextClientReportRunAt(schedule: ScheduleTiming, from: Date): Date {
    if (Number.isNaN(from.getTime()))
        throw new Error('invalid schedule date');
    const local = zonedParts(from, schedule.timezone);
    const at = (year: number, month: number, day: number) => zonedWallTimeToUtc(schedule.timezone, year, month, day, schedule.localHour, schedule.minuteUtc);
    if (schedule.frequency === 'weekly') {
        if (schedule.weekdayUtc === null)
            throw new Error('weekly schedule needs weekdayUtc');
        const todayWeekday = new Date(Date.UTC(local.year, local.month, local.day)).getUTCDay();
        let days = (schedule.weekdayUtc - todayWeekday + 7) % 7;
        let candidate = at(local.year, local.month, local.day + days);
        if (candidate.getTime() <= from.getTime()) {
            days += 7;
            candidate = at(local.year, local.month, local.day + days);
        }
        return candidate;
    }
    if (schedule.monthdayUtc === null)
        throw new Error('monthly schedule needs monthdayUtc');
    const { monthdayUtc } = schedule;
    // Day 0 of the following month is the last day of this one, so Feb 28/29
    // and 30-day months resolve without a lookup table. `Date.UTC` (inside
    // `zonedWallTimeToUtc`) normalizes month 12 into January of the next year.
    const occurrence = (monthOffset: number): Date => monthdayUtc === CLIENT_REPORT_LAST_DAY_OF_MONTH
        ? at(local.year, local.month + monthOffset + 1, 0)
        : at(local.year, local.month + monthOffset, monthdayUtc);
    const candidate = occurrence(0);
    return candidate.getTime() <= from.getTime() ? occurrence(1) : candidate;
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
    await queue.upsertJobScheduler(clientReportSchedulerKey(schedule.id), { pattern: clientReportCron(schedule), tz: schedule.timezone }, { name: CLIENT_REPORT_JOB_NAME, data: template });
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
