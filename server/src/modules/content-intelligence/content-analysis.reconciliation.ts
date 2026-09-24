/**
 * Content Intelligence — reconciliation sweep.
 *
 * Two failure modes this sweep exists to close:
 *   1. Created-but-not-enqueued — the Mongo doc landed but
 *      BullMQ never accepted the job (e.g. the api process died between
 *      `ContentAnalysis.create` and `enqueueContentAnalysisJob`, or the
 *      job was evicted for a different reason). The row is `status:queued`
 *      but the queue no longer holds a job with the deterministic id.
 *   2. Stuck non-terminal runs — a non-terminal analysis whose `updatedAt`
 *      has not moved for longer than the stuck-run window. Almost always
 *      a worker crashed mid-stage; the row will otherwise stay `collecting_*`
 *      forever.
 *
 * Invariants:
 *   - A stalled/orphaned run is marked `failed` with a terminal error; the
 *     sweep never retries it, so reconciliation can never start a second
 *     vendor-spending run for the same request.
 *   - The sweep is idempotent: terminal rows are filtered out at query time
 *     AND re-checked in-transaction so a concurrent worker can never lose
 *     to the reconciler.
 *   - Missing-job detection uses BullMQ's `getJob(deterministicId)` — the
 *     create-time id (`content-analysis-<id>`) is stable, so a
 *     re-enqueue by name later would still collide with the same id.
 *   - The sweep never issues NEW enqueues. A stuck queued run whose job is
 *     missing is failed, not retried, so an orphan cannot silently mutate
 *     into a new run if the reconciler races the api that just
 *     re-enqueued the same job.
 */
import type { Queue } from 'bullmq';
import type { Logger } from 'pino';
import { contentAnalysisJobId, CONTENT_ANALYSIS_QUEUE, } from '../../shared/queue/index.js';
import { ContentAnalysis, CONTENT_ANALYSIS_TERMINAL_STATUSES, type ContentAnalysisHydrated, type ContentAnalysisStatus, } from './content-analysis.model.js';
import { recordContentAnalysisEvent } from './content-analysis.events.js';
import { assertContentAnalysisTransition } from './content-analysis.state.js';
import { tryRunWithSiteWorkLease } from '../sites/index.js';
/** Non-terminal statuses eligible for the stuck-run scan. */
const NON_TERMINAL_STATUSES: readonly ContentAnalysisStatus[] = [
    'queued',
    'collecting_owned',
    'collecting_serp',
    'collecting_competitors',
    'scoring',
    'generating_brief',
    'generating_draft',
];
export const CONTENT_ANALYSIS_RECON_QUEUE = 'content-analysis-recon';
export const CONTENT_ANALYSIS_RECON_JOB = 'sweep';
export const CONTENT_ANALYSIS_RECON_SCHEDULER_KEY = 'content-analysis-reconciliation-sweep';
/**
 * How long a `queued` run may sit without a live BullMQ job before
 * the sweep considers it orphaned. Chosen well past the natural jitter
 * between `ContentAnalysis.create` and `enqueueContentAnalysisJob` (which
 * happens in one request) so we never race the normal happy path.
 */
export const DEFAULT_QUEUED_ORPHAN_MS = 10 * 60 * 1000; // 10 minutes.
/**
 * How long a non-terminal run may remain without a Mongo write before it is
 * declared stuck. Chosen to comfortably exceed the vendor / AI timeouts
 * (`AI_TOTAL_TIMEOUT_MS`, Firecrawl polling) so a slow but healthy pipeline
 * never trips it.
 */
export const DEFAULT_STUCK_RUN_MS = 60 * 60 * 1000; // 60 minutes.
export const CONTENT_ANALYSIS_RECON_INTERVAL_MS = 5 * 60 * 1000;
export const CONTENT_ANALYSIS_RECON_BATCH_SIZE = 100;
// Ceiling on batches per pass — avoids the v8 `while (true)` phantom-branch
// coverage quirk.
const MAX_BATCHES = 100;
export interface ReconcileDeps {
    db: ApplicationDb;
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
async function markFailed(doc: ContentAnalysisHydrated, category: 'unexpected' | 'ai_budget_exceeded', messageKey: string, now: Date): Promise<void> {
    assertContentAnalysisTransition(doc.status, 'failed');
    doc.status = 'failed';
    doc.error = {
        category,
        messageKey,
        retryable: false,
        terminal: true,
    };
    doc.completedAt = now;
    await doc.save();
}
/**
 * Runs one reconciliation pass. Deterministic — every call reads a snapshot
 * from `deps.now()` and works only over rows that were `updatedAt` before
 * that instant, so a re-run after adding fresh docs cannot double-process
 * the same row.
 */
export async function runContentAnalysisReconciliationSweep(deps: ReconcileDeps): Promise<ReconcileOutcome> {
    const now = (deps.now ?? (() => new Date()))();
    const queuedOrphanMs = deps.queuedOrphanMs ?? DEFAULT_QUEUED_ORPHAN_MS;
    const stuckRunMs = deps.stuckRunMs ?? DEFAULT_STUCK_RUN_MS;
    const limit = deps.batchSize ?? CONTENT_ANALYSIS_RECON_BATCH_SIZE;
    const orphanCutoff = new Date(now.getTime() - queuedOrphanMs);
    const stuckCutoff = new Date(now.getTime() - stuckRunMs);
    const outcome: ReconcileOutcome = {
        scanned: 0,
        markedOrphan: 0,
        markedStuck: 0,
        skipped: 0,
    };
    for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
        const rows = await ContentAnalysis.find({
            status: { $in: NON_TERMINAL_STATUSES },
            updatedAt: { $lte: stuckCutoff },
        })
            .sort({ updatedAt: 1 })
            .limit(limit);
        // Also scan queued rows that may have been created between stuckCutoff
        // and orphanCutoff (they wouldn't be picked up by the stuck-run filter
        // yet). Keep it separate so the two windows don't overlap semantics.
        const queuedRows = queuedOrphanMs < stuckRunMs
            ? await ContentAnalysis.find({
                status: 'queued',
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
            const leased = await tryRunWithSiteWorkLease({ accountId: String(doc.accountId), siteId: String(doc.siteId) }, `content-analysis-recon:${String(doc._id)}`, async () => {
                if ((CONTENT_ANALYSIS_TERMINAL_STATUSES as readonly string[]).includes(doc.status)) {
                    outcome.skipped += 1;
                    return;
                }
                if (doc.status === 'queued') {
                    const jobId = contentAnalysisJobId(String(doc._id));
                    const job = await deps.queue.getJob(jobId);
                    if (job) {
                        outcome.skipped += 1;
                        return;
                    }
                    await markFailed(doc, 'unexpected', 'contentIntelligence.errors.orphanedReservation', now);
                    await recordContentAnalysisEvent(deps.db, {
                        accountId: String(doc.accountId),
                        siteId: String(doc.siteId),
                        analysisId: String(doc._id),
                        reservationKey: doc.idempotencyKey,
                        kind: 'failed',
                        units: 0,
                        errorCategory: 'unexpected',
                    });
                    outcome.markedOrphan += 1;
                    deps.logger.warn({
                        analysisId: String(doc._id),
                        accountId: String(doc.accountId),
                        queue: CONTENT_ANALYSIS_QUEUE,
                    }, 'content-analysis reconciliation: orphaned run (queued but no job); marked failed');
                    return;
                }
                await markFailed(doc, 'unexpected', 'contentIntelligence.errors.stalledRun', now);
                await recordContentAnalysisEvent(deps.db, {
                    accountId: String(doc.accountId),
                    siteId: String(doc.siteId),
                    analysisId: String(doc._id),
                    reservationKey: doc.idempotencyKey,
                    kind: 'failed',
                    units: 0,
                    errorCategory: 'unexpected',
                });
                outcome.markedStuck += 1;
                deps.logger.warn({
                    analysisId: String(doc._id),
                    accountId: String(doc.accountId),
                    status: doc.status,
                }, 'content-analysis reconciliation: stalled run; marked failed');
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
 * BullMQ processor for the content-analysis reconciliation queue. Registered
 * on the worker; the repeat schedule (INTERVAL_MS) is set by the api at boot.
 */
export function createContentAnalysisReconciliationProcessor(deps: ReconcileDeps) {
    return async (): Promise<ReconcileOutcome> => runContentAnalysisReconciliationSweep(deps);
}
