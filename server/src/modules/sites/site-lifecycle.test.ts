import { EventEmitter } from 'node:events';
import mongoose from 'mongoose';
import { Queue, UnrecoverableError, type Job } from 'bullmq';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import { logger } from '../../config/logger.js';
import { Site } from './sites.model.js';
import { User } from '../users/users.model.js';
import {
  acquireSiteWorkLease,
  assertSiteDeletionAttempt,
  assertCurrentSiteWorkLease,
  claimSiteDeletion,
  claimSiteDeletionAttempt,
  directSiteScope,
  guardSiteLifecycleCalls,
  guardSiteLifecycleStream,
  installSiteMongoWriteBarrier,
  installSiteQueueWriteBarrier,
  releaseSiteWorkLease,
  releaseSiteDeletionAttempt,
  renewSiteWorkLease,
  renewSiteDeletionAttempt,
  runWithSiteWorkLeaseContext,
  runWithRenewingSiteDeletionAttempt,
  siteLifecycleTestables,
  SITE_DELETION_ATTEMPT_MS,
  SITE_WORK_LEASE_HEARTBEAT_MS,
  SITE_WORK_LEASE_MS,
  tryRunWithSiteWorkLease,
  withSiteWorkLease,
} from './site-lifecycle.js';
import {
  installAccountMongoWriteBarrier,
} from '../legal/account-lifecycle.js';
import { continueWithAccountWorkLease } from '../legal/account-lifecycle.middleware.js';
import {
  bodySiteMutationLease,
  createSiteMutationLease,
  querySiteMutationLease,
  siteMutationLease,
} from './site-lifecycle.middleware.js';

const accountId = new mongoose.Types.ObjectId();

async function createSite(domain: string) {
  return Site.create({
    accountId,
    url: `https://${domain}`,
    domain,
  });
}

function fakeJob(
  siteId: string,
  overrides: Partial<Job> = {},
): Job {
  return {
    id: 'same-job',
    name: 'work',
    queueName: 'lifecycle',
    data: { accountId: String(accountId), siteId },
    ...overrides,
  } as Job;
}

beforeAll(async () => {
  await startMemoryMongo();
  installSiteMongoWriteBarrier();
  installAccountMongoWriteBarrier();
});

afterAll(async () => {
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await User.create({
    _id: accountId,
    email: 'site-lifecycle-owner@example.com',
    emailVerified: true,
  });
  vi.restoreAllMocks();
});

describe('site lifecycle leases', () => {
  it('fails invalid scopes closed', async () => {
    await expect(
      acquireSiteWorkLease({ accountId: 'bad', siteId: 'bad' }, 'lease'),
    ).resolves.toBeNull();
    await expect(
      claimSiteDeletion({ accountId: 'bad', siteId: 'bad' }),
    ).resolves.toEqual({ status: 'missing' });
    await expect(
      claimSiteDeletion({
        accountId: String(accountId),
        siteId: String(new mongoose.Types.ObjectId()),
      }),
    ).resolves.toEqual({ status: 'missing' });
    expect(directSiteScope(fakeJob('x', { data: {} }))).toBeNull();
  });

  it('atomically makes a live lease beat deletion, then resumes one durable claim', async () => {
    const site = await createSite('claim.example.com');
    const scope = { accountId: String(accountId), siteId: String(site._id) };
    const lease = await acquireSiteWorkLease(scope, 'lease-a');
    expect(lease).not.toBeNull();
    await expect(claimSiteDeletion(scope)).resolves.toEqual({ status: 'busy' });
    expect(await renewSiteWorkLease(lease!)).toBe(true);
    await releaseSiteWorkLease(lease!);

    const startedAt = new Date('2026-08-06T12:00:00.000Z');
    await expect(claimSiteDeletion(scope, startedAt)).resolves.toEqual({
      status: 'claimed',
      startedAt,
    });
    await expect(acquireSiteWorkLease(scope, 'too-late')).resolves.toBeNull();
    await expect(claimSiteDeletion(scope, new Date())).resolves.toEqual({
      status: 'resumed',
      startedAt,
    });
  });

  it('persists deletion actor and audit provenance on the durable claim', async () => {
    const site = await createSite('claim-provenance.example.com');
    const scope = { accountId: String(accountId), siteId: String(site._id) };
    const actorUserId = new mongoose.Types.ObjectId().toString();
    await expect(
      claimSiteDeletion(scope, new Date('2026-08-07T12:00:00.000Z'), {
        actorUserId,
        auditSource: 'test-source',
      }),
    ).resolves.toMatchObject({ status: 'claimed' });
    const stored = await Site.findById(site._id).lean();
    expect(String(stored?.deletionActorUserId)).toBe(actorUserId);
    expect(stored?.deletionAuditSource).toBe('test-source');
  });

  it('prunes expired leases and rejects renewal after expiry', async () => {
    const site = await createSite('expired.example.com');
    const scope = { accountId: String(accountId), siteId: String(site._id) };
    const lease = await acquireSiteWorkLease(scope, 'expired', new Date(0));
    expect(lease).not.toBeNull();
    expect(await renewSiteWorkLease(lease!, new Date('2026-08-06'))).toBe(false);
    const claim = await claimSiteDeletion(scope, new Date('2026-08-06'));
    expect(claim.status).toBe('claimed');
  });

  it('runs service work under a renewable lease and reports unavailable scopes', async () => {
    const site = await createSite('service-lease.example.com');
    const scope = { accountId: String(accountId), siteId: String(site._id) };
    await expect(
      tryRunWithSiteWorkLease(scope, 'service-test', async () => 'value'),
    ).resolves.toEqual({ acquired: true, value: 'value' });
    expect((await Site.findById(site._id).lean())?.workLeases).toEqual([]);

    await claimSiteDeletion(scope);
    await expect(
      tryRunWithSiteWorkLease(scope, 'service-test', async () => 'never'),
    ).resolves.toEqual({ acquired: false });
    await expect(
      tryRunWithSiteWorkLease(
        { accountId: new mongoose.Types.ObjectId().toString(), siteId: scope.siteId },
        'missing-account',
        async () => 'never',
      ),
    ).resolves.toEqual({ acquired: false });
  });

  it('propagates unexpected service-lease datastore failures', async () => {
    const site = await createSite('service-lease-error.example.com');
    const scope = { accountId: String(accountId), siteId: String(site._id) };
    vi.spyOn(Site, 'updateOne').mockRejectedValueOnce(new Error('site datastore unavailable'));

    await expect(
      tryRunWithSiteWorkLease(scope, 'service-error', async () => 'never'),
    ).rejects.toThrow('site datastore unavailable');
  });

  it('logs heartbeat and release datastore errors without masking work', async () => {
    const site = await createSite('best-effort.example.com');
    const scope = { accountId: String(accountId), siteId: String(site._id) };
    const lease = await acquireSiteWorkLease(scope, 'best-effort');
    if (!lease) throw new Error('expected lease');
    const warn = vi.spyOn(logger, 'warn');
    const update = vi.spyOn(Site, 'updateOne');

    await siteLifecycleTestables.renewSiteWorkLeaseBestEffort(lease);
    update.mockRejectedValueOnce(new Error('heartbeat unavailable'));
    await siteLifecycleTestables.renewSiteWorkLeaseBestEffort(lease);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ siteId: scope.siteId }),
      'site lease heartbeat failed',
    );

    const runtime = { pending: Promise.resolve() };
    siteLifecycleTestables.scheduleSiteWorkLeaseRenewal(runtime, lease);
    await runtime.pending;

    update.mockRejectedValueOnce(new Error('release unavailable'));
    await siteLifecycleTestables.releaseSiteWorkLeaseBestEffort(lease);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ siteId: scope.siteId }),
      'site lease release failed',
    );
  });

  it('allows only one deletion attempt and resumes after release or crash expiry', async () => {
    const site = await createSite('attempt-owner.example.com');
    const scope = { accountId: String(accountId), siteId: String(site._id) };
    const now = new Date('2026-08-06T00:00:00Z');
    const raced = await Promise.all([
      claimSiteDeletionAttempt(scope, 'attempt-a', now),
      claimSiteDeletionAttempt(scope, 'attempt-b', now),
    ]);
    const winner = raced.find((entry) => entry.status === 'claimed' || entry.status === 'resumed');
    expect(winner).toBeDefined();
    expect(raced.filter((entry) => entry.status === 'busy')).toHaveLength(1);
    if (!winner || (winner.status !== 'claimed' && winner.status !== 'resumed')) return;
    await releaseSiteDeletionAttempt(winner.attempt);
    await expect(claimSiteDeletionAttempt(scope, 'attempt-c', now)).resolves.toMatchObject({
      status: 'resumed',
      attempt: { leaseId: 'attempt-c' },
    });
    await expect(
      claimSiteDeletionAttempt(
        scope,
        'attempt-d',
        new Date(now.getTime() + SITE_DELETION_ATTEMPT_MS + 1),
      ),
    ).resolves.toMatchObject({
      status: 'resumed',
      attempt: { leaseId: 'attempt-d' },
    });
  });

  it('handles deletion claim disappearance and claim completion races', async () => {
    const disappeared = await createSite('claim-disappeared.example.com');
    const disappearedScope = {
      accountId: String(accountId),
      siteId: String(disappeared._id),
    };
    const blockingLease = await acquireSiteWorkLease(disappearedScope, 'claim-blocker');
    if (!blockingLease) throw new Error('expected blocking lease');
    await expect(
      claimSiteDeletion(disappearedScope, new Date(), {}, {
        afterClaimMiss: async () => {
          await Site.collection.deleteOne({ _id: disappeared._id });
        },
      }),
    ).resolves.toEqual({ status: 'missing' });

    const resumed = await createSite('claim-resumed-race.example.com');
    const resumedScope = { accountId: String(accountId), siteId: String(resumed._id) };
    const resumedLease = await acquireSiteWorkLease(resumedScope, 'claim-blocker');
    if (!resumedLease) throw new Error('expected blocking lease');
    const startedAt = new Date('2026-08-07T00:00:00.000Z');
    await expect(
      claimSiteDeletion(resumedScope, startedAt, {}, {
        afterClaimMiss: async () => {
          await releaseSiteWorkLease(resumedLease);
          await Site.collection.updateOne(
            { _id: resumed._id },
            { $set: { deletionStartedAt: startedAt } },
          );
        },
      }),
    ).resolves.toEqual({ status: 'resumed', startedAt });
  });

  it('fails invalid deletion attempts and expired attempt assertions closed', async () => {
    await expect(
      claimSiteDeletionAttempt({ accountId: 'bad', siteId: 'bad' }, 'invalid'),
    ).resolves.toEqual({ status: 'missing' });
    const site = await createSite('attempt-expired.example.com');
    const scope = { accountId: String(accountId), siteId: String(site._id) };
    const now = new Date('2026-08-07T00:00:00.000Z');
    const claim = await claimSiteDeletionAttempt(scope, 'expiring-attempt', now);
    if (claim.status !== 'claimed' && claim.status !== 'resumed') {
      throw new Error('expected deletion attempt');
    }
    expect(
      await renewSiteDeletionAttempt(
        claim.attempt,
        new Date(now.getTime() + SITE_DELETION_ATTEMPT_MS + 1),
      ),
    ).toBe(false);
    await expect(
      assertSiteDeletionAttempt(
        claim.attempt,
        new Date(now.getTime() + SITE_DELETION_ATTEMPT_MS + 1),
      ),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('logs deletion-attempt heartbeat and release failures best-effort', async () => {
    const site = await createSite('attempt-best-effort.example.com');
    const scope = { accountId: String(accountId), siteId: String(site._id) };
    const claim = await claimSiteDeletionAttempt(scope, 'best-effort-attempt');
    if (claim.status !== 'claimed' && claim.status !== 'resumed') {
      throw new Error('expected deletion attempt');
    }
    const warn = vi.spyOn(logger, 'warn');
    const update = vi.spyOn(Site, 'updateOne');
    await siteLifecycleTestables.renewSiteDeletionAttemptBestEffort(claim.attempt);
    update.mockRejectedValueOnce(new Error('attempt heartbeat unavailable'));
    await siteLifecycleTestables.renewSiteDeletionAttemptBestEffort(claim.attempt);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ siteId: scope.siteId }),
      'site deletion attempt heartbeat failed',
    );
    const runtime = { pending: Promise.resolve() };
    siteLifecycleTestables.scheduleSiteDeletionAttemptRenewal(runtime, claim.attempt);
    await runtime.pending;

    update.mockRejectedValueOnce(new Error('attempt release unavailable'));
    await expect(
      runWithRenewingSiteDeletionAttempt(claim.attempt, async () => 'complete'),
    ).resolves.toBe('complete');
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ siteId: scope.siteId }),
      'site deletion attempt release failed',
    );
  });

  it('does not assert or fail after the final Site document is deleted', async () => {
    const site = await createSite('attempt-terminal.example.com');
    const scope = { accountId: String(accountId), siteId: String(site._id) };
    const now = new Date('2026-08-06T00:00:00Z');
    const claim = await claimSiteDeletionAttempt(scope, 'terminal', now);
    if (claim.status !== 'claimed' && claim.status !== 'resumed') {
      throw new Error('attempt claim failed');
    }
    await expect(
      runWithRenewingSiteDeletionAttempt(claim.attempt, async () => {
        await assertSiteDeletionAttempt(claim.attempt, now);
        await Site.deleteOne({ _id: site._id });
        return 'complete';
      }),
    ).resolves.toBe('complete');
  });

  it('uses invocation-unique leases when BullMQ runs the same job id twice', async () => {
    const site = await createSite('stalled.example.com');
    const seen = new Set<string>();
    const wrapped = withSiteWorkLease(async () => {
      const during = await Site.findById(site._id).lean();
      for (const lease of during?.workLeases ?? []) seen.add(lease.leaseId);
      return 'ok';
    });
    const job = fakeJob(String(site._id));
    await expect(Promise.all([wrapped(job), wrapped(job)])).resolves.toEqual(['ok', 'ok']);
    expect(seen.size).toBe(2);
    expect((await Site.findById(site._id).lean())?.workLeases).toEqual([]);
  });

  it('supports anonymous invocation ids and rejects deleting sites', async () => {
    const processor = vi.fn(async () => 'processed');
    const wrapped = withSiteWorkLease(processor);

    const anonymous = await createSite('anonymous-job.example.com');
    const observed = withSiteWorkLease(async () => {
      const stored = await Site.findById(anonymous._id).lean();
      return stored?.workLeases[0]?.leaseId;
    });
    await expect(observed(fakeJob(String(anonymous._id), { id: undefined }))).resolves.toContain(
      ':anonymous:',
    );

    const deleting = await createSite('deleted-job.example.com');
    const scope = { accountId: String(accountId), siteId: String(deleting._id) };
    await claimSiteDeletion(scope);
    await expect(wrapped(fakeJob(scope.siteId))).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('permits truly unscoped work and permanently rejects an unresolved site job', async () => {
    const processor = vi.fn(async () => 'done');
    const unscoped = withSiteWorkLease(processor, async () => undefined);
    await expect(unscoped(fakeJob('none'))).resolves.toBe('done');
    const unresolved = withSiteWorkLease(processor, async () => null);
    await expect(unresolved(fakeJob('none'))).rejects.toBeInstanceOf(UnrecoverableError);
    expect(processor).toHaveBeenCalledTimes(1);
  });

  it('blocks a provider and Mongo write immediately after lease loss', async () => {
    const site = await createSite('lost.example.com');
    const scope = { accountId: String(accountId), siteId: String(site._id) };
    const lease = (await acquireSiteWorkLease(scope, 'lost'))!;
    const providerCall = vi.fn(async () => 'live-result');
    const provider = guardSiteLifecycleCalls({ nested: { providerCall }, label: 'x' });
    expect(guardSiteLifecycleCalls(provider)).toBe(provider);
    await Site.collection.updateOne(
      { _id: site._id },
      { $set: { deletionStartedAt: new Date() }, $setOnInsert: {} },
    );

    await expect(
      runWithSiteWorkLeaseContext(lease, () => provider.nested.providerCall()),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    expect(providerCall).not.toHaveBeenCalled();
    await expect(
      runWithSiteWorkLeaseContext(lease, async () =>
        await Site.updateOne({ _id: site._id }, { $set: { displayName: 'too late' } }),
      ),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(assertCurrentSiteWorkLease()).resolves.toBeUndefined();
  });

  it('allows guarded provider calls without a lease and preserves primitive properties', async () => {
    const call = vi.fn(async (value: string) => `result:${value}`);
    const guarded = guardSiteLifecycleCalls({ nested: { call }, label: 'plain', empty: null });
    await expect(guarded.nested.call('ok')).resolves.toBe('result:ok');
    expect(guarded.label).toBe('plain');
    expect(guarded.empty).toBeNull();
  });

  it('revalidates a streaming provider lease before every yielded event', async () => {
    const site = await createSite('stream-lost.example.com');
    const scope = { accountId: String(accountId), siteId: String(site._id) };
    const lease = (await acquireSiteWorkLease(scope, 'stream-lost'))!;
    const stream = guardSiteLifecycleStream(async function* () {
      yield 'first';
      yield 'second';
    });
    const iterator = runWithSiteWorkLeaseContext(lease, () => stream(undefined)[Symbol.asyncIterator]());
    await expect(
      runWithSiteWorkLeaseContext(lease, () => iterator.next()),
    ).resolves.toMatchObject({ value: 'first', done: false });
    await Site.collection.updateOne(
      { _id: site._id },
      { $set: { deletionStartedAt: new Date() } },
    );
    await expect(
      runWithSiteWorkLeaseContext(lease, () => iterator.next()),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('guards BullMQ enqueue methods without changing unscoped calls', async () => {
    const prototype = Queue.prototype as unknown as Record<PropertyKey, unknown>;
    const marker = Symbol.for('rankme.siteLifecycleQueueWriteBarrier');
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
    installSiteQueueWriteBarrier();
    try {
      await expect(
        (prototype.add as (...args: unknown[]) => Promise<unknown>).call({}, 'x'),
      ).resolves.toBe('queued');
      await expect(
        (prototype.addBulk as (...args: unknown[]) => Promise<unknown>).call({}, null),
      ).resolves.toBe('queued');
      await expect(
        (prototype.upsertJobScheduler as (...args: unknown[]) => Promise<unknown>).call(
          {},
          'empty-template',
          { every: 1_000 },
          null,
        ),
      ).resolves.toBe('queued');

      const live = await createSite('queue-live.example.com');
      const livePayload = {
        accountId: String(accountId),
        siteId: String(live._id),
      };
      await expect(
        (prototype.add as (...args: unknown[]) => Promise<unknown>).call(
          {},
          'site-job',
          livePayload,
        ),
      ).resolves.toBe('queued');
      expect((await Site.findById(live._id).lean())?.workLeases).toEqual([]);
      await expect(
        (prototype.add as (...args: unknown[]) => Promise<unknown>).call(
          {},
          'site-job-with-account-lookup',
          { siteId: String(live._id) },
        ),
      ).resolves.toBe('queued');
      await expect(
        (prototype.add as (...args: unknown[]) => Promise<unknown>).call(
          {},
          'missing-site-with-account-lookup',
          { siteId: String(new mongoose.Types.ObjectId()) },
        ),
      ).rejects.toBeInstanceOf(UnrecoverableError);
      await expect(
        (prototype.add as (...args: unknown[]) => Promise<unknown>).call(
          {},
          'invalid-account',
          { accountId: 'not-an-id', siteId: String(live._id) },
        ),
      ).rejects.toBeInstanceOf(UnrecoverableError);

      const ambientLease = await acquireSiteWorkLease(livePayload, 'ambient-queue');
      if (!ambientLease) throw new Error('expected ambient lease');
      await expect(
        runWithSiteWorkLeaseContext(ambientLease, () =>
          (prototype.add as (...args: unknown[]) => Promise<unknown>).call(
            {},
            'same-ambient-site',
            livePayload,
          ),
        ),
      ).resolves.toBe('queued');
      await releaseSiteWorkLease(ambientLease);

      const second = await createSite('queue-second.example.com');
      await expect(
        (prototype.add as (...args: unknown[]) => Promise<unknown>).call(
          {},
          'multiple-sites',
          [
            { accountId: String(accountId), siteId: String(second._id) },
            livePayload,
          ],
        ),
      ).resolves.toBe('queued');

      // Hostile read → delete-claim → enqueue ordering: the producer's stale
      // read does not authorize Redis. The boundary lease observes the claim
      // and the original Queue.add is never reached.
      expect(await Site.exists({ _id: live._id, deletionStartedAt: null })).not.toBeNull();
      await claimSiteDeletion({
        accountId: String(accountId),
        siteId: String(live._id),
      });
      await expect(
        (prototype.add as (...args: unknown[]) => Promise<unknown>).call(
          {},
          'late-site-job',
          livePayload,
        ),
      ).rejects.toBeInstanceOf(UnrecoverableError);

      const bulk = await createSite('queue-bulk.example.com');
      const bulkPayload = {
        accountId: String(accountId),
        siteId: String(bulk._id),
      };
      await expect(
        (prototype.addBulk as (...args: unknown[]) => Promise<unknown>).call({}, [
          { name: 'bulk', data: { nested: bulkPayload } },
        ]),
      ).resolves.toBe('queued');
      await expect(
        (prototype.upsertJobScheduler as (...args: unknown[]) => Promise<unknown>).call(
          {},
          'scheduler',
          { every: 1000 },
          { name: 'scheduled', data: bulkPayload },
        ),
      ).resolves.toBe('queued');

      const blockedQueueCall = async (
        method: 'addBulk' | 'upsertJobScheduler',
        scope: { accountId: string; siteId: string },
        result: unknown,
        schedulerId: string | number = 'site-scheduler',
      ) => {
        let markEntered!: () => void;
        const entered = new Promise<void>((resolve) => {
          markEntered = resolve;
        });
        let finish!: () => void;
        const finished = new Promise<void>((resolve) => {
          finish = resolve;
        });
        calls.mockImplementationOnce(async () => {
          markEntered();
          await finished;
          return result;
        });
        const queue = { removeJobScheduler: vi.fn(async () => true) };
        const pending =
          method === 'addBulk'
            ? (prototype.addBulk as (...args: unknown[]) => Promise<unknown>).call(queue, [
                { name: 'owned', data: { nested: scope } },
                null,
              ])
            : (prototype.upsertJobScheduler as (...args: unknown[]) => Promise<unknown>).call(
                queue,
                schedulerId,
                { every: 1_000 },
                { name: 'owned', data: scope },
              );
        await entered;
        await expect(
          claimSiteDeletion(scope, new Date(Date.now() + SITE_WORK_LEASE_MS + 1)),
        ).resolves.toMatchObject({ status: 'claimed' });
        finish();
        return { pending, queue };
      };

      const schedulerRaceSite = await createSite('queue-scheduler-race.example.com');
      const schedulerRace = await blockedQueueCall(
        'upsertJobScheduler',
        { accountId: String(accountId), siteId: String(schedulerRaceSite._id) },
        undefined,
      );
      await expect(schedulerRace.pending).rejects.toThrow(/lease expired|lease.*lost|deletion/);
      expect(schedulerRace.queue.removeJobScheduler).toHaveBeenCalledWith('site-scheduler');

      const removedArtifact = { remove: vi.fn(async () => undefined) };
      const failedArtifact = {
        remove: vi.fn(async () => Promise.reject(new Error('redis unavailable'))),
      };
      const warn = vi.spyOn(logger, 'warn');
      const bulkRaceSite = await createSite('queue-bulk-race.example.com');
      const bulkRace = await blockedQueueCall(
        'addBulk',
        { accountId: String(accountId), siteId: String(bulkRaceSite._id) },
        [removedArtifact, null, { remove: 'not-a-function' }, failedArtifact],
      );
      await expect(bulkRace.pending).rejects.toThrow(/lease expired|lease.*lost|deletion/);
      expect(removedArtifact.remove).toHaveBeenCalledOnce();
      expect(failedArtifact.remove).toHaveBeenCalledOnce();
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'addBulk' }),
        'site queue boundary compensation failed',
      );

      const malformedSchedulerSite = await createSite('queue-malformed-scheduler.example.com');
      const malformedScheduler = await blockedQueueCall(
        'upsertJobScheduler',
        { accountId: String(accountId), siteId: String(malformedSchedulerSite._id) },
        undefined,
        42,
      );
      await expect(malformedScheduler.pending).rejects.toThrow(
        /lease expired|lease.*lost|deletion/,
      );
      expect(malformedScheduler.queue.removeJobScheduler).not.toHaveBeenCalled();

      const expiring = await createSite('queue-expiry-race.example.com');
      const expiringScope = {
        accountId: String(accountId),
        siteId: String(expiring._id),
      };
      let markEnqueueEntered!: () => void;
      const enqueueEntered = new Promise<void>((resolve) => {
        markEnqueueEntered = resolve;
      });
      let finishEnqueue!: () => void;
      const enqueueFinish = new Promise<void>((resolve) => {
        finishEnqueue = resolve;
      });
      const committedArtifact = { remove: vi.fn(async () => undefined) };
      calls.mockImplementationOnce(async () => {
        markEnqueueEntered();
        await enqueueFinish;
        return committedArtifact;
      });
      const expiringEnqueue = (
        prototype.add as (...args: unknown[]) => Promise<unknown>
      ).call({}, 'expiry-race', expiringScope);
      await enqueueEntered;
      await expect(
        claimSiteDeletion(
          expiringScope,
          new Date(Date.now() + SITE_WORK_LEASE_MS + 1),
        ),
      ).resolves.toMatchObject({ status: 'claimed' });
      finishEnqueue();
      await expect(expiringEnqueue).rejects.toThrow(/lease expired|lease.*lost|deletion/);
      expect(committedArtifact.remove).toHaveBeenCalledOnce();

      await expect(
        (prototype.add as (...args: unknown[]) => Promise<unknown>).call(
          {},
          'invalid',
          { accountId: String(accountId), siteId: 'not-an-id' },
        ),
      ).rejects.toBeInstanceOf(UnrecoverableError);

      const site = await createSite('queue-lost.example.com');
      const scope = { accountId: String(accountId), siteId: String(site._id) };
      const lease = (await acquireSiteWorkLease(scope, 'queue-lost'))!;
      await Site.collection.updateOne(
        { _id: site._id },
        { $set: { deletionStartedAt: new Date() } },
      );
      await expect(
        runWithSiteWorkLeaseContext(lease, () =>
          (prototype.add as (...args: unknown[]) => Promise<unknown>).call({}, 'x'),
        ),
      ).rejects.toBeInstanceOf(UnrecoverableError);
      expect(calls).toHaveBeenCalledTimes(13);
      installSiteQueueWriteBarrier();
    } finally {
      prototype.add = originals.add;
      prototype.addBulk = originals.addBulk;
      prototype.upsertJobScheduler = originals.upsertJobScheduler;
      delete prototype[marker];
    }
  });

  it('keeps the process-wide Mongo write barrier idempotent', () => {
    expect(() => installSiteMongoWriteBarrier()).not.toThrow();
  });
});

describe('site lifecycle middleware resolvers', () => {
  it('denies selected-scope param/body/resource sites before lease acquisition', async () => {
    const denied = await createSite('team-denied.example.com');
    const allowed = new mongoose.Types.ObjectId().toString();
    for (const middleware of [
      siteMutationLease,
      bodySiteMutationLease,
      createSiteMutationLease(() => String(denied._id), { includeSafeMethods: true }),
    ]) {
      const next = vi.fn();
      middleware(
        {
          id: 'team-denied',
          method: 'POST',
          path: '/work',
          params: { siteId: String(denied._id) },
          body: { siteId: String(denied._id) },
          user: { id: String(accountId) },
          teamRole: 'member',
          teamSiteAccessMode: 'selected',
          teamSiteIds: new Set([allowed]),
        } as never,
        new EventEmitter() as never,
        next,
      );
      await vi.waitFor(() => {
        expect(next.mock.calls[0]?.[0]).toMatchObject({ status: 404 });
      });
      expect((await Site.findById(denied._id).lean())?.workLeases).toEqual([]);
    }
  });

  it('skips safe methods by default, the lifecycle DELETE, and payloads without a site', async () => {
    const next = vi.fn();
    await createSiteMutationLease(() => null)(
      { method: 'GET', params: {}, path: '/', user: null } as never,
      {} as never,
      next,
    );
    await siteMutationLease(
      { method: 'DELETE', params: { siteId: 'x' }, path: '/', user: null } as never,
      {} as never,
      next,
    );
    await bodySiteMutationLease(
      { method: 'POST', params: {}, path: '/', body: {}, user: { id: String(accountId) } } as never,
      {} as never,
      next,
    );
    await bodySiteMutationLease(
      { method: 'POST', params: {}, path: '/', body: null, user: { id: String(accountId) } } as never,
      {} as never,
      next,
    );
    await bodySiteMutationLease(
      {
        method: 'POST', params: {}, path: '/', body: { siteId: 'invalid' },
        user: { id: String(accountId) },
      } as never,
      {} as never,
      next,
    );
    await bodySiteMutationLease(
      {
        method: 'POST', params: {}, path: '/', body: { profileId: 'invalid' },
        user: { id: String(accountId) },
      } as never,
      {} as never,
      next,
    );
    await siteMutationLease(
      {
        method: 'POST', params: { siteId: new mongoose.Types.ObjectId().toString() },
        path: '/content-analyses/preflight', user: { id: String(accountId) },
      } as never,
      {} as never,
      next,
    );
    await querySiteMutationLease(
      {
        method: 'GET', query: { siteId: 'invalid' }, user: { id: String(accountId) },
      } as never,
      {} as never,
      next,
    );
    await querySiteMutationLease(
      {
        method: 'GET', query: { siteId: new mongoose.Types.ObjectId().toString() },
        user: { id: String(accountId) },
      } as never,
      {} as never,
      next,
    );
    await vi.waitFor(() => expect(next).toHaveBeenCalledTimes(9));
  });

  it('uses the request fallback lease id and logs heartbeat/release failures', async () => {
    const site = await createSite('middleware-heartbeat.example.com');
    const response = new EventEmitter();
    let releaseNext!: () => void;
    const nextCalled = new Promise<void>((resolve) => {
      releaseNext = resolve;
    });
    const next = vi.fn(() => releaseNext());
    const error = vi.spyOn(logger, 'error');
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      createSiteMutationLease(() => String(site._id))(
        {
          method: 'POST', params: {}, path: '/', user: { id: String(accountId) },
        } as never,
        response as never,
        next,
      );
      await nextCalled;
      const stored = await Site.findById(site._id).lean();
      expect(stored?.workLeases[0]?.leaseId).toContain('api:request:');

      vi.spyOn(Site, 'updateOne').mockRejectedValueOnce(new Error('renew failed'));
      await vi.advanceTimersByTimeAsync(SITE_WORK_LEASE_HEARTBEAT_MS);
      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({ siteId: String(site._id) }),
        'site mutation lease renewal failed',
      );

      vi.spyOn(Site, 'updateOne').mockRejectedValueOnce(new Error('release failed'));
      response.emit('finish');
      await vi.waitFor(() => {
        expect(error).toHaveBeenCalledWith(
          expect.objectContaining({ siteId: String(site._id) }),
          'site mutation lease release failed',
        );
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('leases body siteId/profileId and releases once on response completion', async () => {
    for (const field of ['siteId', 'profileId'] as const) {
      const site = await createSite(`${field}.example.com`);
      const response = new EventEmitter();
      const next = vi.fn();
      bodySiteMutationLease(
        {
          id: field,
          method: 'POST',
          params: {},
          path: '/',
          body: { [field]: String(site._id) },
          user: { id: String(accountId) },
        } as never,
        response as never,
        next,
      );
      await vi.waitFor(() => expect(next).toHaveBeenCalledOnce());
      expect((await Site.findById(site._id).lean())?.workLeases).toHaveLength(1);
      response.emit('finish');
      response.emit('close');
      await vi.waitFor(async () => {
        expect((await Site.findById(site._id).lean())?.workLeases).toEqual([]);
      });
    }
  });

  it('releases nested account and site request leases regardless of finish-listener order', async () => {
    const site = await createSite('nested-request-release.example.com');
    const response = new EventEmitter();
    let resolveSiteLease!: () => void;
    const siteLeaseReady = new Promise<void>((resolve) => {
      resolveSiteLease = resolve;
    });
    const releaseError = vi.spyOn(logger, 'error');

    await continueWithAccountWorkLease(
      String(accountId),
      'nested-release',
      response as never,
      () => {
        createSiteMutationLease(() => String(site._id))(
          {
            id: 'nested-release',
            method: 'POST',
            params: {},
            path: '/audits',
            user: { id: String(accountId) },
          } as never,
          response as never,
          resolveSiteLease,
        );
      },
    );
    await siteLeaseReady;
    expect((await User.findById(accountId).lean())?.workLeases).toHaveLength(1);
    expect((await Site.findById(site._id).lean())?.workLeases).toHaveLength(1);

    response.emit('finish');
    await vi.waitFor(async () => {
      expect((await User.findById(accountId).lean())?.workLeases).toEqual([]);
      expect((await Site.findById(site._id).lean())?.workLeases).toEqual([]);
    });
    expect(releaseError).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringMatching(/request lease release failed/),
    );
  });

  it('leases query siteId/profileId on reads and hides deleting sites', async () => {
    for (const field of ['siteId', 'profileId'] as const) {
      const site = await createSite(`query-${field}.example.com`);
      await claimSiteDeletion({
        accountId: String(accountId),
        siteId: String(site._id),
      });
      const next = vi.fn();
      querySiteMutationLease(
        {
          id: `query-${field}`,
          method: 'GET',
          query: { [field]: String(site._id) },
          user: { id: String(accountId) },
        } as never,
        {} as never,
        next,
      );
      await vi.waitFor(() => expect(next.mock.calls[0]?.[0]).toMatchObject({ status: 404 }));
    }
  });

  it('returns 404 through next when the resolver targets a deleting site', async () => {
    const site = await createSite('middleware-deleting.example.com');
    await Site.updateOne({ _id: site._id }, { $set: { deletionStartedAt: new Date() } });
    const middleware = createSiteMutationLease(() => String(site._id));
    const next = vi.fn();
    middleware(
      { id: 'delete-race', method: 'PATCH', user: { id: String(accountId) } } as never,
      {} as never,
      next,
    );
    await vi.waitFor(() => {
      expect(next.mock.calls[0]?.[0]).toMatchObject({ status: 404 });
    });
  });

  it('blocks a resource-id request that resolves before deletion but writes after the claim', async () => {
    const site = await createSite('resource-race.example.com');
    let allowResolver!: () => void;
    const resolverGate = new Promise<void>((resolve) => {
      allowResolver = resolve;
    });
    let announceResolved!: () => void;
    const resolved = new Promise<void>((resolve) => {
      announceResolved = resolve;
    });
    const middleware = createSiteMutationLease(async () => {
      const staleResourceRead = await Site.findById(site._id).select({ _id: 1 }).lean();
      announceResolved();
      await resolverGate;
      return staleResourceRead ? String(staleResourceRead._id) : null;
    });
    const next = vi.fn(async (error?: unknown) => {
      if (!error) {
        await Site.updateOne(
          { _id: site._id },
          { $set: { displayName: 'resurrected-after-claim' } },
        );
      }
    });

    middleware(
      { id: 'resource-race', method: 'POST', user: { id: String(accountId) } } as never,
      new EventEmitter() as never,
      next,
    );
    await resolved;
    await expect(claimSiteDeletion({
      accountId: String(accountId),
      siteId: String(site._id),
    })).resolves.toMatchObject({ status: 'claimed' });
    allowResolver();

    await vi.waitFor(() => expect(next.mock.calls[0]?.[0]).toMatchObject({ status: 404 }));
    expect((await Site.findById(site._id).lean())?.displayName).not.toBe(
      'resurrected-after-claim',
    );
  });

  it('can lease resource-scoped reads so claimed sites disappear immediately', async () => {
    const site = await createSite('resource-read.example.com');
    await claimSiteDeletion({
      accountId: String(accountId),
      siteId: String(site._id),
    });
    const middleware = createSiteMutationLease(
      async () => String(site._id),
      { includeSafeMethods: true },
    );
    const next = vi.fn();
    middleware(
      { id: 'resource-read', method: 'GET', user: { id: String(accountId) } } as never,
      {} as never,
      next,
    );
    await vi.waitFor(() => expect(next.mock.calls[0]?.[0]).toMatchObject({ status: 404 }));
  });

  it('leases site-scoped reads so claimed sites disappear immediately', async () => {
    const site = await createSite('site-read.example.com');
    await claimSiteDeletion({
      accountId: String(accountId),
      siteId: String(site._id),
    });
    const next = vi.fn();
    siteMutationLease(
      {
        id: 'site-read',
        method: 'GET',
        path: '/weekly-pulse',
        params: { siteId: String(site._id) },
        user: { id: String(accountId) },
      } as never,
      {} as never,
      next,
    );
    await vi.waitFor(() => expect(next.mock.calls[0]?.[0]).toMatchObject({ status: 404 }));
  });

  it('forwards lease datastore rejections to Express error middleware', async () => {
    const site = await createSite('middleware-db-error.example.com');
    vi.spyOn(Site, 'updateOne').mockRejectedValueOnce(new Error('mongo lease down'));
    const middleware = createSiteMutationLease(() => String(site._id));
    const next = vi.fn();
    middleware(
      { id: 'db-error', method: 'PATCH', user: { id: String(accountId) } } as never,
      {} as never,
      next,
    );
    await vi.waitFor(() => {
      expect(next.mock.calls[0]?.[0]).toMatchObject({ message: 'mongo lease down' });
    });
  });
});
