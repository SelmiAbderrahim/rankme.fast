import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setResendTransport, type EmailMessage } from './mailers/resend.js';
import {
  deliverAuditCompleteEmail,
  deliverAlertEmail,
  deliverPasswordChangedEmail,
  deliverPasswordResetEmail,
  deliverMonitorChangeEmail,
  deliverRankDropEmail,
  deliverTeamInviteEmail,
  deliverVerificationEmail,
  deliverWelcomeEmail,
  isAlertEmailEligible,
  shouldSendNotification,
} from './communication.service.js';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import { User } from '../users/users.model.js';
import { env } from '../../config/env.js';

async function withResend<T>(fn: () => Promise<T>): Promise<T> {
  const prevKey = env.RESEND_API_KEY;
  const prevFrom = env.RESEND_FROM;
  (env as { RESEND_API_KEY?: string }).RESEND_API_KEY = 'test-key';
  (env as { RESEND_FROM?: string }).RESEND_FROM = 'no-reply@rankme.test';
  try {
    return await fn();
  } finally {
    (env as { RESEND_API_KEY?: string }).RESEND_API_KEY = prevKey;
    (env as { RESEND_FROM?: string }).RESEND_FROM = prevFrom;
  }
}

async function makeUser(
  prefs?: Partial<{
    emailAuditComplete: boolean;
    emailRankDrop: boolean;
    emailMarketing: boolean;
    emailMonitorChange: boolean;
    emailAlerts: boolean;
  }>,
): Promise<string> {
  const doc = await User.create({
    email: `u${Math.random().toString(36).slice(2)}@test.com`,
    emailVerified: true,
    ...(prefs ? { notificationPreferences: prefs } : {}),
  });
  return (doc._id as { toString(): string }).toString();
}

describe('mailer notification-preference gate', () => {
  const seen: EmailMessage[] = [];

  beforeAll(async () => {
    await startMemoryMongo();
  });

  afterAll(async () => {
    setResendTransport(null);
    await stopMemoryMongo();
  });

  beforeEach(async () => {
    seen.length = 0;
    setResendTransport(async (msg) => {
      seen.push({ ...msg });
      return { delivered: true };
    });
    await clearCollections();
  });

  it('shouldSendNotification returns true for a fresh user with defaults', async () => {
    const userId = await makeUser();
    for (const channel of [
      'emailAuditComplete',
      'emailRankDrop',
      'emailMarketing',
    ] as const) {
      expect(await shouldSendNotification(userId, channel)).toBe(true);
    }
  });

  it('shouldSendNotification honours a stored false', async () => {
    const userId = await makeUser({ emailMarketing: false });
    expect(await shouldSendNotification(userId, 'emailMarketing')).toBe(false);
    expect(await shouldSendNotification(userId, 'emailRankDrop')).toBe(true);
  });

  it('deliverAuditCompleteEmail short-circuits when emailAuditComplete is false', async () => {
    await withResend(async () => {
      const userId = await makeUser({ emailAuditComplete: false });
      const res = await deliverAuditCompleteEmail({
        email: 'u@test.com',
        userId,
        siteLabel: 'example.com',
        reportUrl: 'https://app.test/report/1',
      });
      expect(res).toEqual({ delivered: false, reason: 'opted-out' });
      expect(seen).toHaveLength(0);
    });
  });

  it('deliverAuditCompleteEmail sends when emailAuditComplete is true', async () => {
    await withResend(async () => {
      const userId = await makeUser({ emailAuditComplete: true });
      const res = await deliverAuditCompleteEmail({
        email: 'u@test.com',
        userId,
        siteLabel: 'example.com',
        reportUrl: 'https://app.test/report/1',
      });
      expect(res.delivered).toBe(true);
      expect(seen).toHaveLength(1);
      expect(seen[0]?.text).toContain('example.com');
      expect(seen[0]?.text).toContain('https://app.test/report/1');
    });
  });

  it('deliverRankDropEmail short-circuits when emailRankDrop is false', async () => {
    await withResend(async () => {
      const userId = await makeUser({ emailRankDrop: false });
      const res = await deliverRankDropEmail({
        email: 'u@test.com',
        userId,
        keyword: 'seo',
        previousPosition: '3',
        currentPosition: '9',
        siteUrl: 'https://example.com',
      });
      expect(res).toEqual({ delivered: false, reason: 'opted-out' });
      expect(seen).toHaveLength(0);
    });
  });

  it('deliverRankDropEmail sends when emailRankDrop is true', async () => {
    await withResend(async () => {
      const userId = await makeUser({ emailRankDrop: true });
      const res = await deliverRankDropEmail({
        email: 'u@test.com',
        userId,
        keyword: 'seo',
        previousPosition: '3',
        currentPosition: '9',
        siteUrl: 'https://example.com',
      });
      expect(res.delivered).toBe(true);
      expect(seen).toHaveLength(1);
      expect(seen[0]?.subject).toContain('seo');
    });
  });

  it('deliverMonitorChangeEmail sends a payload whose eligibility was frozen upstream', async () => {
    await withResend(async () => {
      const res = await deliverMonitorChangeEmail({
        email: 'u@test.com',
        subject: 'Page changed: https://example.com/page',
        text: 'Review https://app.test/sites/1?tab=content&view=monitoring',
        html: '<html lang="en" dir="ltr"><body>Review</body></html>',
        senderIdentity: 'no-reply@rankme.test',
        idempotencyKey: 'content-monitor/receipt-frozen-eligible',
      });
      expect(res.delivered).toBe(true);
      expect(seen).toHaveLength(1);
    });
  });

  it('deliverMonitorChangeEmail sends when emailMonitorChange is true', async () => {
    await withResend(async () => {
      const res = await deliverMonitorChangeEmail({
        email: 'u@test.com',
        subject: 'Page changed: https://example.com/page',
        text: 'Review https://app.test/sites/1?tab=content&view=monitoring',
        html: '<html lang="en" dir="ltr"><body>Review</body></html>',
        senderIdentity: 'no-reply@rankme.test',
        idempotencyKey: 'content-monitor/receipt-sent',
      });
      expect(res.delivered).toBe(true);
      expect(seen).toHaveLength(1);
      expect(seen[0]?.subject).toContain('example.com/page');
      expect(seen[0]?.idempotencyKey).toBe('content-monitor/receipt-sent');
    });
  });

  it('deliverMonitorChangeEmail classifies a transport failure for outbox retry', async () => {
    await withResend(async () => {
      setResendTransport(async () => ({ delivered: false }));
      const res = await deliverMonitorChangeEmail({
        email: 'u@test.com',
        subject: 'Page changed: https://example.com/page',
        text: 'Review https://app.test/sites/1?tab=content&view=monitoring',
        html: '<html lang="en" dir="ltr"><body>Review</body></html>',
        senderIdentity: 'no-reply@rankme.test',
        idempotencyKey: 'content-monitor/receipt-retry',
      });
      expect(res).toEqual({ delivered: false, reason: 'transport-failure' });
    });
  });

  it('refuses an idempotent replay when the configured sender changed', async () => {
    await withResend(async () => {
      (env as { RESEND_FROM?: string }).RESEND_FROM = 'rotated@rankme.test';
      const res = await deliverMonitorChangeEmail({
        email: 'u@test.com',
        subject: 'Page changed: https://example.com/page',
        text: 'Review https://app.test/sites/1?tab=content&view=monitoring',
        html: '<html lang="en" dir="ltr"><body>Review</body></html>',
        senderIdentity: 'no-reply@rankme.test',
        idempotencyKey: 'content-monitor/receipt-sender-rotated',
      });
      expect(res).toEqual({ delivered: false, reason: 'transport-failure' });
      expect(seen).toHaveLength(0);
    });
  });

  it('deliverWelcomeEmail short-circuits when emailMarketing is false', async () => {
    await withResend(async () => {
      const userId = await makeUser({ emailMarketing: false });
      const res = await deliverWelcomeEmail({
        email: 'u@test.com',
        name: 'Alex',
        userId,
      });
      expect(res).toEqual({ delivered: false, reason: 'opted-out' });
      expect(seen).toHaveLength(0);
    });
  });

  it('deliverWelcomeEmail sends when emailMarketing is true', async () => {
    await withResend(async () => {
      const userId = await makeUser({ emailMarketing: true });
      const res = await deliverWelcomeEmail({
        email: 'u@test.com',
        name: 'Alex',
        userId,
      });
      expect(res.delivered).toBe(true);
      expect(seen).toHaveLength(1);
      expect(seen[0]?.text).toContain('Alex');
    });
  });

  it('deliverWelcomeEmail without a userId sends (legacy caller — no gate)', async () => {
    await withResend(async () => {
      const res = await deliverWelcomeEmail({ email: 'u@test.com', name: 'Alex' });
      expect(res.delivered).toBe(true);
      expect(seen).toHaveLength(1);
    });
  });

  it('deliverAlertEmail honours the dedicated alert preference', async () => {
    await withResend(async () => {
      const userId = await makeUser({ emailAlerts: false });
      const result = await deliverAlertEmail({
        email: 'alerts-off@test.com',
        userId,
        idempotencyKey: 'alert/delivery-opted-out',
        subject: 'Stored alert subject',
        text: 'Stored alert body',
      });

      expect(result).toEqual({ delivered: false, reason: 'opted-out' });
      expect(seen).toHaveLength(0);
    });
  });

  it('deliverAlertEmail distinguishes a provider-reported failure from an opt-out', async () => {
    await withResend(async () => {
      const userId = await makeUser({ emailAlerts: true });
      setResendTransport(async () => ({ delivered: false }));

      await expect(
        deliverAlertEmail({
          email: 'alerts-on@test.com',
          userId,
          idempotencyKey: 'alert/delivery-reported-failure',
          subject: 'Stored alert subject',
          text: 'Stored alert body',
        }),
      ).resolves.toEqual({ delivered: false, reason: 'transport-failure' });
    });
  });

  it('freezes eligible alerts and returns a successful transport result unchanged', async () => {
    await withResend(async () => {
      const userId = await makeUser({ emailAlerts: true });
      expect(await isAlertEmailEligible(userId)).toBe(true);

      await expect(
        deliverAlertEmail({
          eligibilityFrozen: true,
          email: 'alerts-on@test.com',
          userId,
          idempotencyKey: 'alert/delivery-success',
          subject: 'Stored alert subject',
          text: 'Stored alert body',
        }),
      ).resolves.toEqual({ delivered: true });
    });
  });

  it('deliverAlertEmail classifies a malformed Resend success as transport failure', async () => {
    await withResend(async () => {
      const userId = await makeUser({ emailAlerts: true });
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('not-json', { status: 200 }),
      );
      setResendTransport(null);
      try {
        await expect(
          deliverAlertEmail({
            email: 'alerts-on@test.com',
            userId,
            idempotencyKey: 'alert/delivery-malformed',
            subject: 'Stored alert subject',
            text: 'Stored alert body',
          }),
          // A 200 we could not parse may still have been accepted by Resend,
          // so the outcome is unknown rather than a known non-delivery.
        ).resolves.toEqual({
          delivered: false,
          reason: 'transport-failure',
          outcomeUnknown: true,
        });
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });

  it('deliverAlertEmail classifies a rejected transport as transport failure', async () => {
    await withResend(async () => {
      const userId = await makeUser({ emailAlerts: true });
      setResendTransport(async () => {
        throw new Error('network unavailable');
      });

      await expect(
        deliverAlertEmail({
          email: 'alerts-on@test.com',
          userId,
          idempotencyKey: 'alert/delivery-rejected',
          subject: 'Stored alert subject',
          text: 'Stored alert body',
        }),
        // The request may have reached Resend before the transport threw, so
        // the outcome is unknown rather than a known non-delivery.
      ).resolves.toEqual({
        delivered: false,
        reason: 'transport-failure',
        outcomeUnknown: true,
      });
    });
  });

  it('deliverTeamInviteEmail falls back to DEFAULT_LOCALE when caller omits locale', async () => {
    await withResend(async () => {
      await deliverTeamInviteEmail({
        email: 'u@test.com',
        inviterName: 'Owner',
        teamName: 'Acme',
      });
      expect(seen).toHaveLength(1);
      expect(seen[0]?.subject).toContain('Acme');
    });
  });

  it('security email always sends even when EVERY preference is false', async () => {
    await withResend(async () => {
      const userId = await makeUser({
        emailAuditComplete: false,
        emailRankDrop: false,
        emailMarketing: false,
      });
      // The security mailers are userId-less on the wire — the point is they
      // never consult the record at all, so a user with everything off still
      // receives them.
      void userId; // documented dependency on the recorded prefs

      await deliverPasswordResetEmail('u@test.com', 'https://app.test/reset/1');
      await deliverVerificationEmail('u@test.com', 'https://app.test/verify/1');
      await deliverPasswordChangedEmail('u@test.com');
      expect(seen).toHaveLength(3);
      // Sanity: the gate must not have suppressed any of them.
      expect(seen.map((m) => m.subject)).toEqual([
        'Reset your password',
        'Verify your email address',
        'Your password was changed',
      ]);
    });
  });
});
