import { randomUUID } from 'node:crypto';
import type { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { alertDeliveries } from '../../db/schema/index.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import {
  latestAlertTransitionRows,
  reconcileAlertDeliveries,
} from './alert-delivery.reconciliation.js';

const NOW = new Date('2026-08-06T12:00:00.000Z');
const RULE_ID = 'b82522d4-58f7-47b3-8129-04a337760901';
const EVIDENCE = {
  kind: 'rank_drop' as const,
  keyword: 'durable alert',
  threshold: 10,
  before: { at: '2026-08-04T00:00:00.000Z', position: 3 },
  after: { at: '2026-08-05T00:00:00.000Z', position: 30 },
};

function frozenEmailRequest(index: number) {
  return {
    version: 'rankmefast.alert-email.v1' as const,
    senderIdentity: 'no-reply@example.test',
    to: `recipient-${index}@example.test`,
    subject: 'Frozen alert',
    text: 'Frozen evidence-only body',
    locale: 'en' as const,
  };
}

beforeAll(startTestPostgres);
afterAll(stopTestPostgres);
beforeEach(truncateAllTables);
const serviceDb = () => getTestDb() as never;

describe('alert delivery reconciliation', () => {
  it('uses the system clock by default when there is no recovery work', async () => {
    await expect(
      reconcileAlertDeliveries(serviceDb(), { add: vi.fn() } as unknown as Queue),
    ).resolves.toEqual({ expired: 0, examined: 0, enqueued: 0 });
  });

  it('keeps only the newest row for each transition regardless of input order', () => {
    const older = { ruleId: RULE_ID, transitionId: 'same', updatedAt: new Date(1), id: 'older' };
    const newer = { ruleId: RULE_ID, transitionId: 'same', updatedAt: new Date(2), id: 'newer' };
    expect(latestAlertTransitionRows([newer, older])).toEqual([newer]);
    expect(latestAlertTransitionRows([older, newer])).toEqual([newer]);
  });

  it.each([
    ['Error', new Error('queue unavailable')],
    ['NonError', 'queue unavailable'],
  ])('logs a %s queue rejection without terminalizing valid evidence', async (errorName, failure) => {
    const id = randomUUID();
    const attemptedAt = new Date(NOW.getTime() - 60_000);
    await getTestDb().insert(alertDeliveries).values({
      id,
      accountId: 'account-queue-failure',
      siteId: 'site-queue-failure',
      ruleId: RULE_ID,
      channel: 'email',
      recipientRef: 'queue-user',
      idempotencyKey: `alert:${RULE_ID}:queue-failure-${errorName}:email:queue-user`,
      transitionId: `queue-failure-${errorName}`,
      transitionKind: 'rank_drop',
      status: 'failed',
      attempt: 1,
      requestFingerprint: `request-hmac-v1:${'e'.repeat(64)}`,
      firstAttemptAt: attemptedAt,
      requestPayload: frozenEmailRequest(4),
      errorCode: 'provider_outcome_unknown',
      evidence: EVIDENCE,
      createdAt: attemptedAt,
      updatedAt: attemptedAt,
    });
    const warn = vi.fn();
    const queue = { add: vi.fn().mockRejectedValue(failure) } as unknown as Queue;

    await expect(
      reconcileAlertDeliveries(serviceDb(), queue, {
        now: () => NOW,
        logger: { warn } as never,
      }),
    ).resolves.toMatchObject({ examined: 1, enqueued: 0 });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryId: id, errorName }),
      'alert delivery reconciliation skipped an invalid durable row',
    );
    expect(await getTestDb().query.alertDeliveries.findFirst({
      where: eq(alertDeliveries.id, id),
    })).toMatchObject({ attempt: 1, requestPayload: frozenEmailRequest(4) });
  });

  it('rotates a bounded page so the 201st recoverable transition is enqueued on the next sweep', async () => {
    const firstAttemptAt = new Date(NOW.getTime() - 60_000);
    await getTestDb().insert(alertDeliveries).values(
      Array.from({ length: 201 }, (_, index) => ({
        id: randomUUID(),
        accountId: 'account-reconcile',
        siteId: 'site-reconcile',
        ruleId: RULE_ID,
        channel: 'email' as const,
        recipientRef: `user-${index}`,
        idempotencyKey: `alert:${RULE_ID}:transition-${index}:email:user-${index}`,
        transitionId: `transition-${index}`,
        transitionKind: 'rank_drop' as const,
        status: 'failed' as const,
        attempt: 1,
        claimToken: null,
        requestFingerprint: `request-hmac-v1:${'a'.repeat(64)}`,
        firstAttemptAt,
        requestPayload: frozenEmailRequest(index),
        errorCode: 'provider_outcome_unknown' as const,
        providerMessageId: null,
        suppressedReason: null,
        evidence: EVIDENCE,
        createdAt: new Date(firstAttemptAt.getTime() + index),
        updatedAt: new Date(firstAttemptAt.getTime() + index),
        reconciledAt: null,
      })),
    );
    const add = vi.fn(async (_name: string, _data: unknown, _options?: unknown) => ({}));
    const queue = { add } as unknown as Queue;

    await expect(reconcileAlertDeliveries(serviceDb(), queue, {
      now: () => NOW,
    })).resolves.toMatchObject({ examined: 200, enqueued: 200 });
    expect(add).toHaveBeenCalledTimes(200);
    expect(add.mock.calls.some((call) =>
      (call[1] as { transitionId: string }).transitionId === 'transition-200'
    )).toBe(false);

    await reconcileAlertDeliveries(serviceDb(), queue, { now: () => NOW });
    expect(add.mock.calls.some((call) =>
      (call[1] as { transitionId: string }).transitionId === 'transition-200'
    )).toBe(true);
    expect(JSON.stringify(add.mock.calls)).not.toContain('@example.test');
  });

  it('distinguishes an expired ambiguous request from a known provider rejection', async () => {
    const expiredAt = new Date(NOW.getTime() - 24 * 60 * 60 * 1_000);
    const ambiguousId = randomUUID();
    const knownId = randomUUID();
    await getTestDb().insert(alertDeliveries).values([
      {
        id: ambiguousId,
        accountId: 'account-expiry',
        siteId: 'site-expiry',
        ruleId: RULE_ID,
        channel: 'email',
        recipientRef: 'ambiguous-user',
        idempotencyKey: `alert:${RULE_ID}:expired-ambiguous:email:ambiguous-user`,
        transitionId: 'expired-ambiguous',
        transitionKind: 'rank_drop',
        status: 'pending',
        attempt: 1,
        claimToken: randomUUID(),
        requestFingerprint: `request-hmac-v1:${'b'.repeat(64)}`,
        firstAttemptAt: expiredAt,
        requestPayload: frozenEmailRequest(1),
        evidence: EVIDENCE,
        createdAt: expiredAt,
        updatedAt: expiredAt,
      },
      {
        id: knownId,
        accountId: 'account-expiry',
        siteId: 'site-expiry',
        ruleId: RULE_ID,
        channel: 'email',
        recipientRef: 'known-user',
        idempotencyKey: `alert:${RULE_ID}:expired-known:email:known-user`,
        transitionId: 'expired-known',
        transitionKind: 'rank_drop',
        status: 'failed',
        attempt: 1,
        claimToken: null,
        requestFingerprint: `request-hmac-v1:${'c'.repeat(64)}`,
        firstAttemptAt: expiredAt,
        requestPayload: frozenEmailRequest(2),
        errorCode: 'transport_rejected',
        evidence: EVIDENCE,
        createdAt: expiredAt,
        updatedAt: expiredAt,
      },
    ]);
    const queue = {
      add: vi.fn(async (_name: string, _data: unknown, _options?: unknown) => ({})),
    } as unknown as Queue;

    await expect(reconcileAlertDeliveries(serviceDb(), queue, {
      now: () => NOW,
    })).resolves.toMatchObject({ expired: 2, examined: 0, enqueued: 0 });
    const ambiguous = await getTestDb().query.alertDeliveries.findFirst({
      where: eq(alertDeliveries.id, ambiguousId),
    });
    const known = await getTestDb().query.alertDeliveries.findFirst({
      where: eq(alertDeliveries.id, knownId),
    });
    expect(ambiguous).toMatchObject({
      status: 'failed',
      attempt: 3,
      errorCode: 'provider_outcome_unknown_idempotency_window_expired',
      claimToken: null,
      requestPayload: null,
    });
    expect(known).toMatchObject({
      status: 'failed',
      attempt: 3,
      errorCode: 'idempotency_window_expired',
      requestPayload: null,
    });
  });

  it('terminalizes and scrubs invalid durable evidence instead of starving the sweep forever', async () => {
    const id = randomUUID();
    const attemptedAt = new Date(NOW.getTime() - 60_000);
    await getTestDb().insert(alertDeliveries).values({
      id,
      accountId: 'account-invalid',
      siteId: 'site-invalid',
      ruleId: RULE_ID,
      channel: 'email',
      recipientRef: 'invalid-user',
      idempotencyKey: `alert:${RULE_ID}:invalid:email:invalid-user`,
      transitionId: 'invalid',
      transitionKind: 'rank_drop',
      status: 'failed',
      attempt: 1,
      requestFingerprint: `request-hmac-v1:${'d'.repeat(64)}`,
      firstAttemptAt: attemptedAt,
      requestPayload: frozenEmailRequest(3),
      errorCode: 'provider_outcome_unknown',
      evidence: {},
      createdAt: attemptedAt,
      updatedAt: attemptedAt,
    });
    const add = vi.fn(async (_name: string, _data: unknown, _options?: unknown) => ({}));

    await expect(reconcileAlertDeliveries(
      serviceDb(),
      { add } as unknown as Queue,
      { now: () => NOW },
    )).resolves.toMatchObject({ examined: 1, enqueued: 0 });
    expect(add).not.toHaveBeenCalled();
    const row = await getTestDb().query.alertDeliveries.findFirst({
      where: eq(alertDeliveries.id, id),
    });
    expect(row).toMatchObject({
      status: 'failed',
      attempt: 3,
      errorCode: 'provider_outcome_unknown_payload_drift',
      requestPayload: null,
    });
  });
});
