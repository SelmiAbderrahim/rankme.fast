import type { Logger } from 'pino';
/**
 * Redis is a disposable queue cache, while product schedules live in Postgres
 * (and accepted reconciliation receipts/runs live in Mongo). A worker process
 * can survive a Redis restart, so boot-only scheduler recovery is insufficient.
 * This timer re-runs the bounded, idempotent domain reconcilers without ever
 * overlapping a prior pass in the same worker.
 */
export const SCHEDULER_RECONCILIATION_INTERVAL_MS = 60000;
export const SCHEDULER_RECONCILIATION_MAX_BACKOFF_MS = 15 * 60000;
export interface SchedulerReconciliationTask {
    name: string;
    run(): Promise<unknown>;
}
export interface SchedulerReconciliationResult {
    completed: number;
    failures: number;
}
export interface SchedulerReconciler {
    close(): Promise<void>;
    runNow(): Promise<SchedulerReconciliationResult>;
}
export interface SchedulerReconcilerDeps {
    logger: Logger;
    tasks: readonly SchedulerReconciliationTask[];
}
export interface SingletonSchedulerQueue {
    getJobScheduler(key: string): Promise<unknown>;
    removeJobScheduler(key: string): Promise<unknown>;
}
export interface SingletonScheduleSpec {
    every?: number;
    pattern?: string;
    tz?: string;
}
export interface SchedulerIterationLike {
    opts?: {
        repeatJobKey?: string;
    };
}
export type SingletonSchedulerResult = 'created' | 'existing' | 'removed' | 'absent';
/**
 * Converge one worker-owned singleton scheduler without upserting an existing
 * iteration. This preserves accepted payload snapshots and gives every
 * flag-off path explicit desired/absent semantics.
 */
export async function reconcileSingletonScheduler(queue: SingletonSchedulerQueue, key: string, desired: boolean, install: () => Promise<unknown>): Promise<SingletonSchedulerResult> {
    const existing = await queue.getJobScheduler(key);
    if (desired) {
        if (existing)
            return 'existing';
        await install();
        return 'created';
    }
    if (!existing)
        return 'absent';
    await queue.removeJobScheduler(key);
    return 'removed';
}
export function singletonScheduleMatches(raw: unknown, expected: SingletonScheduleSpec): boolean {
    if (!raw || typeof raw !== 'object')
        return false;
    const actual = raw as Record<string, unknown>;
    const actualEvery = typeof actual.every === 'number' ? actual.every : undefined;
    const actualPattern = typeof actual.pattern === 'string' ? actual.pattern : undefined;
    const actualTz = typeof actual.tz === 'string' ? actual.tz : undefined;
    return (actualEvery === expected.every &&
        actualPattern === expected.pattern &&
        actualTz === expected.tz);
}
/**
 * BullMQ promotes the current scheduler iteration and generates its successor
 * before invoking the worker processor. Therefore a drift repair performed
 * from that processor can replace only the future iteration; the accepted
 * current tick remains active and always continues.
 */
export async function refreshSingletonSchedulerAfterPromotion(queue: SingletonSchedulerQueue, key: string, desired: boolean, expected: SingletonScheduleSpec, install: () => Promise<unknown>, job: SchedulerIterationLike): Promise<boolean> {
    if (!desired || job.opts?.repeatJobKey !== key)
        return false;
    const existing = await queue.getJobScheduler(key);
    if (singletonScheduleMatches(existing, expected))
        return false;
    await install();
    return true;
}
export function withSingletonSchedulerRefresh<TJob extends SchedulerIterationLike, TResult>(processor: (job: TJob) => Promise<TResult>, deps: {
    queue: SingletonSchedulerQueue;
    key: string;
    desired: boolean;
    expected: SingletonScheduleSpec;
    install: () => Promise<unknown>;
    logger: Pick<Logger, 'warn'>;
}): (job: TJob) => Promise<TResult> {
    return async (job) => {
        try {
            await refreshSingletonSchedulerAfterPromotion(deps.queue, deps.key, deps.desired, deps.expected, deps.install, job);
        }
        catch (error) {
            deps.logger.warn({ err: error, schedulerKey: deps.key }, 'singleton scheduler future-template refresh failed; accepted tick continues');
        }
        return processor(job);
    };
}
/** Run every domain task even when an earlier one fails. */
export async function reconcileSchedulers(deps: SchedulerReconcilerDeps): Promise<SchedulerReconciliationResult> {
    let completed = 0;
    let failures = 0;
    for (const task of deps.tasks) {
        try {
            await task.run();
            completed += 1;
        }
        catch (error) {
            failures += 1;
            deps.logger.error({ err: error, reconciliationTask: task.name }, 'durable scheduler reconciliation task failed');
        }
    }
    return { completed, failures };
}
/** Single-flight recursive timer with bounded backoff and graceful drain. */
export function startSchedulerReconciler(deps: SchedulerReconcilerDeps, options: {
    intervalMs?: number;
    maxBackoffMs?: number;
} = {}): SchedulerReconciler {
    const intervalMs = options.intervalMs ?? SCHEDULER_RECONCILIATION_INTERVAL_MS;
    const maxBackoffMs = options.maxBackoffMs ?? SCHEDULER_RECONCILIATION_MAX_BACKOFF_MS;
    let stopped = false;
    let timer: NodeJS.Timeout | null = null;
    let inFlight: Promise<SchedulerReconciliationResult> | null = null;
    let nextDelay = intervalMs;
    const schedule = (): void => {
        if (stopped || timer !== null)
            return;
        timer = setTimeout(() => {
            timer = null;
            void runNow();
        }, nextDelay);
        timer.unref();
    };
    const runNow = async (): Promise<SchedulerReconciliationResult> => {
        if (inFlight)
            return inFlight;
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        inFlight = reconcileSchedulers(deps);
        try {
            const result = await inFlight;
            nextDelay =
                result.failures === 0
                    ? intervalMs
                    : Math.min(maxBackoffMs, Math.max(intervalMs, nextDelay * 2));
            return result;
        }
        finally {
            inFlight = null;
            schedule();
        }
    };
    schedule();
    return {
        runNow,
        async close() {
            stopped = true;
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            if (inFlight)
                await inFlight.catch(() => undefined);
        },
    };
}
