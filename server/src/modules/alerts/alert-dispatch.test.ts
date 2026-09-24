/**
 * Dispatch invariants.
 *
 * Proves exactly-once per (rule, transition, channel, recipient), per-leg
 * isolation, the bounded retry → terminal suppression machine, an
 * independently recomputable HMAC signature, and the secret-free versioned
 * payload. Every transport is a deterministic fake — no network, no live DNS.
 */
import { createHmac, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  alertDeliveries,
  alertRules,
  ALERT_MAX_ATTEMPTS,
  type AlertDeliveryRow,
} from '../../db/schema/index.js';
import type { ResolvedAddress } from '../../shared/security/url-safety.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import {
  alertIdempotencyKey,
  alertRequestFingerprint,
  alertDispatchTestables,
  buildWebhookPayload,
  defaultAlertDispatchRepository,
  dispatchAlert,
  renderAlertEmail,
  renderSlackText,
  type AlertEmailMessage,
  type AlertRecipient,
  type AlertDispatchRepository,
  type DispatchAlertDeps,
} from './alert-dispatch.service.js';
import { newRuleId, sealAlertSecret } from './alerts.secrets.js';
import { deleteRule as deleteRuleRow } from './alerts.repo.js';
import type { AlertEvidence } from './alerts.schema.js';

type Db = Parameters<typeof dispatchAlert>[1]['db'];

const db = () => getTestDb() as unknown as Db;

const ACCOUNT = 'acct-1';
const SITE = 'site-1';
const SLACK_URL = 'https://hooks.slack.test/services/T1/B1/secret-token';
const WEBHOOK_URL = 'https://webhooks.example.test/hook';
const NOW = new Date('2026-07-10T12:00:00.000Z');

const RANK_EVIDENCE: AlertEvidence = {
  kind: 'rank_drop',
  keyword: 'seo audit tool',
  threshold: 10,
  before: { at: '2026-07-01T00:00:00.000Z', position: 3 },
  after: { at: '2026-07-02T00:00:00.000Z', position: 24 },
};

const LINK_EVIDENCE: AlertEvidence = {
  kind: 'new_backlink',
  before: { at: '2026-07-01T00:00:00.000Z', reviewId: 'rev-1', rowCount: 4 },
  after: { at: '2026-07-02T00:00:00.000Z', reviewId: 'rev-2', rowCount: 7 },
  changedDomains: ['a.test', 'b.test'],
  changedTotal: 2,
};

function frozenEmailDelivery(
  ruleId: string,
  transitionId: string,
  overrides: Partial<AlertDeliveryRow> = {},
): AlertDeliveryRow {
  return {
    id: randomUUID(),
    accountId: ACCOUNT,
    siteId: SITE,
    ruleId,
    channel: 'email',
    recipientRef: 'u1',
    idempotencyKey: alertIdempotencyKey({
      ruleId,
      transitionId,
      channel: 'email',
      recipientRef: 'u1',
    }),
    transitionId,
    transitionKind: 'rank_drop',
    status: 'pending',
    attempt: 1,
    claimToken: randomUUID(),
    requestFingerprint: null,
    firstAttemptAt: null,
    requestPayload: {
      version: 'rankmefast.alert-email.v1',
      senderIdentity: null,
      to: 'owner@example.test',
      subject: 'Frozen subject',
      text: 'Frozen body',
      locale: 'en',
    },
    errorCode: null,
    providerMessageId: null,
    suppressedReason: null,
    evidence: RANK_EVIDENCE,
    createdAt: NOW,
    updatedAt: NOW,
    reconciledAt: null,
    ...overrides,
  };
}

function dispatchRepository(
  overrides: Partial<AlertDispatchRepository>,
): AlertDispatchRepository {
  return { ...defaultAlertDispatchRepository, ...overrides };
}

interface SeedRuleOptions {
  emailRecipientIds?: string[];
  slack?: boolean;
  webhook?: boolean;
  enabled?: boolean;
}

async function seedRule(options: SeedRuleOptions = {}) {
  const id = newRuleId();
  const secret = 'f'.repeat(64);
  await db()
    .insert(alertRules)
    .values({
      id,
      accountId: ACCOUNT,
      siteId: SITE,
      type: 'rank_drop',
      threshold: 10,
      enabled: options.enabled ?? true,
      emailRecipientIds: options.emailRecipientIds ?? [],
      slackWebhook: options.slack ? sealAlertSecret(SLACK_URL, id, 'slack_webhook') : null,
      slackHostMasked: options.slack ? 'hooks.slack.test/services/…' : null,
      webhookUrl: options.webhook ? WEBHOOK_URL : null,
      webhookSecret: options.webhook ? sealAlertSecret(secret, id, 'webhook_secret') : null,
      webhookSecretLast4: options.webhook ? secret.slice(-4) : null,
      createdAt: NOW,
      updatedAt: NOW,
    });
  return { id, secret };
}

const PUBLIC: ResolvedAddress = { address: '93.184.216.34', family: 4 };

interface FakeTransportCall {
  url: string;
  body: string;
  headers: Headers;
}

function makeDeps(
  overrides: Partial<DispatchAlertDeps> = {},
  transportResult: (call: FakeTransportCall) => Response | Promise<Response> = () =>
    new Response('', { status: 200 }),
): DispatchAlertDeps & { calls: FakeTransportCall[]; emails: AlertEmailMessage[] } {
  const calls: FakeTransportCall[] = [];
  const emails: AlertEmailMessage[] = [];
  const deps: DispatchAlertDeps & {
    calls: FakeTransportCall[];
    emails: AlertEmailMessage[];
  } = {
    db: db(),
    calls,
    emails,
    now: () => NOW,
    transportAvailable: () => true,
    resolveRecipient: async (): Promise<AlertRecipient> => ({
      email: 'owner@example.test',
      locale: 'en',
      membership: 'active',
    }),
    sendEmail: async (message) => {
      emails.push(message);
      return { delivered: true };
    },
    urlSafety: {
      resolver: async () => [PUBLIC],
      transport: async (url, _pinned, init) => {
        const call: FakeTransportCall = {
          url: url.toString(),
          body: String(init.body ?? ''),
          headers: new Headers(init.headers),
        };
        calls.push(call);
        return transportResult(call);
      },
    },
    ...overrides,
  };
  return deps;
}

beforeAll(async () => {
  await startTestPostgres();
});

afterAll(async () => {
  await stopTestPostgres();
});

beforeEach(async () => {
  await truncateAllTables();
});

describe('alertIdempotencyKey', () => {
  it('is derived from evidence identity only — no clock, no counter', () => {
    const a = alertIdempotencyKey({
      ruleId: 'r1',
      transitionId: 'rank:c1',
      channel: 'email',
      recipientRef: 'u1',
    });
    const b = alertIdempotencyKey({
      ruleId: 'r1',
      transitionId: 'rank:c1',
      channel: 'email',
      recipientRef: 'u1',
    });
    expect(a).toBe(b);
    expect(a).toBe('alert:r1:rank:c1:email:u1');
    expect(
      alertIdempotencyKey({
        ruleId: 'r1',
        transitionId: 'rank:c1',
        channel: 'slack',
      }),
    ).toBe('alert:r1:rank:c1:slack:-');
  });

  it('rejects oversized durable requests and channel/payload drift', () => {
    const emailRequest = frozenEmailDelivery('rule-1', 'transition-1').requestPayload!;
    const byteLength = vi.spyOn(Buffer, 'byteLength').mockReturnValueOnce(1_000_000);
    expect(() => alertDispatchTestables.parseAlertRequest(emailRequest)).toThrow(
      'alert request payload exceeds the durable outbox ceiling',
    );
    byteLength.mockRestore();

    expect(() =>
      alertRequestFingerprint({
        ruleId: 'rule-1',
        deliveryId: randomUUID(),
        channel: 'webhook',
        request: emailRequest as never,
      }),
    ).toThrow('alert request channel does not match its frozen payload');
  });

  it('fingerprints a proven legacy Slack request without inventing a locale', () => {
    const ruleId = newRuleId();
    const request = {
      version: 'rankmefast.alert-slack.v1' as const,
      encryptedUrl: sealAlertSecret(SLACK_URL, ruleId, 'slack_webhook'),
      body: '{"text":"Frozen legacy body"}',
    };
    const legacy = alertRequestFingerprint({
      ruleId,
      deliveryId: 'legacy-slack-delivery',
      channel: 'slack',
      request,
    });
    const localized = alertRequestFingerprint({
      ruleId,
      deliveryId: 'localized-slack-delivery',
      channel: 'slack',
      request: { ...request, locale: 'fr' },
    });
    expect(legacy).toMatch(/^request-hmac-v1:[a-f0-9]{64}$/u);
    expect(localized).not.toBe(legacy);
  });
});

describe('dispatchAlert', () => {
  it('asks BullMQ to retry when the rule version changes before its plan freezes', async () => {
    const { id } = await seedRule({ emailRecipientIds: ['u1'] });
    const freezeAlertDeliveryPlan = vi.fn().mockResolvedValue({
      state: 'stale_rule',
      rows: [],
    });
    const outcome = await dispatchAlert(
      {
        accountId: ACCOUNT,
        ruleId: id,
        transitionId: 'rank:stale-rule',
        evidence: RANK_EVIDENCE,
        attempt: 1,
      },
      makeDeps({
        repository: dispatchRepository({ freezeAlertDeliveryPlan }),
      }),
    );

    expect(freezeAlertDeliveryPlan).toHaveBeenCalledOnce();
    expect(outcome).toMatchObject({ shouldThrow: true, sent: 0, skipped: 0 });
  });

  it('claims a plan that another worker froze after the initial read', async () => {
    const { id } = await seedRule({ emailRecipientIds: ['u1'] });
    const existing = frozenEmailDelivery(id, 'rank:freeze-winner', {
      status: 'sent',
      claimToken: null,
      requestPayload: null,
    });
    const claimFrozenAlertDeliveries = vi.fn().mockResolvedValue([]);
    const outcome = await dispatchAlert(
      {
        accountId: ACCOUNT,
        ruleId: id,
        transitionId: 'rank:freeze-winner',
        evidence: RANK_EVIDENCE,
        attempt: 1,
      },
      makeDeps({
        repository: dispatchRepository({
          freezeAlertDeliveryPlan: vi.fn().mockResolvedValue({
            state: 'exists',
            rows: [existing],
          }),
          claimFrozenAlertDeliveries,
        }),
      }),
    );

    expect(claimFrozenAlertDeliveries).toHaveBeenCalledOnce();
    expect(outcome).toMatchObject({ skipped: 1, shouldThrow: false });
  });

  it('handles exhausted, claim-loss, bind-loss, and settle-loss rows independently', async () => {
    const ruleId = newRuleId();
    const exhausted = frozenEmailDelivery(ruleId, 'rank:defensive', {
      id: randomUUID(),
      status: 'failed',
      attempt: ALERT_MAX_ATTEMPTS,
      claimToken: null,
    });
    const missingToken = frozenEmailDelivery(ruleId, 'rank:defensive', {
      id: randomUUID(),
      claimToken: null,
    });
    const bindLost = frozenEmailDelivery(ruleId, 'rank:defensive', { id: randomUUID() });
    const settleLost = frozenEmailDelivery(ruleId, 'rank:defensive', { id: randomUUID() });
    const bindDeliveryRequestFingerprint = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(settleLost);
    const settleDelivery = vi.fn().mockResolvedValue(null);

    const outcome = await dispatchAlert(
      {
        accountId: ACCOUNT,
        ruleId,
        transitionId: 'rank:defensive',
        evidence: RANK_EVIDENCE,
        attempt: 1,
      },
      makeDeps({
        repository: dispatchRepository({
          listTransitionDeliveries: vi.fn().mockResolvedValue([
            exhausted,
            missingToken,
            bindLost,
            settleLost,
          ]),
          claimFrozenAlertDeliveries: vi.fn().mockResolvedValue([
            missingToken,
            bindLost,
            settleLost,
          ]),
          bindDeliveryRequestFingerprint,
          settleDelivery,
        }),
      }),
    );

    expect(outcome).toMatchObject({
      exhausted: 1,
      skipped: 3,
      shouldThrow: true,
    });
    expect(settleDelivery).toHaveBeenCalledOnce();
  });

  it('fails closed and logs when a frozen request fingerprint drifts', async () => {
    const ruleId = newRuleId();
    const row = frozenEmailDelivery(ruleId, 'rank:fingerprint-drift', {
      requestFingerprint: `request-hmac-v1:${'f'.repeat(64)}`,
    });
    const warn = vi.fn();
    const settleDelivery = vi.fn().mockImplementation(async (_db, input) => ({
      ...row,
      ...input,
    }));
    const outcome = await dispatchAlert(
      {
        accountId: ACCOUNT,
        ruleId,
        transitionId: 'rank:fingerprint-drift',
        evidence: RANK_EVIDENCE,
        attempt: 1,
      },
      makeDeps({
        logger: { warn } as never,
        repository: dispatchRepository({
          listTransitionDeliveries: vi.fn().mockResolvedValue([row]),
          claimFrozenAlertDeliveries: vi.fn().mockResolvedValue([row]),
          settleDelivery,
        }),
      }),
    );

    expect(outcome).toMatchObject({ failed: 1, shouldThrow: true });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryId: row.id, channel: 'email', err: 'Error' }),
      'alert frozen request failed closed',
    );
  });

  it('delivers every configured channel exactly once', async () => {
    const { id } = await seedRule({
      emailRecipientIds: ['u1', 'u2'],
      slack: true,
      webhook: true,
    });
    const deps = makeDeps();

    const outcome = await dispatchAlert(
      {
        accountId: ACCOUNT,
        ruleId: id,
        transitionId: 'rank:c1',
        evidence: RANK_EVIDENCE,
        attempt: 1,
      },
      deps,
    );

    expect(outcome).toMatchObject({
      sent: 4,
      failed: 0,
      suppressed: 0,
      skipped: 0,
    });
    expect(deps.emails).toHaveLength(2);
    expect(new Set(deps.emails.map((message) => message.idempotencyKey)).size).toBe(2);
    expect(deps.emails.every((message) => /^alert\/[0-9a-f-]{36}$/u.test(
      message.idempotencyKey,
    ))).toBe(true);
    expect(deps.calls).toHaveLength(2);
    const rows = await db().select().from(alertDeliveries);
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.status === 'sent')).toBe(true);
    expect(rows.every((row) => row.requestPayload === null)).toBe(true);
  });

  it('is replay-safe: a repeated dispatch sends nothing more', async () => {
    const { id } = await seedRule({ emailRecipientIds: ['u1'], webhook: true });
    const deps = makeDeps();
    const input = {
      accountId: ACCOUNT,
      ruleId: id,
      transitionId: 'rank:c1',
      evidence: RANK_EVIDENCE,
      attempt: 1,
    };

    await dispatchAlert(input, deps);
    const replay = await dispatchAlert(input, deps);

    expect(replay).toMatchObject({ sent: 0, skipped: 2 });
    expect(deps.emails).toHaveLength(1);
    expect(deps.calls).toHaveLength(1);
    expect(await db().select().from(alertDeliveries)).toHaveLength(2);
  });

  it('reclaims a crash-stranded pending leg without burning a delivery attempt', async () => {
    const { id } = await seedRule({ emailRecipientIds: ['u1'] });
    const key = alertIdempotencyKey({
      ruleId: id,
      transitionId: 'rank:crash-recovery',
      channel: 'email',
      recipientRef: 'u1',
    });
    const [stranded] = await db().insert(alertDeliveries).values({
      id: randomUUID(),
      accountId: ACCOUNT,
      siteId: SITE,
      ruleId: id,
      channel: 'email',
      recipientRef: 'u1',
      idempotencyKey: key,
      transitionId: 'rank:crash-recovery',
      transitionKind: 'rank_drop',
      status: 'pending',
      attempt: 1,
      claimToken: randomUUID(),
      requestPayload: {
        version: 'rankmefast.alert-email.v1',
        senderIdentity: null,
        to: 'owner@example.test',
        subject: 'Frozen subject',
        text: 'Frozen body',
        locale: 'en',
      },
      evidence: RANK_EVIDENCE,
      createdAt: NOW,
      updatedAt: new Date(NOW.getTime() - 31_000),
    }).returning();
    const deps = makeDeps();

    const recovered = await dispatchAlert({
      accountId: ACCOUNT,
      ruleId: id,
      transitionId: 'rank:crash-recovery',
      evidence: RANK_EVIDENCE,
      attempt: 2,
    }, deps);

    expect(recovered).toMatchObject({ sent: 1, failed: 0, skipped: 0 });
    expect(deps.emails).toHaveLength(1);
    expect(deps.emails[0]!.idempotencyKey).toBe(`alert/${stranded!.id}`);
    const [settled] = await db().select().from(alertDeliveries);
    expect(settled).toMatchObject({
      id: stranded!.id,
      status: 'sent',
      attempt: 1,
      requestPayload: null,
    });
  });

  it('uses the server clock when dispatch wiring does not inject one', async () => {
    const { id } = await seedRule({ webhook: true });
    const deps = makeDeps({ now: undefined });
    const before = Date.now();

    await dispatchAlert(
      {
        accountId: ACCOUNT,
        ruleId: id,
        transitionId: 'rank:server-clock',
        evidence: RANK_EVIDENCE,
        attempt: 1,
      },
      deps,
    );

    const [delivery] = await db().select().from(alertDeliveries);
    expect(delivery!.createdAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(delivery!.createdAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('isolates a failing channel from its siblings', async () => {
    const { id } = await seedRule({
      emailRecipientIds: ['u1'],
      slack: true,
      webhook: true,
    });
    const deps = makeDeps({}, (call) =>
      call.url.startsWith('https://hooks.slack.test')
        ? new Response('', { status: 500 })
        : new Response('', { status: 200 }),
    );

    const outcome = await dispatchAlert(
      {
        accountId: ACCOUNT,
        ruleId: id,
        transitionId: 'rank:c1',
        evidence: RANK_EVIDENCE,
        attempt: 1,
      },
      deps,
    );

    // Email + webhook still land; only Slack fails.
    expect(outcome).toMatchObject({ sent: 2, failed: 1, shouldThrow: true });
    const rows = await db().select().from(alertDeliveries);
    const slack = rows.find((row) => row.channel === 'slack');
    expect(slack).toMatchObject({
      status: 'failed',
      errorCode: 'transport_rejected',
    });
    expect(rows.filter((row) => row.status === 'sent')).toHaveLength(2);
  });

  it('suppresses terminally at the retry ceiling instead of looping', async () => {
    const { id } = await seedRule({ webhook: true });
    const deps = makeDeps({}, () => new Response('', { status: 503 }));
    const input = {
      accountId: ACCOUNT,
      ruleId: id,
      transitionId: 'rank:c1',
      evidence: RANK_EVIDENCE,
    };

    const first = await dispatchAlert({ ...input, attempt: 1 }, deps);
    expect(first).toMatchObject({ failed: 1, shouldThrow: true });
    let [row] = await db().select().from(alertDeliveries);
    expect(row).toMatchObject({
      status: 'failed',
      errorCode: 'transport_rejected',
    });
    const deliveryId = row!.id;

    const second = await dispatchAlert({ ...input, attempt: 2 }, deps);
    expect(second).toMatchObject({ failed: 1, shouldThrow: true });
    const last = await dispatchAlert({ ...input, attempt: ALERT_MAX_ATTEMPTS }, deps);
    expect(last).toMatchObject({
      suppressed: 1,
      exhausted: 1,
      failed: 0,
      shouldThrow: true,
    });
    [row] = await db().select().from(alertDeliveries);
    expect(row).toMatchObject({
      id: deliveryId,
      status: 'suppressed',
      errorCode: 'retries_exhausted',
      suppressedReason: 'retries_exhausted',
      attempt: ALERT_MAX_ATTEMPTS,
    });
    expect(deps.calls).toHaveLength(ALERT_MAX_ATTEMPTS);
  });

  it('renders Slack in the account recipient locale', async () => {
    const { id } = await seedRule({ slack: true });
    const deps = makeDeps({
      resolveRecipient: async () => ({
        email: 'owner@example.test',
        locale: 'fr',
        membership: 'active',
      }),
    });

    await dispatchAlert(
      {
        accountId: ACCOUNT,
        ruleId: id,
        transitionId: 'rank:fr',
        evidence: RANK_EVIDENCE,
        attempt: 1,
      },
      deps,
    );

    expect(JSON.parse(deps.calls[0]!.body)).toEqual({
      text: renderSlackText('fr', RANK_EVIDENCE),
    });
  });

  it.each([
    ['missing owner', async () => null],
    [
      'removed owner',
      async () => ({
        email: 'owner@example.test',
        locale: 'fr',
        membership: 'removed' as const,
      }),
    ],
    [
      'unsupported owner locale',
      async () => ({
        email: 'owner@example.test',
        locale: 'not-a-locale',
        membership: 'active' as const,
      }),
    ],
  ] satisfies Array<[string, DispatchAlertDeps['resolveRecipient']]>) (
    'renders Slack in the default locale for a %s',
    async (_label, resolveRecipient) => {
      const { id } = await seedRule({ slack: true });
      const deps = makeDeps({ resolveRecipient });

      await dispatchAlert(
        {
          accountId: ACCOUNT,
          ruleId: id,
          transitionId: `rank:default:${_label}`,
          evidence: RANK_EVIDENCE,
          attempt: 1,
        },
        deps,
      );

      expect(JSON.parse(deps.calls[0]!.body)).toEqual({
        text: renderSlackText('en', RANK_EVIDENCE),
      });
    },
  );

  it('signs the exact transmitted body with a recomputable HMAC', async () => {
    const { id, secret } = await seedRule({ webhook: true });
    const deps = makeDeps();

    await dispatchAlert(
      {
        accountId: ACCOUNT,
        ruleId: id,
        transitionId: 'rank:c1',
        evidence: RANK_EVIDENCE,
        attempt: 1,
      },
      deps,
    );

    const call = deps.calls[0]!;
    const header = call.headers.get('x-rankmefast-signature')!;
    const [tPart, vPart] = header.split(',');
    const timestamp = tPart!.slice('t='.length);
    const mac = vPart!.slice('v1='.length);
    const expected = createHmac('sha256', secret).update(`${timestamp}.${call.body}`).digest('hex');
    expect(mac).toBe(expected);
    expect(Number(timestamp)).toBe(Math.floor(NOW.getTime() / 1000));
    expect(call.headers.get('x-rankmefast-delivery')).toBeTruthy();
  });

  it('sends a secret-free, schema-versioned payload', async () => {
    const { id, secret } = await seedRule({ webhook: true, slack: true });
    const deps = makeDeps();

    await dispatchAlert(
      {
        accountId: ACCOUNT,
        ruleId: id,
        transitionId: 'rank:c1',
        evidence: RANK_EVIDENCE,
        attempt: 1,
      },
      deps,
    );

    const webhookCall = deps.calls.find((call) => call.url.startsWith(WEBHOOK_URL))!;
    const parsed = JSON.parse(webhookCall.body);
    expect(parsed.version).toBe('rankmefast.alert.v1');
    expect(parsed.evidence).toMatchObject({
      before: { at: '2026-07-01T00:00:00.000Z', position: 3 },
      after: { at: '2026-07-02T00:00:00.000Z', position: 24 },
    });
    for (const forbidden of [secret, SLACK_URL, 'secret-token', ACCOUNT]) {
      expect(webhookCall.body).not.toContain(forbidden);
    }
  });

  it('suppresses an opted-out recipient without failing the job', async () => {
    const { id } = await seedRule({ emailRecipientIds: ['u1'] });
    const sendEmail = vi.fn(async () => ({ delivered: true }));
    const deps = makeDeps({
      isEmailEligible: async () => false,
      sendEmail,
    });

    const outcome = await dispatchAlert(
      {
        accountId: ACCOUNT,
        ruleId: id,
        transitionId: 'rank:c1',
        evidence: RANK_EVIDENCE,
        attempt: 1,
      },
      deps,
    );

    expect(outcome).toMatchObject({ suppressed: 1, shouldThrow: false });
    const [row] = await db().select().from(alertDeliveries);
    expect(row).toMatchObject({
      status: 'suppressed',
      suppressedReason: 'opted_out',
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it.each([
    ['classified transport failure', { delivered: false, reason: 'transport-failure' } as const],
    ['defensive unclassified false', { delivered: false } as const],
  ])('retries and exhausts an email %s', async (_label, mailerResult) => {
    const { id } = await seedRule({ emailRecipientIds: ['u1'] });
    const sendEmail = vi.fn(async () => mailerResult);
    const deps = makeDeps({ sendEmail });
    const input = {
      accountId: ACCOUNT,
      ruleId: id,
      transitionId: `rank:email-failure:${_label}`,
      evidence: RANK_EVIDENCE,
    };

    for (let attempt = 1; attempt < ALERT_MAX_ATTEMPTS; attempt += 1) {
      const retryable = await dispatchAlert({ ...input, attempt }, deps);
      expect(retryable).toMatchObject({
        failed: 1,
        exhausted: 0,
        suppressed: 0,
        shouldThrow: true,
      });
      const [row] = await db().select().from(alertDeliveries);
      expect(row).toMatchObject({
        status: 'failed',
        errorCode: 'transport_rejected',
        attempt,
      });
    }

    const exhausted = await dispatchAlert(
      { ...input, attempt: ALERT_MAX_ATTEMPTS },
      deps,
    );
    expect(exhausted).toMatchObject({
      failed: 0,
      exhausted: 1,
      suppressed: 1,
      shouldThrow: true,
    });
    const [row] = await db().select().from(alertDeliveries);
    expect(row).toMatchObject({
      status: 'suppressed',
      errorCode: 'retries_exhausted',
      suppressedReason: 'retries_exhausted',
      attempt: ALERT_MAX_ATTEMPTS,
    });
    expect(sendEmail).toHaveBeenCalledTimes(ALERT_MAX_ATTEMPTS);
  });

  it('isolates a rejected email promise and logs only secret-free identifiers', async () => {
    const { id } = await seedRule({ emailRecipientIds: ['u1'] });
    const warn = vi.fn();
    const sensitive = 'Bearer provider-secret for owner@example.test';
    const deps = makeDeps({
      logger: { warn } as never,
      sendEmail: async () => {
        throw new Error(sensitive);
      },
    });

    const outcome = await dispatchAlert(
      {
        accountId: ACCOUNT,
        ruleId: id,
        transitionId: 'rank:email-rejection',
        evidence: RANK_EVIDENCE,
        attempt: 1,
      },
      deps,
    );

    expect(outcome).toMatchObject({ failed: 1, shouldThrow: true });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ ruleId: id, channel: 'email', err: 'Error' }),
      'alert provider outcome is unknown — leg isolated',
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain(sensitive);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('owner@example.test');
  });

  it('falls back to English when a stored recipient locale is unsupported', async () => {
    const { id } = await seedRule({ emailRecipientIds: ['u1'] });
    const locales: string[] = [];
    const deps = makeDeps({
      resolveRecipient: async () => ({
        email: 'owner@example.test',
        locale: 'not-a-locale' as never,
        membership: 'active',
      }),
      sendEmail: async (message) => {
        locales.push(message.locale);
        return { delivered: true };
      },
    });

    await dispatchAlert(
      {
        accountId: ACCOUNT,
        ruleId: id,
        transitionId: 'rank:c1',
        evidence: RANK_EVIDENCE,
        attempt: 1,
      },
      deps,
    );

    expect(locales).toEqual(['en']);
  });

  it('suppresses a removed member and a vanished user', async () => {
    const removed = await seedRule({ emailRecipientIds: ['u1'] });
    await dispatchAlert(
      {
        accountId: ACCOUNT,
        ruleId: removed.id,
        transitionId: 't1',
        evidence: RANK_EVIDENCE,
        attempt: 1,
      },
      makeDeps({
        resolveRecipient: async () => ({
          email: 'x@example.test',
          locale: 'en',
          membership: 'removed',
        }),
      }),
    );
    const vanished = await seedRule({ emailRecipientIds: ['u2'] });
    await dispatchAlert(
      {
        accountId: ACCOUNT,
        ruleId: vanished.id,
        transitionId: 't2',
        evidence: RANK_EVIDENCE,
        attempt: 1,
      },
      makeDeps({ resolveRecipient: async () => null }),
    );

    const rows = await db().select().from(alertDeliveries);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.suppressedReason === 'membership_removed')).toBe(true);
  });

  it('suppresses when the mail transport is unconfigured', async () => {
    const { id } = await seedRule({ emailRecipientIds: ['u1'] });
    const deps = makeDeps({ transportAvailable: () => false });

    await dispatchAlert(
      {
        accountId: ACCOUNT,
        ruleId: id,
        transitionId: 'rank:c1',
        evidence: RANK_EVIDENCE,
        attempt: 1,
      },
      deps,
    );

    const [row] = await db().select().from(alertDeliveries);
    expect(row).toMatchObject({
      status: 'suppressed',
      suppressedReason: 'no_transport',
    });
    expect(deps.emails).toHaveLength(0);
  });

  it('suppresses every leg of a disabled rule', async () => {
    const { id } = await seedRule({
      emailRecipientIds: ['u1'],
      webhook: true,
      enabled: false,
    });
    const deps = makeDeps();

    const outcome = await dispatchAlert(
      {
        accountId: ACCOUNT,
        ruleId: id,
        transitionId: 'rank:c1',
        evidence: RANK_EVIDENCE,
        attempt: 1,
      },
      deps,
    );

    expect(outcome).toMatchObject({ suppressed: 2, sent: 0 });
    expect(deps.calls).toHaveLength(0);
    const rows = await db().select().from(alertDeliveries);
    expect(rows.every((row) => row.suppressedReason === 'rule_disabled')).toBe(true);
  });

  it('no-ops when the rule was deleted between detection and dispatch', async () => {
    const deps = makeDeps();
    const outcome = await dispatchAlert(
      {
        accountId: ACCOUNT,
        ruleId: '00000000-0000-4000-8000-000000000000',
        transitionId: 'rank:c1',
        evidence: RANK_EVIDENCE,
        attempt: 1,
      },
      deps,
    );
    expect(outcome).toMatchObject({
      sent: 0,
      failed: 0,
      suppressed: 0,
      skipped: 0,
    });
    expect(await db().select().from(alertDeliveries)).toHaveLength(0);
  });

  it('classifies an SSRF refusal at send time as unsafe_url', async () => {
    const { id } = await seedRule({ webhook: true });
    // Resolver now reports a private address for the stored target.
    const deps = makeDeps({
      urlSafety: {
        resolver: async () => [{ address: '10.0.0.9', family: 4 as const }],
      },
    });

    const outcome = await dispatchAlert(
      {
        accountId: ACCOUNT,
        ruleId: id,
        transitionId: 'rank:c1',
        evidence: RANK_EVIDENCE,
        attempt: 1,
      },
      deps,
    );

    expect(outcome).toMatchObject({ failed: 1 });
    const [row] = await db().select().from(alertDeliveries);
    expect(row).toMatchObject({ status: 'failed', errorCode: 'unsafe_url' });
  });

  it('classifies an unexpected transport throw as provider outcome unknown', async () => {
    const { id } = await seedRule({ webhook: true });
    const deps = makeDeps({}, () => {
      throw new TypeError('socket exploded');
    });

    await dispatchAlert(
      {
        accountId: ACCOUNT,
        ruleId: id,
        transitionId: 'rank:c1',
        evidence: RANK_EVIDENCE,
        attempt: 1,
      },
      deps,
    );

    const [row] = await db().select().from(alertDeliveries);
    expect(row).toMatchObject({
      status: 'failed',
      errorCode: 'provider_outcome_unknown',
    });
  });

  it('classifies and redacts a non-Error transport rejection', async () => {
    const { id } = await seedRule({ webhook: true });
    const warn = vi.fn();
    const deps = makeDeps({ logger: { warn } as never }, () => {
      throw 'secret transport rejection';
    });

    const outcome = await dispatchAlert(
      {
        accountId: ACCOUNT,
        ruleId: id,
        transitionId: 'rank:non-error-rejection',
        evidence: RANK_EVIDENCE,
        attempt: 1,
      },
      deps,
    );

    expect(outcome).toMatchObject({ failed: 1, shouldThrow: true });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'webhook', err: 'NonError' }),
      'alert provider outcome is unknown — leg isolated',
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret transport rejection');
  });

  it('refuses evidence that is missing an observation (honesty invariant)', async () => {
    const { id } = await seedRule({ emailRecipientIds: ['u1'] });
    await expect(
      dispatchAlert(
        {
          accountId: ACCOUNT,
          ruleId: id,
          transitionId: 'rank:c1',
          evidence: {
            kind: 'rank_drop',
            keyword: 'x',
            threshold: 10,
            before: { at: '2026-07-01T00:00:00.000Z', position: 3 },
          },
          attempt: 1,
        },
        makeDeps(),
      ),
    ).rejects.toThrow();
    expect(await db().select().from(alertDeliveries)).toHaveLength(0);
  });

  it('carries the link observation pair on a backlink transition', async () => {
    const { id } = await seedRule({ webhook: true });
    const deps = makeDeps();

    await dispatchAlert(
      {
        accountId: ACCOUNT,
        ruleId: id,
        transitionId: 'link:new:rev-1:rev-2',
        evidence: LINK_EVIDENCE,
        attempt: 1,
      },
      deps,
    );

    const parsed = JSON.parse(deps.calls[0]!.body);
    expect(parsed.type).toBe('new_backlink');
    expect(parsed.evidence).toMatchObject({
      before: { reviewId: 'rev-1', rowCount: 4 },
      after: { reviewId: 'rev-2', rowCount: 7 },
      changedTotal: 2,
    });
  });

  it('logs the isolated leg without leaking the channel credential', async () => {
    const { id } = await seedRule({ slack: true });
    const warn = vi.fn();
    const deps = makeDeps(
      {
        logger: { warn } as unknown as DispatchAlertDeps['logger'],
      },
      () => {
        throw new TypeError('boom');
      },
    );

    await dispatchAlert(
      {
        accountId: ACCOUNT,
        ruleId: id,
        transitionId: 'rank:c1',
        evidence: RANK_EVIDENCE,
        attempt: 1,
      },
      deps,
    );

    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-token');
  });

  it('replays a provider-unknown email from the frozen request after rule and recipient drift', async () => {
    const { id } = await seedRule({ emailRecipientIds: ['u1'] });
    const messages: AlertEmailMessage[] = [];
    const resolveRecipient = vi.fn(async () => ({
      email: 'frozen@example.test',
      locale: 'fr',
      membership: 'active' as const,
    }));
    const isEmailEligible = vi.fn(async () => true);
    const senderIdentity = vi.fn(() => 'RankMe <from@example.test>');
    let submission = 0;
    let clock = NOW;
    const deps = makeDeps({
      now: () => clock,
      resolveRecipient,
      isEmailEligible,
      senderIdentity,
      sendEmail: async (message) => {
        messages.push(message);
        submission += 1;
        return submission === 1
          ? { delivered: false, outcomeUnknown: true }
          : { delivered: true, providerMessageId: 'replay-collapsed' };
      },
    });
    const input = {
      accountId: ACCOUNT,
      ruleId: id,
      transitionId: 'rank:frozen-email',
      evidence: RANK_EVIDENCE,
      attempt: 99,
    };

    await expect(dispatchAlert(input, deps)).resolves.toMatchObject({
      failed: 1,
      shouldThrow: true,
    });
    const [ambiguous] = await db().select().from(alertDeliveries);
    expect(ambiguous).toMatchObject({
      attempt: 1,
      status: 'failed',
      errorCode: 'provider_outcome_unknown',
    });
    expect(ambiguous!.requestPayload).not.toBeNull();

    clock = new Date(NOW.getTime() + 1_000);
    await db().update(alertRules).set({
      enabled: false,
      emailRecipientIds: ['someone-else'],
      updatedAt: clock,
    }).where(eq(alertRules.id, id));
    resolveRecipient.mockRejectedValueOnce(new Error('mutable resolver must not run'));
    isEmailEligible.mockRejectedValueOnce(new Error('mutable preference must not run'));

    await expect(dispatchAlert(input, deps)).resolves.toMatchObject({ sent: 1, failed: 0 });
    expect(messages).toHaveLength(2);
    expect(messages[1]).toEqual(messages[0]);
    expect(resolveRecipient).toHaveBeenCalledTimes(1);
    expect(isEmailEligible).toHaveBeenCalledTimes(1);
    expect(senderIdentity).toHaveBeenCalledTimes(1);
    const [sent] = await db().select().from(alertDeliveries);
    expect(sent).toMatchObject({
      status: 'sent',
      attempt: 2,
      providerMessageId: 'replay-collapsed',
      requestPayload: null,
    });
  });

  it('keeps provider outcome unknown distinct at the retry ceiling', async () => {
    const { id } = await seedRule({ emailRecipientIds: ['u1'] });
    let clock = NOW;
    const sendEmail = vi.fn(async () => ({ delivered: false, outcomeUnknown: true }));
    const deps = makeDeps({ now: () => clock, sendEmail });
    const input = {
      accountId: ACCOUNT,
      ruleId: id,
      transitionId: 'rank:unknown-terminal',
      evidence: RANK_EVIDENCE,
      attempt: 100,
    };
    await dispatchAlert(input, deps);
    clock = new Date(clock.getTime() + 1_000);
    await dispatchAlert(input, deps);
    clock = new Date(clock.getTime() + 1_000);
    const terminal = await dispatchAlert(input, deps);

    expect(terminal).toMatchObject({ failed: 1, exhausted: 1, shouldThrow: true });
    expect(sendEmail).toHaveBeenCalledTimes(ALERT_MAX_ATTEMPTS);
    const [row] = await db().select().from(alertDeliveries);
    expect(row).toMatchObject({
      status: 'failed',
      attempt: ALERT_MAX_ATTEMPTS,
      errorCode: 'provider_outcome_unknown',
      suppressedReason: null,
      requestPayload: null,
    });
  });

  it('freezes every configured leg before the first provider call', async () => {
    const { id } = await seedRule({
      emailRecipientIds: ['u1', 'u2'],
      slack: true,
      webhook: true,
    });
    let observedFrozenPlan = false;
    let providerCalls = 0;
    const deps = makeDeps({
      sendEmail: async () => {
        if (providerCalls === 0) {
          const rows = await db().select().from(alertDeliveries);
          observedFrozenPlan =
            rows.length === 4 &&
            rows.every((row) => row.status === 'pending' && row.requestPayload !== null);
        }
        providerCalls += 1;
        return { delivered: true };
      },
    });
    await dispatchAlert({
      accountId: ACCOUNT,
      ruleId: id,
      transitionId: 'rank:atomic-plan',
      evidence: RANK_EVIDENCE,
      attempt: 1,
    }, deps);
    expect(observedFrozenPlan).toBe(true);
  });

  it('replays the exact frozen webhook URL, body, timestamp, and signature after rule drift', async () => {
    const { id } = await seedRule({ webhook: true });
    let clock = NOW;
    let requestNumber = 0;
    const deps = makeDeps({ now: () => clock }, () => {
      requestNumber += 1;
      if (requestNumber === 1) throw new TypeError('connection reset after upload');
      return new Response('', { status: 200 });
    });
    const input = {
      accountId: ACCOUNT,
      ruleId: id,
      transitionId: 'rank:frozen-webhook',
      evidence: RANK_EVIDENCE,
      attempt: 1,
    };
    await dispatchAlert(input, deps);
    const first = deps.calls[0]!;

    clock = new Date(NOW.getTime() + 5_000);
    const replacementSecret = 'a'.repeat(64);
    await db().update(alertRules).set({
      webhookUrl: 'https://replacement.example.test/hook',
      webhookSecret: sealAlertSecret(replacementSecret, id, 'webhook_secret'),
      webhookSecretLast4: replacementSecret.slice(-4),
      updatedAt: clock,
    }).where(eq(alertRules.id, id));
    await dispatchAlert(input, deps);
    const replay = deps.calls[1]!;

    expect(replay.url).toBe(first.url);
    expect(replay.body).toBe(first.body);
    expect(replay.headers.get('x-rankmefast-signature'))
      .toBe(first.headers.get('x-rankmefast-signature'));
    expect(replay.headers.get('x-rankmefast-delivery'))
      .toBe(first.headers.get('x-rankmefast-delivery'));
  });

  it('retains and completes a provider-bound ambiguous leg after explicit rule deletion', async () => {
    const { id } = await seedRule({ emailRecipientIds: ['u1'] });
    let clock = NOW;
    let submission = 0;
    const deps = makeDeps({
      now: () => clock,
      sendEmail: async () => {
        submission += 1;
        return submission === 1
          ? { delivered: false, outcomeUnknown: true }
          : { delivered: true };
      },
    });
    const input = {
      accountId: ACCOUNT,
      ruleId: id,
      transitionId: 'rank:delete-bound',
      evidence: RANK_EVIDENCE,
      attempt: 1,
    };
    await dispatchAlert(input, deps);
    clock = new Date(NOW.getTime() + 1_000);
    await expect(deleteRuleRow(db(), ACCOUNT, id, clock)).resolves.toBe(true);
    expect(await db().select().from(alertRules)).toHaveLength(0);
    expect(await db().select().from(alertDeliveries)).toHaveLength(1);

    await expect(dispatchAlert(input, deps)).resolves.toMatchObject({ sent: 1 });
    const [row] = await db().select().from(alertDeliveries);
    expect(row).toMatchObject({ status: 'sent', requestPayload: null });
  });
});

describe('rendering', () => {
  it('renders the rank body from both observations', () => {
    const { subject, text } = renderAlertEmail('en', RANK_EVIDENCE);
    expect(subject).toContain('seo audit tool');
    expect(text).toContain('2026-07-01');
    expect(text).toContain('2026-07-02');
    expect(text).toContain('3');
    expect(text).toContain('24');
  });

  it('labels a lost ranking rather than printing a bare null', () => {
    const { text } = renderAlertEmail('en', {
      ...RANK_EVIDENCE,
      after: { at: '2026-07-02T00:00:00.000Z', position: null },
    } as AlertEvidence);
    expect(text).toContain('below the top 100');
  });

  it('caps the rendered domain list and states the honest total', () => {
    const { text } = renderAlertEmail('en', {
      kind: 'lost_backlink',
      before: { at: '2026-07-01T00:00:00.000Z', reviewId: 'r1', rowCount: 90 },
      after: { at: '2026-07-02T00:00:00.000Z', reviewId: 'r2', rowCount: 10 },
      changedDomains: ['a.test', 'b.test'],
      changedTotal: 80,
    });
    expect(text).toContain('a.test, b.test');
    expect(text).toContain('78');
  });

  it('renders a complete new-link sample without an artificial remainder', () => {
    const { subject, text } = renderAlertEmail('en', LINK_EVIDENCE);
    expect(subject).toContain('2');
    expect(text).toContain('a.test, b.test');
    expect(text).not.toContain('more');
  });

  it('renders every Slack variant from evidence only', () => {
    expect(renderSlackText('en', RANK_EVIDENCE)).toContain('seo audit tool');
    expect(renderSlackText('en', LINK_EVIDENCE)).toContain('2');
    expect(
      renderSlackText('en', {
        ...LINK_EVIDENCE,
        kind: 'lost_backlink',
      } as AlertEvidence),
    ).toContain('2026-07-02');
  });
});

describe('buildWebhookPayload', () => {
  it('never includes account, secret, or vendor fields', () => {
    const payload = buildWebhookPayload({
      deliveryId: 'd1',
      ruleId: 'r1',
      siteId: SITE,
      occurredAt: '2026-07-02T00:00:00.000Z',
      evidence: RANK_EVIDENCE,
    });
    expect(Object.keys(payload).sort()).toEqual([
      'evidence',
      'id',
      'occurredAt',
      'ruleId',
      'siteId',
      'type',
      'version',
    ]);
  });
});
