/**
 * Dead-letter wiring.
 *
 * BullMQ has no built-in DLQ, so the worker feeds one by hand: when a job
 * has exhausted its attempts (or failed with an UnrecoverableError, which
 * skips retries entirely), a copy of the original payload plus failure
 * context is added to the `dead-letter` queue for operator triage. Jobs
 * that still have attempts left are BullMQ's problem — they re-enter the
 * queue with backoff and never touch the DLQ.
 */
import { UnrecoverableError, type Job, type Queue, type Worker } from 'bullmq';
import type { Logger } from 'pino';
export interface DeadLetterEntry {
    original: unknown;
    queue: string;
    err: string;
    failedAt: string;
}
export interface DeadLetterDeps {
    deadLetterQueue: Queue;
    sourceQueueName: string;
    logger: Logger;
    /** Called once per terminally-failed job (after the DLQ add). */
    onExhausted?: (job: Job, err: Error) => Promise<void>;
    /** Domain-state filter for queues whose durable retry budget exceeds BullMQ's. */
    shouldDeadLetter?: (job: Job, err: Error) => boolean | Promise<boolean>;
    /** Stable id prevents duplicate permanent evidence across failed-event replay. */
    deadLetterJobId?: (job: Job, err: Error) => string | undefined;
    /** Test seam for `failedAt`. */
    now?: () => Date;
}
export function isExhausted(job: Job, err: Error): boolean {
    // UnrecoverableError fails the job on its first throw with attemptsMade
    // below the configured cap — without this clause those jobs would die
    // silently outside the DLQ.
    return job.attemptsMade >= (job.opts.attempts ?? 1) || err instanceof UnrecoverableError;
}
export function createDeadLetterHandler(deps: DeadLetterDeps) {
    const now = deps.now ?? (() => new Date());
    return async (job: Job | undefined, err: Error): Promise<void> => {
        // BullMQ emits `failed` with an undefined job for process-level errors
        // (e.g. a job whose lock expired) — nothing to dead-letter.
        if (!job) {
            deps.logger.error({ err, queue: deps.sourceQueueName }, 'job failed without a job handle');
            return;
        }
        if (!isExhausted(job, err)) {
            return; // still has attempts — BullMQ retries with backoff
        }
        if (deps.shouldDeadLetter && !(await deps.shouldDeadLetter(job, err))) {
            return;
        }
        const entry: DeadLetterEntry = {
            original: job.data,
            queue: deps.sourceQueueName,
            err: err.message,
            failedAt: now().toISOString(),
        };
        const deadLetterJobId = deps.deadLetterJobId?.(job, err);
        if (deadLetterJobId) {
            await deps.deadLetterQueue.add('dead-letter', entry, { jobId: deadLetterJobId });
        }
        else {
            await deps.deadLetterQueue.add('dead-letter', entry);
        }
        deps.logger.error({ queue: deps.sourceQueueName, jobId: job.id, err: err.message }, 'job exhausted retries — dead-lettered');
        if (deps.onExhausted) {
            await deps.onExhausted(job, err);
        }
    };
}
/**
 * Attaches the dead-letter handler to a worker's `failed` event. Handler
 * rejections are logged, never rethrown — a broken DLQ write must not take
 * the worker process down with it.
 */
export function wireDeadLetter(worker: Worker, deps: DeadLetterDeps): void {
    const handler = createDeadLetterHandler(deps);
    worker.on('failed', (job, err) => {
        handler(job, err).catch((handlerErr: unknown) => {
            deps.logger.error({ err: handlerErr, queue: deps.sourceQueueName }, 'dead-letter handler failed');
        });
    });
}
