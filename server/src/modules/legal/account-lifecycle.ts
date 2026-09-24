import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Queue, UnrecoverableError, type Job } from 'bullmq';
import mongoose, { Types } from 'mongoose';
import { logger } from '../../config/logger.js';
import { isLeaseCleanup, runWithLeaseCleanup, } from '../../shared/lifecycle/lease-cleanup.js';
import { User } from '../users/users.model.js';
export const ACCOUNT_WORK_LEASE_MS = 5 * 60 * 1000;
export const ACCOUNT_WORK_LEASE_HEARTBEAT_MS = 30 * 1000;
export const ACCOUNT_DELETION_ATTEMPT_MS = ACCOUNT_WORK_LEASE_MS;
export interface AccountWorkLease {
    accountId: string;
    leaseId: string;
    /** Exclusive purge context created only after the durable deletion claim. */
    deletionOwner?: true;
    deletionAttemptId?: string;
}
export interface AccountDeletionAttempt {
    accountId: string;
    leaseId: string;
}
export type AccountDeletionAttemptClaim = {
    status: 'claimed';
    startedAt: Date;
    attempt: AccountDeletionAttempt;
} | {
    status: 'resumed';
    startedAt: Date;
    attempt: AccountDeletionAttempt;
} | {
    status: 'busy';
} | {
    status: 'legal-hold';
} | {
    status: 'missing';
} | {
    status: 'not-due';
};
export type AccountDeletionClaim = {
    status: 'claimed';
    startedAt: Date;
} | {
    status: 'resumed';
    startedAt: Date;
} | {
    status: 'busy';
} | {
    status: 'legal-hold';
} | {
    status: 'missing';
} | {
    status: 'not-due';
};
const accountWorkContext = new AsyncLocalStorage<AccountWorkLease>();
const accountLeaseBookkeeping = new AsyncLocalStorage<boolean>();
const accountLeaseRenewals = new WeakMap<AccountWorkLease, {
    pending: Promise<void>;
}>();
const accountDeletionRenewals = new WeakMap<AccountWorkLease, {
    pending: Promise<void>;
}>();
interface AccountLeaseRenewalRuntime {
    pending: Promise<void>;
}
function leaseExpiry(now: Date): Date {
    return new Date(now.getTime() + ACCOUNT_WORK_LEASE_MS);
}
export function runWithAccountWorkLeaseContext<Result>(lease: AccountWorkLease, callback: () => Result): Result {
    return accountWorkContext.run(lease, callback);
}
/**
 * Runs the purge after `claimAccountDeletion` won exclusivity. This context
 * may perform teardown writes/provider calls even though normal work leases
 * are permanently closed. It is never exposed to request/job producers.
 */
export function currentAccountWorkLease(): AccountWorkLease | undefined {
    return accountWorkContext.getStore();
}
export async function acquireAccountWorkLease(accountId: string, leaseId: string, now = new Date()): Promise<AccountWorkLease | null> {
    if (!Types.ObjectId.isValid(accountId))
        return null;
    await accountLeaseBookkeeping.run(true, async () => User.updateOne({ _id: accountId, deletionStartedAt: null }, {
        $pull: {
            workLeases: {
                $or: [{ leaseId }, { expiresAt: { $lte: now } }],
            },
        },
    }));
    const user = await accountLeaseBookkeeping.run(true, async () => User.findOneAndUpdate({ _id: accountId, deletionStartedAt: null }, { $push: { workLeases: { leaseId, expiresAt: leaseExpiry(now) } } }, { new: true }));
    return user ? { accountId, leaseId } : null;
}
export async function renewAccountWorkLease(lease: AccountWorkLease, now = new Date()): Promise<boolean> {
    const result = await accountLeaseBookkeeping.run(true, async () => User.updateOne({
        _id: lease.accountId,
        deletionStartedAt: null,
        workLeases: {
            $elemMatch: { leaseId: lease.leaseId, expiresAt: { $gt: now } },
        },
        'workLeases.leaseId': lease.leaseId,
    }, { $set: { 'workLeases.$.expiresAt': leaseExpiry(now) } }));
    return result.matchedCount === 1;
}
export async function releaseAccountWorkLease(lease: AccountWorkLease): Promise<void> {
    await runWithLeaseCleanup(async () => accountLeaseBookkeeping.run(true, async () => User.updateOne({ _id: lease.accountId }, { $pull: { workLeases: { leaseId: lease.leaseId } } })));
}
export async function assertCurrentAccountWorkLease(now = new Date()): Promise<void> {
    const lease = accountWorkContext.getStore();
    if (!lease)
        return;
    if (lease.deletionOwner) {
        if (!lease.deletionAttemptId)
            return;
        await accountDeletionRenewals.get(lease)?.pending;
        if (!(await renewAccountDeletionAttempt({ accountId: lease.accountId, leaseId: lease.deletionAttemptId }, now))) {
            throw new UnrecoverableError('account deletion attempt lease was lost or expired');
        }
        return;
    }
    // Drain any timer renewal already in flight before making the authoritative
    // ownership decision. A prior transient timer exception is diagnostic only;
    // this current Mongo predicate decides whether work may continue.
    await accountLeaseRenewals.get(lease)?.pending;
    if (!(await renewAccountWorkLease(lease, now))) {
        throw new UnrecoverableError('account work lease was lost, expired, or deletion started');
    }
}
/**
 * Keep a previously acquired lease alive for an arbitrary async operation.
 *
 * This is shared by workers and cross-account service operations: both can
 * legitimately run longer than one lease window. The callback still runs in
 * the lease ALS context so the provider/Mongo/queue barriers revalidate it at
 * every irreversible boundary. A lost heartbeat is surfaced before the
 * caller may report success.
 */
export async function runWithRenewingAccountWorkLease<Result>(lease: AccountWorkLease, callback: () => Promise<Result>, options: {
    assertAfterWork?: boolean;
} = {}): Promise<Result> {
    const runtime = { pending: Promise.resolve() };
    accountLeaseRenewals.set(lease, runtime);
    const timer = setInterval(() => {
        scheduleAccountWorkLeaseRenewal(runtime, lease);
    }, ACCOUNT_WORK_LEASE_HEARTBEAT_MS);
    timer.unref();
    return accountWorkContext.run(lease, async () => {
        try {
            const result = await callback();
            if (options.assertAfterWork !== false) {
                await assertCurrentAccountWorkLease();
            }
            return result;
        }
        finally {
            clearInterval(timer);
            await runtime.pending;
            accountLeaseRenewals.delete(lease);
        }
    });
}
async function renewAccountWorkLeaseBestEffort(lease: AccountWorkLease): Promise<void> {
    try {
        await renewAccountWorkLease(lease);
    }
    catch (error) {
        logger.warn({ err: error, accountId: lease.accountId }, 'account lease heartbeat failed');
    }
}
function scheduleAccountWorkLeaseRenewal(runtime: AccountLeaseRenewalRuntime, lease: AccountWorkLease): void {
    runtime.pending = runtime.pending.then(() => renewAccountWorkLeaseBestEffort(lease));
}
async function releaseAccountWorkLeaseBestEffort(lease: AccountWorkLease): Promise<void> {
    try {
        await releaseAccountWorkLease(lease);
    }
    catch (error) {
        // The lease expires by itself. A failed cleanup must never turn completed
        // idempotent work into a retry that repeats irreversible side effects.
        logger.warn({ err: error, accountId: lease.accountId }, 'account lease release failed');
    }
}
/**
 * Runs work under the target account, even when the ambient request belongs
 * to an administrator. Nested matching contexts are reused; mismatched actor
 * contexts acquire the target independently and restore the actor afterward.
 */
export async function tryRunWithTargetAccountWorkLease<Result>(accountId: string, ownerPrefix: string, work: () => Promise<Result>, options: {
    assertAfterWork?: boolean;
} = {}): Promise<{
    acquired: true;
    value: Result;
} | {
    acquired: false;
}> {
    const current = currentAccountWorkLease();
    if (current?.accountId === accountId) {
        return { acquired: true, value: await work() };
    }
    const lease = await acquireAccountWorkLease(accountId, `${ownerPrefix}:${randomUUID()}`);
    if (!lease)
        return { acquired: false };
    try {
        return {
            acquired: true,
            value: await runWithRenewingAccountWorkLease(lease, work, options),
        };
    }
    finally {
        await releaseAccountWorkLeaseBestEffort(lease);
    }
}
export async function runWithTargetAccountWorkLease<Result>(accountId: string, ownerPrefix: string, work: () => Promise<Result>, options: {
    assertAfterWork?: boolean;
} = {}): Promise<Result> {
    const result = await tryRunWithTargetAccountWorkLease(accountId, ownerPrefix, work, options);
    if (!result.acquired) {
        throw new UnrecoverableError('account missing or deletion already started');
    }
    return result.value;
}
/** Sorted sequential target wrapper for deadlock-free administrative batches. */
export async function runWithTargetAccountWorkLeases<Result>(accountIds: readonly string[], ownerPrefix: string, work: (accountId: string) => Promise<Result>): Promise<Result[]> {
    const results: Result[] = [];
    for (const accountId of [...new Set(accountIds)].sort()) {
        results.push(await runWithTargetAccountWorkLease(accountId, ownerPrefix, () => work(accountId)));
    }
    return results;
}
const guardedObjects = new WeakMap<object, object>();
/** Revalidates the account lease immediately before every provider method. */
export function guardAccountLifecycleCalls<T extends object>(target: T): T {
    const existing = guardedObjects.get(target);
    if (existing)
        return existing as T;
    const proxy = new Proxy(target, {
        get(object, property, receiver) {
            const value = Reflect.get(object, property, receiver) as unknown;
            if (typeof value === 'function') {
                return async (...args: unknown[]) => {
                    await assertCurrentAccountWorkLease();
                    return Reflect.apply(value, object, args);
                };
            }
            return value && typeof value === 'object'
                ? guardAccountLifecycleCalls(value as object)
                : value;
        },
    });
    guardedObjects.set(target, proxy);
    guardedObjects.set(proxy, proxy);
    return proxy;
}
/** Streaming providers are checked before dispatch and before every yielded event. */
export function guardAccountLifecycleStream<TInput, TEvent>(stream: (input: TInput) => AsyncIterable<TEvent>): (input: TInput) => AsyncIterable<TEvent> {
    return (input) => ({
        async *[Symbol.asyncIterator]() {
            await assertCurrentAccountWorkLease();
            for await (const event of stream(input)) {
                await assertCurrentAccountWorkLease();
                yield event;
            }
        },
    });
}
interface ClaimAccountDeletionDeps {
    /** Deterministic seam for claim/read races; production leaves it unset. */
    afterClaimMiss?: () => Promise<void>;
}
export async function claimAccountDeletion(accountId: string, now = new Date(), deps: ClaimAccountDeletionDeps = {}): Promise<AccountDeletionClaim> {
    if (!Types.ObjectId.isValid(accountId))
        return { status: 'missing' };
    const existing = await User.findById(accountId)
        .select('deletionScheduledAt deletionStartedAt deletionCancellationRequestedAt legalHold')
        .lean();
    if (!existing)
        return { status: 'missing' };
    if (existing.legalHold)
        return { status: 'legal-hold' };
    if (existing.deletionStartedAt) {
        return { status: 'resumed', startedAt: existing.deletionStartedAt };
    }
    if (existing.deletionCancellationRequestedAt)
        return { status: 'not-due' };
    if (!existing.deletionScheduledAt || existing.deletionScheduledAt.getTime() > now.getTime()) {
        return { status: 'not-due' };
    }
    await accountLeaseBookkeeping.run(true, async () => User.updateOne({ _id: accountId, deletionStartedAt: null }, { $pull: { workLeases: { expiresAt: { $lte: now } } } }));
    const claimed = await accountLeaseBookkeeping.run(true, async () => User.findOneAndUpdate({
        _id: accountId,
        legalHold: { $ne: true },
        deletionScheduledAt: { $ne: null, $lte: now },
        deletionStartedAt: null,
        deletionCancellationRequestedAt: null,
        workLeases: { $not: { $elemMatch: { expiresAt: { $gt: now } } } },
    }, {
        $set: {
            deletionStartedAt: now,
            suspended: true,
            suspendedAt: now,
        },
    }, { new: true }));
    if (claimed)
        return { status: 'claimed', startedAt: now };
    await deps.afterClaimMiss?.();
    const raced = await User.findById(accountId)
        .select('deletionScheduledAt deletionStartedAt deletionCancellationRequestedAt legalHold')
        .lean();
    if (!raced)
        return { status: 'missing' };
    if (raced.legalHold)
        return { status: 'legal-hold' };
    if (raced.deletionStartedAt) {
        return { status: 'resumed', startedAt: raced.deletionStartedAt };
    }
    if (raced.deletionCancellationRequestedAt)
        return { status: 'not-due' };
    if (!raced.deletionScheduledAt || raced.deletionScheduledAt.getTime() > now.getTime()) {
        return { status: 'not-due' };
    }
    return { status: 'busy' };
}
/** Acquire the sole crash-expiring owner for a durable account purge claim. */
export async function claimAccountDeletionAttempt(accountId: string, leaseId: string, now = new Date()): Promise<AccountDeletionAttemptClaim> {
    const claim = await claimAccountDeletion(accountId, now);
    if (claim.status !== 'claimed' && claim.status !== 'resumed')
        return claim;
    const acquired = await accountLeaseBookkeeping.run(true, async () => User.findOneAndUpdate({
        _id: accountId,
        deletionStartedAt: { $ne: null },
        $or: [
            { deletionAttemptLeaseId: leaseId },
            { deletionAttemptLeaseId: null },
            { deletionAttemptExpiresAt: null },
            { deletionAttemptExpiresAt: { $lte: now } },
        ],
    }, {
        $set: {
            deletionAttemptLeaseId: leaseId,
            deletionAttemptExpiresAt: new Date(now.getTime() + ACCOUNT_DELETION_ATTEMPT_MS),
        },
    }, { new: true }));
    if (!acquired)
        return { status: 'busy' };
    return {
        status: claim.status,
        startedAt: claim.startedAt,
        attempt: { accountId, leaseId },
    };
}
export async function renewAccountDeletionAttempt(attempt: AccountDeletionAttempt, now = new Date()): Promise<boolean> {
    const result = await accountLeaseBookkeeping.run(true, async () => User.updateOne({
        _id: attempt.accountId,
        deletionStartedAt: { $ne: null },
        deletionAttemptLeaseId: attempt.leaseId,
        deletionAttemptExpiresAt: { $gt: now },
    }, {
        $set: {
            deletionAttemptExpiresAt: new Date(now.getTime() + ACCOUNT_DELETION_ATTEMPT_MS),
        },
    }));
    return result.matchedCount === 1;
}
export async function releaseAccountDeletionAttempt(attempt: AccountDeletionAttempt): Promise<void> {
    await accountLeaseBookkeeping.run(true, async () => User.updateOne({ _id: attempt.accountId, deletionAttemptLeaseId: attempt.leaseId }, {
        $set: {
            deletionAttemptLeaseId: null,
            deletionAttemptExpiresAt: null,
        },
    }));
}
async function renewAccountDeletionAttemptBestEffort(attempt: AccountDeletionAttempt): Promise<void> {
    try {
        await renewAccountDeletionAttempt(attempt);
    }
    catch (error) {
        logger.warn({ err: error, accountId: attempt.accountId }, 'account deletion attempt heartbeat failed');
    }
}
function scheduleAccountDeletionAttemptRenewal(runtime: AccountLeaseRenewalRuntime, attempt: AccountDeletionAttempt): void {
    runtime.pending = runtime.pending.then(() => renewAccountDeletionAttemptBestEffort(attempt));
}
async function releaseAccountDeletionAttemptBestEffort(attempt: AccountDeletionAttempt): Promise<void> {
    try {
        await releaseAccountDeletionAttempt(attempt);
    }
    catch (error) {
        logger.warn({ err: error, accountId: attempt.accountId }, 'account deletion attempt release failed');
    }
}
/**
 * Runs the exclusive purge owner. There is intentionally no assertion after
 * the callback: the callback deletes User last and performs its authoritative
 * attempt check immediately before that irreversible write.
 */
export async function runWithAccountDeletionContext<Result>(attempt: AccountDeletionAttempt, callback: () => Promise<Result>): Promise<Result> {
    const context: AccountWorkLease = {
        accountId: attempt.accountId,
        leaseId: `account-deletion:${attempt.leaseId}`,
        deletionOwner: true,
        deletionAttemptId: attempt.leaseId,
    };
    const runtime = { pending: Promise.resolve() };
    accountDeletionRenewals.set(context, runtime);
    const timer = setInterval(() => {
        scheduleAccountDeletionAttemptRenewal(runtime, attempt);
    }, ACCOUNT_WORK_LEASE_HEARTBEAT_MS);
    timer.unref();
    try {
        return await accountWorkContext.run(context, callback);
    }
    finally {
        clearInterval(timer);
        await runtime.pending;
        accountDeletionRenewals.delete(context);
        await releaseAccountDeletionAttemptBestEffort(attempt);
    }
}
const mongoBarrierMarker = Symbol.for('rankme.accountLifecycleMongoWriteBarrier');
export function installAccountMongoWriteBarrier(): void {
    const prototype = mongoose.mongo.Collection.prototype as unknown as Record<PropertyKey, unknown>;
    if (prototype[mongoBarrierMarker])
        return;
    const methods = [
        'insertOne',
        'insertMany',
        'updateOne',
        'updateMany',
        'findOneAndUpdate',
        'replaceOne',
        'findOneAndReplace',
        'deleteOne',
        'deleteMany',
        'findOneAndDelete',
        'bulkWrite',
    ] as const;
    for (const method of methods) {
        const original = prototype[method] as (...args: unknown[]) => Promise<unknown>;
        prototype[method] = async function guardedAccountMongoWrite(this: {
            collectionName?: string;
        }, ...args: unknown[]) {
            if (!accountLeaseBookkeeping.getStore() && !isLeaseCleanup()) {
                await assertCurrentAccountWorkLease();
            }
            return Reflect.apply(original, this, args);
        };
    }
    prototype[mongoBarrierMarker] = true;
}
function collectAccountIds(value: unknown, out: Set<string>, topLevel = false): void {
    if (Array.isArray(value)) {
        for (const item of value)
            collectAccountIds(item, out, topLevel);
        return;
    }
    if (!value || typeof value !== 'object')
        return;
    const record = value as Record<string, unknown>;
    // A small set of global scheduler templates intentionally carry an empty
    // typed placeholder and resolve concrete accounts when the sweep fires.
    // Ignore only the exact empty sentinel; malformed non-empty scopes still
    // fail closed at the queue boundary below.
    if (typeof record.accountId === 'string' && record.accountId !== '') {
        out.add(record.accountId);
    }
    if (topLevel && typeof record.userId === 'string') {
        if (record.userId !== '')
            out.add(record.userId);
    }
    for (const [key, nested] of Object.entries(record)) {
        collectAccountIds(nested, out, key === 'original');
    }
}
/** Pure inspection seam for the scheduler/global-payload boundary matrix. */
export function accountScopesFromQueuePayload(value: unknown): string[] {
    const accountIds = new Set<string>();
    collectAccountIds(value, accountIds, true);
    return [...accountIds].sort();
}
const queueBarrierMarker = Symbol.for('rankme.accountLifecycleQueueWriteBarrier');
export async function withAccountQueueBoundary<Result>(method: string, payloads: readonly unknown[], callback: () => Promise<Result>, compensate?: (result: Result) => Promise<void>): Promise<Result> {
    await assertCurrentAccountWorkLease();
    const accountIds = new Set(payloads.flatMap(accountScopesFromQueuePayload));
    const current = accountWorkContext.getStore();
    const boundaryLeases: AccountWorkLease[] = [];
    let callbackCompleted = false;
    let callbackResult: Result | undefined;
    try {
        for (const accountId of [...accountIds].sort()) {
            if (current?.accountId === accountId)
                continue;
            if (!Types.ObjectId.isValid(accountId)) {
                throw new UnrecoverableError('invalid account scope at queue boundary');
            }
            const lease = await acquireAccountWorkLease(accountId, `queue-boundary:${method}:${randomUUID()}`);
            if (!lease) {
                throw new UnrecoverableError('account missing or deletion already started');
            }
            boundaryLeases.push(lease);
        }
        // A Redis write can outlive the original five-minute lease window. Keep
        // every independently acquired scope alive, then revalidate all of them
        // after Redis returns but before the producer may report success. Nested
        // ALS contexts are intentional: each renewal timer is independent and
        // each wrapper performs its own authoritative final check.
        let run = async (): Promise<Result> => {
            callbackResult = await callback();
            callbackCompleted = true;
            return callbackResult;
        };
        for (const lease of boundaryLeases) {
            const nested = run;
            run = () => runWithRenewingAccountWorkLease(lease, nested);
        }
        const result = await run();
        // Nested boundary contexts have now unwound, so this validates the
        // producer's original ambient account lease as well.
        await assertCurrentAccountWorkLease();
        return result;
    }
    catch (error) {
        // Redis may have committed immediately before a final lease revalidation
        // observed deletion. Remove that manifestation best-effort; the durable
        // account queue cascade remains the convergence backstop.
        if (callbackCompleted && compensate) {
            try {
                await compensate(callbackResult as Result);
            }
            catch (compensationError) {
                logger.warn({ err: compensationError, method }, 'account queue boundary compensation failed');
            }
        }
        throw error;
    }
    finally {
        await Promise.all(boundaryLeases.map((lease) => releaseAccountWorkLeaseBestEffort(lease)));
    }
}
interface QueueWriteArtifact {
    remove(): Promise<unknown>;
}
function removableQueueArtifacts(value: unknown): QueueWriteArtifact[] {
    if (Array.isArray(value))
        return value.flatMap(removableQueueArtifacts);
    if (value &&
        typeof value === 'object' &&
        typeof (value as {
            remove?: unknown;
        }).remove === 'function') {
        return [value as QueueWriteArtifact];
    }
    return [];
}
async function compensateAccountQueueWrite(queue: Queue, method: string, args: readonly unknown[], result: unknown): Promise<void> {
    if (method === 'upsertJobScheduler') {
        const schedulerId = args[0];
        if (typeof schedulerId === 'string') {
            await queue.removeJobScheduler(schedulerId);
        }
        return;
    }
    const removals = await Promise.allSettled(removableQueueArtifacts(result).map((artifact) => artifact.remove()));
    const failed = removals.find((removal): removal is PromiseRejectedResult => removal.status === 'rejected');
    if (failed)
        throw failed.reason;
}
export function installAccountQueueWriteBarrier(): void {
    const prototype = Queue.prototype as unknown as Record<PropertyKey, unknown>;
    if (prototype[queueBarrierMarker])
        return;
    const methods = ['add', 'addBulk', 'upsertJobScheduler'] as const;
    for (const method of methods) {
        const original = prototype[method] as (...args: unknown[]) => Promise<unknown>;
        prototype[method] = async function guardedAccountQueueWrite(this: Queue, ...args: unknown[]) {
            const payloads = method === 'add'
                ? [args[1]]
                : method === 'addBulk'
                    ? Array.isArray(args[0])
                        ? args[0].map((entry) => entry && typeof entry === 'object'
                            ? (entry as {
                                data?: unknown;
                            }).data
                            : undefined)
                        : []
                    : [
                        args[2] && typeof args[2] === 'object'
                            ? (args[2] as {
                                data?: unknown;
                            }).data
                            : undefined,
                    ];
            return withAccountQueueBoundary(method, payloads, () => Reflect.apply(original, this, args), (result) => compensateAccountQueueWrite(this, method, args, result));
        };
    }
    prototype[queueBarrierMarker] = true;
}
export type AccountScopeResolver<Data = unknown> = (job: Job<Data>) => string | null | undefined | Promise<string | null | undefined>;
export function directAccountScope<Data>(job: Job<Data>): string | null {
    const data = job.data as {
        accountId?: unknown;
        userId?: unknown;
    };
    if (typeof data.accountId === 'string')
        return data.accountId;
    return typeof data.userId === 'string' ? data.userId : null;
}
export function withAccountWorkLease<Data = unknown, Result = unknown>(processor: (job: Job<Data>, token?: string) => Promise<Result>, resolveScope: AccountScopeResolver<Data> = directAccountScope): (job: Job<Data>, token?: string) => Promise<Result> {
    return async (job, token) => {
        const accountId = await resolveScope(job);
        if (accountId === undefined)
            return processor(job, token);
        if (!accountId) {
            throw new UnrecoverableError('account scope not found for account-owned job');
        }
        const lease = await acquireAccountWorkLease(accountId, `${job.queueName}:${job.name}:${job.id ?? 'anonymous'}:${randomUUID()}`);
        if (!lease) {
            throw new UnrecoverableError('account missing or deletion already started');
        }
        try {
            return await runWithRenewingAccountWorkLease(lease, () => processor(job, token));
        }
        finally {
            await releaseAccountWorkLeaseBestEffort(lease);
        }
    };
}
export const accountLifecycleTestables = Object.freeze({
    renewAccountWorkLeaseBestEffort,
    scheduleAccountWorkLeaseRenewal,
    releaseAccountWorkLeaseBestEffort,
    renewAccountDeletionAttemptBestEffort,
    scheduleAccountDeletionAttemptRenewal,
    releaseAccountDeletionAttemptBestEffort,
    compensateAccountQueueWrite,
});
