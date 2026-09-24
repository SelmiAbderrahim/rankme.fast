import { DelayedError, type Job } from 'bullmq';
import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { Queues } from '../../shared/queue/index.js';
import type { GoogleGscProvider } from '../../shared/providers/google/gsc.js';
import type { ApplicationDb } from '../../shared/types/application-db.js';
import { accountPurgeJobSchema, parseConsumedPayload, } from '../../shared/queue/index.js';
import { installAccountDeletionBarrier } from '../../shared/account-deletion/postgres.js';
import { AuditRun } from '../audits/audit-run.model.js';
import { getGoogleGscProvider, revokeBetterAuthGoogleTokens, revokeAndDelete, } from '../google-connections/index.js';
import { Site, deleteSite, getSiteLifecycleQueues } from '../sites/index.js';
import { User } from '../users/index.js';
import { assertCurrentAccountWorkLease, claimAccountDeletionAttempt, runWithAccountDeletionContext, } from './account-lifecycle.js';
import { collectAccountMongoResources, purgeAccountMongoData, } from './account-mongo-cascade.js';
import { purgeAccountPostgresData } from './account-postgres-cascade.js';
import { purgeAccountQueueData } from './account-queue-cascade.js';
import { sanitizeRetainedMongoData } from './account-retained-mongo.js';
import { completePendingAccountCancellation, recordAccountDeletionAudit, } from './account-deletion-audit.js';
import { denyReportExportsForAccount } from '../report-exports/index.js';
export class AccountPurgeBusyError extends Error {
    constructor() {
        super('account purge is waiting for active account work');
        this.name = 'AccountPurgeBusyError';
    }
}
export interface AccountPurgeDeps {
    db: ApplicationDb;
    logger: Logger;
    queues?: Queues | null;
    gscProvider?: GoogleGscProvider | null;
    now?: () => Date;
    /** Focused fault-injection seam; production leaves this undefined. */
    afterLocalMongoPurge?: () => Promise<void>;
    /** Focused proof that final ownership is revalidated after audit persistence. */
    afterCompletionAudit?: () => Promise<void>;
    /** Focused claim/read race seam; production leaves this undefined. */
    afterDeletionClaim?: () => Promise<void>;
    /** Focused early-delivery race seam; production leaves this undefined. */
    afterNotDueClaim?: () => Promise<void>;
}
/**
 * The legacy per-collection counters remain for API/test compatibility. The
 * lifecycle now uses schema-ratcheted graph cascades; `mongoDocuments` is the
 * authoritative aggregate.
 */
export interface AccountPurgeStats {
    userId: string;
    sites: number;
    mongoDocuments: number;
    postgresRows: number;
    auditLogs: number;
    mongoRuns: number;
    auditedPages: number;
    reportSnapshots: number;
    googleConnections: number;
    contentAnalyses: number;
    contentSnapshots: number;
    contentInventoryRuns: number;
    contentInventoryPages: number;
    contentInventorySnapshots: number;
    competitorContentRuns: number;
    competitorContentPages: number;
    competitorContentSnapshots: number;
    contentMonitors: number;
    monitorWebhookReceipts: number;
    monitorEvidence: number;
}
export type AccountPurgeResult = AccountPurgeStats | {
    skipped: string;
    userId: string;
};
export function createAccountPurgeProcessor(deps: AccountPurgeDeps) {
    return async (job: Job): Promise<AccountPurgeResult> => {
        const payload = parseConsumedPayload(accountPurgeJobSchema, job.data);
        const result = await purgeAccount(payload.userId, deps);
        if ('skipped' in result && result.skipped === 'not-due') {
            const scheduled = await User.findById(payload.userId)
                .select('deletionScheduledAt')
                .lean();
            if (scheduled?.deletionScheduledAt) {
                await job.moveToDelayed(scheduled.deletionScheduledAt.getTime(), job.token);
                // BullMQ requires this sentinel after manual delayed transition so the
                // worker does not also mark the same job completed.
                throw new DelayedError();
            }
        }
        return result;
    };
}
function emptyLegacyStats(): Omit<AccountPurgeStats, 'userId' | 'sites' | 'mongoDocuments' | 'postgresRows' | 'auditLogs'> {
    return {
        mongoRuns: 0,
        auditedPages: 0,
        reportSnapshots: 0,
        googleConnections: 0,
        contentAnalyses: 0,
        contentSnapshots: 0,
        contentInventoryRuns: 0,
        contentInventoryPages: 0,
        contentInventorySnapshots: 0,
        competitorContentRuns: 0,
        competitorContentPages: 0,
        competitorContentSnapshots: 0,
        contentMonitors: 0,
        monitorWebhookReceipts: 0,
        monitorEvidence: 0,
    };
}
export async function purgeAccount(userId: string, deps: AccountPurgeDeps): Promise<AccountPurgeResult> {
    const now = deps.now?.() ?? new Date();
    if (await completePendingAccountCancellation(userId)) {
        deps.logger.info({ userId }, 'account purge skipped — cancellation completed');
        return { userId, skipped: 'not-scheduled' };
    }
    const claim = await claimAccountDeletionAttempt(userId, randomUUID(), now);
    if (claim.status === 'missing') {
        deps.logger.info({ userId }, 'account purge skipped — user already gone');
        return { userId, skipped: 'user-missing' };
    }
    if (claim.status === 'legal-hold') {
        deps.logger.info({ userId }, 'account purge skipped — legal hold active');
        return { userId, skipped: 'legal-hold' };
    }
    if (claim.status === 'not-due') {
        const scheduled = await User.findById(userId).select('deletionScheduledAt').lean();
        const reason = scheduled?.deletionScheduledAt ? 'not-due' : 'not-scheduled';
        deps.logger.info({ userId }, 'account purge skipped — deletion is not due');
        await deps.afterNotDueClaim?.();
        return { userId, skipped: reason };
    }
    if (claim.status === 'busy')
        throw new AccountPurgeBusyError();
    await deps.afterDeletionClaim?.();
    return runWithAccountDeletionContext(claim.attempt, async () => {
        const user = await User.findById(userId)
            .select('email deletionLifecycleId')
            .lean();
        if (!user)
            return { userId, skipped: 'user-missing' };
        const queues = deps.queues === undefined ? getSiteLifecycleQueues() : deps.queues;
        await assertCurrentAccountWorkLease();
        await installAccountDeletionBarrier(deps.db, userId, claim.startedAt);
        await denyReportExportsForAccount(userId, claim.startedAt);
        const sites = await Site.find({ accountId: userId }, { _id: 1 }).lean();
        const siteIds = sites.map((site) => String(site._id)).sort();
        const mongoInventory = await collectAccountMongoResources(userId);
        const resourceIds = new Set<string>([userId, ...siteIds]);
        for (const ids of mongoInventory.idsByModel.values()) {
            for (const id of ids)
                resourceIds.add(id);
        }
        // Refuse deletion under old/unwrapped active work and remove all queued
        // manifestations before external teardown.
        await assertCurrentAccountWorkLease();
        await purgeAccountQueueData(queues, userId);
        const googleConnectionExists = mongoInventory.idsByModel.get('GoogleConnection')?.size;
        const gscProvider = deps.gscProvider === undefined
            ? getGoogleGscProvider()
            : deps.gscProvider;
        if (googleConnectionExists) {
            if (!gscProvider)
                throw new Error('Google token revocation is unavailable');
            await assertCurrentAccountWorkLease();
            await revokeAndDelete(userId, gscProvider, deps.logger, { failClosed: true });
        }
        // Better Auth can hold Google access/refresh credentials without a Mongo
        // GSC connection (social-login-only accounts). The helper decrypts both
        // migration-safe encrypted and legacy plaintext rows, dedupes, and fails
        // closed only when revocable tokens actually exist.
        await assertCurrentAccountWorkLease();
        await revokeBetterAuthGoogleTokens(userId, gscProvider);
        // Account deletion owns the terminal state of any stale audit row. Site
        // deletion's public 409 remains intact for ordinary callers.
        await AuditRun.updateMany({ accountId: userId, status: { $in: ['queued', 'running'] } }, { $set: { status: 'failed', error: 'account_deleted' } });
        for (const siteId of siteIds) {
            await deleteSite(userId, siteId);
        }
        await assertCurrentAccountWorkLease();
        const retained = await sanitizeRetainedMongoData({
            accountId: userId,
            resourceIds,
        });
        const mongo = await purgeAccountMongoData(userId);
        // Deliberate failure seam proves a retry can resume from a locally erased
        // Mongo graph while the durable User claim/tombstone remain.
        await deps.afterLocalMongoPurge?.();
        await assertCurrentAccountWorkLease();
        const postgresRows = await purgeAccountPostgresData(deps.db, {
            accountId: userId,
            email: user.email,
        });
        // A producer that cleared an ownership check immediately before the claim
        // may have enqueued during the first sweep. Converge after all stores are
        // erased; the permanent tombstone rejects any later Postgres writes.
        await assertCurrentAccountWorkLease();
        await purgeAccountQueueData(queues, userId);
        // Durable completion evidence is the last fallible local write before the
        // User manifest disappears. It starts pseudonymous because retained-data
        // sanitization already ran, and its idempotency key lets a claimed retry
        // repair an ambiguous/crashed finalization without duplicating evidence.
        await assertCurrentAccountWorkLease();
        const completionAuditCreated = await recordAccountDeletionAudit({
            accountId: userId,
            lifecycleId: user.deletionLifecycleId ?? claim.startedAt.toISOString(),
            outcome: 'completed',
        });
        await deps.afterCompletionAudit?.();
        const stats: AccountPurgeStats = {
            userId,
            sites: siteIds.length,
            mongoDocuments: mongo.documents,
            postgresRows,
            auditLogs: retained.auditLogs + (completionAuditCreated ? 1 : 0),
            ...emptyLegacyStats(),
        };
        // Mongo User mirror LAST. There is no fallible teardown after this write;
        // even logging is swallowed so a completed purge can never be retried as a
        // false failure after its final manifest disappeared.
        await assertCurrentAccountWorkLease();
        await User.deleteOne({ _id: userId, deletionStartedAt: { $ne: null } });
        try {
            deps.logger.info({ stats }, 'account purge complete');
        }
        catch {
            // Logging must not change a completed lifecycle outcome.
        }
        return stats;
    });
}
