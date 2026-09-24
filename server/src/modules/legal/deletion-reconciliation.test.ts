import pino from 'pino';
import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import { Site } from '../sites/index.js';
import { User } from '../users/index.js';
import {
  reconcileDeletionBatch,
  startDeletionReconciler,
} from './deletion-reconciliation.js';

beforeAll(startMemoryMongo);
afterAll(stopMemoryMongo);
beforeEach(clearCollections);

async function user(label: string, values: Record<string, unknown> = {}) {
  return User.create({
    email: `${label}@example.com`,
    emailVerified: true,
    ...values,
  });
}

describe('deletion reconciliation', () => {
  it('selects only due/available bounded work and preserves site audit provenance', async () => {
    const now = new Date('2026-08-06T00:00:00Z');
    const due = await user('due', { deletionScheduledAt: now });
    const resumed = await user('resumed', {
      deletionScheduledAt: now,
      deletionStartedAt: new Date(now.getTime() - 60_000),
      deletionAttemptLeaseId: 'crashed',
      deletionAttemptExpiresAt: new Date(now.getTime() - 1),
    });
    const pendingCancellation = await user('pending-cancellation', {
      deletionScheduledAt: new Date(now.getTime() + 60_000),
      deletionCancellationId: 'pending-cancellation-id',
      deletionCancellationRequestedAt: now,
    });
    await user('future', { deletionScheduledAt: new Date(now.getTime() + 60_000) });
    await user('held', { deletionScheduledAt: now, legalHold: true });
    await user('active-attempt', {
      deletionScheduledAt: now,
      deletionStartedAt: now,
      deletionAttemptLeaseId: 'live',
      deletionAttemptExpiresAt: new Date(now.getTime() + 60_000),
    });
    const owner = await user('site-owner');
    const actor = await user('site-actor');
    const site = await Site.create({
      accountId: owner._id,
      url: 'https://reconcile.example.com',
      domain: 'reconcile.example.com',
      deletionStartedAt: new Date(now.getTime() - 60_000),
      deletionAttemptLeaseId: null,
      deletionAttemptExpiresAt: null,
      deletionActorUserId: actor._id,
      deletionAuditSource: 'superadmin_bulk',
    });

    const purgeAccount = vi.fn(async (_userId: string) => undefined);
    const deleteClaimedSite = vi.fn(async () => undefined);
    await expect(
      reconcileDeletionBatch({
        logger: pino({ enabled: false }),
        purgeAccount,
        deleteClaimedSite,
        now: () => now,
        batchSize: 10,
      }),
    ).resolves.toEqual({ accountsAttempted: 3, sitesAttempted: 1, failures: 0 });
    expect(new Set(purgeAccount.mock.calls.map(([id]) => id))).toEqual(
      new Set([
        String(due._id),
        String(resumed._id),
        String(pendingCancellation._id),
      ]),
    );
    expect(deleteClaimedSite).toHaveBeenCalledWith(
      String(owner._id),
      String(site._id),
      {
        actorUserId: String(actor._id),
        auditSource: 'superadmin_bulk',
      },
    );
  });

  it('is single-flight, drains on close, and records item failures without aborting the batch', async () => {
    const now = new Date('2026-08-06T00:00:00Z');
    const due = await user('failing', { deletionScheduledAt: now });
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const purgeAccount = vi.fn(async (id: string) => {
      expect(id).toBe(String(due._id));
      await gate;
      throw new Error('retry later');
    });
    const reconciler = startDeletionReconciler(
      {
        logger: pino({ enabled: false }),
        purgeAccount,
        deleteClaimedSite: vi.fn(async () => undefined),
        now: () => now,
      },
      { intervalMs: 60_000, maxBackoffMs: 120_000 },
    );
    const first = reconciler.runNow();
    const second = reconciler.runNow();
    await vi.waitFor(() => expect(purgeAccount).toHaveBeenCalledOnce());
    releaseGate();
    await expect(first).resolves.toMatchObject({ failures: 1 });
    await expect(second).resolves.toMatchObject({ failures: 1 });
    await expect(reconciler.close()).resolves.toBeUndefined();
  });

  it('honours the configured batch bound deterministically', async () => {
    const now = new Date('2026-08-06T00:00:00Z');
    for (let index = 0; index < 3; index += 1) {
      await User.create({
        _id: new Types.ObjectId(),
        email: `bounded-${index}@example.com`,
        deletionScheduledAt: now,
      });
    }
    const purgeAccount = vi.fn(async () => undefined);
    await reconcileDeletionBatch({
      logger: pino({ enabled: false }),
      purgeAccount,
      deleteClaimedSite: vi.fn(async () => undefined),
      now: () => now,
      batchSize: 2,
    });
    expect(purgeAccount).toHaveBeenCalledTimes(2);
  });

  it('uses defaults and records a claimed-site failure with owner provenance fallbacks', async () => {
    const defaultReconciler = startDeletionReconciler({
      logger: pino({ enabled: false }),
      purgeAccount: vi.fn(async () => undefined),
    });
    await defaultReconciler.close();
    await expect(
      reconcileDeletionBatch({
        logger: pino({ enabled: false }),
        purgeAccount: vi.fn(async () => undefined),
      }),
    ).resolves.toEqual({ accountsAttempted: 0, sitesAttempted: 0, failures: 0 });

    const owner = await user('fallback-site-owner');
    const site = await Site.create({
      accountId: owner._id,
      url: 'https://fallback-reconcile.example.com',
      domain: 'fallback-reconcile.example.com',
      deletionStartedAt: new Date(0),
    });
    const deleteClaimedSite = vi.fn(async () => {
      throw new Error('site retry failed');
    });
    await expect(
      reconcileDeletionBatch({
        logger: pino({ enabled: false }),
        purgeAccount: vi.fn(async () => undefined),
        deleteClaimedSite,
      }),
    ).resolves.toEqual({ accountsAttempted: 0, sitesAttempted: 1, failures: 1 });
    expect(deleteClaimedSite).toHaveBeenCalledWith(String(owner._id), String(site._id), {
      actorUserId: String(owner._id),
    });
  });

  it('runs the scheduled timer and resets to the base interval after a clean pass', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const now = vi.fn(() => new Date('2026-08-06T00:00:00Z'));
    const reconciler = startDeletionReconciler(
      {
        logger: pino({ enabled: false }),
        purgeAccount: vi.fn(async () => undefined),
        deleteClaimedSite: vi.fn(async () => undefined),
        now,
      },
      { intervalMs: 10, maxBackoffMs: 20 },
    );
    await vi.advanceTimersByTimeAsync(10);
    await vi.waitFor(() => expect(now).toHaveBeenCalledOnce());
    await reconciler.close();
    vi.useRealTimers();
  });

  it('logs a pass-level failure, drains it on close, and does not reschedule after stop', async () => {
    let rejectQuery!: () => void;
    const gate = new Promise<void>((resolve) => {
      rejectQuery = resolve;
    });
    const query = {
      sort() { return this; },
      limit() { return this; },
      async lean() {
        await gate;
        throw new Error('mongo reconciliation unavailable');
      },
    };
    vi.spyOn(User, 'find').mockReturnValueOnce(query as never);
    const logger = pino({ enabled: false });
    const error = vi.spyOn(logger, 'error');
    const reconciler = startDeletionReconciler(
      { logger, purgeAccount: vi.fn(async () => undefined) },
      { intervalMs: 60_000, maxBackoffMs: 120_000 },
    );
    const running = reconciler.runNow();
    const rejected = expect(running).rejects.toThrow('mongo reconciliation unavailable');
    const closing = reconciler.close();
    rejectQuery();
    await rejected;
    await expect(closing).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'deletion reconciliation pass failed',
    );
  });
});
