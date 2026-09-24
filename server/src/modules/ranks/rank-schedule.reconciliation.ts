import type { Queue } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import { domainStates, keywords } from '../../db/schema/keywords.js';
import { rankJobSchema } from '../../shared/queue/payloads.js';
import { rankSchedulerKey, upsertRankSchedule, } from '../../shared/queue/schedulers.js';
/**
 * Rebuild every active site's rank scheduler from Postgres.
 *
 * Redis is disposable; Postgres is the source of truth. Running this at worker
 * boot (and the live-worker timer) recovers schedules after Redis loss.
 * Existing schedulers are deliberately left untouched: BullMQ's public
 * `upsertJobScheduler(..., override=true)` removes and replaces the currently
 * delayed iteration, which would rewrite an already-accepted alternate-engine
 * flag snapshot during rollback. Producer paths own intentional schedule edits;
 * this recovery path only recreates missing state.
 */
export async function reconcileRankSchedules(db: ApplicationDb, queue: Queue, altEnginesEnabled: boolean): Promise<number> {
    const rows = await db
        .selectDistinct({
        accountId: keywords.accountId,
        siteId: keywords.siteId,
        cadence: domainStates.cadence,
    })
        .from(keywords)
        .leftJoin(domainStates, eq(domainStates.siteId, keywords.siteId))
        .where(eq(keywords.active, true));
    rows.sort((left, right) => left.siteId.localeCompare(right.siteId));
    const desiredKeys = new Set(rows.map((row) => rankSchedulerKey(row.siteId)));
    const existingSchedulers = await queue.getJobSchedulers(0, -1, true);
    const existingKeys = new Set(existingSchedulers.map((scheduler) => scheduler.key));
    for (const scheduler of existingSchedulers) {
        if (scheduler.key.startsWith('rank-schedule:') &&
            !desiredKeys.has(scheduler.key)) {
            await queue.removeJobScheduler(scheduler.key);
        }
    }
    for (const row of rows) {
        // `getJobScheduler(id)` treats any missing id containing `:` as a legacy
        // repeat key and returns a synthetic object. Use the authoritative zset
        // listing above so colon-bearing v5 scheduler ids can actually recover.
        if (existingKeys.has(rankSchedulerKey(row.siteId)))
            continue;
        await upsertRankSchedule(queue, {
            accountId: row.accountId,
            siteId: row.siteId,
            cadence: row.cadence ?? 'weekly',
            altEnginesEnabled,
        });
    }
    return rows.length;
}
/**
 * Refresh the scheduler template only after BullMQ has promoted the accepted
 * iteration to `active`. At that point BullMQ has already created the next
 * delayed iteration; a public upsert replaces only that future iteration and
 * cannot rewrite the payload currently being consumed.
 */
export async function refreshRankScheduleAfterPromotion(db: ApplicationDb, queue: Queue, rawPayload: unknown, altEnginesEnabled: boolean): Promise<boolean> {
    const parsed = rankJobSchema.safeParse(rawPayload);
    if (!parsed.success)
        return false;
    const payload = parsed.data;
    if (payload.manual === true ||
        payload.schedulerKey !== rankSchedulerKey(payload.siteId)) {
        return false;
    }
    // A stale iteration can become active just after the final keyword (or site)
    // removed its scheduler. Never resurrect that schedule from the consumer.
    const active = await db
        .select({ id: keywords.id })
        .from(keywords)
        .where(and(eq(keywords.accountId, payload.accountId), eq(keywords.siteId, payload.siteId), eq(keywords.active, true)))
        .limit(1);
    if (active.length === 0)
        return false;
    const cadenceRows = await db
        .select({ cadence: domainStates.cadence })
        .from(domainStates)
        .where(eq(domainStates.siteId, payload.siteId))
        .limit(1);
    await upsertRankSchedule(queue, {
        accountId: payload.accountId,
        siteId: payload.siteId,
        cadence: cadenceRows[0]?.cadence ?? 'weekly',
        altEnginesEnabled,
    });
    return true;
}
