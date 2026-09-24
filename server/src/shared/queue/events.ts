/**
 * QueueEvents consumers — run in the API process.
 *
 * The worker owns domain writes while it is alive; these consumers are the
 * api-side mirror that keeps job-status records current on `completed` /
 * `failed` even if the worker died before its own bookkeeping ran. The
 * domain-specific handlers are injected (modules/audits owns the audit
 * ones) so this layer stays free of module imports.
 *
 * Each QueueEvents holds a blocking stream read, so every instance gets a
 * FRESH connection from the factory — never the shared api connection.
 */
import { QueueEvents } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { AUDITS_QUEUE, RANKS_QUEUE } from './queues.js';
/** Inverse of `auditJobId` — null for jobs not enqueued through the helper. */
export function runIdFromAuditJobId(jobId: string): string | null {
    if (!jobId.startsWith('audit-'))
        return null;
    const runId = jobId.slice('audit-'.length);
    return runId.length > 0 ? runId : null;
}
export interface CompletedEvent {
    jobId: string;
}
export interface FailedEvent {
    jobId: string;
    failedReason: string;
}
export interface QueueStatusEvents {
    /**
     * Resolves once both event streams are subscribed. QueueEvents only sees
     * events emitted AFTER it connects — await this before treating the
     * consumers as live (tests do; the api boots them before any enqueue).
     */
    ready(): Promise<void>;
    close(): Promise<void>;
}
export interface StartQueueStatusEventsDeps {
    /** Fresh-connection factory — one dedicated connection per QueueEvents. */
    createConnection: () => Redis;
    logger: Logger;
    onAuditCompleted: (event: CompletedEvent) => Promise<void>;
    onAuditFailed: (event: FailedEvent) => Promise<void>;
}
/**
 * Boots the api-side status consumers for both work queues. Rank jobs have
 * no domain record yet (rank history lands) — their events
 * are logged for operators only.
 */
export function startQueueStatusEvents(deps: StartQueueStatusEventsDeps): QueueStatusEvents {
    // BullMQ never closes externally-provided connections — keep refs and
    // quit them ourselves in close().
    const auditConnection = deps.createConnection();
    const rankConnection = deps.createConnection();
    const auditEvents = new QueueEvents(AUDITS_QUEUE, { connection: auditConnection });
    const rankEvents = new QueueEvents(RANKS_QUEUE, { connection: rankConnection });
    auditEvents.on('completed', (event) => {
        deps.onAuditCompleted(event).catch((err: unknown) => {
            deps.logger.error({ err, jobId: event.jobId }, 'audit completed handler failed');
        });
    });
    auditEvents.on('failed', (event) => {
        deps.onAuditFailed(event).catch((err: unknown) => {
            deps.logger.error({ err, jobId: event.jobId }, 'audit failed handler failed');
        });
    });
    rankEvents.on('completed', ({ jobId }) => {
        deps.logger.info({ jobId }, 'rank job completed');
    });
    rankEvents.on('failed', ({ jobId, failedReason }) => {
        deps.logger.warn({ jobId, failedReason }, 'rank job failed');
    });
    return {
        async ready() {
            await Promise.all([auditEvents.waitUntilReady(), rankEvents.waitUntilReady()]);
        },
        async close() {
            await Promise.all([auditEvents.close(), rankEvents.close()]);
            await Promise.allSettled([auditConnection.quit(), rankConnection.quit()]);
        },
    };
}
