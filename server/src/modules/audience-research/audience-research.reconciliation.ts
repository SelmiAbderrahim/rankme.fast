/**
 * Audience Research — reconciliation sweep.
 *
 * Two failure modes this sweep exists to close:
 *   1. Created-but-not-enqueued — the Mongo doc landed but BullMQ never
 *      accepted the job. Row is `state:queued` and the queue no
 *      longer holds a job with the deterministic id.
 *   2. Stuck non-terminal runs — a non-terminal run whose `updatedAt` has not
 *      moved for longer than the stuck-run window. Almost always a worker
 *      crashed mid-stage; the row will otherwise stay non-terminal forever.
 *
 * Invariants:
 *   - Reconciliation marks a stalled/orphaned run `failed` with
 *     `processing_failure`; retained sources stay readable.
 *   - The sweep is idempotent — terminal rows filter out at query time AND
 *     re-check in-loop so a concurrent worker never loses to the sweep.
 *   - The sweep never issues NEW enqueues; a stuck queued run whose job is
 *     missing is failed, not retried.
 */
import type { Queue } from 'bullmq';
import type { Logger } from 'pino';
import { audienceResearchJobId, AUDIENCE_RESEARCH_QUEUE, } from '../../shared/queue/index.js';
import { AudienceResearchRun, type AudienceResearchRunHydrated, } from './audience-research.model.js';
import { assertTransition, isTerminal, type AudienceResearchState, } from './audience-research.state.js';
import { tryRunWithSiteWorkLease } from '../sites/index.js';
const NON_TERMINAL_STATES: readonly AudienceResearchState[] = [
    'queued',
    'discovering',
    'selecting',
    'collecting',
    'clustering',
];
export const AUDIENCE_RESEARCH_RECON_QUEUE = 'audience-research-recon';
export const AUDIENCE_RESEARCH_RECON_JOB = 'sweep';
export const AUDIENCE_RESEARCH_RECON_SCHEDULER_KEY = 'audience-research-reconciliation-sweep';
/** How long a `queued` run may sit without a live job before it is orphaned. */
export const DEFAULT_QUEUED_ORPHAN_MS = 10 * 60 * 1000; // 10 minutes.
/** How long a non-terminal run may remain without a Mongo write before it is stuck. */
export const DEFAULT_STUCK_RUN_MS = 60 * 60 * 1000; // 60 minutes.
export const AUDIENCE_RESEARCH_RECON_INTERVAL_MS = 5 * 60 * 1000;
export const AUDIENCE_RESEARCH_RECON_BATCH_SIZE = 100;
const MAX_BATCHES = 100;
export interface ReconcileDeps {
    logger: Logger;
    queue: Queue;
    now?: () => Date;
    queuedOrphanMs?: number;
    stuckRunMs?: number;
    batchSize?: number;
}
export interface ReconcileOutcome {
    scanned: number;
    markedOrphan: number;
    markedStuck: number;
    skipped: number;
}
async function markFailed(doc: AudienceResearchRunHydrated, reasonCode: 'processing_failure', now: Date): Promise<void> {
    assertTransition(doc.state as AudienceResearchState, 'failed');
    doc.state = 'failed';
    doc.terminal = {
        state: 'failed',
        reasonCode,
        completedAt: now,
    } as never;
    doc.completedAt = now;
    await doc.save();
}
/**
 * Runs one reconciliation pass. Deterministic — every call reads a snapshot
 * from `deps.now()` and works only over rows that were `updatedAt` before
 * that instant, so a re-run after adding fresh docs cannot double-process
 * the same row.
 */
export async function runAudienceResearchReconciliationSweep(deps: ReconcileDeps): Promise<ReconcileOutcome> {
    const now = (deps.now ?? (() => new Date()))();
    const queuedOrphanMs = deps.queuedOrphanMs ?? DEFAULT_QUEUED_ORPHAN_MS;
    const stuckRunMs = deps.stuckRunMs ?? DEFAULT_STUCK_RUN_MS;
    const limit = deps.batchSize ?? AUDIENCE_RESEARCH_RECON_BATCH_SIZE;
    const stuckCutoff = new Date(now.getTime() - stuckRunMs);
    const orphanCutoff = new Date(now.getTime() - queuedOrphanMs);
    const outcome: ReconcileOutcome = {
        scanned: 0,
        markedOrphan: 0,
        markedStuck: 0,
        skipped: 0,
    };
    for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
        const rows = await AudienceResearchRun.find({
            state: { $in: NON_TERMINAL_STATES },
            updatedAt: { $lte: stuckCutoff },
        })
            .sort({ updatedAt: 1 })
            .limit(limit);
        const queuedRows = queuedOrphanMs < stuckRunMs
            ? await AudienceResearchRun.find({
                state: 'queued',
                updatedAt: { $lte: orphanCutoff, $gt: stuckCutoff },
            })
                .sort({ updatedAt: 1 })
                .limit(limit)
            : [];
        const combined = [...rows, ...queuedRows];
        if (combined.length === 0)
            break;
        for (const doc of combined) {
            outcome.scanned += 1;
            const runId = String(doc._id);
            const accountId = String(doc.accountId);
            const leased = await tryRunWithSiteWorkLease({ accountId, siteId: String(doc.siteId) }, `audience-research-recon:${runId}`, async () => {
                if (isTerminal(doc.state as AudienceResearchState)) {
                    outcome.skipped += 1;
                    return;
                }
                if (doc.state === 'queued') {
                    const jobId = audienceResearchJobId(runId);
                    const job = await deps.queue.getJob(jobId);
                    if (job) {
                        outcome.skipped += 1;
                        return;
                    }
                    await markFailed(doc, 'processing_failure', now);
                    outcome.markedOrphan += 1;
                    deps.logger.warn({
                        runId,
                        accountId,
                        queue: AUDIENCE_RESEARCH_QUEUE,
                    }, 'audience-research reconciliation: orphaned run; marked failed');
                    return;
                }
                await markFailed(doc, 'processing_failure', now);
                outcome.markedStuck += 1;
                deps.logger.warn({
                    runId,
                    accountId,
                    state: doc.state,
                }, 'audience-research reconciliation: stalled run; marked failed');
            });
            if (!leased.acquired)
                outcome.skipped += 1;
        }
        if (combined.length < limit)
            break;
    }
    return outcome;
}
/**
 * BullMQ processor for the audience-research reconciliation queue. Registered
 * on the worker; the repeat schedule (INTERVAL_MS) is set by the worker at boot.
 */
export function createAudienceResearchReconciliationProcessor(deps: ReconcileDeps) {
    return async (): Promise<ReconcileOutcome> => runAudienceResearchReconciliationSweep(deps);
}
