/**
 * AuditRun state transitions.
 *
 * All writers funnel through here so the lifecycle stays monotonic:
 * `queued → running → succeeded | failed | unavailable`. Every update is
 * guarded by the set of states it may transition FROM, which makes the
 * worker (processor / dead-letter handler) and the api (QueueEvents
 * consumer) safely idempotent against each other — whoever writes the
 * terminal state first wins, later writers no-op.
 */
import type { AuditResult } from '../../shared/providers/index.js';
import { AuditRun, type AuditRunStatus } from './audit-run.model.js';
export interface TransitionResult {
    /** False = the guard matched nothing (already past that state). */
    transitioned: boolean;
}
export async function markAuditRunRunning(runId: string, vendorTaskId: string | null = null): Promise<TransitionResult> {
    const res = await AuditRun.updateOne({ _id: runId, status: 'queued' }, { $set: { status: 'running', startedAt: new Date(), ...(vendorTaskId ? { vendorTaskId } : {}) } });
    return { transitioned: res.modifiedCount === 1 };
}
export async function completeAuditRun(runId: string, result: Pick<AuditResult, 'domainChecks'>): Promise<TransitionResult> {
    // Persist only the summary block on `AuditRun`; the
    // per-page detail already lives in AuditedPage docs and the ReportSnapshot,
    // so triple-storing it here just bloats the run doc for every read.
    const stored = { domainChecks: result.domainChecks };
    const res = await AuditRun.updateOne({ _id: runId, status: { $in: ['queued', 'running'] } }, {
        $set: {
            status: 'succeeded',
            finishedAt: new Date(),
            result: stored,
            error: null,
            activeKey: null,
        },
    });
    return { transitioned: res.modifiedCount === 1 };
}
export async function failAuditRun(runId: string, error: string, opts: {
    unavailable?: boolean;
} = {}): Promise<TransitionResult> {
    const status: AuditRunStatus = opts.unavailable ? 'unavailable' : 'failed';
    const res = await AuditRun.updateOne({ _id: runId, status: { $in: ['queued', 'running'] } }, { $set: { status, finishedAt: new Date(), error, activeKey: null } });
    return { transitioned: res.modifiedCount === 1 };
}
