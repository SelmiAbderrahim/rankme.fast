/**
 * API-side QueueEvents handlers for the audits queue.
 *
 * Injected into shared/queue/events.ts by server.ts. The worker persists
 * results and terminal states itself; these handlers are the backstop that
 * closes a run's status when the worker died mid-bookkeeping. All writes
 * are guarded transitions — whoever lands the terminal state first wins.
 */
import type { Logger } from 'pino';
import { runIdFromAuditJobId, type CompletedEvent, type FailedEvent, } from '../../shared/queue/events.js';
import { AuditRun } from './audit-run.model.js';
import { failAuditRun } from './audit-run.service.js';
export interface AuditStatusEventDeps {
    logger: Logger;
}
export function createAuditCompletedHandler(deps: AuditStatusEventDeps) {
    return async ({ jobId }: CompletedEvent): Promise<void> => {
        const runId = runIdFromAuditJobId(jobId);
        if (!runId) {
            deps.logger.warn({ jobId }, 'audit completed event with unrecognized jobId');
            return;
        }
        // The event stream carries no domain data, so this sets status only —
        // the worker wrote the result before the job could complete.
        const res = await AuditRun.updateOne({ _id: runId, status: { $in: ['queued', 'running'] } }, { $set: { status: 'succeeded', finishedAt: new Date(), activeKey: null } });
        deps.logger.info({ jobId, runId, transitioned: res.modifiedCount === 1 }, 'audit job completed');
    };
}
export function createAuditFailedHandler(deps: AuditStatusEventDeps) {
    return async ({ jobId, failedReason }: FailedEvent): Promise<void> => {
        const runId = runIdFromAuditJobId(jobId);
        if (!runId) {
            deps.logger.warn({ jobId }, 'audit failed event with unrecognized jobId');
            return;
        }
        // The worker's exhaustion hook classifies failed vs unavailable and
        // usually wins the race; this catches a worker that died first.
        const { transitioned } = await failAuditRun(runId, failedReason);
        deps.logger.warn({ jobId, runId, failedReason, transitioned }, 'audit job failed');
    };
}
