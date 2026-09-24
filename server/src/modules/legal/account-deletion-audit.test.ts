import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import { User } from '../users/index.js';
import { completePendingAccountCancellation } from './account-deletion-audit.js';

beforeAll(startMemoryMongo);
afterAll(stopMemoryMongo);
beforeEach(clearCollections);

describe('account deletion audit handoff invariants', () => {
  it('is a no-op when no cancellation marker exists', async () => {
    const user = await User.create({ email: 'audit-no-cancel@example.com' });
    await expect(completePendingAccountCancellation(String(user._id))).resolves.toBe(false);
  });

  it('fails closed when a corrupted marker overlaps an irreversible claim', async () => {
    const now = new Date('2026-08-06T00:00:00Z');
    const user = await User.create({
      email: 'audit-started-cancel@example.com',
      deletionScheduledAt: now,
      deletionStartedAt: now,
      deletionCancellationId: 'started-cancel',
      deletionCancellationRequestedAt: now,
    });
    await expect(completePendingAccountCancellation(String(user._id))).rejects.toThrow(
      'account cancellation raced an irreversible deletion claim',
    );
  });

  it('fails closed when a pending marker has no idempotency identity', async () => {
    const now = new Date('2026-08-06T00:00:00Z');
    const user = await User.create({
      email: 'audit-missing-id@example.com',
      deletionScheduledAt: now,
      deletionCancellationRequestedAt: now,
    });
    await expect(completePendingAccountCancellation(String(user._id))).rejects.toThrow(
      'account cancellation marker is missing its lifecycle id',
    );
  });

  it('does not report success when the exact audited marker cannot finalize', async () => {
    const now = new Date('2026-08-06T00:00:00Z');
    const user = await User.create({
      email: 'audit-finalize-race@example.com',
      deletionScheduledAt: now,
      deletionCancellationId: 'finalize-race',
      deletionCancellationRequestedAt: now,
    });
    const update = vi.spyOn(User, 'updateOne').mockResolvedValueOnce({
      modifiedCount: 0,
    } as never);
    try {
      await expect(completePendingAccountCancellation(String(user._id))).rejects.toThrow(
        'account cancellation audit persisted but finalization did not converge',
      );
    } finally {
      update.mockRestore();
    }
  });
});
