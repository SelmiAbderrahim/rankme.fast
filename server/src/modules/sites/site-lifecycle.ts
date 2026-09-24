import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Queue, UnrecoverableError, type Job } from 'bullmq';
import mongoose, { Types } from 'mongoose';
import { logger } from '../../config/logger.js';
import { isLeaseCleanup, runWithLeaseCleanup, } from '../../shared/lifecycle/lease-cleanup.js';
import { runWithTargetAccountWorkLease } from '../legal/account-lifecycle.js';
import { Site } from './sites.model.js';
export const SITE_WORK_LEASE_MS = 5 * 60 * 1000;
export const SITE_WORK_LEASE_HEARTBEAT_MS = 30 * 1000;
export const SITE_DELETION_ATTEMPT_MS = SITE_WORK_LEASE_MS;
export interface SiteWorkScope {
    accountId: string;
    siteId: string;
}
export interface SiteWorkLease extends SiteWorkScope {
    leaseId: string;
}
export interface SiteDeletionAttempt extends SiteWorkScope {
    leaseId: string;
}
const siteWorkContext = new AsyncLocalStorage<SiteWorkLease>();
const siteLeaseBookkeeping = new AsyncLocalStorage<boolean>();
const siteLeaseRenewals = new WeakMap<SiteWorkLease, {
    pending: Promise<void>;
}>();
interface SiteLeaseRenewalRuntime {
    pending: Promise<void>;
}
async function renewSiteWorkLeaseBestEffort(lease: SiteWorkLease): Promise<void> {
    try {
        await renewSiteWorkLease(lease);
    }
    catch (error) {
        logger.warn({ err: error, siteId: lease.siteId }, 'site lease heartbeat failed');
    }
}
function scheduleSiteWorkLeaseRenewal(runtime: SiteLeaseRenewalRuntime, lease: SiteWorkLease): void {
    runtime.pending = runtime.pending.then(renewSiteWorkLeaseBestEffort.bind(null, lease));
}
export function runWithSiteWorkLeaseContext<Result>(lease: SiteWorkLease, callback: () => Result): Result {
    return siteWorkContext.run(lease, callback);
}
/**
 * Keeps an acquired site lease alive for service/reconciliation work that is
 * not entered through BullMQ. The final assertion prevents a callback from
 * reporting success after losing ownership between its last write and return.
 */
export async function runWithRenewingSiteWorkLease<Result>(lease: SiteWorkLease, callback: () => Promise<Result>): Promise<Result> {
    const runtime = { pending: Promise.resolve() };
    siteLeaseRenewals.set(lease, runtime);
    const timer = setInterval(scheduleSiteWorkLeaseRenewal, SITE_WORK_LEASE_HEARTBEAT_MS, runtime, lease);
    timer.unref();
    return siteWorkContext.run(lease, async () => {
        try {
            const result = await callback();
            await assertCurrentSiteWorkLease();
            return result;
        }
        finally {
            clearInterval(timer);
            await runtime.pending;
            siteLeaseRenewals.delete(lease);
        }
    });
}
async function releaseSiteWorkLeaseBestEffort(lease: SiteWorkLease): Promise<void> {
    try {
        await releaseSiteWorkLease(lease);
    }
    catch (error) {
        logger.warn({ err: error, siteId: lease.siteId }, 'site lease release failed');
    }
}
/** Acquire a short-lived lease for a service/reconciliation operation. */
export async function tryRunWithSiteWorkLease<Result>(scope: SiteWorkScope, ownerPrefix: string, work: () => Promise<Result>): Promise<{
    acquired: true;
    value: Result;
} | {
    acquired: false;
}> {
    try {
        return await runWithTargetAccountWorkLease(scope.accountId, `${ownerPrefix}:account`, async () => {
            const lease = await acquireSiteWorkLease(scope, `${ownerPrefix}:${randomUUID()}`);
            if (!lease)
                return { acquired: false as const };
            try {
                return {
                    acquired: true as const,
                    value: await runWithRenewingSiteWorkLease(lease, work),
                };
            }
            finally {
                await releaseSiteWorkLeaseBestEffort(lease);
            }
        });
    }
    catch (error) {
        if (error instanceof UnrecoverableError)
            return { acquired: false };
        throw error;
    }
}
export type SiteDeletionClaim = {
    status: 'claimed';
    startedAt: Date;
} | {
    status: 'resumed';
    startedAt: Date;
} | {
    status: 'busy';
} | {
    status: 'missing';
};
export type SiteDeletionAttemptClaim = {
    status: 'claimed';
    startedAt: Date;
    attempt: SiteDeletionAttempt;
} | {
    status: 'resumed';
    startedAt: Date;
    attempt: SiteDeletionAttempt;
} | {
    status: 'busy';
} | {
    status: 'missing';
};
export interface ClaimSiteDeletionDeps {
    /** Deterministic seam for delete/claim race regression tests. */
    afterClaimMiss?: () => Promise<void>;
}
function leaseExpiry(now: Date): Date {
    return new Date(now.getTime() + SITE_WORK_LEASE_MS);
}
async function pruneExpiredLeases(scope: SiteWorkScope, now: Date): Promise<void> {
    await Site.updateOne({ _id: scope.siteId, accountId: scope.accountId }, { $pull: { workLeases: { expiresAt: { $lte: now } } } });
}
/**
 * Atomically acquires a renewable lease only while the site is live. The
 * deletion claim updates the same Mongo document with the inverse predicate,
 * so exactly one side of an acquire/delete race can win.
 */
export async function acquireSiteWorkLease(scope: SiteWorkScope, leaseId: string, now = new Date()): Promise<SiteWorkLease | null> {
    if (!Types.ObjectId.isValid(scope.siteId) || !Types.ObjectId.isValid(scope.accountId)) {
        return null;
    }
    // A replayed BullMQ id must not leave two copies of the same lease. If a
    // delete claims between this idempotent cleanup and the push below, the
    // push predicate observes `deletionStartedAt` and fails closed.
    await Site.updateOne({
        _id: scope.siteId,
        accountId: scope.accountId,
        deletionStartedAt: null,
    }, {
        $pull: {
            workLeases: {
                $or: [{ leaseId }, { expiresAt: { $lte: now } }],
            },
        },
    });
    const site = await Site.findOneAndUpdate({
        _id: scope.siteId,
        accountId: scope.accountId,
        deletionStartedAt: null,
    }, {
        $push: {
            workLeases: { leaseId, expiresAt: leaseExpiry(now) },
        },
    }, { new: true });
    return site ? { ...scope, leaseId } : null;
}
export async function renewSiteWorkLease(lease: SiteWorkLease, now = new Date()): Promise<boolean> {
    const result = await siteLeaseBookkeeping.run(true, async () => await Site.updateOne({
        _id: lease.siteId,
        accountId: lease.accountId,
        deletionStartedAt: null,
        workLeases: {
            $elemMatch: {
                leaseId: lease.leaseId,
                expiresAt: { $gt: now },
            },
        },
        'workLeases.leaseId': lease.leaseId,
    }, { $set: { 'workLeases.$.expiresAt': leaseExpiry(now) } }));
    // A renewal in the same millisecond can compute the exact existing expiry;
    // matched ownership is the invariant even when Mongo reports a no-op write.
    return result.matchedCount === 1;
}
export async function releaseSiteWorkLease(lease: SiteWorkLease): Promise<void> {
    await runWithLeaseCleanup(async () => siteLeaseBookkeeping.run(true, async () => Site.updateOne({ _id: lease.siteId, accountId: lease.accountId }, { $pull: { workLeases: { leaseId: lease.leaseId } } })));
}
/** Immediate vendor/write barrier for code running inside a site lease. */
export async function assertCurrentSiteWorkLease(now = new Date()): Promise<void> {
    const lease = siteWorkContext.getStore();
    if (!lease)
        return;
    await siteLeaseRenewals.get(lease)?.pending;
    if (!(await renewSiteWorkLease(lease, now))) {
        throw new UnrecoverableError('site work lease expired, was lost, or deletion started');
    }
}
const guardedObjects = new WeakMap<object, object>();
/** Recursively guards provider methods when executing inside a site lease. */
export function guardSiteLifecycleCalls<T extends object>(target: T): T {
    const existing = guardedObjects.get(target);
    if (existing)
        return existing as T;
    const proxy = new Proxy(target, {
        get(object, property, receiver) {
            const value = Reflect.get(object, property, receiver) as unknown;
            if (typeof value === 'function') {
                return async (...args: unknown[]) => {
                    await assertCurrentSiteWorkLease();
                    return Reflect.apply(value, object, args);
                };
            }
            return value && typeof value === 'object'
                ? guardSiteLifecycleCalls(value as object)
                : value;
        },
    });
    guardedObjects.set(target, proxy);
    guardedObjects.set(proxy, proxy);
    return proxy;
}
/**
 * Streaming providers need lease checks at iteration time, not merely when an
 * AsyncIterable object is created. This wrapper preserves the synchronous
 * `AsyncIterable` contract and revalidates before dispatch and every yield.
 */
export function guardSiteLifecycleStream<TInput, TEvent>(stream: (input: TInput) => AsyncIterable<TEvent>): (input: TInput) => AsyncIterable<TEvent> {
    return (input) => ({
        async *[Symbol.asyncIterator]() {
            await assertCurrentSiteWorkLease();
            for await (const event of stream(input)) {
                await assertCurrentSiteWorkLease();
                yield event;
            }
        },
    });
}
const mongoBarrierMarker = Symbol.for('rankme.siteLifecycleMongoWriteBarrier');
/**
 * Installs one process-wide driver boundary. Every Mongo write made from a
 * leased site processor/request revalidates ownership immediately before the
 * driver call. Only lease bookkeeping bypasses the check through its narrow
 * AsyncLocalStorage flag; unrelated writes to `sites` are guarded too.
 */
export function installSiteMongoWriteBarrier(): void {
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
        const original = prototype[method] as (...args: unknown[]) => unknown;
        prototype[method] = async function guardedMongoWrite(this: {
            collectionName?: string;
        }, ...args: unknown[]) {
            if (!siteLeaseBookkeeping.getStore() && !isLeaseCleanup()) {
                await assertCurrentSiteWorkLease();
            }
            return Reflect.apply(original, this, args);
        };
    }
    prototype[mongoBarrierMarker] = true;
}
const queueBarrierMarker = Symbol.for('rankme.siteLifecycleQueueWriteBarrier');
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
async function compensateSiteQueueWrite(queue: Queue, method: string, args: readonly unknown[], result: unknown): Promise<void> {
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
/** Revalidates the current site lease immediately before any BullMQ enqueue. */
export function installSiteQueueWriteBarrier(): void {
    const prototype = Queue.prototype as unknown as Record<PropertyKey, unknown>;
    if (prototype[queueBarrierMarker])
        return;
    const methods = ['add', 'addBulk', 'upsertJobScheduler'] as const;
    for (const method of methods) {
        const original = prototype[method] as (...args: unknown[]) => unknown;
        prototype[method] = async function guardedQueueWrite(this: Queue, ...args: unknown[]) {
            await assertCurrentSiteWorkLease();
            const current = siteWorkContext.getStore();
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
            const scopes = new Map<string, SiteWorkScope>();
            const visit = (value: unknown): void => {
                if (Array.isArray(value)) {
                    for (const item of value)
                        visit(item);
                    return;
                }
                if (!value || typeof value !== 'object')
                    return;
                const record = value as Record<string, unknown>;
                if (typeof record.siteId === 'string') {
                    const accountId = typeof record.accountId === 'string' ? record.accountId : '';
                    scopes.set(`${accountId}:${record.siteId}`, {
                        accountId,
                        siteId: record.siteId,
                    });
                }
                for (const nested of Object.values(record))
                    visit(nested);
            };
            for (const payload of payloads)
                visit(payload);
            const boundaryLeases: SiteWorkLease[] = [];
            let queueWriteCompleted = false;
            let queueWriteResult: unknown;
            try {
                for (const scope of [...scopes.values()].sort((left, right) => left.siteId.localeCompare(right.siteId))) {
                    if (current?.siteId === scope.siteId && current.accountId === scope.accountId) {
                        continue;
                    }
                    if (!Types.ObjectId.isValid(scope.siteId) ||
                        (scope.accountId !== '' && !Types.ObjectId.isValid(scope.accountId))) {
                        throw new UnrecoverableError('invalid site scope at queue boundary');
                    }
                    const accountId = scope.accountId ||
                        String((await Site.findOne({ _id: scope.siteId, deletionStartedAt: null }, { accountId: 1 }).lean())?.accountId ?? '');
                    if (!accountId) {
                        throw new UnrecoverableError('site missing or deletion already started');
                    }
                    const lease = await acquireSiteWorkLease({ accountId, siteId: scope.siteId }, `queue-boundary:${method}:${randomUUID()}`);
                    if (!lease) {
                        throw new UnrecoverableError('site missing or deletion already started');
                    }
                    boundaryLeases.push(lease);
                }
                let run = async (): Promise<unknown> => {
                    queueWriteResult = await Reflect.apply(original, this, args);
                    queueWriteCompleted = true;
                    return queueWriteResult;
                };
                for (const lease of boundaryLeases) {
                    const nested = run;
                    run = () => runWithRenewingSiteWorkLease(lease, nested);
                }
                const result = await run();
                // The nested contexts have unwound; validate the caller's original
                // ambient site lease before exposing Redis success.
                await assertCurrentSiteWorkLease();
                return result;
            }
            catch (error) {
                if (queueWriteCompleted) {
                    try {
                        await compensateSiteQueueWrite(this, method, args, queueWriteResult);
                    }
                    catch (compensationError) {
                        logger.warn({ err: compensationError, method }, 'site queue boundary compensation failed');
                    }
                }
                throw error;
            }
            finally {
                await Promise.all(boundaryLeases.map((lease) => releaseSiteWorkLeaseBestEffort(lease)));
            }
        };
    }
    prototype[queueBarrierMarker] = true;
}
/**
 * Durable, retryable deletion claim. `busy` means a live worker lease won the
 * atomic race; `resumed` means an earlier attempt already stopped new work and
 * this caller should continue the idempotent cleanup.
 */
export async function claimSiteDeletion(scope: SiteWorkScope, now = new Date(), provenance: {
    actorUserId?: string;
    auditSource?: string;
} = {}, deps: ClaimSiteDeletionDeps = {}): Promise<SiteDeletionClaim> {
    if (!Types.ObjectId.isValid(scope.siteId) || !Types.ObjectId.isValid(scope.accountId)) {
        return { status: 'missing' };
    }
    const existing = await Site.findOne({ _id: scope.siteId, accountId: scope.accountId }, { deletionStartedAt: 1 }).lean();
    if (!existing)
        return { status: 'missing' };
    if (existing.deletionStartedAt) {
        return {
            status: 'resumed',
            startedAt: existing.deletionStartedAt,
        };
    }
    await pruneExpiredLeases(scope, now);
    const claimed = await Site.findOneAndUpdate({
        _id: scope.siteId,
        accountId: scope.accountId,
        deletionStartedAt: null,
        workLeases: { $not: { $elemMatch: { expiresAt: { $gt: now } } } },
    }, {
        $set: {
            deletionStartedAt: now,
            ...(provenance.actorUserId
                ? { deletionActorUserId: provenance.actorUserId }
                : {}),
            ...(provenance.auditSource
                ? { deletionAuditSource: provenance.auditSource }
                : {}),
            paused: true,
            pausedAt: now,
        },
    }, { new: true });
    if (claimed) {
        return { status: 'claimed', startedAt: now };
    }
    await deps.afterClaimMiss?.();
    const raced = await Site.findOne({ _id: scope.siteId, accountId: scope.accountId }, { deletionStartedAt: 1 }).lean();
    if (!raced)
        return { status: 'missing' };
    if (raced.deletionStartedAt) {
        return {
            status: 'resumed',
            startedAt: raced.deletionStartedAt,
        };
    }
    return { status: 'busy' };
}
/** Sole crash-expiring owner for the retryable teardown after the durable claim. */
export async function claimSiteDeletionAttempt(scope: SiteWorkScope, leaseId: string, now = new Date(), provenance: {
    actorUserId?: string;
    auditSource?: string;
} = {}): Promise<SiteDeletionAttemptClaim> {
    const claim = await claimSiteDeletion(scope, now, provenance);
    if (claim.status !== 'claimed' && claim.status !== 'resumed')
        return claim;
    const acquired = await siteLeaseBookkeeping.run(true, async () => Site.findOneAndUpdate({
        _id: scope.siteId,
        accountId: scope.accountId,
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
            deletionAttemptExpiresAt: new Date(now.getTime() + SITE_DELETION_ATTEMPT_MS),
        },
    }, { new: true }));
    if (!acquired)
        return { status: 'busy' };
    return {
        ...claim,
        attempt: { ...scope, leaseId },
    };
}
export async function renewSiteDeletionAttempt(attempt: SiteDeletionAttempt, now = new Date()): Promise<boolean> {
    const result = await siteLeaseBookkeeping.run(true, async () => Site.updateOne({
        _id: attempt.siteId,
        accountId: attempt.accountId,
        deletionStartedAt: { $ne: null },
        deletionAttemptLeaseId: attempt.leaseId,
        deletionAttemptExpiresAt: { $gt: now },
    }, {
        $set: {
            deletionAttemptExpiresAt: new Date(now.getTime() + SITE_DELETION_ATTEMPT_MS),
        },
    }));
    return result.matchedCount === 1;
}
export async function releaseSiteDeletionAttempt(attempt: SiteDeletionAttempt): Promise<void> {
    await siteLeaseBookkeeping.run(true, async () => Site.updateOne({
        _id: attempt.siteId,
        accountId: attempt.accountId,
        deletionAttemptLeaseId: attempt.leaseId,
    }, {
        $set: {
            deletionAttemptLeaseId: null,
            deletionAttemptExpiresAt: null,
        },
    }));
}
export async function assertSiteDeletionAttempt(attempt: SiteDeletionAttempt, now = new Date()): Promise<void> {
    if (!(await renewSiteDeletionAttempt(attempt, now))) {
        throw new UnrecoverableError('site deletion attempt lease was lost or expired');
    }
}
/** No post-callback assertion: the callback deletes Site as its final write. */
export async function runWithRenewingSiteDeletionAttempt<Result>(attempt: SiteDeletionAttempt, callback: () => Promise<Result>): Promise<Result> {
    const runtime: SiteLeaseRenewalRuntime = { pending: Promise.resolve() };
    const timer = setInterval(scheduleSiteDeletionAttemptRenewal, SITE_WORK_LEASE_HEARTBEAT_MS, runtime, attempt);
    timer.unref();
    try {
        return await callback();
    }
    finally {
        clearInterval(timer);
        await runtime.pending;
        try {
            await releaseSiteDeletionAttempt(attempt);
        }
        catch (error) {
            logger.warn({ err: error, siteId: attempt.siteId }, 'site deletion attempt release failed');
        }
    }
}
async function renewSiteDeletionAttemptBestEffort(attempt: SiteDeletionAttempt): Promise<void> {
    try {
        await renewSiteDeletionAttempt(attempt);
    }
    catch (error) {
        logger.warn({ err: error, siteId: attempt.siteId }, 'site deletion attempt heartbeat failed');
    }
}
function scheduleSiteDeletionAttemptRenewal(runtime: SiteLeaseRenewalRuntime, attempt: SiteDeletionAttempt): void {
    runtime.pending = runtime.pending.then(renewSiteDeletionAttemptBestEffort.bind(null, attempt));
}
export const siteLifecycleTestables = {
    releaseSiteWorkLeaseBestEffort,
    renewSiteDeletionAttemptBestEffort,
    renewSiteWorkLeaseBestEffort,
    scheduleSiteDeletionAttemptRenewal,
    scheduleSiteWorkLeaseRenewal,
};
export type SiteScopeResolver<Data = unknown> = (job: Job<Data>) => SiteWorkScope | null | undefined | Promise<SiteWorkScope | null | undefined>;
export function directSiteScope<Data>(job: Job<Data>): SiteWorkScope | null {
    const data = job.data as {
        accountId?: unknown;
        siteId?: unknown;
    };
    return typeof data.accountId === 'string' && typeof data.siteId === 'string'
        ? { accountId: data.accountId, siteId: data.siteId }
        : null;
}
/**
 * Central worker boundary. A processor receives control only after its lease
 * has been recorded on the Site document; release is guaranteed in `finally`.
 * Missing/deleting sites are permanent stale jobs and therefore bypass retry.
 */
export function withSiteWorkLease<Data = unknown, Result = unknown>(processor: (job: Job<Data>, token?: string) => Promise<Result>, resolveScope: SiteScopeResolver<Data> = directSiteScope): (job: Job<Data>, token?: string) => Promise<Result> {
    return async (job, token) => {
        const scope = await resolveScope(job);
        if (scope === undefined)
            return processor(job, token);
        if (!scope) {
            throw new UnrecoverableError('site scope not found for site-scoped job');
        }
        // Invocation nonce is mandatory: BullMQ stalled-job recovery can run the
        // same job id on two workers briefly. Sharing a lease id would let either
        // invocation release the other's protection.
        const leaseId = `${job.queueName}:${job.name}:${job.id ?? 'anonymous'}:${randomUUID()}`;
        return runWithTargetAccountWorkLease(scope.accountId, `site-worker:${job.queueName}:${job.name}`, async () => {
            const lease = await acquireSiteWorkLease(scope, leaseId);
            if (!lease) {
                throw new UnrecoverableError('site missing or deletion already started');
            }
            try {
                return await runWithRenewingSiteWorkLease(lease, () => processor(job, token));
            }
            finally {
                await releaseSiteWorkLeaseBestEffort(lease);
            }
        });
    };
}
