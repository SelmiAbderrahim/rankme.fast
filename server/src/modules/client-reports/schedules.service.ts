import { randomUUID } from 'node:crypto';
import type { Queue } from 'bullmq';
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import { env } from '../../config/env.js';
import type { Db } from '../../db/client.js';
import { scheduledReportDeliveries, scheduledReports, type ScheduledReportDeliveryRow, type ScheduledReportRow, } from '../../db/schema/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { Site } from '../sites/sites.model.js';
import type { ClientReportDeliveryQuery, ClientReportScheduleBody, } from './client-reports.schema.js';
import { clientReportScheduleMinute, nextClientReportRunAt, removeClientReportScheduler, upsertClientReportScheduler, } from './scheduler.js';
export interface ScheduledReportDto {
    id: string;
    siteId: string;
    name: string;
    frequency: ScheduledReportRow['frequency'];
    weekdayUtc: number | null;
    monthdayUtc: number | null;
    hourUtc: number;
    minuteUtc: number;
    locale: string;
    recipients: string[];
    sections: ScheduledReportRow['sections'];
    enabled: boolean;
    nextRunAt: string | null;
    lastRunAt: string | null;
    createdAt: string;
    updatedAt: string;
}
export interface ScheduledReportDeliveryDto {
    id: string;
    scheduleId: string;
    recipient: string;
    status: ScheduledReportDeliveryRow['status'];
    suppressionReason: ScheduledReportDeliveryRow['suppressionReason'];
    errorCode: string | null;
    snapshotDate: string | null;
    createdAt: string;
    finishedAt: string | null;
}
export function toScheduledReportDto(row: ScheduledReportRow): ScheduledReportDto {
    return {
        id: row.id,
        siteId: row.siteId,
        name: row.name,
        frequency: row.frequency,
        weekdayUtc: row.weekdayUtc,
        monthdayUtc: row.monthdayUtc,
        hourUtc: row.hourUtc,
        minuteUtc: row.minuteUtc,
        locale: row.locale,
        recipients: row.recipients,
        sections: row.sections,
        enabled: row.enabled,
        nextRunAt: row.nextRunAt?.toISOString() ?? null,
        lastRunAt: row.lastRunAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}
function toDeliveryDto(row: ScheduledReportDeliveryRow): ScheduledReportDeliveryDto {
    return {
        id: row.id,
        scheduleId: row.scheduleId,
        recipient: row.recipient,
        status: row.status,
        suppressionReason: row.suppressionReason,
        errorCode: row.errorCode,
        snapshotDate: row.snapshotDate?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        finishedAt: row.finishedAt?.toISOString() ?? null,
    };
}
async function assertOwnedSite(accountId: string, siteId: string): Promise<void> {
    const site = await Site.exists({ _id: siteId, accountId, deletionStartedAt: null });
    if (!site)
        throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
}
function assertCreateAvailable(): void {
    if (!env.CLIENT_REPORTS_ENABLED) {
        throw HttpError.notFound({ code: 'CLIENT_REPORTS_ERRORS_UNAVAILABLE', messageKey: 'clientReports.errors.unavailable' });
    }
}
async function syncClientReportScheduler(queue: Queue, schedule: ScheduledReportRow): Promise<void> {
    try {
        if (schedule.enabled)
            await upsertClientReportScheduler(queue, schedule);
        else
            await removeClientReportScheduler(queue, schedule.id);
    }
    catch (error) {
        throw new HttpError(503, { code: 'CLIENT_REPORTS_ERRORS_QUEUE_UNAVAILABLE', messageKey: 'clientReports.errors.queueUnavailable' }, undefined, { cause: error });
    }
}
async function reconcileClientReportSchedulerAfterRollback(db: Db, queue: Queue, input: {
    accountId: string;
    siteId: string;
    scheduleId: string;
}): Promise<void> {
    try {
        // Reacquire the same account lock and reread DB truth. A newer mutation
        // may have won the lock after the failed transaction rolled back; blindly
        // restoring a captured `previous` row here could overwrite that newer
        // scheduler. Whichever compensation/mutation wins first, the last holder
        // now applies the row that is actually current under the lock.
        await db.transaction(async (tx) => {
            await tx.execute(sql `select pg_advisory_xact_lock(hashtext(${input.accountId}))`);
            const [current] = await tx
                .select()
                .from(scheduledReports)
                .where(and(eq(scheduledReports.id, input.scheduleId), eq(scheduledReports.accountId, input.accountId), eq(scheduledReports.siteId, input.siteId)))
                .limit(1);
            if (current)
                await syncClientReportScheduler(queue, current);
            else
                await removeClientReportScheduler(queue, input.scheduleId);
        });
    }
    catch {
        // Startup reconciliation repairs DB truth if Redis is unavailable for
        // both the original mutation and its compensation.
    }
}
function scheduleValues(id: string, accountId: string, siteId: string, body: ClientReportScheduleBody, now: Date) {
    const cadence = body.frequency === 'weekly'
        ? { weekdayUtc: body.weekdayUtc, monthdayUtc: null }
        : { weekdayUtc: null, monthdayUtc: body.monthdayUtc };
    const base = {
        id,
        accountId,
        siteId,
        name: body.name,
        frequency: body.frequency,
        ...cadence,
        hourUtc: body.hourUtc,
        minuteUtc: clientReportScheduleMinute(id),
        locale: body.locale,
        recipients: body.recipients,
        sections: body.sections,
        enabled: body.enabled,
        createdAt: now,
        updatedAt: now,
        lastRunAt: null,
    } satisfies Omit<ScheduledReportRow, 'nextRunAt'>;
    return {
        ...base,
        nextRunAt: body.enabled ? nextClientReportRunAt(base, now) : null,
    };
}
export async function createSchedule(input: {
    accountId: string;
    siteId: string;
    body: ClientReportScheduleBody;
}, deps: {
    db: Db;
    queue: Queue | null;
    now?: () => Date;
}): Promise<ScheduledReportDto> {
    await assertOwnedSite(input.accountId, input.siteId);
    assertCreateAvailable();
    const queue = deps.queue;
    if (!queue)
        throw new HttpError(503, { code: 'CLIENT_REPORTS_ERRORS_QUEUE_UNAVAILABLE', messageKey: 'clientReports.errors.queueUnavailable' });
    const now = (deps.now ?? (() => new Date()))();
    const id = randomUUID();
    const values = scheduleValues(id, input.accountId, input.siteId, input.body, now);
    let schedulerTouched = false;
    try {
        const row = await deps.db.transaction(async (tx) => {
            const [created] = await tx.insert(scheduledReports).values(values).returning();
            if (created!.enabled) {
                // Set before the Redis round trip: an ambiguous transport failure can
                // mean BullMQ committed the scheduler but the client never saw the
                // acknowledgement.
                schedulerTouched = true;
                await syncClientReportScheduler(queue, created!);
            }
            return created!;
        });
        return toScheduledReportDto(row);
    }
    catch (error) {
        if (schedulerTouched) {
            await reconcileClientReportSchedulerAfterRollback(deps.db, queue, {
                accountId: input.accountId,
                siteId: input.siteId,
                scheduleId: id,
            });
        }
        throw error;
    }
}
export async function listSchedules(accountId: string, siteId: string, db: Db): Promise<{
    schedules: ScheduledReportDto[];
}> {
    await assertOwnedSite(accountId, siteId);
    const rows = await db
        .select()
        .from(scheduledReports)
        .where(and(eq(scheduledReports.accountId, accountId), eq(scheduledReports.siteId, siteId)))
        .orderBy(desc(scheduledReports.createdAt));
    return {
        schedules: rows.map(toScheduledReportDto),
    };
}
export async function updateSchedule(input: {
    accountId: string;
    siteId: string;
    scheduleId: string;
    body: ClientReportScheduleBody;
}, deps: {
    db: Db;
    queue: Queue | null;
    now?: () => Date;
}): Promise<ScheduledReportDto> {
    await assertOwnedSite(input.accountId, input.siteId);
    const queue = deps.queue;
    const now = (deps.now ?? (() => new Date()))();
    let schedulerTouched = false;
    try {
        const row = await deps.db.transaction(async (tx) => {
            await tx.execute(sql `select pg_advisory_xact_lock(hashtext(${input.accountId}))`);
            const [current] = await tx
                .select()
                .from(scheduledReports)
                .where(and(eq(scheduledReports.id, input.scheduleId), eq(scheduledReports.accountId, input.accountId), eq(scheduledReports.siteId, input.siteId)))
                .limit(1);
            if (!current)
                throw HttpError.notFound({ code: 'CLIENT_REPORTS_ERRORS_SCHEDULE_NOT_FOUND', messageKey: 'clientReports.errors.scheduleNotFound' });
            if (!env.CLIENT_REPORTS_ENABLED && input.body.enabled) {
                throw HttpError.notFound({ code: 'CLIENT_REPORTS_ERRORS_UNAVAILABLE', messageKey: 'clientReports.errors.unavailable' });
            }
            if (!queue)
                throw new HttpError(503, { code: 'CLIENT_REPORTS_ERRORS_QUEUE_UNAVAILABLE', messageKey: 'clientReports.errors.queueUnavailable' });
            const next = scheduleValues(current.id, input.accountId, input.siteId, input.body, now);
            const [updated] = await tx
                .update(scheduledReports)
                .set({ ...next, createdAt: current.createdAt, lastRunAt: current.lastRunAt })
                .where(and(eq(scheduledReports.id, current.id), eq(scheduledReports.accountId, input.accountId)))
                .returning();
            schedulerTouched = true;
            await syncClientReportScheduler(queue, updated!);
            return updated!;
        });
        return toScheduledReportDto(row);
    }
    catch (error) {
        if (schedulerTouched && queue) {
            await reconcileClientReportSchedulerAfterRollback(deps.db, queue, {
                accountId: input.accountId,
                siteId: input.siteId,
                scheduleId: input.scheduleId,
            });
        }
        throw error;
    }
}
export async function deleteSchedule(input: {
    accountId: string;
    siteId: string;
    scheduleId: string;
}, deps: {
    db: Db;
    queue: Queue | null;
}): Promise<void> {
    await assertOwnedSite(input.accountId, input.siteId);
    let schedulerTouched = false;
    try {
        await deps.db.transaction(async (tx) => {
            await tx.execute(sql `select pg_advisory_xact_lock(hashtext(${input.accountId}))`);
            const [deleted] = await tx
                .delete(scheduledReports)
                .where(and(eq(scheduledReports.id, input.scheduleId), eq(scheduledReports.accountId, input.accountId), eq(scheduledReports.siteId, input.siteId)))
                .returning();
            if (!deleted)
                throw HttpError.notFound({ code: 'CLIENT_REPORTS_ERRORS_SCHEDULE_NOT_FOUND', messageKey: 'clientReports.errors.scheduleNotFound' });
            if (deps.queue) {
                schedulerTouched = true;
                await syncClientReportScheduler(deps.queue, { ...deleted, enabled: false });
            }
        });
    }
    catch (error) {
        if (schedulerTouched && deps.queue) {
            await reconcileClientReportSchedulerAfterRollback(deps.db, deps.queue, {
                accountId: input.accountId,
                siteId: input.siteId,
                scheduleId: input.scheduleId,
            });
        }
        throw error;
    }
}
export async function listDeliveries(input: {
    accountId: string;
    siteId: string;
    query: ClientReportDeliveryQuery;
}, db: Db): Promise<{
    deliveries: ScheduledReportDeliveryDto[];
    nextCursor: string | null;
}> {
    await assertOwnedSite(input.accountId, input.siteId);
    const predicates = [
        eq(scheduledReportDeliveries.accountId, input.accountId),
        eq(scheduledReportDeliveries.siteId, input.siteId),
    ];
    if (input.query.cursor) {
        const cursor = await db.query.scheduledReportDeliveries.findFirst({
            where: and(eq(scheduledReportDeliveries.id, input.query.cursor), eq(scheduledReportDeliveries.accountId, input.accountId), eq(scheduledReportDeliveries.siteId, input.siteId)),
        });
        if (!cursor)
            throw HttpError.notFound({ code: 'CLIENT_REPORTS_ERRORS_DELIVERY_NOT_FOUND', messageKey: 'clientReports.errors.deliveryNotFound' });
        predicates.push(or(lt(scheduledReportDeliveries.createdAt, cursor.createdAt), and(eq(scheduledReportDeliveries.createdAt, cursor.createdAt), lt(scheduledReportDeliveries.id, cursor.id)))!);
    }
    const rows = await db
        .select()
        .from(scheduledReportDeliveries)
        .where(and(...predicates))
        .orderBy(desc(scheduledReportDeliveries.createdAt), desc(scheduledReportDeliveries.id))
        .limit(input.query.limit + 1);
    const page = rows.slice(0, input.query.limit);
    return {
        deliveries: page.map(toDeliveryDto),
        nextCursor: rows.length > input.query.limit ? page.at(-1)!.id : null,
    };
}
