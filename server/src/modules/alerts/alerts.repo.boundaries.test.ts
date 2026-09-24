import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ALERT_MAX_ATTEMPTS,
  alertDeliveries,
  alertRules,
  type AlertDeliveryRow,
  type NewAlertDeliveryRow,
} from '../../db/schema/index.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import {
  assertFrozenDeliveryPlanComplete,
  bindDeliveryRequestFingerprint,
  claimDelivery,
  claimFrozenAlertDeliveries,
  expireAlertDeliveryClaims,
  freezeAlertDeliveryPlan,
  markAlertDeliveriesReconciled,
  terminalizeInvalidAlertDeliveries,
} from './alerts.repo.js';
import { newRuleId } from './alerts.secrets.js';

const ACCOUNT = 'repo-account';
const SITE = 'repo-site';
const NOW = new Date('2026-08-06T12:00:00.000Z');
const EVIDENCE = {
  kind: 'rank_drop' as const,
  keyword: 'repo boundary',
  threshold: 10,
  before: { at: '2026-08-04T00:00:00.000Z', position: 3 },
  after: { at: '2026-08-05T00:00:00.000Z', position: 30 },
};

const db = () => getTestDb() as never;

beforeAll(startTestPostgres);
afterAll(stopTestPostgres);
beforeEach(truncateAllTables);

function requestPayload() {
  return {
    version: 'rankmefast.alert-email.v1' as const,
    senderIdentity: null,
    to: 'recipient@example.test',
    subject: 'Frozen alert',
    text: 'Frozen body',
    locale: 'en' as const,
  };
}

function delivery(
  ruleId: string,
  transitionId: string,
  overrides: Partial<NewAlertDeliveryRow> = {},
): NewAlertDeliveryRow {
  return {
    id: randomUUID(),
    accountId: ACCOUNT,
    siteId: SITE,
    ruleId,
    channel: 'email',
    recipientRef: 'recipient-user',
    idempotencyKey: `alert:${ruleId}:${transitionId}:email:recipient-user`,
    transitionId,
    transitionKind: 'rank_drop',
    status: 'pending',
    attempt: 1,
    claimToken: randomUUID(),
    requestFingerprint: null,
    firstAttemptAt: null,
    requestPayload: requestPayload(),
    errorCode: null,
    providerMessageId: null,
    suppressedReason: null,
    evidence: EVIDENCE,
    createdAt: NOW,
    updatedAt: NOW,
    reconciledAt: null,
    ...overrides,
  };
}

async function seedRule(ruleId = newRuleId()): Promise<string> {
  await getTestDb().insert(alertRules).values({
    id: ruleId,
    accountId: ACCOUNT,
    siteId: SITE,
    type: 'rank_drop',
    threshold: 10,
    enabled: true,
    emailRecipientIds: ['recipient-user'],
    slackWebhook: null,
    slackHostMasked: null,
    webhookUrl: null,
    webhookSecret: null,
    webhookSecretLast4: null,
    createdAt: NOW,
    updatedAt: NOW,
  });
  return ruleId;
}

describe('alert delivery repository defensive boundaries', () => {
  it('handles empty, stale, existing, and incomplete frozen plans', async () => {
    const missingRuleId = newRuleId();
    await expect(
      freezeAlertDeliveryPlan(db(), {
        accountId: ACCOUNT,
        ruleId: missingRuleId,
        transitionId: 'empty',
        expectedRuleUpdatedAt: NOW,
        rows: [],
      }),
    ).resolves.toEqual({ state: 'created', rows: [] });

    await expect(
      freezeAlertDeliveryPlan(db(), {
        accountId: ACCOUNT,
        ruleId: missingRuleId,
        transitionId: 'stale',
        expectedRuleUpdatedAt: NOW,
        rows: [delivery(missingRuleId, 'stale')],
      }),
    ).resolves.toEqual({ state: 'stale_rule', rows: [] });

    const ruleId = await seedRule();
    const existing = delivery(ruleId, 'existing');
    await getTestDb().insert(alertDeliveries).values(existing);
    await expect(
      freezeAlertDeliveryPlan(db(), {
        accountId: ACCOUNT,
        ruleId,
        transitionId: 'existing',
        expectedRuleUpdatedAt: NOW,
        rows: [delivery(ruleId, 'existing')],
      }),
    ).resolves.toMatchObject({ state: 'exists', rows: [{ id: existing.id }] });

    expect(() => assertFrozenDeliveryPlanComplete(1, 1)).not.toThrow();
    expect(() => assertFrozenDeliveryPlanComplete(0, 1)).toThrow(
      'alert delivery plan was not frozen atomically',
    );
  });

  it('skips terminal claims and tolerates lost failed and interrupted claim races', async () => {
    const ruleId = newRuleId();
    const retryAfter = new Date(NOW.getTime() - 60_000);
    const staleBefore = new Date(NOW.getTime() - 30_000);
    const rows = [
      delivery(ruleId, 'terminal', {
        status: 'failed',
        errorCode: 'idempotency_window_expired',
      }),
      delivery(ruleId, 'missing-failed', {
        status: 'failed',
        claimToken: null,
        errorCode: 'transport_rejected',
      }),
      delivery(ruleId, 'missing-pending', {
        status: 'pending',
        updatedAt: new Date(staleBefore.getTime() - 1),
      }),
    ] as AlertDeliveryRow[];

    await expect(
      claimFrozenAlertDeliveries(db(), { rows, now: NOW, retryAfter, staleBefore }),
    ).resolves.toEqual([]);
  });

  it('claims a new row, a failed retry, an interrupted retry, and returns null otherwise', async () => {
    const ruleId = await seedRule();
    const bounds = {
      retryAfter: new Date(NOW.getTime() - 60_000),
      staleBefore: new Date(NOW.getTime() - 30_000),
    };

    const fresh = delivery(ruleId, 'fresh');
    await expect(
      claimDelivery(db(), { ...fresh, attempt: 1, claimToken: randomUUID(), updatedAt: NOW }, bounds),
    ).resolves.toMatchObject({ id: fresh.id, attempt: 1 });

    const failed = delivery(ruleId, 'failed', {
      status: 'failed',
      claimToken: null,
      errorCode: 'transport_rejected',
      createdAt: new Date(NOW.getTime() - 1_000),
      updatedAt: new Date(NOW.getTime() - 1_000),
    });
    await getTestDb().insert(alertDeliveries).values(failed);
    await expect(
      claimDelivery(db(), {
        ...delivery(ruleId, 'failed'),
        attempt: 2,
        claimToken: randomUUID(),
        updatedAt: NOW,
      }, bounds),
    ).resolves.toMatchObject({ id: failed.id, status: 'pending', attempt: 2 });

    const interrupted = delivery(ruleId, 'interrupted', {
      updatedAt: new Date(bounds.staleBefore.getTime() - 1),
    });
    await getTestDb().insert(alertDeliveries).values(interrupted);
    await expect(
      claimDelivery(db(), {
        ...delivery(ruleId, 'interrupted'),
        attempt: 1,
        claimToken: randomUUID(),
        updatedAt: NOW,
      }, bounds),
    ).resolves.toMatchObject({ id: interrupted.id, status: 'pending' });

    const sent = delivery(ruleId, 'sent', {
      status: 'sent',
      claimToken: null,
      requestPayload: null,
    });
    await getTestDb().insert(alertDeliveries).values(sent);
    await expect(
      claimDelivery(db(), {
        ...delivery(ruleId, 'sent'),
        attempt: 2,
        claimToken: randomUUID(),
        updatedAt: NOW,
      }, bounds),
    ).resolves.toBeNull();
  });

  it('returns null for a lost fingerprint bind and accepts empty maintenance batches', async () => {
    await expect(
      bindDeliveryRequestFingerprint(db(), {
        id: randomUUID(),
        attempt: 1,
        claimToken: randomUUID(),
        fingerprint: `request-hmac-v1:${'a'.repeat(64)}`,
        now: NOW,
      }),
    ).resolves.toBeNull();
    await expect(markAlertDeliveriesReconciled(db(), [], NOW)).resolves.toBeUndefined();
    await expect(terminalizeInvalidAlertDeliveries(db(), [], NOW)).resolves.toBeUndefined();
  });

  it('continues past an empty ambiguity group during expiry', async () => {
    const ruleId = await seedRule();
    const expired = delivery(ruleId, 'known-expiry', {
      status: 'failed',
      claimToken: null,
      requestFingerprint: null,
      errorCode: 'transport_rejected',
      firstAttemptAt: new Date(NOW.getTime() - 120_000),
      createdAt: new Date(NOW.getTime() - 120_000),
      updatedAt: new Date(NOW.getTime() - 120_000),
    });
    await getTestDb().insert(alertDeliveries).values(expired);

    await expect(
      expireAlertDeliveryClaims(db(), {
        retryAfter: new Date(NOW.getTime() - 60_000),
        now: NOW,
        limit: 10,
      }),
    ).resolves.toMatchObject([{ id: expired.id, errorCode: 'idempotency_window_expired' }]);
  });

  it('recognizes the retry ceiling constant used by repository transitions', () => {
    expect(ALERT_MAX_ATTEMPTS).toBeGreaterThan(1);
  });
});
