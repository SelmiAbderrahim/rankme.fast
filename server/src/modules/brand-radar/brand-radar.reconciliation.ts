/**
 * Brand Radar — reconciliation sweep.
 *
 * Two failure modes it closes, mirroring the shipped
 * `audience-research.reconciliation.ts` pattern:
 *
 *   1. Orphaned — the scan document landed but BullMQ never delivered the
 *      job. The row sits `queued` with no live job
 *      for the deterministic job id. The sweep RE-ENQUEUES it (the job id is
 *      deterministic, so a re-enqueue can never fan out twice).
 *   2. Stuck runs — a `running` row whose `updatedAt` has not moved for
 *      longer than the stuck window (a worker crashed mid-stage), or a
 *      `queued` row that has been orphaned for that same long window. Both
 *      are marked `failed` and get one scan-level `failed` event row.
 *
 * Idempotent: terminal rows filter out at query time, and the event write
 * collides on the Postgres unique index, so a re-run never doubles a row.
 */
import type { Queue } from 'bullmq';
import type { Logger } from 'pino';
import { isSupportedLocale } from '../../shared/i18n/locales.js';
import { brandRadarScanJobId, enqueueBrandRadarScanJob, } from '../../shared/queue/index.js';
import { BrandRadarScan, type BrandRadarScanHydrated, } from './brand-radar.model.js';
import { recordBrandRadarEvent } from './brand-radar.events.js';
import { tryRunWithSiteWorkLease } from '../sites/index.js';
export const BRAND_RADAR_RECON_QUEUE = 'brand-radar-recon';
export const BRAND_RADAR_RECON_JOB = 'sweep';
export const BRAND_RADAR_RECON_SCHEDULER_KEY = 'brand-radar-reconciliation-sweep';
/** How long a `queued` scan may sit without a live job before re-enqueue. */
export const BRAND_RADAR_QUEUED_ORPHAN_MS = 10 * 60 * 1000;
/** How long a non-terminal scan may sit without a Mongo write before it is stuck. */
export const BRAND_RADAR_STUCK_RUN_MS = 60 * 60 * 1000;
export const BRAND_RADAR_RECON_INTERVAL_MS = 5 * 60 * 1000;
export const BRAND_RADAR_RECON_BATCH_SIZE = 100;
/** Reason code recorded on a swept scan. Never user text. */
export const BRAND_RADAR_RECON_REASON = 'processing_failure';
const MAX_BATCHES = 100;
export interface BrandRadarReconcileDeps {
    db: ApplicationDb;
    logger: Logger;
    queue: Queue;
    now?: () => Date;
    queuedOrphanMs?: number;
    stuckRunMs?: number;
    batchSize?: number;
}
export interface BrandRadarReconcileOutcome {
    scanned: number;
    reEnqueued: number;
    markedFailed: number;
    skipped: number;
}
async function markFailed(deps: BrandRadarReconcileDeps, doc: BrandRadarScanHydrated, now: Date): Promise<void> {
    doc.status = 'failed';
    // Whole-run halt disclosure: the sweep cannot know which vendor stage
    // the crashed worker died in, so it records the honest whole-run stage
    // instead of fabricating one.
    doc.halt = { stage: 'scan', reason: BRAND_RADAR_RECON_REASON };
    doc.terminalAt = now;
    await doc.save();
    await recordBrandRadarEvent(deps.db, {
        accountId: String(doc.accountId),
        scanId: String(doc._id),
        stage: 'scan',
        event: 'failed',
        costMicros: 0,
        metadata: {
            reason: BRAND_RADAR_RECON_REASON,
            retainedRows: doc.retainedRowCount,
        },
    });
}
/**
 * One deterministic pass. Every call snapshots `deps.now()` and only touches
 * rows whose `updatedAt` is older than the relevant cutoff, so a re-run cannot
 * double-process a row that was written after the snapshot.
 */
export async function runBrandRadarReconciliationSweep(deps: BrandRadarReconcileDeps): Promise<BrandRadarReconcileOutcome> {
    const now = (deps.now ?? (() => new Date()))();
    const queuedOrphanMs = deps.queuedOrphanMs ?? BRAND_RADAR_QUEUED_ORPHAN_MS;
    const stuckRunMs = deps.stuckRunMs ?? BRAND_RADAR_STUCK_RUN_MS;
    const limit = deps.batchSize ?? BRAND_RADAR_RECON_BATCH_SIZE;
    const stuckCutoff = new Date(now.getTime() - stuckRunMs);
    const orphanCutoff = new Date(now.getTime() - queuedOrphanMs);
    const outcome: BrandRadarReconcileOutcome = {
        scanned: 0,
        reEnqueued: 0,
        markedFailed: 0,
        skipped: 0,
    };
    for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
        const rows = await BrandRadarScan.find({
            status: { $in: ['queued', 'running'] },
            updatedAt: { $lte: orphanCutoff },
        })
            .sort({ updatedAt: 1 })
            .limit(limit);
        if (rows.length === 0)
            break;
        for (const doc of rows) {
            outcome.scanned += 1;
            const scanId = String(doc._id);
            const accountId = String(doc.accountId);
            // Site scoping: every scan carries a site, so
            // the sweep always runs under the site work lease — the old
            // account-only branch is gone with the legacy null-sited rows.
            const siteId = String(doc.siteId);
            const reconcile = async (): Promise<void> => {
                // Locale is part of the persisted execution contract. Reconciliation
                // may replay that contract, but it must never infer one for active
                // legacy work: fail and compensate before any provider-capable enqueue.
                if (!isSupportedLocale(doc.outputLocale)) {
                    await markFailed(deps, doc, now);
                    outcome.markedFailed += 1;
                    deps.logger.warn({ scanId, accountId }, 'brand-radar reconciliation: invalid output locale; marked failed');
                    return;
                }
                const stuck = doc.updatedAt.getTime() <= stuckCutoff.getTime();
                if (doc.status === 'queued' && !stuck) {
                    const job = await deps.queue.getJob(brandRadarScanJobId(scanId));
                    if (job) {
                        outcome.skipped += 1;
                        return;
                    }
                    await enqueueBrandRadarScanJob(deps.queue, {
                        accountId,
                        siteId,
                        scanId,
                        outputLocale: doc.outputLocale,
                    });
                    outcome.reEnqueued += 1;
                    deps.logger.warn({ scanId, accountId }, 'brand-radar reconciliation: orphaned scan; re-enqueued');
                    return;
                }
                if (!stuck) {
                    outcome.skipped += 1;
                    return;
                }
                await markFailed(deps, doc, now);
                outcome.markedFailed += 1;
                deps.logger.warn({ scanId, accountId }, 'brand-radar reconciliation: stalled scan; marked failed');
            };
            const leased = await tryRunWithSiteWorkLease({ accountId, siteId }, `brand-radar-recon:${scanId}`, reconcile);
            if (!leased.acquired)
                outcome.skipped += 1;
        }
        if (rows.length < limit)
            break;
    }
    return outcome;
}
/**
 * BullMQ processor for the reconciliation queue. The worker registers it and
 * owns the repeat schedule (`BRAND_RADAR_RECON_INTERVAL_MS`).
 */
export function createBrandRadarReconciliationProcessor(deps: BrandRadarReconcileDeps) {
    return async (): Promise<BrandRadarReconcileOutcome> => runBrandRadarReconciliationSweep(deps);
}
