/**
 * Delivery-only alert outbox reconciliation.
 *
 * Redis is disposable and BullMQ can replay a stalled job without advancing
 * attemptsMade. This bounded sweep rebuilds only dispatch work that already
 * has a durable delivery row; it never detects a new transition or spends at
 * a vendor. Recovery job ids include the durable claim generation so a failed
 * BullMQ job retained by removeOnFail cannot block the next repair.
 */
import { createHash } from 'node:crypto';
import type { Queue } from 'bullmq';
import type { Logger } from 'pino';
import type { Db } from '../../db/client.js';
import { ALERT_DISPATCH_JOB_NAME } from '../../shared/queue/index.js';
import { alertEvidenceSchema } from './alerts.schema.js';
import { ALERT_DELIVERY_CLAIM_LEASE_MS, ALERT_DELIVERY_RECONCILE_LIMIT, ALERT_IDEMPOTENCY_RETRY_WINDOW_MS, } from './alert-dispatch.service.js';
import { expireAlertDeliveryClaims, listTransitionDeliveries, listRecoverableAlertDeliveries, markAlertDeliveriesReconciled, terminalizeInvalidAlertDeliveries, } from './alerts.repo.js';
export interface AlertDeliveryReconciliationOutcome {
    expired: number;
    examined: number;
    enqueued: number;
}
export function latestAlertTransitionRows<T extends {
    ruleId: string;
    transitionId: string;
    updatedAt: Date;
}>(rows: readonly T[]): T[] {
    const transitions = new Map<string, T>();
    for (const row of rows) {
        const key = `${row.ruleId}\0${row.transitionId}`;
        const prior = transitions.get(key);
        if (!prior || prior.updatedAt < row.updatedAt)
            transitions.set(key, row);
    }
    return [...transitions.values()];
}
export async function reconcileAlertDeliveries(db: Db, queue: Queue, options: {
    now?: () => Date;
    logger?: Logger;
} = {}): Promise<AlertDeliveryReconciliationOutcome> {
    const now = (options.now ?? (() => new Date()))();
    const retryAfter = new Date(now.getTime() - ALERT_IDEMPOTENCY_RETRY_WINDOW_MS);
    const staleBefore = new Date(now.getTime() - ALERT_DELIVERY_CLAIM_LEASE_MS);
    const expired = await expireAlertDeliveryClaims(db, {
        retryAfter,
        now,
        limit: ALERT_DELIVERY_RECONCILE_LIMIT,
    });
    const rows = await listRecoverableAlertDeliveries(db, {
        retryAfter,
        staleBefore,
        limit: ALERT_DELIVERY_RECONCILE_LIMIT,
    });
    let enqueued = 0;
    for (const row of latestAlertTransitionRows(rows)) {
        const transitionRows = await listTransitionDeliveries(db, {
            accountId: row.accountId,
            ruleId: row.ruleId,
            transitionId: row.transitionId,
        });
        try {
            const evidence = alertEvidenceSchema.parse(row.evidence);
            const generation = createHash('sha256')
                .update(`${row.ruleId}\0${row.transitionId}\0${row.attempt}\0${row.updatedAt.toISOString()}`)
                .digest('hex')
                .slice(0, 20);
            await queue.add(ALERT_DISPATCH_JOB_NAME, {
                accountId: row.accountId,
                siteId: row.siteId,
                ruleId: row.ruleId,
                transitionId: row.transitionId,
                evidence,
            }, { jobId: `alert-recovery-${generation}` });
            enqueued += 1;
        }
        catch (error) {
            if (!alertEvidenceSchema.safeParse(row.evidence).success) {
                await terminalizeInvalidAlertDeliveries(db, transitionRows.map((delivery) => delivery.id), now);
            }
            options.logger?.warn({
                deliveryId: row.id,
                errorName: error instanceof Error ? error.name : 'NonError',
            }, 'alert delivery reconciliation skipped an invalid durable row');
        }
        finally {
            // Independent cursor rotation prevents retained/deduped queue jobs from
            // monopolizing the first bounded page and starving later transitions.
            await markAlertDeliveriesReconciled(db, transitionRows.map((delivery) => delivery.id), now);
        }
    }
    return { expired: expired.length, examined: rows.length, enqueued };
}
