import { randomUUID } from 'node:crypto';
import type { Queue } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLIENT_REPORT_RUN_PAYLOAD_MAX_BYTES,
  scheduledReportDeliveries,
  scheduledReportRuns,
  scheduledReports,
  type ScheduledReportRow,
} from '../../db/schema/index.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import { clientReportEmailRequestFingerprint } from '../communication/index.js';
import {
  CLIENT_REPORT_DELIVERY_MAX_ATTEMPTS,
  CLIENT_REPORT_IDEMPOTENCY_RETRY_WINDOW_MS,
  claimClientReportRunDeliveries,
  clientReportDeliveryIdempotencyKey,
  deliveryOutboxTestables,
  freezeClientReportRun,
  purgeClientReportRunIfTerminal,
  parseFrozenClientReportPayload,
  reconcileClientReportDeliveries,
  settleClientReportDelivery,
  type ClientReportDeliveryClaim,
} from './delivery-outbox.service.js';

const NOW = new Date('2026-08-06T12:00:00.000Z');
const PAYLOAD = {
  version: 'rankmefast.client-report-email.v2' as const,
  locale: 'en' as const,
  senderIdentity: 'reports@example.test',
  subject: 'Frozen report',
  text: 'Frozen report body',
  html: '<p>Frozen report body</p>',
  attachment: {
    filename: 'client-report.pdf' as const,
    contentBase64: 'JVBERg==',
    contentType: 'application/pdf' as const,
  },
};

beforeAll(startTestPostgres);
afterAll(stopTestPostgres);
beforeEach(truncateAllTables);
const serviceDb = () => getTestDb() as never;

async function seedSchedule(recipients = ['client@example.test']): Promise<ScheduledReportRow> {
  const [schedule] = await getTestDb().insert(scheduledReports).values({
    id: randomUUID(),
    accountId: 'client-report-account',
    siteId: 'client-report-site',
    name: 'Durable report',
    frequency: 'weekly',
    weekdayUtc: 4,
    monthdayUtc: null,
    hourUtc: 12,
    minuteUtc: 0,
    locale: 'en',
    recipients,
    sections: { audit: true, ranks: true, gsc: false },
    enabled: true,
    nextRunAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  }).returning();
  return schedule!;
}

function prepared(email = 'client@example.test', runKey = 'run-1') {
  return {
    payload: PAYLOAD,
    recipients: [{
      email,
      idempotencyKey: clientReportDeliveryIdempotencyKey('placeholder', runKey, email),
    }],
    suppressed: [],
  };
}

describe('client report delivery outbox', () => {
  it('bounds frozen payloads, deduplicates runs, and rejects incomplete preparation', async () => {
    const noClaims: ClientReportDeliveryClaim[] = [];
    deliveryOutboxTestables.appendReturnedClaim(undefined, noClaims);
    expect(noClaims).toEqual([]);
    expect(() => parseFrozenClientReportPayload({
      ...PAYLOAD,
      attachment: {
        ...PAYLOAD.attachment,
        contentBase64: 'A'.repeat(CLIENT_REPORT_RUN_PAYLOAD_MAX_BYTES),
      },
    })).toThrow('client report frozen payload exceeds the durable outbox ceiling');
    const { locale: _locale, ...legacyPayload } = PAYLOAD;
    expect(_locale).toBe('en');
    const parsedLegacy = parseFrozenClientReportPayload({
      ...legacyPayload,
      version: 'rankmefast.client-report-email.v1',
      html: '<html lang="ar" dir="rtl"><body>Frozen report body</body></html>',
    });
    expect(parsedLegacy).toMatchObject({ version: 'rankmefast.client-report-email.v1' });
    expect(clientReportEmailRequestFingerprint(parsedLegacy, {
      email: 'legacy@example.test',
      idempotencyKey: 'client-report/legacy',
    })).toMatch(/^request-hmac-v1:[a-f0-9]{64}$/u);
    expect(() => parseFrozenClientReportPayload({
      ...legacyPayload,
      version: 'rankmefast.client-report-email.v1',
      html: '<p>ambiguous legacy report</p>',
    })).toThrow('legacy client report payload has no unambiguous stored locale');

    const schedule = await seedSchedule();
    const runKey = 'run-freeze-contract';
    const first = await freezeClientReportRun(serviceDb(), {
      schedule,
      runKey,
      scheduledFor: NOW,
      snapshotDate: NOW,
      prepared: {
        ...prepared(schedule.recipients[0]!, runKey),
        recipients: [{
          email: schedule.recipients[0]!,
          idempotencyKey: clientReportDeliveryIdempotencyKey(
            schedule.id,
            runKey,
            schedule.recipients[0]!,
          ),
        }],
      },
      now: NOW,
    });
    expect(first).toMatchObject({ created: true });
    await expect(freezeClientReportRun(serviceDb(), {
      schedule,
      runKey,
      scheduledFor: NOW,
      snapshotDate: NOW,
      prepared: prepared(schedule.recipients[0]!, runKey),
      now: NOW,
    })).resolves.toEqual({ created: false, claims: [] });
    await expect(claimClientReportRunDeliveries(serviceDb(), {
      scheduleId: schedule.id,
      runKey,
      payload: PAYLOAD,
      now: new Date(NOW.getTime() + 1_000),
    })).resolves.toEqual([]);

    await expect(freezeClientReportRun(serviceDb(), {
      schedule: { ...schedule, recipients: ['unprepared@example.test'] },
      runKey: 'run-incomplete-preparation',
      scheduledFor: NOW,
      snapshotDate: NOW,
      prepared: { payload: PAYLOAD, recipients: [], suppressed: [] },
      now: NOW,
    })).rejects.toThrow('client report recipient preparation is incomplete');
  });

  it('terminalizes malformed, expired, and exhausted claims without replay', async () => {
    const recipients = [
      'missing-fingerprint@example.test',
      'malformed-fingerprint@example.test',
      'mismatched-fingerprint@example.test',
      'expired-ambiguous@example.test',
      'expired-known@example.test',
      'missing-first-attempt@example.test',
      'exhausted@example.test',
    ];
    const schedule = await seedSchedule(recipients);
    const runKey = 'run-claim-integrity';
    const old = new Date(NOW.getTime() - CLIENT_REPORT_IDEMPOTENCY_RETRY_WINDOW_MS - 1);
    const validFingerprint = (recipient: string) => clientReportEmailRequestFingerprint(PAYLOAD, {
      email: recipient,
      idempotencyKey: clientReportDeliveryIdempotencyKey(schedule.id, runKey, recipient),
    });
    await getTestDb().insert(scheduledReportDeliveries).values(
      recipients.map((recipient, index) => ({
        scheduleId: schedule.id,
        accountId: schedule.accountId,
        siteId: schedule.siteId,
        runKey,
        recipient,
        status: 'failed' as const,
        attempt: index === 6 ? CLIENT_REPORT_DELIVERY_MAX_ATTEMPTS : 1,
        claimToken: null,
        requestFingerprint:
          index === 0
            ? null
            : index === 1
              ? 'malformed'
              : index === 2
                ? `request-hmac-v1:${'0'.repeat(64)}`
                : validFingerprint(recipient),
        firstAttemptAt: index === 5 ? null : index === 3 || index === 4 ? old : NOW,
        suppressionReason: null,
        errorCode: index === 3 ? 'provider_outcome_unknown' as const : 'transport_exception' as const,
        providerMessageId: null,
        snapshotDate: NOW,
        createdAt: NOW,
        updatedAt: NOW,
        finishedAt: NOW,
      })),
    );

    await expect(claimClientReportRunDeliveries(serviceDb(), {
      scheduleId: schedule.id,
      runKey,
      payload: PAYLOAD,
      now: new Date(NOW.getTime() + 1_000),
    })).resolves.toEqual([]);

    const rows = await getTestDb().select().from(scheduledReportDeliveries);
    const byRecipient = new Map(rows.map((row) => [row.recipient, row]));
    for (const recipient of recipients.slice(0, 3)) {
      expect(byRecipient.get(recipient)).toMatchObject({
        attempt: CLIENT_REPORT_DELIVERY_MAX_ATTEMPTS,
        errorCode: 'provider_outcome_unknown_payload_drift',
      });
    }
    expect(byRecipient.get(recipients[3]!)).toMatchObject({
      errorCode: 'provider_outcome_unknown_idempotency_window_expired',
    });
    for (const recipient of recipients.slice(4, 6)) {
      expect(byRecipient.get(recipient)).toMatchObject({ errorCode: 'idempotency_window_expired' });
    }
    expect(byRecipient.get(recipients[6]!)).toMatchObject({
      attempt: CLIENT_REPORT_DELIVERY_MAX_ATTEMPTS,
      errorCode: 'transport_exception',
    });
  });

  it('rotates a stale same-attempt claim and rejects settlement by the old worker', async () => {
    const schedule = await seedSchedule();
    const runKey = 'run-stale-claim';
    const recipient = 'client@example.test';
    const frozen = await freezeClientReportRun(serviceDb(), {
      schedule,
      runKey,
      scheduledFor: NOW,
      snapshotDate: NOW,
      prepared: {
        ...prepared(recipient, runKey),
        recipients: [{
          email: recipient,
          idempotencyKey: clientReportDeliveryIdempotencyKey(
            schedule.id,
            runKey,
            recipient,
          ),
        }],
      },
      now: NOW,
    });
    const original = frozen.claims[0]!;
    const reclaimed = await claimClientReportRunDeliveries(serviceDb(), {
      scheduleId: schedule.id,
      runKey,
      payload: PAYLOAD,
      now: new Date(NOW.getTime() + 31_000),
    });
    expect(reclaimed).toHaveLength(1);
    expect(reclaimed[0]).toMatchObject({ attempt: 1 });
    expect(reclaimed[0]!.claimToken).not.toBe(original.claimToken);

    await expect(settleClientReportDelivery(serviceDb(), original, {
      status: 'sent',
      errorCode: null,
      providerMessageId: 'stale-worker',
    }, new Date(NOW.getTime() + 32_000))).resolves.toBeNull();
    await expect(settleClientReportDelivery(serviceDb(), reclaimed[0]!, {
      status: 'failed',
      errorCode: 'provider_outcome_unknown',
      providerMessageId: null,
    }, new Date(NOW.getTime() + 32_000))).resolves.toMatchObject({
      status: 'failed',
      attempt: 1,
      errorCode: 'provider_outcome_unknown',
    });
  });

  it.each([
    ['known rejection', 'transport_reported_failure', 'retries_exhausted'],
    ['ambiguous outcome', 'provider_outcome_unknown', 'provider_outcome_unknown'],
  ] as const)('closes a %s honestly at attempt three', async (
    _label,
    attemptError,
    terminalError,
  ) => {
    const schedule = await seedSchedule();
    const runKey = `run-${attemptError}`;
    const recipient = 'client@example.test';
    const frozen = await freezeClientReportRun(serviceDb(), {
      schedule,
      runKey,
      scheduledFor: NOW,
      snapshotDate: NOW,
      prepared: {
        payload: PAYLOAD,
        recipients: [{
          email: recipient,
          idempotencyKey: clientReportDeliveryIdempotencyKey(
            schedule.id,
            runKey,
            recipient,
          ),
        }],
        suppressed: [],
      },
      now: NOW,
    });
    let claim = frozen.claims[0]!;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const settled = await settleClientReportDelivery(serviceDb(), claim, {
        status: 'failed',
        errorCode: attemptError,
        providerMessageId: null,
      }, new Date(NOW.getTime() + attempt * 1_000));
      expect(settled).not.toBeNull();
      if (attempt < 3) {
        const next = await claimClientReportRunDeliveries(serviceDb(), {
          scheduleId: schedule.id,
          runKey,
          payload: PAYLOAD,
          now: new Date(NOW.getTime() + attempt * 1_000 + 1),
        });
        expect(next).toHaveLength(1);
        claim = next[0]!;
      }
    }
    const row = await getTestDb().query.scheduledReportDeliveries.findFirst({
      where: and(
        eq(scheduledReportDeliveries.scheduleId, schedule.id),
        eq(scheduledReportDeliveries.runKey, runKey),
      ),
    });
    expect(row).toMatchObject({
      status: 'failed',
      attempt: 3,
      errorCode: terminalError,
    });
    await expect(purgeClientReportRunIfTerminal(
      serviceDb(),
      schedule.id,
      runKey,
    )).resolves.toBe(true);
  });

  it('closes a stale in-flight request as provider-outcome-unknown when the key window expires', async () => {
    const schedule = await seedSchedule();
    const runKey = 'run-window-expired';
    const recipient = 'client@example.test';
    await freezeClientReportRun(serviceDb(), {
      schedule,
      runKey,
      scheduledFor: NOW,
      snapshotDate: NOW,
      prepared: {
        payload: PAYLOAD,
        recipients: [{
          email: recipient,
          idempotencyKey: clientReportDeliveryIdempotencyKey(
            schedule.id,
            runKey,
            recipient,
          ),
        }],
        suppressed: [],
      },
      now: NOW,
    });
    const claims = await claimClientReportRunDeliveries(serviceDb(), {
      scheduleId: schedule.id,
      runKey,
      payload: PAYLOAD,
      now: new Date(NOW.getTime() + 23 * 60 * 60 * 1_000 + 1),
    });
    expect(claims).toEqual([]);
    const row = await getTestDb().query.scheduledReportDeliveries.findFirst({
      where: and(
        eq(scheduledReportDeliveries.scheduleId, schedule.id),
        eq(scheduledReportDeliveries.runKey, runKey),
      ),
    });
    expect(row).toMatchObject({
      status: 'failed',
      attempt: 3,
      errorCode: 'provider_outcome_unknown_idempotency_window_expired',
      claimToken: null,
    });
    await expect(purgeClientReportRunIfTerminal(
      serviceDb(),
      schedule.id,
      runKey,
    )).resolves.toBe(true);
  });

  it('rotates the first 100 active run rows so the 101st is recovered on the next sweep', async () => {
    const schedule = await seedSchedule();
    const recipient = 'client@example.test';
    const base = new Date(NOW.getTime() - 60_000);
    const runRows = Array.from({ length: 101 }, (_, index) => ({
      id: randomUUID(),
      scheduleId: schedule.id,
      accountId: schedule.accountId,
      siteId: schedule.siteId,
      runKey: `rotation-${index}`,
      scheduledFor: base,
      snapshotDate: base,
      payload: PAYLOAD,
      createdAt: new Date(base.getTime() + index),
      updatedAt: new Date(base.getTime() + index),
    }));
    await getTestDb().insert(scheduledReportRuns).values(runRows);
    await getTestDb().insert(scheduledReportDeliveries).values(runRows.map((run) => {
      const idempotencyKey = clientReportDeliveryIdempotencyKey(
        schedule.id,
        run.runKey,
        recipient,
      );
      return {
        scheduleId: schedule.id,
        accountId: schedule.accountId,
        siteId: schedule.siteId,
        runKey: run.runKey,
        recipient,
        status: 'failed' as const,
        attempt: 1,
        claimToken: null,
        requestFingerprint: clientReportEmailRequestFingerprint(PAYLOAD, {
          email: recipient,
          idempotencyKey,
        }),
        firstAttemptAt: base,
        suppressionReason: null,
        errorCode: 'provider_outcome_unknown' as const,
        providerMessageId: null,
        snapshotDate: base,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        finishedAt: run.updatedAt,
      };
    }));
    const add = vi.fn(async (_name: string, _data: unknown, _options?: unknown) => ({}));
    const queue = { add } as unknown as Queue;

    await expect(reconcileClientReportDeliveries(serviceDb(), queue, {
      now: () => NOW,
    })).resolves.toMatchObject({ examined: 100, enqueued: 100 });
    expect(add.mock.calls.some((call) =>
      (call[1] as { runKey: string }).runKey === 'rotation-100'
    )).toBe(false);
    await reconcileClientReportDeliveries(serviceDb(), queue, { now: () => NOW });
    expect(add.mock.calls.some((call) =>
      (call[1] as { runKey: string }).runKey === 'rotation-100'
    )).toBe(true);
  });

  it('purges invalid and terminal frozen runs while classifying every expiry path', async () => {
    const recipients = [
      'invalid-payload@example.test',
      'missing-fingerprint@example.test',
      'mismatched-fingerprint@example.test',
      'expired-ambiguous@example.test',
      'expired-known@example.test',
    ];
    const schedule = await seedSchedule(recipients);
    const invalidRunKey = 'reconcile-invalid-payload';
    const validRunKey = 'reconcile-valid-payload';
    await getTestDb().insert(scheduledReportRuns).values([
      {
        scheduleId: schedule.id,
        accountId: schedule.accountId,
        siteId: schedule.siteId,
        runKey: invalidRunKey,
        scheduledFor: NOW,
        snapshotDate: NOW,
        payload: {} as never,
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        scheduleId: schedule.id,
        accountId: schedule.accountId,
        siteId: schedule.siteId,
        runKey: validRunKey,
        scheduledFor: NOW,
        snapshotDate: NOW,
        payload: PAYLOAD,
        createdAt: new Date(NOW.getTime() + 1),
        updatedAt: new Date(NOW.getTime() + 1),
      },
    ]);
    const old = new Date(NOW.getTime() - CLIENT_REPORT_IDEMPOTENCY_RETRY_WINDOW_MS - 1);
    const validFingerprint = (recipient: string) => clientReportEmailRequestFingerprint(PAYLOAD, {
      email: recipient,
      idempotencyKey: clientReportDeliveryIdempotencyKey(schedule.id, validRunKey, recipient),
    });
    await getTestDb().insert(scheduledReportDeliveries).values(
      recipients.map((recipient, index) => ({
        scheduleId: schedule.id,
        accountId: schedule.accountId,
        siteId: schedule.siteId,
        runKey: index === 0 ? invalidRunKey : validRunKey,
        recipient,
        status: 'failed' as const,
        attempt: 1,
        claimToken: null,
        requestFingerprint:
          index === 0 || index === 1
            ? null
            : index === 2
              ? `request-hmac-v1:${'f'.repeat(64)}`
              : validFingerprint(recipient),
        firstAttemptAt: index >= 3 ? old : NOW,
        suppressionReason: null,
        errorCode: index === 3 ? 'provider_outcome_unknown' as const : 'transport_exception' as const,
        providerMessageId: null,
        snapshotDate: NOW,
        createdAt: NOW,
        updatedAt: NOW,
        finishedAt: NOW,
      })),
    );
    const warn = vi.fn();
    const add = vi.fn(async () => ({}));
    const queue = { add } as unknown as Queue;

    await expect(reconcileClientReportDeliveries(serviceDb(), queue, {
      now: () => NOW,
      logger: { warn } as never,
    })).resolves.toEqual({ examined: 2, expired: 2, enqueued: 0, purged: 2 });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ errorName: 'ZodError' }),
      'client report reconciliation purged an invalid frozen payload',
    );
    expect(add).not.toHaveBeenCalled();
    expect(await getTestDb().select().from(scheduledReportRuns)).toEqual([]);
    expect(deliveryOutboxTestables.reconciliationErrorName('opaque')).toBe('NonError');
    await expect(reconcileClientReportDeliveries(serviceDb(), queue)).resolves.toEqual({
      examined: 0,
      expired: 0,
      enqueued: 0,
      purged: 0,
    });
  });
});
