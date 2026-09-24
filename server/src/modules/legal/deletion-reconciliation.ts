import type { Logger } from 'pino';
import { Site, deleteSite } from '../sites/index.js';
import { User } from '../users/index.js';
export const DELETION_RECONCILIATION_BATCH_SIZE = 50;
export const DELETION_RECONCILIATION_INTERVAL_MS = 60000;
export const DELETION_RECONCILIATION_MAX_BACKOFF_MS = 15 * 60000;
export interface DeletionReconciliationDeps {
    logger: Logger;
    purgeAccount(userId: string): Promise<unknown>;
    deleteClaimedSite?: typeof deleteSite;
    now?: () => Date;
    batchSize?: number;
}
export interface DeletionReconciliationResult {
    accountsAttempted: number;
    sitesAttempted: number;
    failures: number;
}
/**
 * Bounded recovery pass. Expiring attempt predicates prevent replicas from
 * selecting an attempt another worker still owns. The attempt CAS remains the
 * final authority if two replicas read the same expired row concurrently.
 */
export async function reconcileDeletionBatch(deps: DeletionReconciliationDeps): Promise<DeletionReconciliationResult> {
    const now = deps.now?.() ?? new Date();
    const limit = deps.batchSize ?? DELETION_RECONCILIATION_BATCH_SIZE;
    const accountRows = await User.find({
        legalHold: { $ne: true },
        $or: [
            {
                deletionStartedAt: null,
                deletionCancellationRequestedAt: { $ne: null },
            },
            {
                deletionStartedAt: null,
                deletionCancellationRequestedAt: null,
                deletionScheduledAt: { $ne: null, $lte: now },
            },
            {
                deletionStartedAt: { $ne: null },
                $or: [
                    { deletionAttemptLeaseId: null },
                    { deletionAttemptExpiresAt: null },
                    { deletionAttemptExpiresAt: { $lte: now } },
                ],
            },
        ],
    }, { _id: 1 })
        .sort({ deletionStartedAt: 1, deletionScheduledAt: 1, _id: 1 })
        .limit(limit)
        .lean();
    let failures = 0;
    for (const row of accountRows) {
        try {
            await deps.purgeAccount(String(row._id));
        }
        catch (error) {
            failures += 1;
            deps.logger.warn({ err: error, accountId: String(row._id) }, 'account deletion reconciliation attempt failed');
        }
    }
    const siteRows = await Site.find({
        deletionStartedAt: { $ne: null },
        $or: [
            { deletionAttemptLeaseId: null },
            { deletionAttemptExpiresAt: null },
            { deletionAttemptExpiresAt: { $lte: now } },
        ],
    }, {
        _id: 1,
        accountId: 1,
        deletionActorUserId: 1,
        deletionAuditSource: 1,
    })
        .sort({ deletionStartedAt: 1, _id: 1 })
        .limit(limit)
        .lean();
    const deleteClaimedSite = deps.deleteClaimedSite ?? deleteSite;
    for (const row of siteRows) {
        try {
            await deleteClaimedSite(String(row.accountId), String(row._id), {
                actorUserId: String(row.deletionActorUserId ?? row.accountId),
                ...(row.deletionAuditSource
                    ? { auditSource: row.deletionAuditSource }
                    : {}),
            });
        }
        catch (error) {
            failures += 1;
            deps.logger.warn({ err: error, accountId: String(row.accountId), siteId: String(row._id) }, 'site deletion reconciliation attempt failed');
        }
    }
    return {
        accountsAttempted: accountRows.length,
        sitesAttempted: siteRows.length,
        failures,
    };
}
export interface DeletionReconciler {
    close(): Promise<void>;
    runNow(): Promise<DeletionReconciliationResult>;
}
/** Single-flight timer with bounded exponential backoff and graceful drain. */
export function startDeletionReconciler(deps: DeletionReconciliationDeps, options: {
    intervalMs?: number;
    maxBackoffMs?: number;
} = {}): DeletionReconciler {
    const intervalMs = options.intervalMs ?? DELETION_RECONCILIATION_INTERVAL_MS;
    const maxBackoffMs = options.maxBackoffMs ?? DELETION_RECONCILIATION_MAX_BACKOFF_MS;
    let stopped = false;
    let timer: NodeJS.Timeout | null = null;
    let inFlight: Promise<DeletionReconciliationResult> | null = null;
    let nextDelay = intervalMs;
    const schedule = (): void => {
        if (stopped)
            return;
        timer = setTimeout(() => {
            timer = null;
            void runNow();
        }, nextDelay);
        timer.unref();
    };
    const runNow = async (): Promise<DeletionReconciliationResult> => {
        if (inFlight)
            return inFlight;
        inFlight = reconcileDeletionBatch(deps);
        try {
            const result = await inFlight;
            nextDelay = result.failures === 0
                ? intervalMs
                : Math.min(maxBackoffMs, Math.max(intervalMs, nextDelay * 2));
            return result;
        }
        catch (error) {
            nextDelay = Math.min(maxBackoffMs, Math.max(intervalMs, nextDelay * 2));
            deps.logger.error({ err: error }, 'deletion reconciliation pass failed');
            throw error;
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
            if (timer)
                clearTimeout(timer);
            if (inFlight)
                await inFlight.catch(() => undefined);
        },
    };
}
