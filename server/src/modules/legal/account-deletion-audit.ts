import { recordAuditOnce, type AuditAction } from '../audit/index.js';
import { User } from '../users/index.js';
import { deletedMongoActorId, deletedMongoReference } from './account-retained-mongo.js';
export type AccountDeletionAuditOutcome = 'requested' | 'cancelled' | 'completed';
const ACTION_BY_OUTCOME: Record<AccountDeletionAuditOutcome, AuditAction> = {
    requested: 'data.delete.requested',
    cancelled: 'data.delete.cancelled',
    completed: 'data.delete.completed',
};
export function accountDeletionAuditIdempotencyKey(outcome: AccountDeletionAuditOutcome, lifecycleId: string): string {
    return deletedMongoReference(`account-deletion:${outcome}:${lifecycleId}`);
}
export async function recordAccountDeletionAudit(input: {
    accountId: string;
    lifecycleId: string;
    outcome: AccountDeletionAuditOutcome;
    ip?: string;
}): Promise<boolean> {
    const completed = input.outcome === 'completed';
    return recordAuditOnce(accountDeletionAuditIdempotencyKey(input.outcome, input.lifecycleId), {
        // Completion is created after retained-data sanitization, so it must be
        // pseudonymous at birth. Requested/cancelled evidence is sanitized by a
        // later successful purge along with the account's other audit history.
        actorUserId: completed
            ? String(deletedMongoActorId(input.accountId))
            : input.accountId,
        action: ACTION_BY_OUTCOME[input.outcome],
        targetType: 'user',
        targetId: completed
            ? deletedMongoReference(input.accountId)
            : input.accountId,
        ip: completed ? '' : (input.ip ?? ''),
        metadata: completed ? { redacted: true } : { outcome: input.outcome },
    });
}
/**
 * Crash repair for the cancellation two-phase handoff. A pending marker keeps
 * the original schedule visible while excluding purge claims. Any request,
 * processor, or reconciler can idempotently persist the cancellation outcome
 * and then clear that exact lifecycle without touching a later reschedule.
 */
export async function completePendingAccountCancellation(accountId: string): Promise<boolean> {
    const user = await User.findById(accountId)
        .select('deletionScheduledAt deletionStartedAt deletionLifecycleId deletionCancellationId deletionCancellationRequestedAt')
        .lean();
    if (!user?.deletionCancellationRequestedAt)
        return false;
    if (user.deletionStartedAt) {
        throw new Error('account cancellation raced an irreversible deletion claim');
    }
    if (!user.deletionCancellationId) {
        throw new Error('account cancellation marker is missing its lifecycle id');
    }
    const cancellationId = user.deletionCancellationId;
    await recordAccountDeletionAudit({
        accountId,
        lifecycleId: cancellationId,
        outcome: 'cancelled',
    });
    const finalized = await User.updateOne({
        _id: accountId,
        deletionCancellationId: cancellationId,
        deletionCancellationRequestedAt: user.deletionCancellationRequestedAt,
        deletionStartedAt: null,
    }, {
        $set: {
            deletionScheduledAt: null,
            deletionWarningSentAt: null,
            deletionLifecycleId: null,
            deletionCancellationId: null,
            deletionCancellationRequestedAt: null,
        },
    });
    if (finalized.modifiedCount !== 1) {
        throw new Error('account cancellation audit persisted but finalization did not converge');
    }
    return true;
}
