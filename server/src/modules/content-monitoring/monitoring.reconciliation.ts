/**
 * Public-page change monitoring — reconciliation sweep.
 *
 * Two jobs, both idempotent:
 *   1. Provider drift — read the safe provider status for active/paused monitors
 *      and fold an out-of-band provider `error` / `paused` back into local state
 *      (never recreate a monitor blindly).
 *   2. Durable-receipt recovery — stale `received`, `processing`, or
 *      `notification_pending` receipts are enqueued/retried. This drains both
 *      webhook enqueue failures and notification crash windows without calling
 *      the content vendor.
 *
 * SEC-REDACT: no page content is ever logged.
 */
import type { Queue } from 'bullmq';
import type { Logger } from 'pino';
import { randomUUID } from 'node:crypto';
import { contentMonitorJobId, enqueueContentMonitorJob, } from '../../shared/queue/index.js';
import { env } from '../../config/env.js';
import type { ContentMonitorProvider } from '../../shared/providers/index.js';
import { decryptSecret } from '../../shared/crypto/index.js';
import { filterPausedSiteIds } from '../sites/sites.guard.js';
import { acquireSiteWorkLease, releaseSiteWorkLease, runWithSiteWorkLeaseContext, } from '../sites/site-lifecycle.js';
import { isKillSwitchEnabled } from '../../shared/safety/feature-flags.js';
import { ContentMonitor, MonitorWebhookReceipt, type MonitorWebhookReceiptHydrated, } from './monitor.model.js';
import { finalizeClosedMonitorNotification } from './monitoring.processor.js';
import { assertContentMonitorTransition } from './monitoring.state.js';
import { terminalSkipMonitorReceipt } from './monitoring.receipts.js';
export const CONTENT_MONITOR_RECON_QUEUE = 'content-monitor-recon';
export const CONTENT_MONITOR_RECON_JOB = 'sweep';
export const CONTENT_MONITOR_RECON_SCHEDULER_KEY = 'content-monitor-reconciliation-sweep';
/** A `received` receipt older than this whose job never landed is re-enqueued. */
export const DEFAULT_STUCK_RECEIPT_MS = 10 * 60 * 1000; // 10 minutes.
export const CONTENT_MONITOR_RECON_BATCH_SIZE = 200;
export interface MonitorReconcileDeps {
    db: ApplicationDb;
    logger: Logger;
    queue: Queue;
    provider: ContentMonitorProvider;
    now?: () => Date;
    stuckReceiptMs?: number;
    batchSize?: number;
}
export interface MonitorReconcileOutcome {
    driftReconciled: number;
    receiptsRequeued: number;
    /** Monitors/receipts skipped because their site is paused (no spend). */
    skippedPaused: number;
}
function emptyOutcome(): MonitorReconcileOutcome {
    return {
        driftReconciled: 0,
        receiptsRequeued: 0,
        skippedPaused: 0,
    };
}
async function withMonitorSiteLease(resource: {
    accountId: unknown;
    siteId: unknown;
}, operation: () => Promise<void>): Promise<boolean> {
    const accountId = String(resource.accountId);
    const siteId = String(resource.siteId);
    const lease = await acquireSiteWorkLease({ accountId, siteId }, `content-monitor-reconcile:${randomUUID()}`);
    if (!lease)
        return false;
    try {
        await runWithSiteWorkLeaseContext(lease, operation);
        return true;
    }
    finally {
        await releaseSiteWorkLease(lease);
    }
}
/** Fold an out-of-band provider status back into local state (no recreation). */
async function runDriftSweep(deps: MonitorReconcileDeps, now: Date, outcome: MonitorReconcileOutcome): Promise<void> {
    const monitors = await ContentMonitor.find({
        status: { $in: ['active', 'paused'] },
        deletionStartedAt: null,
    })
        .sort({ createdAt: 1 })
        .limit(deps.batchSize ?? CONTENT_MONITOR_RECON_BATCH_SIZE);
    // Skip paused sites — no per-monitor provider status calls for them.
    const pausedSites = await filterPausedSiteIds(monitors.map((m) => String(m.siteId)));
    for (const monitor of monitors) {
        const ran = await withMonitorSiteLease(monitor, async () => {
            if (pausedSites.has(String(monitor.siteId))) {
                outcome.skippedPaused += 1;
                return;
            }
            let providerStatus;
            try {
                providerStatus = (await deps.provider.getMonitorStatus({
                    providerMonitorId: decryptSecret(monitor.providerMonitorIdEncrypted as never),
                    ...(monitor.providerCredentialRef
                        ? { providerCredentialRef: monitor.providerCredentialRef }
                        : {}),
                    timeoutMs: env.FIRECRAWL_TIMEOUT_MS,
                })).status;
            }
            catch {
                deps.logger.warn({ monitorId: String(monitor._id) }, 'content-monitor reconciliation: provider status read failed; leaving local state');
                return;
            }
            monitor.lastReconcileAt = now;
            // Provider reports a hard error but we believe it healthy → reflect it.
            if (providerStatus === 'error' && monitor.status !== 'error') {
                assertContentMonitorTransition(monitor.status, 'error');
                monitor.status = 'error';
                monitor.error = {
                    category: 'reconcile_failed',
                    messageKey: 'contentIntelligence.monitoring.warnings.providerDrift',
                };
                await monitor.save();
                outcome.driftReconciled += 1;
                deps.logger.warn({ monitorId: String(monitor._id) }, 'content-monitor reconciliation: provider reports error; local state reconciled');
                return;
            }
            // Provider paused it out-of-band while we thought it active → reflect it.
            if (providerStatus === 'paused' && monitor.status === 'active') {
                assertContentMonitorTransition(monitor.status, 'paused');
                monitor.status = 'paused';
                await monitor.save();
                outcome.driftReconciled += 1;
                deps.logger.warn({ monitorId: String(monitor._id) }, 'content-monitor reconciliation: provider paused out-of-band; local state reconciled');
                return;
            }
            await monitor.save();
        });
        if (!ran)
            outcome.skippedPaused += 1;
    }
}
/**
 * Re-enqueue a durable receipt. Failed deterministic jobs are retried in place;
 * a completed job paired with a non-terminal receipt is removed/recreated (the
 * only legitimate case is a crash/lease hand-off that left outbox work behind).
 */
async function recoverReceiptJob(deps: MonitorReconcileDeps, receipt: MonitorWebhookReceiptHydrated): Promise<boolean> {
    const jobId = contentMonitorJobId(String(receipt._id));
    // Test queues are intentionally minimal. Production BullMQ queues always
    // expose getJob; falling back to add preserves the enqueue-failure tests.
    const getJob = (deps.queue as Queue & {
        getJob?: (id: string) => Promise<{
            getState(): Promise<string>;
            retry(state?: 'failed' | 'completed'): Promise<void>;
            remove(): Promise<void>;
        } | undefined>;
    }).getJob;
    const existing = getJob ? await getJob.call(deps.queue, jobId) : undefined;
    if (!existing) {
        await enqueueContentMonitorJob(deps.queue, {
            accountId: String(receipt.accountId),
            siteId: String(receipt.siteId),
            monitorId: String(receipt.monitorId),
            receiptId: String(receipt._id),
        });
        return true;
    }
    const state = await existing.getState();
    if (state === 'failed') {
        await existing.retry('failed');
        return true;
    }
    if (state === 'completed') {
        await existing.remove();
        await enqueueContentMonitorJob(deps.queue, {
            accountId: String(receipt.accountId),
            siteId: String(receipt.siteId),
            monitorId: String(receipt.monitorId),
            receiptId: String(receipt._id),
        });
        return true;
    }
    return false;
}
/** Recover stale accepted receipts and durable notification outbox work. */
async function runStuckReceiptSweep(deps: MonitorReconcileDeps, now: Date, outcome: MonitorReconcileOutcome): Promise<void> {
    const cutoff = new Date(now.getTime() - (deps.stuckReceiptMs ?? DEFAULT_STUCK_RECEIPT_MS));
    const receipts = await MonitorWebhookReceipt.find({
        $and: [
            {
                $or: [
                    { status: 'received', receivedAt: { $lte: cutoff } },
                    {
                        status: { $in: ['processing', 'notification_pending'] },
                        updatedAt: { $lte: cutoff },
                    },
                    {
                        status: 'notification_pending',
                        'notification.state': 'sending',
                        'notification.leaseUntil': { $lte: now },
                    },
                ],
            },
            {
                $or: [
                    { recoveryCheckedAt: null },
                    { recoveryCheckedAt: { $lte: cutoff } },
                ],
            },
        ],
    })
        .sort({ recoveryCheckedAt: 1, receivedAt: 1, _id: 1 })
        .limit(deps.batchSize ?? CONTENT_MONITOR_RECON_BATCH_SIZE);
    const pausedSites = await filterPausedSiteIds(receipts.map((r) => String(r.siteId)));
    for (const receipt of receipts) {
        const ran = await withMonitorSiteLease(receipt, async () => {
            if (receipt.status === 'received' &&
                pausedSites.has(String(receipt.siteId))) {
                // Terminal-skip instead of leaving it `received`: a paused-site receipt
                // would otherwise clog every future sweep batch and re-enqueue on
                // resume — the stale webhook event is not worth a late crawl-check.
                await terminalSkipMonitorReceipt(String(receipt._id), now);
                outcome.skippedPaused += 1;
                return;
            }
            const closedNotification = receipt.status === 'notification_pending'
                ? await finalizeClosedMonitorNotification(String(receipt._id), now)
                : null;
            if (closedNotification) {
                deps.logger.warn({
                    receiptId: String(receipt._id),
                    notificationOutcome: closedNotification,
                }, 'content-monitor reconciliation: notification retry boundary closed; receipt terminalized');
                return;
            }
            try {
                if (await recoverReceiptJob(deps, receipt)) {
                    outcome.receiptsRequeued += 1;
                }
            }
            catch {
                deps.logger.warn({ receiptId: String(receipt._id) }, 'content-monitor reconciliation: stuck-receipt re-enqueue failed; will retry next sweep');
            }
            finally {
                await MonitorWebhookReceipt.updateOne({
                    _id: receipt._id,
                    status: { $in: ['received', 'processing', 'notification_pending'] },
                }, { $set: { recoveryCheckedAt: now } }, { runValidators: true });
            }
        });
        if (!ran)
            outcome.skippedPaused += 1;
    }
}
/** Runs one full reconciliation pass. Deterministic given `deps.now()`. */
export async function runContentMonitorReconciliationSweep(deps: MonitorReconcileDeps): Promise<MonitorReconcileOutcome> {
    const now = (deps.now ?? (() => new Date()))();
    const outcome = emptyOutcome();
    // Accepted receipt/outbox recovery is latency-sensitive and provider-free;
    // run it before feature-flag reads or sequential vendor status calls. A control-plane read failure must not strand work already
    // accepted at the webhook boundary.
    await runStuckReceiptSweep(deps, now, outcome);
    // Kill switches stop producing new vendor work. They must not strand
    // receipts already accepted by the webhook boundary: those are durable
    // obligations and are safe to replay because their processor is
    // receipt-idempotent and does not consult the current producer flag.
    const producerEnabled = env.CONTENT_MONITORING_ENABLED &&
        (await isKillSwitchEnabled(deps.db, 'firecrawl_change_monitoring'));
    if (producerEnabled) {
        await runDriftSweep(deps, now, outcome);
    }
    return outcome;
}
/**
 * BullMQ processor for the content-monitor reconciliation queue. Registered on
 * the worker; the repeat schedule (INTERVAL_MS) is set by the worker at boot.
 */
export function createContentMonitorReconciliationProcessor(deps: MonitorReconcileDeps) {
    return async (): Promise<MonitorReconcileOutcome> => runContentMonitorReconciliationSweep(deps);
}
