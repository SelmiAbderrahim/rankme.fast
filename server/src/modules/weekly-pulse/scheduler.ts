/**
 * Weekly Pulse — BullMQ scheduler + deterministic test-seam drainer.
 *
 * Two entry points:
 *
 *   1. `upsertPulseScheduler(queue, { accountId, siteId })` — called on the
 *      first eligible subscription for a site. Uses BullMQ v5
 *      `queue.upsertJobScheduler` with a pattern derived from the pure hash
 *      in `schedule.ts`. Idempotent: multiple subscribes for the same site
 *      converge on one scheduler entry.
 *
 *   2. `removePulseScheduler(queue, siteId)` — called on last-unsubscribe /
 *      site deletion / account purge. Returns `true` when a scheduler existed.
 *
 * The exported deterministic test seam `scheduleDueWeeklyPulses` enqueues
 * all currently-due `(site, iso_week)` jobs for a controllable clock. It is
 * NOT a bypass — it runs the same validations the scheduler-driven path
 * runs (enabled site, subscriptions eligible, uniqueness on
 * `(site, iso_week)` via the queue's dedupe jobId), so tests and E2E runs
 * never wait a wall-clock week and never invoke a code path that skips
 * checks.
 */
import type { Queue } from 'bullmq';
import { and, eq, gte, inArray, isNull, lt, lte, notLike, or, } from 'drizzle-orm';
import { sitePulseSettings, sitePulseSubscriptions, weeklyPulseDeliveryEvents, weeklyPulseRuns, } from '../../db/schema/weekly-pulse.js';
import { WEEKLY_PULSE_JOB_NAME, enqueueWeeklyPulseJob, type WeeklyPulseScheduledJob, } from '../../shared/queue/index.js';
import { recoverInterruptedWeeklyPulseRuns } from './pulse.processor.js';
import { WEEKLY_PULSE_DELIVERY_LEASE_MS, WEEKLY_PULSE_DELIVERY_MAX_ATTEMPTS, WEEKLY_PULSE_IDEMPOTENCY_RETRY_WINDOW_MS, } from './delivery.service.js';
import { computeSchedule, isoWeekUtc } from './schedule.js';
export function pulseSchedulerKey(siteId: string): string {
    return `weekly-pulse:${siteId}`;
}
export interface UpsertPulseScheduleInput {
    accountId: string;
    siteId: string;
}
/**
 * Creates or updates the repeatable weekly-pulse scheduler for a site.
 * BullMQ v5 `upsertJobScheduler` is idempotent by key so calling this on
 * every subscribe is safe — the same siteId always maps to the same key.
 *
 * The scheduler payload carries an explicit marker. The processor derives the
 * ISO week from its fire-time clock so a long-lived template cannot freeze a
 * stale week key.
 */
export async function upsertPulseScheduler(queue: Queue, input: UpsertPulseScheduleInput): Promise<void> {
    const schedule = computeSchedule(input.siteId);
    await queue.upsertJobScheduler(pulseSchedulerKey(input.siteId), { pattern: schedule.cron, tz: 'UTC' }, {
        name: WEEKLY_PULSE_JOB_NAME,
        data: {
            accountId: input.accountId,
            siteId: input.siteId,
            scheduled: true,
        } satisfies WeeklyPulseScheduledJob,
    });
}
/** Removes the site's weekly-pulse scheduler; true when one existed. */
export async function removePulseScheduler(queue: Queue, siteId: string): Promise<boolean> {
    return queue.removeJobScheduler(pulseSchedulerKey(siteId));
}
/**
 * Rebuild enabled weekly-pulse schedulers from durable Postgres state.
 * Redis is intentionally disposable, so worker boot must not rely on a user
 * toggling their subscription after Redis loss. The active-subscription join
 * also prevents a stale `enabled` setting from resurrecting delivery work.
 */
export async function reconcilePulseSchedulers(db: ApplicationDb, queue: Queue): Promise<number> {
    // Redis jobs are disposable, but a paid collection claim is durable. Close
    // any genuinely abandoned claim before rebuilding scheduler inventory so a
    // worker crash can never leave the customer-facing run stuck forever.
    await recoverInterruptedWeeklyPulseRuns(db);
    // Projection/delivery happens after the paid collection commits. Redis job
    // loss or a process crash at the email boundary must not strand that
    // durable outbox, so every periodic scheduler sweep also re-enqueues stale
    // delivery work while Resend's idempotency guarantee is still valid.
    await enqueueRecoverablePulseDeliveries(db, queue);
    const rows = await db
        .selectDistinct({
        accountId: sitePulseSettings.accountId,
        siteId: sitePulseSettings.siteId,
    })
        .from(sitePulseSettings)
        .innerJoin(sitePulseSubscriptions, and(eq(sitePulseSubscriptions.accountId, sitePulseSettings.accountId), eq(sitePulseSubscriptions.siteId, sitePulseSettings.siteId), isNull(sitePulseSubscriptions.disabledAt)))
        .where(eq(sitePulseSettings.enabled, true));
    rows.sort((left, right) => left.siteId.localeCompare(right.siteId));
    const desiredKeys = new Set(rows.map((row) => pulseSchedulerKey(row.siteId)));
    const existingSchedulers = await queue.getJobSchedulers(0, -1, true);
    const existingKeys = new Set(existingSchedulers.map((scheduler) => scheduler.key));
    for (const scheduler of existingSchedulers) {
        if (scheduler.key.startsWith('weekly-pulse:') &&
            !desiredKeys.has(scheduler.key)) {
            await queue.removeJobScheduler(scheduler.key);
        }
    }
    for (const row of rows) {
        if (!existingKeys.has(pulseSchedulerKey(row.siteId))) {
            await upsertPulseScheduler(queue, row);
        }
    }
    return rows.length;
}
const WEEKLY_PULSE_DELIVERY_RECOVERY_BATCH_SIZE = 100;
export function pulseDeliveryRecoveryJobId(input: {
    runId: string;
    updatedAt: Date;
    attempt: number;
}): string {
    return `weekly-pulse-delivery-${input.runId}-${input.attempt}-${input.updatedAt.getTime()}`;
}
/**
 * Re-enqueue a bounded batch of interrupted/transient digest deliveries.
 * The weekly-pulse processor sees the already-terminal run, skips every paid
 * collection boundary, and resumes only the frozen projection/outbox.
 */
export async function enqueueRecoverablePulseDeliveries(db: ApplicationDb, queue: Queue, now = new Date()): Promise<number> {
    const leaseCutoff = new Date(now.getTime() - WEEKLY_PULSE_DELIVERY_LEASE_MS);
    const retryWindowStart = new Date(now.getTime() - WEEKLY_PULSE_IDEMPOTENCY_RETRY_WINDOW_MS);
    // Expire ambiguous work before selecting retries. Replaying an email after
    // the provider's 24-hour dedupe retention could create a visible duplicate.
    await db
        .update(weeklyPulseDeliveryEvents)
        .set({
        status: 'not_delivered',
        attempt: WEEKLY_PULSE_DELIVERY_MAX_ATTEMPTS,
        errorCode: 'idempotency_window_expired',
        errorDetailSafe: null,
        updatedAt: now,
    })
        .where(and(inArray(weeklyPulseDeliveryEvents.status, ['queued', 'not_delivered']), or(isNull(weeklyPulseDeliveryEvents.errorCode), notLike(weeklyPulseDeliveryEvents.errorCode, 'provider_outcome_unknown_%')), lte(weeklyPulseDeliveryEvents.createdAt, retryWindowStart), or(eq(weeklyPulseDeliveryEvents.status, 'queued'), lt(weeklyPulseDeliveryEvents.attempt, WEEKLY_PULSE_DELIVERY_MAX_ATTEMPTS))));
    const candidates = await db
        .select({
        eventId: weeklyPulseDeliveryEvents.id,
        runId: weeklyPulseRuns.id,
        accountId: weeklyPulseRuns.accountId,
        siteId: weeklyPulseRuns.siteId,
        isoWeek: weeklyPulseRuns.isoWeek,
        attempt: weeklyPulseDeliveryEvents.attempt,
        updatedAt: weeklyPulseDeliveryEvents.updatedAt,
    })
        .from(weeklyPulseDeliveryEvents)
        .innerJoin(weeklyPulseRuns, eq(weeklyPulseRuns.id, weeklyPulseDeliveryEvents.pulseRunId))
        .where(and(inArray(weeklyPulseDeliveryEvents.status, ['queued', 'not_delivered']), or(isNull(weeklyPulseDeliveryEvents.errorCode), notLike(weeklyPulseDeliveryEvents.errorCode, 'provider_outcome_unknown_%')), gte(weeklyPulseDeliveryEvents.createdAt, retryWindowStart), or(and(eq(weeklyPulseDeliveryEvents.status, 'queued'), lte(weeklyPulseDeliveryEvents.updatedAt, leaseCutoff)), and(eq(weeklyPulseDeliveryEvents.status, 'not_delivered'), lt(weeklyPulseDeliveryEvents.attempt, WEEKLY_PULSE_DELIVERY_MAX_ATTEMPTS)))))
        .limit(WEEKLY_PULSE_DELIVERY_RECOVERY_BATCH_SIZE);
    // One run replay processes every frozen recipient. Collapse candidates so
    // a pulse with many transient recipients cannot enqueue N identical jobs.
    const runs = new Map<string, (typeof candidates)[number]>();
    for (const candidate of candidates) {
        const current = runs.get(candidate.runId);
        if (!current || candidate.updatedAt > current.updatedAt) {
            runs.set(candidate.runId, candidate);
        }
    }
    for (const candidate of runs.values()) {
        await queue.add(WEEKLY_PULSE_JOB_NAME, {
            accountId: candidate.accountId,
            siteId: candidate.siteId,
            isoWeek: candidate.isoWeek,
        }, {
            jobId: pulseDeliveryRecoveryJobId(candidate),
        });
    }
    return runs.size;
}
// ---------------------------------------------------------------------------
// scheduleDueWeeklyPulses — deterministic drainer.
// ---------------------------------------------------------------------------
export interface ScheduleDueWeeklyPulsesDeps {
    db: ApplicationDb;
    queue: Queue;
    /** Controllable clock — tests pass a fixed Date; production passes `new Date()`. */
    now: () => Date;
}
export interface ScheduleDueWeeklyPulsesResult {
    /** Sites whose scheduler tick was drained on this call. */
    enqueued: Array<{
        accountId: string;
        siteId: string;
        isoWeek: string;
    }>;
}
/**
 * Test-safe trigger — enqueues one job per enabled `site_pulse_settings`
 * row whose `next_run_at` is at or before `now()`. Idempotent:
 *
 *   - The BullMQ jobId is `weekly-pulse-<siteId>-<isoWeek>` so a
 *     replayed drainer sees the same jobId and BullMQ no-ops.
 *   - The processor enforces the same uniqueness at the DB layer via the
 *     `weekly_pulse_runs_account_site_week_uidx` unique index.
 *
 * This runs ALL production checks — it is deliberately identical to the
 * scheduler-driven fire path minus the wall-clock wait. A site with zero
 * enabled subscribers is skipped BEFORE any queue write; the processor
 * re-runs the same check as its ownership step.
 */
export async function scheduleDueWeeklyPulses(deps: ScheduleDueWeeklyPulsesDeps): Promise<ScheduleDueWeeklyPulsesResult> {
    const now = deps.now();
    const dueSites = await deps.db
        .select({
        accountId: sitePulseSettings.accountId,
        siteId: sitePulseSettings.siteId,
    })
        .from(sitePulseSettings)
        .where(and(eq(sitePulseSettings.enabled, true), lte(sitePulseSettings.nextRunAt, now)));
    const enqueued: ScheduleDueWeeklyPulsesResult['enqueued'] = [];
    for (const site of dueSites) {
        // Re-verify: at least one active subscription for the site. A rare
        // race where `enabled=true` outlives the final `disabled_at` write
        // still resolves to zero rows here and the drainer skips.
        const subs = await deps.db
            .select({ id: sitePulseSubscriptions.id })
            .from(sitePulseSubscriptions)
            .where(and(eq(sitePulseSubscriptions.accountId, site.accountId), eq(sitePulseSubscriptions.siteId, site.siteId), isNull(sitePulseSubscriptions.disabledAt)));
        const active = subs.length;
        if (active === 0)
            continue;
        const isoWeek = isoWeekUtc(now);
        await enqueueWeeklyPulseJob(deps.queue, {
            accountId: site.accountId,
            siteId: site.siteId,
            isoWeek,
        });
        enqueued.push({ accountId: site.accountId, siteId: site.siteId, isoWeek });
    }
    return { enqueued };
}
