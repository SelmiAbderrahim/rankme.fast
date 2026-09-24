/**
 * Processor + wiring + secret-helper coverage.
 *
 * The processors are thin shells, so these tests pin the contract that matters:
 * a malformed payload is unrecoverable (straight to dead-letter, no retries
 * burned), a failed leg re-throws so BullMQ retries, a fully-settled fan-out
 * does not, and the masking/signing helpers never leak entropy.
 */
import type { Job } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../config/env.js';
import {
  alertDeliveries,
  alertRules,
  keywords,
  rankDropConfirmations,
  rankings,
  teamMembers,
} from '../../db/schema/index.js';
import { startMemoryMongo, stopMemoryMongo } from '../../shared/testing/mongo.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import type { DispatchAlertDeps } from './alert-dispatch.service.js';
import {
  AlertDispatchIncompleteError,
  createAlertDispatchProcessor,
} from './alert-dispatch.processor.js';
import {
  alertSweepIntervalMs,
  ALERT_SWEEP_JOB,
  ALERT_SWEEP_QUEUE,
  ALERT_SWEEP_SCHEDULER_KEY,
  createAlertSweepProcessor,
} from './alert-sweep.processor.js';
import {
  countRulesForAccount,
  findDeliveryByKey,
  listConfirmedRankDrops,
  settleDelivery,
} from './alerts.repo.js';
import {
  alertSecretAad,
  generateWebhookSecret,
  maskSlackWebhookUrl,
  newRuleId,
  openAlertSecret,
  sealAlertSecret,
  signAlertPayload,
  webhookSecretLast4,
} from './alerts.secrets.js';
import { createAlertDispatchDeps, resolveAlertRecipient } from './alerts.wiring.js';
import { setResendTransport } from '../communication/index.js';
import { User } from '../users/users.model.js';
import { createRuleBodySchema } from './alerts.schema.js';

type Db = DispatchAlertDeps['db'];
const db = () => getTestDb() as unknown as Db;

const ACCOUNT = 'acct-1';
const SITE = 'site-1';
const EVIDENCE = {
  kind: 'rank_drop',
  keyword: 'seo audit tool',
  threshold: 10,
  before: { at: '2026-07-01T00:00:00.000Z', position: 3 },
  after: { at: '2026-07-02T00:00:00.000Z', position: 24 },
};

function job(data: unknown, attemptsMade?: number): Job {
  const payload =
    data && typeof data === 'object' && 'accountId' in data
      ? { siteId: SITE, ...(data as Record<string, unknown>) }
      : data;
  return {
    data: payload,
    ...(attemptsMade === undefined ? {} : { attemptsMade }),
  } as unknown as Job;
}

async function seedRule(webhookFails: boolean): Promise<string> {
  const id = newRuleId();
  const secret = generateWebhookSecret();
  await db()
    .insert(alertRules)
    .values({
      id,
      accountId: ACCOUNT,
      siteId: SITE,
      type: 'rank_drop',
      threshold: 10,
      emailRecipientIds: [],
      webhookUrl: webhookFails
        ? 'https://broken.example.test/hook'
        : 'https://ok.example.test/hook',
      webhookSecret: sealAlertSecret(secret, id, 'webhook_secret'),
      webhookSecretLast4: webhookSecretLast4(secret),
    });
  return id;
}

function deps(status: number): DispatchAlertDeps {
  return {
    db: db(),
    transportAvailable: () => true,
    resolveRecipient: async () => null,
    sendEmail: async () => ({ delivered: true }),
    urlSafety: {
      resolver: async () => [{ address: '93.184.216.34', family: 4 as const }],
      transport: async () => new Response('', { status }),
    },
  };
}

beforeAll(async () => {
  await startMemoryMongo();
  await startTestPostgres();
});

afterAll(async () => {
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await truncateAllTables();
});

describe('createAlertDispatchProcessor', () => {
  it('resolves silently when every leg settled', async () => {
    const ruleId = await seedRule(false);
    const info = vi.fn();
    const process = createAlertDispatchProcessor({
      ...deps(200),
      logger: { info } as never,
    });

    await expect(
      process(
        job({
          accountId: ACCOUNT,
          ruleId,
          transitionId: 'rank:c1',
          evidence: EVIDENCE,
        }),
      ),
    ).resolves.toBeUndefined();

    expect(info).toHaveBeenCalledTimes(1);
    const [row] = await db().select().from(alertDeliveries);
    expect(row!.status).toBe('sent');
  });

  it('re-throws so BullMQ retries when a leg failed', async () => {
    const ruleId = await seedRule(true);
    const process = createAlertDispatchProcessor(deps(500));

    await expect(
      process(
        job({
          accountId: ACCOUNT,
          ruleId,
          transitionId: 'rank:c1',
          evidence: EVIDENCE,
        }),
      ),
    ).rejects.toBeInstanceOf(AlertDispatchIncompleteError);
  });

  it('maps BullMQ attemptsMade onto the 1-based delivery attempt', async () => {
    const ruleId = await seedRule(true);
    const process = createAlertDispatchProcessor(deps(500));

    await expect(
      process(
        job(
          {
            accountId: ACCOUNT,
            ruleId,
            transitionId: 'rank:c1',
            evidence: EVIDENCE,
          },
          0,
        ),
      ),
    ).rejects.toBeInstanceOf(AlertDispatchIncompleteError);
    await expect(
      process(
        job(
          {
            accountId: ACCOUNT,
            ruleId,
            transitionId: 'rank:c1',
            evidence: EVIDENCE,
          },
          1,
        ),
      ),
    ).rejects.toBeInstanceOf(AlertDispatchIncompleteError);

    // attemptsMade 2 → attempt 3 → terminal row plus a final throw. BullMQ's
    // failed event can now route this exhausted job into the shipped DLQ.
    await expect(
      process(
        job(
          {
            accountId: ACCOUNT,
            ruleId,
            transitionId: 'rank:c1',
            evidence: EVIDENCE,
          },
          2,
        ),
      ),
    ).rejects.toBeInstanceOf(AlertDispatchIncompleteError);

    const [row] = await db().select().from(alertDeliveries);
    expect(row).toMatchObject({
      attempt: 3,
      status: 'suppressed',
      suppressedReason: 'retries_exhausted',
    });
  });

  it('treats a malformed payload as unrecoverable', async () => {
    const process = createAlertDispatchProcessor(deps(200));
    await expect(process(job({ nope: true }))).rejects.toThrow();
    expect(await db().select().from(alertDeliveries)).toHaveLength(0);
  });
});

describe('createAlertSweepProcessor', () => {
  it('exposes stable scheduler identifiers without a BullMQ-illegal colon', () => {
    expect(ALERT_SWEEP_QUEUE).toBe('alert-detection-sweep');
    expect(ALERT_SWEEP_JOB).toBe('alert-detection-sweep');
    expect(ALERT_SWEEP_SCHEDULER_KEY).not.toContain(':');
    expect(alertSweepIntervalMs()).toBe(env.ALERT_SWEEP_INTERVAL_MS);
  });

  it('runs quietly when nothing was dispatched', async () => {
    const info = vi.fn();
    const process = createAlertSweepProcessor({
      db: db(),
      queue: null,
      logger: { info } as never,
    });
    await expect(process()).resolves.toBeUndefined();
    expect(info).not.toHaveBeenCalled();
  });

  it('logs once when the sweep dispatched work', async () => {
    const ruleId = newRuleId();
    await db()
      .insert(alertRules)
      .values({
        id: ruleId,
        accountId: ACCOUNT,
        siteId: SITE,
        type: 'rank_drop',
        threshold: 10,
        emailRecipientIds: ['u1'],
      });
    const [keyword] = await db()
      .insert(keywords)
      .values({
        accountId: ACCOUNT,
        siteId: SITE,
        phrase: 'seo audit tool',
        locationCode: 2840,
        languageCode: 'en',
      })
      .returning();
    const observedAt = new Date('2026-07-02T00:00:00.000Z');
    const [ranking] = await db()
      .insert(rankings)
      .values({
        keywordId: keyword!.id,
        position: 24,
        checkedAt: observedAt,
        source: 'fresh',
      })
      .returning();
    await db().insert(rankDropConfirmations).values({
      accountId: ACCOUNT,
      siteId: SITE,
      keywordId: keyword!.id,
      rankingId: ranking!.id,
      state: 'confirmed',
      previousPosition: 3,
      candidatePosition: 24,
      confirmationPosition: 24,
      candidateObservedAt: observedAt,
      confirmationObservedAt: observedAt,
      locationCode: 2840,
      languageCode: 'en',
      device: 'desktop',
      attemptReservedAt: observedAt,
      settledAt: observedAt,
    });
    const info = vi.fn();
    const jobs: unknown[] = [];
    const process = createAlertSweepProcessor({
      db: db(),
      queue: { add: async (...args: unknown[]) => jobs.push(args) } as never,
      logger: { info } as never,
      now: () => new Date('2026-07-02T12:00:00.000Z'),
    });
    await expect(process()).resolves.toBeUndefined();
    expect(jobs).toHaveLength(1);
    expect(info).toHaveBeenCalledWith(
      { examined: 1, dispatched: 1 },
      'alert detection sweep dispatched confirmed rank drops',
    );
  });
});

describe('alerts.secrets', () => {
  it('binds each envelope to its rule and field', () => {
    const ruleId = newRuleId();
    expect(alertSecretAad(ruleId, 'slack_webhook')).toBe(`alert_rules:${ruleId}:slack_webhook`);
    const sealed = sealAlertSecret('top-secret', ruleId, 'slack_webhook');
    expect(openAlertSecret(sealed, ruleId, 'slack_webhook')).toBe('top-secret');
    expect(() => openAlertSecret(sealed, newRuleId(), 'slack_webhook')).toThrow();
  });

  it('mints 32 bytes of hex entropy and exposes only the tail', () => {
    const secret = generateWebhookSecret();
    expect(secret).toMatch(/^[0-9a-f]{64}$/u);
    expect(webhookSecretLast4(secret)).toBe(secret.slice(-4));
    expect(generateWebhookSecret()).not.toBe(secret);
  });

  it('masks a Slack URL down to host plus first path segment', () => {
    expect(maskSlackWebhookUrl('https://hooks.slack.com/services/T1/B2/xoxb-token')).toBe(
      'hooks.slack.com/services/…',
    );
    // A path-less URL still masks rather than throwing.
    expect(maskSlackWebhookUrl('https://hooks.slack.com/')).toBe('hooks.slack.com/…');
  });

  it('signs over the exact body and timestamp', () => {
    const header = signAlertPayload('sekret', '{"a":1}', 1_780_000_000);
    expect(header).toMatch(/^t=1780000000,v1=[0-9a-f]{64}$/u);
    // A single changed byte in the body changes the MAC.
    expect(signAlertPayload('sekret', '{"a":2}', 1_780_000_000)).not.toBe(header);
  });
});

describe('alerts.repo helpers', () => {
  it('keeps delivery evidence independent from physical rule deletion', () => {
    expect(getTableConfig(alertDeliveries).foreignKeys).toHaveLength(0);
  });

  it('finds a delivery by its idempotency key', async () => {
    const ruleId = await seedRule(false);
    await db().insert(alertDeliveries).values({
      accountId: ACCOUNT,
      siteId: SITE,
      ruleId,
      channel: 'webhook',
      idempotencyKey: 'alert:x:y:webhook:-',
      transitionId: 'y',
      transitionKind: 'rank_drop',
      status: 'sent',
      attempt: 1,
      evidence: EVIDENCE,
    });

    expect(await findDeliveryByKey(db(), 'alert:x:y:webhook:-')).toMatchObject({
      status: 'sent',
    });
    expect(await findDeliveryByKey(db(), 'missing')).toBeNull();
  });
});

describe('resolveAlertRecipient', () => {
  it('reports a vanished user as absent so delivery suppresses', async () => {
    // No Mongo connection in this suite — `findUserById` on an unknown id
    // resolves null, which is exactly the contract under test.
    await expect(
      resolveAlertRecipient({
        db: db(),
        accountId: ACCOUNT,
        userId: '000000000000000000000000',
      }),
    ).resolves.toBeNull();
  });

  it('checks site-specific access for a non-owner recipient', async () => {
    const userId = new Types.ObjectId().toHexString();
    await User.create({
      _id: userId,
      email: 'site-member@example.test',
      language: 'de',
    });
    await db().insert(teamMembers).values({
      teamId: ACCOUNT,
      userId,
      email: 'site-member@example.test',
      role: 'member',
      siteAccessMode: 'all',
      inviteTokenHash: 'site-member'.padEnd(64, '0'),
      invitedBy: ACCOUNT,
      acceptedAt: new Date(),
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    });

    await expect(
      resolveAlertRecipient({
        db: db(),
        accountId: ACCOUNT,
        userId,
        siteId: SITE,
      }),
    ).resolves.toEqual({
      email: 'site-member@example.test',
      locale: 'de',
      membership: 'active',
    });
  });
});

describe('alerts.repo edge cases', () => {
  it('reports zero rules for an account that has none', async () => {
    expect(await countRulesForAccount(db(), 'nobody')).toBe(0);
  });

  it('returns null when settling a delivery row that no longer exists', async () => {
    expect(
      await settleDelivery(db(), {
        id: '00000000-0000-4000-8000-000000000000',
        status: 'sent',
        attempt: 1,
        claimToken: randomUUID(),
        now: new Date(),
      }),
    ).toBeNull();
  });

  it('drops a confirmation whose evidence pair is incomplete', async () => {
    // `previous_position` NULL → no "before" observation → the row can never
    // produce an honest alert, so the reader filters it out at the source.
    const [keyword] = await db()
      .insert(keywords)
      .values({
        accountId: ACCOUNT,
        siteId: SITE,
        phrase: 'seo audit tool',
        locationCode: 2840,
        languageCode: 'en',
      })
      .returning();
    const [ranking] = await db()
      .insert(rankings)
      .values({
        keywordId: keyword!.id,
        position: 24,
        checkedAt: new Date(),
        source: 'fresh',
      })
      .returning();
    await db().insert(rankDropConfirmations).values({
      accountId: ACCOUNT,
      siteId: SITE,
      keywordId: keyword!.id,
      rankingId: ranking!.id,
      state: 'confirmed',
      previousPosition: null,
      candidatePosition: 24,
      confirmationPosition: 24,
      candidateObservedAt: new Date(),
      confirmationObservedAt: new Date(),
      locationCode: 2840,
      languageCode: 'en',
      device: 'desktop',
      attemptReservedAt: new Date(),
      settledAt: new Date(),
    });

    expect(await listConfirmedRankDrops(db(), { since: new Date(0), limit: 10 })).toEqual([]);
  });
});

describe('createRuleBodySchema url guard', () => {
  it('refuses a string the URL parser cannot even parse', () => {
    const parsed = createRuleBodySchema.safeParse({
      siteId: 'site1',
      type: 'new_backlink',
      webhookUrl: 'not-a-url-at-all',
    });
    expect(parsed.success).toBe(false);
  });
});

describe('createAlertDispatchDeps', () => {
  it('reports email transport ready only for a complete live sender configuration', () => {
    const previousTransport = env.EMAIL_TRANSPORT;
    const previousKey = env.RESEND_API_KEY;
    const previousFrom = env.RESEND_FROM;
    const wired = createAlertDispatchDeps({
      db: db(),
      logger: { warn: vi.fn() } as never,
    });
    try {
      (env as { EMAIL_TRANSPORT: 'resend' | 'fake' }).EMAIL_TRANSPORT = 'resend';
      (env as { RESEND_API_KEY?: string }).RESEND_API_KEY = 'configured-key';
      (env as { RESEND_FROM?: string }).RESEND_FROM = undefined;
      expect(wired.transportAvailable()).toBe(false);

      (env as { RESEND_FROM?: string }).RESEND_FROM = 'no-reply@rankme.test';
      expect(wired.transportAvailable()).toBe(true);
    } finally {
      (env as { EMAIL_TRANSPORT: 'resend' | 'fake' }).EMAIL_TRANSPORT =
        previousTransport;
      (env as { RESEND_API_KEY?: string }).RESEND_API_KEY = previousKey;
      (env as { RESEND_FROM?: string }).RESEND_FROM = previousFrom;
    }
  });

  it('wires a recipient resolver and a preference-gated mailer', async () => {
    const user = await User.create({
      _id: new Types.ObjectId(),
      email: 'owner@example.test',
      firstName: 'Owner',
      lastName: 'User',
      language: 'fr',
    });
    const userId = String(user._id);

    const deps = createAlertDispatchDeps({
      db: db(),
      logger: { warn: vi.fn() } as never,
    });

    // Transport availability mirrors the operator's Resend configuration.
    expect(typeof deps.transportAvailable()).toBe('boolean');

    expect(await deps.resolveRecipient({ accountId: userId, userId })).toEqual({
      email: 'owner@example.test',
      locale: 'fr',
      membership: 'active',
    });

    // The wiring must preserve the communication boundary's failure reason;
    // otherwise dispatch would turn this provider failure into an opt-out.
    const previousTransport = env.EMAIL_TRANSPORT;
    const previousKey = env.RESEND_API_KEY;
    const previousFrom = env.RESEND_FROM;
    let providerIdempotencyKey: string | undefined;
    try {
      (env as { EMAIL_TRANSPORT: 'resend' | 'fake' }).EMAIL_TRANSPORT = 'resend';
      (env as { RESEND_API_KEY?: string }).RESEND_API_KEY = 'configured-key';
      (env as { RESEND_FROM?: string }).RESEND_FROM = 'no-reply@rankme.test';
      setResendTransport(async (message) => {
        providerIdempotencyKey = message.idempotencyKey;
        return { delivered: false };
      });
      await expect(
        deps.sendEmail({
          to: 'owner@example.test',
          userId,
          idempotencyKey: 'alert/delivery-wiring',
          expectedSenderIdentity: 'no-reply@rankme.test',
          eligibilityFrozen: true,
          subject: 'subject',
          text: 'body',
          locale: 'en',
        }),
      ).resolves.toEqual({ delivered: false, reason: 'transport-failure' });
      expect(providerIdempotencyKey).toBe('alert/delivery-wiring');
    } finally {
      setResendTransport(null);
      (env as { EMAIL_TRANSPORT: 'resend' | 'fake' }).EMAIL_TRANSPORT =
        previousTransport;
      (env as { RESEND_API_KEY?: string }).RESEND_API_KEY = previousKey;
      (env as { RESEND_FROM?: string }).RESEND_FROM = previousFrom;
    }
  });

  it('falls back to the default locale when the user has none', async () => {
    const user = await User.create({
      _id: new Types.ObjectId(),
      email: 'nolocale@example.test',
      firstName: 'No',
      lastName: 'Locale',
    });
    const resolved = await resolveAlertRecipient({
      db: db(),
      accountId: String(user._id),
      userId: String(user._id),
    });
    expect(resolved?.locale).toBe('en');
  });

  it('suppresses a real user who is not an active account member', async () => {
    const user = await User.create({
      _id: new Types.ObjectId(),
      email: 'outsider@example.test',
      firstName: 'Out',
      lastName: 'Sider',
      language: 'de',
    });

    const resolved = await resolveAlertRecipient({
      db: db(),
      accountId: ACCOUNT,
      userId: String(user._id),
    });

    expect(resolved).toMatchObject({
      email: 'outsider@example.test',
      locale: 'de',
      membership: 'removed',
    });
  });

  it('accepts a verified active team member', async () => {
    const user = await User.create({
      _id: new Types.ObjectId(),
      email: 'member@example.test',
      firstName: 'Team',
      lastName: 'Member',
      language: 'ar',
    });
    const userId = String(user._id);
    await db()
      .insert(teamMembers)
      .values({
        teamId: ACCOUNT,
        userId,
        email: 'member@example.test',
        inviteTokenHash: 'member-token-hash',
        invitedBy: ACCOUNT,
        acceptedAt: new Date('2026-07-01T00:00:00.000Z'),
        expiresAt: new Date('2026-08-01T00:00:00.000Z'),
      });

    await expect(
      resolveAlertRecipient({ db: db(), accountId: ACCOUNT, userId }),
    ).resolves.toMatchObject({ locale: 'ar', membership: 'active' });
  });

  it('accepts an admin-role member exactly like a member-role one', async () => {
    // Alert eligibility keys off acceptance/revocation, never off the team
    // role — the `admin` role added must not
    // fall out of the fan-out.
    const user = await User.create({
      _id: new Types.ObjectId(),
      email: 'admin-member@example.test',
      firstName: 'Team',
      lastName: 'Admin',
      language: 'de',
    });
    const userId = String(user._id);
    await db()
      .insert(teamMembers)
      .values({
        teamId: ACCOUNT,
        userId,
        email: 'admin-member@example.test',
        role: 'admin',
        inviteTokenHash: 'admin-member-token-hash',
        invitedBy: ACCOUNT,
        acceptedAt: new Date('2026-07-01T00:00:00.000Z'),
        expiresAt: new Date('2026-08-01T00:00:00.000Z'),
      });

    await expect(
      resolveAlertRecipient({ db: db(), accountId: ACCOUNT, userId }),
    ).resolves.toMatchObject({ locale: 'de', membership: 'active' });
  });
});
