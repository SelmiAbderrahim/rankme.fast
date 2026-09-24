import { EventEmitter } from 'node:events';
import { Types } from 'mongoose';
import { Queue, UnrecoverableError, type Job } from 'bullmq';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import { upsertPulseScheduler } from '../weekly-pulse/scheduler.js';
import { User } from '../users/index.js';
import { logger } from '../../config/logger.js';
import {
  ACCOUNT_WORK_LEASE_HEARTBEAT_MS,
  ACCOUNT_WORK_LEASE_MS,
  ACCOUNT_DELETION_ATTEMPT_MS,
  acquireAccountWorkLease,
  accountLifecycleTestables,
  accountScopesFromQueuePayload,
  assertCurrentAccountWorkLease,
  claimAccountDeletion,
  claimAccountDeletionAttempt,
  directAccountScope,
  guardAccountLifecycleCalls,
  guardAccountLifecycleStream,
  installAccountMongoWriteBarrier,
  installAccountQueueWriteBarrier,
  releaseAccountWorkLease,
  releaseAccountDeletionAttempt,
  renewAccountWorkLease,
  runWithAccountWorkLeaseContext,
  runWithAccountDeletionContext,
  runWithTargetAccountWorkLease,
  runWithTargetAccountWorkLeases,
  tryRunWithTargetAccountWorkLease,
  withAccountQueueBoundary,
  withAccountWorkLease,
} from './account-lifecycle.js';
import { continueWithAccountWorkLease } from './account-lifecycle.middleware.js';

beforeAll(async () => {
  await startMemoryMongo();
});

afterAll(async () => {
  await stopMemoryMongo();
});

beforeEach(async () => {
  vi.useRealTimers();
  await clearCollections();
});

async function account(
  overrides: Record<string, unknown> = {},
): Promise<InstanceType<typeof User>> {
  return User.create({
    email: `${new Types.ObjectId()}@example.com`,
    ...overrides,
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fakeJob(data: unknown, id: string | undefined = 'job-1'): Job {
  return { data, id, queueName: 'test-queue', name: 'test-job' } as Job;
}

describe('account deletion claims and leases', () => {
  it('covers missing, not-due, legal-hold, claimed, and resumed states', async () => {
    const now = new Date('2026-08-01T00:00:00Z');
    expect(await claimAccountDeletion('not-an-object-id', now)).toEqual({ status: 'missing' });
    expect(await claimAccountDeletionAttempt('not-an-object-id', 'missing-attempt', now)).toEqual({
      status: 'missing',
    });
    expect(await claimAccountDeletion(new Types.ObjectId().toString(), now)).toEqual({
      status: 'missing',
    });
    const notDue = await account({ deletionScheduledAt: new Date('2026-08-02T00:00:00Z') });
    const held = await account({ deletionScheduledAt: now, legalHold: true });
    const cancelling = await account({
      deletionScheduledAt: now,
      deletionCancellationId: 'cancel-in-flight',
      deletionCancellationRequestedAt: now,
    });
    const due = await account({ deletionScheduledAt: now });
    expect(await claimAccountDeletion(String(notDue._id), now)).toEqual({ status: 'not-due' });
    expect(await claimAccountDeletion(String(held._id), now)).toEqual({ status: 'legal-hold' });
    expect(await claimAccountDeletion(String(cancelling._id), now)).toEqual({
      status: 'not-due',
    });
    expect((await User.findById(cancelling._id))?.deletionStartedAt ?? null).toBeNull();
    expect(await claimAccountDeletion(String(due._id), now)).toEqual({
      status: 'claimed',
      startedAt: now,
    });
    expect(await claimAccountDeletion(String(due._id), new Date(now.getTime() + 1))).toEqual({
      status: 'resumed',
      startedAt: now,
    });
    expect(await User.findById(due._id).lean()).toMatchObject({
      suspended: true,
      suspendedAt: now,
      deletionStartedAt: now,
    });
  });

  it('refuses a claim while work is live, then claims immediately after release', async () => {
    const now = new Date('2026-08-01T00:00:00Z');
    const user = await account({ deletionScheduledAt: now });
    const lease = await acquireAccountWorkLease(String(user._id), 'request-1', now);
    expect(lease).not.toBeNull();
    expect(await claimAccountDeletion(String(user._id), now)).toEqual({ status: 'busy' });
    await releaseAccountWorkLease(lease!);
    expect(await claimAccountDeletion(String(user._id), now)).toMatchObject({ status: 'claimed' });
    expect(await acquireAccountWorkLease(String(user._id), 'too-late', now)).toBeNull();
  });

  it('re-reads every terminal state after a deletion-claim race', async () => {
    const now = new Date('2026-08-01T00:00:00Z');
    const runRace = async (
      mutate: (user: InstanceType<typeof User>) => Promise<void>,
    ) => {
      const user = await account({ deletionScheduledAt: now });
      const lease = await acquireAccountWorkLease(String(user._id), `block-${user._id}`, now);
      if (!lease) throw new Error('expected blocking account lease');
      return claimAccountDeletion(String(user._id), now, {
        afterClaimMiss: () => mutate(user),
      });
    };

    await expect(
      runRace(async (user) => {
        await User.collection.deleteOne({ _id: user._id });
      }),
    ).resolves.toEqual({ status: 'missing' });
    await expect(
      runRace(async (user) => {
        await User.collection.updateOne({ _id: user._id }, { $set: { legalHold: true } });
      }),
    ).resolves.toEqual({ status: 'legal-hold' });
    await expect(
      runRace(async (user) => {
        await User.collection.updateOne(
          { _id: user._id },
          { $set: { deletionStartedAt: now } },
        );
      }),
    ).resolves.toEqual({ status: 'resumed', startedAt: now });
    await expect(
      runRace(async (user) => {
        await User.collection.updateOne(
          { _id: user._id },
          { $set: { deletionCancellationRequestedAt: now } },
        );
      }),
    ).resolves.toEqual({ status: 'not-due' });
    await expect(
      runRace(async (user) => {
        await User.collection.updateOne(
          { _id: user._id },
          { $set: { deletionScheduledAt: new Date(now.getTime() + 1) } },
        );
      }),
    ).resolves.toEqual({ status: 'not-due' });
  });

  it('removes expired/duplicate leases and renews only a live owned lease', async () => {
    const now = new Date('2026-08-01T00:00:00Z');
    const user = await account({
      workLeases: [
        { leaseId: 'expired', expiresAt: new Date(now.getTime() - 1) },
        { leaseId: 'replace-me', expiresAt: new Date(now.getTime() + 1_000) },
      ],
    });
    const lease = await acquireAccountWorkLease(String(user._id), 'replace-me', now);
    expect(lease).not.toBeNull();
    expect((await User.findById(user._id).lean())?.workLeases).toHaveLength(1);
    expect(await renewAccountWorkLease(lease!, now)).toBe(true);
    await releaseAccountWorkLease(lease!);
    expect(await renewAccountWorkLease(lease!, now)).toBe(false);
    await expect(releaseAccountWorkLease(lease!)).resolves.toBeUndefined();
    expect(await acquireAccountWorkLease('invalid', 'bad', now)).toBeNull();
  });

  it('serializes purge attempts, then permits explicit release or crash-expiry takeover', async () => {
    const now = new Date('2026-08-01T00:00:00Z');
    const user = await account({ deletionScheduledAt: now });
    const raced = await Promise.all([
      claimAccountDeletionAttempt(String(user._id), 'attempt-a', now),
      claimAccountDeletionAttempt(String(user._id), 'attempt-b', now),
    ]);
    const winner = raced.find((entry) => entry.status === 'claimed' || entry.status === 'resumed');
    expect(winner).toBeDefined();
    expect(raced.filter((entry) => entry.status === 'busy')).toHaveLength(1);
    if (!winner || (winner.status !== 'claimed' && winner.status !== 'resumed')) return;

    await releaseAccountDeletionAttempt(winner.attempt);
    await expect(
      claimAccountDeletionAttempt(String(user._id), 'attempt-c', now),
    ).resolves.toMatchObject({ status: 'resumed', attempt: { leaseId: 'attempt-c' } });

    await expect(
      claimAccountDeletionAttempt(
        String(user._id),
        'attempt-d',
        new Date(now.getTime() + ACCOUNT_DELETION_ATTEMPT_MS + 1),
      ),
    ).resolves.toMatchObject({ status: 'resumed', attempt: { leaseId: 'attempt-d' } });
  });

  it('does not perform a fallible ownership check after the final User delete', async () => {
    const now = new Date('2026-08-01T00:00:00Z');
    const user = await account({ deletionScheduledAt: now });
    const claim = await claimAccountDeletionAttempt(String(user._id), 'terminal', now);
    if (claim.status !== 'claimed' && claim.status !== 'resumed') {
      throw new Error('attempt claim failed');
    }
    await expect(
      runWithAccountDeletionContext(claim.attempt, async () => {
        await assertCurrentAccountWorkLease(now);
        await User.deleteOne({ _id: user._id });
        return 'complete';
      }),
    ).resolves.toBe('complete');
  });

  it('accepts a deletion-owner context without an attempt and rejects a lost attempt', async () => {
    const user = await account({ deletionScheduledAt: new Date(0) });
    await expect(
      runWithAccountWorkLeaseContext(
        { accountId: String(user._id), leaseId: 'owner', deletionOwner: true },
        () => assertCurrentAccountWorkLease(),
      ),
    ).resolves.toBeUndefined();

    const claim = await claimAccountDeletionAttempt(String(user._id), 'lost-attempt');
    if (claim.status !== 'claimed' && claim.status !== 'resumed') {
      throw new Error('expected account deletion attempt');
    }
    await releaseAccountDeletionAttempt(claim.attempt);
    await expect(
      runWithAccountWorkLeaseContext(
        {
          accountId: String(user._id),
          leaseId: 'owner-with-attempt',
          deletionOwner: true,
          deletionAttemptId: claim.attempt.leaseId,
        },
        () => assertCurrentAccountWorkLease(),
      ),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('logs work-lease heartbeat and release datastore failures best-effort', async () => {
    const user = await account();
    const lease = await acquireAccountWorkLease(String(user._id), 'best-effort-work');
    if (!lease) throw new Error('expected account lease');
    const warn = vi.spyOn(logger, 'warn');
    const update = vi.spyOn(User, 'updateOne');

    await accountLifecycleTestables.renewAccountWorkLeaseBestEffort(lease);
    update.mockRejectedValueOnce(new Error('heartbeat unavailable'));
    await accountLifecycleTestables.renewAccountWorkLeaseBestEffort(lease);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: String(user._id) }),
      'account lease heartbeat failed',
    );

    const runtime = { pending: Promise.resolve() };
    accountLifecycleTestables.scheduleAccountWorkLeaseRenewal(runtime, lease);
    await runtime.pending;

    update.mockRejectedValueOnce(new Error('release unavailable'));
    await accountLifecycleTestables.releaseAccountWorkLeaseBestEffort(lease);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: String(user._id) }),
      'account lease release failed',
    );
  });

  it('logs deletion-attempt heartbeat and release datastore failures best-effort', async () => {
    const user = await account({ deletionScheduledAt: new Date(0) });
    const claim = await claimAccountDeletionAttempt(String(user._id), 'best-effort-deletion');
    if (claim.status !== 'claimed' && claim.status !== 'resumed') {
      throw new Error('expected account deletion attempt');
    }
    const warn = vi.spyOn(logger, 'warn');
    const update = vi.spyOn(User, 'updateOne');

    await accountLifecycleTestables.renewAccountDeletionAttemptBestEffort(claim.attempt);
    update.mockRejectedValueOnce(new Error('attempt heartbeat unavailable'));
    await accountLifecycleTestables.renewAccountDeletionAttemptBestEffort(claim.attempt);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: String(user._id) }),
      'account deletion attempt heartbeat failed',
    );

    const runtime = { pending: Promise.resolve() };
    accountLifecycleTestables.scheduleAccountDeletionAttemptRenewal(runtime, claim.attempt);
    await runtime.pending;

    update.mockRejectedValueOnce(new Error('attempt release unavailable'));
    await accountLifecycleTestables.releaseAccountDeletionAttemptBestEffort(claim.attempt);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: String(user._id) }),
      'account deletion attempt release failed',
    );
  });

  it('renews the deletion-attempt timer while purge work is pending', async () => {
    const user = await account({ deletionScheduledAt: new Date(0) });
    const claim = await claimAccountDeletionAttempt(String(user._id), 'timer-deletion');
    if (claim.status !== 'claimed' && claim.status !== 'resumed') {
      throw new Error('expected account deletion attempt');
    }
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const entered = deferred<void>();
    const finish = deferred<string>();
    const running = runWithAccountDeletionContext(claim.attempt, async () => {
      entered.resolve();
      return finish.promise;
    });
    await entered.promise;
    await vi.advanceTimersByTimeAsync(ACCOUNT_WORK_LEASE_HEARTBEAT_MS);
    finish.resolve('purged');
    await expect(running).resolves.toBe('purged');
    vi.useRealTimers();
  });
});

describe('worker/provider lifecycle boundaries', () => {
  it('reuses matching target context, rejects closed targets, and orders bulk targets', async () => {
    const first = await account();
    const second = await account();
    const firstId = String(first._id);
    const secondId = String(second._id);

    await expect(
      runWithAccountWorkLeaseContext(
        { accountId: firstId, leaseId: 'ambient-target' },
        () => tryRunWithTargetAccountWorkLease(firstId, 'nested', async () => 'nested'),
      ),
    ).resolves.toEqual({ acquired: true, value: 'nested' });
    await expect(
      runWithTargetAccountWorkLease('not-an-object-id', 'closed', async () => 'never'),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(
      tryRunWithTargetAccountWorkLease(
        secondId,
        'no-final-assert',
        async () => 'unchecked',
        { assertAfterWork: false },
      ),
    ).resolves.toEqual({ acquired: true, value: 'unchecked' });

    const seen: string[] = [];
    const expectedOrder = [firstId, secondId].sort();
    await expect(
      runWithTargetAccountWorkLeases(
        [secondId, firstId, secondId],
        'bulk-target',
        async (accountId) => {
          seen.push(accountId);
          return accountId;
        },
      ),
    ).resolves.toEqual(expectedOrder);
    expect(seen).toEqual(expectedOrder);
  });

  it('holds a worker lease through completion and makes a concurrent purge busy', async () => {
    const now = new Date('2026-08-01T00:00:00Z');
    const user = await account({ deletionScheduledAt: now });
    const entered = deferred<void>();
    const finish = deferred<string>();
    const processor = withAccountWorkLease(async () => {
      entered.resolve();
      return finish.promise;
    });
    const running = processor(fakeJob({ accountId: String(user._id) }));
    await entered.promise;
    expect(await claimAccountDeletion(String(user._id), now)).toEqual({ status: 'busy' });
    finish.resolve('done');
    await expect(running).resolves.toBe('done');
    expect((await User.findById(user._id).lean())?.workLeases).toEqual([]);
  });

  it('supports explicitly global processors and rejects missing/deleted account scopes', async () => {
    const global = vi.fn(async () => 'global');
    await expect(
      withAccountWorkLease(global, async () => undefined)(fakeJob({ source: 'sweep' })),
    ).resolves.toBe('global');
    expect(global).toHaveBeenCalledOnce();
    await expect(
      withAccountWorkLease(async () => 'never', async () => null)(fakeJob({})),
    ).rejects.toBeInstanceOf(UnrecoverableError);

    const user = await account({
      deletionScheduledAt: new Date('2026-08-01T00:00:00Z'),
      deletionStartedAt: new Date('2026-08-01T00:00:00Z'),
    });
    await expect(
      withAccountWorkLease(async () => 'never')(fakeJob({ userId: String(user._id) })),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    expect(directAccountScope(fakeJob({ accountId: String(user._id) }))).toBe(String(user._id));
    expect(directAccountScope(fakeJob({ userId: String(user._id) }))).toBe(String(user._id));
    expect(directAccountScope(fakeJob({ accountId: 42, userId: 42 }))).toBeNull();
  });

  it('renews long work and surfaces a lost heartbeat before reporting success', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const user = await account();
    const finish = deferred<string>();
    const entered = deferred<void>();
    const running = withAccountWorkLease(async () => {
      entered.resolve();
      return finish.promise;
    })(fakeJob({ accountId: String(user._id) }));
    await entered.promise;
    await vi.advanceTimersByTimeAsync(ACCOUNT_WORK_LEASE_HEARTBEAT_MS);
    expect((await User.findById(user._id).lean())?.workLeases).toHaveLength(1);
    await User.updateOne({ _id: user._id }, { $set: { workLeases: [] } });
    await vi.advanceTimersByTimeAsync(ACCOUNT_WORK_LEASE_HEARTBEAT_MS);
    finish.resolve('unsafe-success');
    await expect(running).rejects.toThrow(/lease was lost/);
    vi.useRealTimers();
  });

  it('revalidates nested provider methods and each streamed event', async () => {
    const user = await account();
    const lease = (await acquireAccountWorkLease(String(user._id), 'provider'))!;
    const call = vi.fn(async (value: string) => `ok:${value}`);
    const raw = { nested: { call }, label: 'provider', empty: null };
    const guarded = guardAccountLifecycleCalls(raw);
    expect(guardAccountLifecycleCalls(raw)).toBe(guarded);
    expect(guarded.label).toBe('provider');
    expect(guarded.empty).toBeNull();
    await expect(
      runWithAccountWorkLeaseContext(lease, () => guarded.nested.call('first')),
    ).resolves.toBe('ok:first');

    const stream = guardAccountLifecycleStream(async function* () {
      yield 'one';
      yield 'two';
    });
    const iterator = runWithAccountWorkLeaseContext(lease, () =>
      stream(undefined)[Symbol.asyncIterator](),
    );
    await expect(
      runWithAccountWorkLeaseContext(lease, () => iterator.next()),
    ).resolves.toEqual({ done: false, value: 'one' });
    await releaseAccountWorkLease(lease);
    await expect(
      runWithAccountWorkLeaseContext(lease, () => guarded.nested.call('late')),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(
      runWithAccountWorkLeaseContext(lease, () => iterator.next()),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(assertCurrentAccountWorkLease()).resolves.toBeUndefined();
  });

  it('uses an invocation-unique anonymous worker lease id', async () => {
    const user = await account();
    const observed = withAccountWorkLease(async () => {
      const stored = await User.findById(user._id).lean();
      return stored?.workLeases[0]?.leaseId;
    });
    const job = fakeJob({ accountId: String(user._id) });
    job.id = undefined;
    await expect(observed(job)).resolves.toContain(':anonymous:');
  });
});

describe('queue boundary scheduler matrix', () => {
  it('ignores only exact empty scheduler sentinels and retains every malformed non-empty scope', () => {
    expect(accountScopesFromQueuePayload({})).toEqual([]);
    expect(accountScopesFromQueuePayload({ accountId: '', userId: '' })).toEqual([]);
    expect(accountScopesFromQueuePayload({ accountId: ' ' })).toEqual([' ']);
    expect(accountScopesFromQueuePayload({ accountId: 'malformed' })).toEqual(['malformed']);
    expect(
      accountScopesFromQueuePayload({ original: { userId: 'aaaaaaaaaaaaaaaaaaaaaaaa' } }),
    ).toEqual(['aaaaaaaaaaaaaaaaaaaaaaaa']);
    expect(accountScopesFromQueuePayload({ nested: { userId: 'ignored-attribution' } })).toEqual([]);
    expect(
      accountScopesFromQueuePayload([
        { accountId: 'bbbbbbbbbbbbbbbbbbbbbbbb' },
        { userId: 'aaaaaaaaaaaaaaaaaaaaaaaa' },
      ]),
    ).toEqual(['aaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbb']);
  });

  it('reuses an ambient account lease', async () => {
    const user = await account();
    const accountId = String(user._id);
    const lease = await acquireAccountWorkLease(accountId, 'ambient-queue-boundary');
    if (!lease) throw new Error('expected ambient account lease');
    const callback = vi.fn(async () => 'queued');
    await expect(
      runWithAccountWorkLeaseContext(lease, () =>
        withAccountQueueBoundary('add', [{ accountId }], callback),
      ),
    ).resolves.toBe('queued');
    await releaseAccountWorkLease(lease);

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('accepts global/empty templates but fails malformed non-empty scheduler data before upsert', async () => {
    const callback = vi.fn(async () => 'upserted');
    await expect(withAccountQueueBoundary('upsertJobScheduler', [{}], callback)).resolves.toBe(
      'upserted',
    );
    await expect(
      withAccountQueueBoundary('upsertJobScheduler', [{ accountId: '' }], callback),
    ).resolves.toBe('upserted');
    await expect(
      withAccountQueueBoundary('upsertJobScheduler', [{ accountId: 'malformed' }], callback),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it('proves the shipped weekly-pulse template carries a real scope and holds it through enqueue', async () => {
    const user = await account({ deletionScheduledAt: new Date('2026-08-01T00:00:00Z') });
    let templateData: unknown;
    const queue = {
      upsertJobScheduler: vi.fn(async (_key, _repeat, template) => {
        templateData = template.data;
      }),
    } as unknown as Queue;
    await upsertPulseScheduler(queue, {
      accountId: String(user._id),
      siteId: new Types.ObjectId().toString(),
    });
    expect(accountScopesFromQueuePayload(templateData)).toEqual([String(user._id)]);

    const entered = deferred<void>();
    const finish = deferred<void>();
    const enqueue = withAccountQueueBoundary('add', [templateData], async () => {
      entered.resolve();
      await finish.promise;
    });
    await entered.promise;
    expect(
      await claimAccountDeletion(String(user._id), new Date('2026-08-01T00:00:00Z')),
    ).toEqual({ status: 'busy' });
    finish.resolve();
    await enqueue;
  });

  it('renews a slow enqueue boundary and removes the committed job if deletion wins at expiry', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const user = await account({ deletionScheduledAt: new Date(0) });
    const entered = deferred<void>();
    const finish = deferred<void>();
    const artifact = { remove: vi.fn(async () => undefined) };
    const enqueue = withAccountQueueBoundary(
      'add',
      [{ accountId: String(user._id) }],
      async () => {
        entered.resolve();
        await finish.promise;
        return artifact;
      },
      async (result) => result.remove(),
    );
    await entered.promise;

    await vi.advanceTimersByTimeAsync(ACCOUNT_WORK_LEASE_HEARTBEAT_MS);
    await expect(claimAccountDeletion(String(user._id), new Date())).resolves.toEqual({
      status: 'busy',
    });

    // Model the enqueue callback exceeding even its renewed lease window. The
    // deletion claim prunes the expired boundary lease while Redis is about to
    // return a committed Job artifact.
    await expect(
      claimAccountDeletion(
        String(user._id),
        new Date(Date.now() + ACCOUNT_WORK_LEASE_MS + 1),
      ),
    ).resolves.toMatchObject({ status: 'claimed' });
    finish.resolve();
    await expect(enqueue).rejects.toThrow(/lease was lost/);
    expect(artifact.remove).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('releases earlier account leases if a later account in a bulk enqueue is blocked', async () => {
    const open = await account();
    const blocked = await account({ deletionStartedAt: new Date() });
    const callback = vi.fn(async () => undefined);
    await expect(
      withAccountQueueBoundary(
        'addBulk',
        [{ accountId: String(open._id) }, { accountId: String(blocked._id) }],
        callback,
      ),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    expect(callback).not.toHaveBeenCalled();
    expect((await User.findById(open._id).lean())?.workLeases).toEqual([]);
  });

  it('compensates scheduler and bulk writes through the installed account queue boundary', async () => {
    const prototype = Queue.prototype as unknown as Record<PropertyKey, unknown>;
    const marker = Symbol.for('rankme.accountLifecycleQueueWriteBarrier');
    const originals = {
      add: prototype.add,
      addBulk: prototype.addBulk,
      upsertJobScheduler: prototype.upsertJobScheduler,
    };
    const calls = vi.fn(async (): Promise<unknown> => 'queued');
    prototype.add = calls;
    prototype.addBulk = calls;
    prototype.upsertJobScheduler = calls;
    delete prototype[marker];
    installAccountQueueWriteBarrier();

    const blockedQueueCall = async (
      method: 'addBulk' | 'upsertJobScheduler',
      accountId: string,
      result: unknown,
      schedulerId: string | number = 'account-scheduler',
    ) => {
      const entered = deferred<void>();
      const finish = deferred<void>();
      calls.mockImplementationOnce(async () => {
        entered.resolve();
        await finish.promise;
        return result;
      });
      const queue = { removeJobScheduler: vi.fn(async () => true) };
      const pending =
        method === 'addBulk'
          ? (prototype.addBulk as (...args: unknown[]) => Promise<unknown>).call(queue, [
              { name: 'owned', data: { accountId } },
              null,
            ])
          : (prototype.upsertJobScheduler as (...args: unknown[]) => Promise<unknown>).call(
              queue,
              schedulerId,
              { every: 1_000 },
              { name: 'owned', data: { accountId } },
            );
      await entered.promise;
      await expect(
        claimAccountDeletion(
          accountId,
          new Date(Date.now() + ACCOUNT_WORK_LEASE_MS + 1),
        ),
      ).resolves.toMatchObject({ status: 'claimed' });
      finish.resolve();
      return { pending, queue };
    };

    try {
      await expect(
        (prototype.add as (...args: unknown[]) => Promise<unknown>).call({}, 'global'),
      ).resolves.toBe('queued');
      await expect(
        (prototype.addBulk as (...args: unknown[]) => Promise<unknown>).call({}, 'not-an-array'),
      ).resolves.toBe('queued');
      await expect(
        (prototype.upsertJobScheduler as (...args: unknown[]) => Promise<unknown>).call(
          {},
          'global-scheduler',
          { every: 1_000 },
          null,
        ),
      ).resolves.toBe('queued');

      const schedulerOwner = await account({ deletionScheduledAt: new Date(0) });
      const schedulerCall = await blockedQueueCall(
        'upsertJobScheduler',
        String(schedulerOwner._id),
        undefined,
      );
      await expect(schedulerCall.pending).rejects.toThrow(/lease was lost/);
      expect(schedulerCall.queue.removeJobScheduler).toHaveBeenCalledWith('account-scheduler');

      const successfulArtifact = { remove: vi.fn(async () => undefined) };
      const failedArtifact = { remove: vi.fn(async () => Promise.reject(new Error('redis down'))) };
      const warn = vi.spyOn(logger, 'warn');
      const bulkOwner = await account({ deletionScheduledAt: new Date(0) });
      const bulkCall = await blockedQueueCall('addBulk', String(bulkOwner._id), [
        successfulArtifact,
        null,
        { remove: 'not-a-function' },
        failedArtifact,
      ]);
      await expect(bulkCall.pending).rejects.toThrow(/lease was lost/);
      expect(successfulArtifact.remove).toHaveBeenCalledOnce();
      expect(failedArtifact.remove).toHaveBeenCalledOnce();
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'addBulk' }),
        'account queue boundary compensation failed',
      );

      const malformedSchedulerOwner = await account({ deletionScheduledAt: new Date(0) });
      const malformedSchedulerCall = await blockedQueueCall(
        'upsertJobScheduler',
        String(malformedSchedulerOwner._id),
        undefined,
        42,
      );
      await expect(malformedSchedulerCall.pending).rejects.toThrow(/lease was lost/);
      expect(malformedSchedulerCall.queue.removeJobScheduler).not.toHaveBeenCalled();

      installAccountQueueWriteBarrier();
    } finally {
      prototype.add = originals.add;
      prototype.addBulk = originals.addBulk;
      prototype.upsertJobScheduler = originals.upsertJobScheduler;
      delete prototype[marker];
    }
  });

  it('accepts an all-successful bulk compensation result', async () => {
    const artifact = { remove: vi.fn(async () => undefined) };
    await expect(
      accountLifecycleTestables.compensateAccountQueueWrite(
        {} as Queue,
        'addBulk',
        [],
        [artifact],
      ),
    ).resolves.toBeUndefined();
    expect(artifact.remove).toHaveBeenCalledOnce();
  });
});

describe('account Mongo write barrier', () => {
  it('is idempotent and blocks writes immediately after an ambient lease is lost', async () => {
    const user = await account();
    const accountId = String(user._id);
    installAccountMongoWriteBarrier();
    installAccountMongoWriteBarrier();

    await expect(
      User.updateOne({ _id: user._id }, { $set: { suspended: false } }),
    ).resolves.toMatchObject({ acknowledged: true });
    const lease = await acquireAccountWorkLease(accountId, 'mongo-boundary');
    if (!lease) throw new Error('expected account lease');
    await expect(
      runWithAccountWorkLeaseContext(lease, async () =>
        await User.updateOne({ _id: user._id }, { $set: { suspended: false } }),
      ),
    ).resolves.toMatchObject({ acknowledged: true });
    await releaseAccountWorkLease(lease);
    await expect(
      runWithAccountWorkLeaseContext(lease, async () =>
        await User.updateOne({ _id: user._id }, { $set: { suspended: true } }),
      ),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });
});

describe('account request lease middleware', () => {
  it('reuses ambient ownership and fails closed when the account cannot be leased', async () => {
    const user = await account();
    const next = vi.fn();
    await expect(
      runWithAccountWorkLeaseContext(
        { accountId: String(user._id), leaseId: 'ambient-request' },
        () =>
          continueWithAccountWorkLease(
            String(user._id),
            'request-id',
            new EventEmitter() as never,
            next,
          ),
      ),
    ).resolves.toBe(true);
    expect(next).toHaveBeenCalledOnce();
    await expect(
      continueWithAccountWorkLease(
        new Types.ObjectId().toString(),
        'missing',
        new EventEmitter() as never,
        next,
      ),
    ).resolves.toBe(false);
  });

  it('uses bounded request ids and logs heartbeat/release failures without double release', async () => {
    const user = await account();
    const response = new EventEmitter();
    const next = vi.fn();
    vi.useFakeTimers({ shouldAdvanceTime: false });
    await expect(
      continueWithAccountWorkLease(String(user._id), 42, response as never, next),
    ).resolves.toBe(true);
    const error = vi.spyOn(logger, 'error');
    const update = vi.spyOn(User, 'updateOne');
    update.mockRejectedValueOnce(new Error('request heartbeat unavailable'));
    await vi.advanceTimersByTimeAsync(ACCOUNT_WORK_LEASE_HEARTBEAT_MS);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: String(user._id) }),
      'account request lease renewal failed',
    );

    update.mockRejectedValueOnce(new Error('request release unavailable'));
    response.emit('finish');
    await vi.waitFor(() => {
      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({ accountId: String(user._id) }),
        'account request lease release failed',
      );
    });
    const callsAfterFinish = update.mock.calls.length;
    response.emit('close');
    await Promise.resolve();
    expect(update).toHaveBeenCalledTimes(callsAfterFinish);
    vi.useRealTimers();

    const fallbackUser = await account();
    const fallbackResponse = new EventEmitter();
    await expect(
      continueWithAccountWorkLease(
        String(fallbackUser._id),
        { unsafe: true },
        fallbackResponse as never,
        vi.fn(),
      ),
    ).resolves.toBe(true);
    fallbackResponse.emit('finish');
  });
});
