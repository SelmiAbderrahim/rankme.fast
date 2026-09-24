/**
 * Content-monitoring notification tests. Proves the material-change
 * alert freezes recipient, preference eligibility, sender, and localized body
 * before delegating to the mailer. The mailer is mocked so no email is sent.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import { SUPPORTED_LOCALES } from '../../shared/i18n/index.js';
import { User } from '../users/index.js';

const deliverMonitorChangeEmail = vi.fn();
const shouldSendNotification = vi.fn();
vi.mock('../communication/index.js', () => ({
  deliverMonitorChangeEmail: (...args: unknown[]) => deliverMonitorChangeEmail(...args),
  getEmailSenderIdentity: () => 'RankMeFast <no-reply@rankme.test>',
  resolveRecipientLocale: (input: { artifactLocale?: string }) => input.artifactLocale ?? 'en',
  shouldSendNotification: (...args: unknown[]) => shouldSendNotification(...args),
}));

const {
  monitoringDashboardUrl,
  monitorNotificationRequestFingerprint,
  monitorTargetDisplayLabel,
  notifyMonitorMaterialChange,
  prepareMonitorMaterialChangeNotification,
} = await import('./monitoring.notifications.js');

const SITE = '000000000000000000000def';

function frozenRequest<T extends {
  locale: 'en' | 'ar' | 'fr' | 'de' | 'es' | 'ru' | 'zh';
  recipientEmail: string | null;
  senderIdentity: string | null;
  subject: string;
  text: string;
  html: string;
  idempotencyKey: string;
}>(input: T): T & { requestFingerprint: string } {
  return {
    ...input,
    requestFingerprint: monitorNotificationRequestFingerprint(input),
  };
}

beforeAll(async () => {
  await startMemoryMongo();
});
afterAll(async () => {
  await stopMemoryMongo();
});
beforeEach(() => {
  deliverMonitorChangeEmail.mockReset();
  shouldSendNotification.mockReset().mockResolvedValue(true);
});
afterEach(async () => {
  await clearCollections();
});

describe('monitoringDashboardUrl', () => {
  it('builds a deep link into the monitoring sub-view', () => {
    const url = monitoringDashboardUrl(SITE);
    expect(url).toContain(`/sites/${SITE}`);
    expect(url).toContain('tab=content');
    expect(url).toContain('view=monitoring');
    // No double slash before /sites.
    expect(url).not.toMatch(/[^:]\/\/sites/);
  });

  it('keeps accepted 2048-character targets out of bounded subject/body labels', () => {
    const target = `https://example.com/${'a'.repeat(2028)}`;
    expect(target).toHaveLength(2048);
    const label = monitorTargetDisplayLabel(target);
    expect(label).toHaveLength(240);
    expect(label.endsWith('…')).toBe(true);
    expect(monitorTargetDisplayLabel('https://example.com/page')).toBe(
      'https://example.com/page',
    );
  });
});

describe('material-change notification freezing', () => {
  it.each(SUPPORTED_LOCALES)('freezes %s HTML direction and locale-prefixed links', async (locale) => {
    const user = await User.create({
      email: `${locale}@example.com`,
      emailVerified: true,
    });
    const prepared = await prepareMonitorMaterialChangeNotification({
      ownerUserId: String(user._id),
      siteId: SITE,
      targetUrl: 'https://example.com/page',
      locale,
    });
    expect(prepared.locale).toBe(locale);
    expect(prepared.html).toContain(`lang="${locale}"`);
    expect(prepared.html).toContain(`dir="${locale === 'ar' ? 'rtl' : 'ltr'}"`);
    if (locale !== 'en') expect(prepared.text).toContain(`/${locale}/sites/`);
  });

  it('freezes an explicit no-recipient suppression when the owner is gone', async () => {
    const prepared = await prepareMonitorMaterialChangeNotification({
      ownerUserId: '000000000000000000000fff',
      siteId: SITE,
      targetUrl: 'https://example.com/page',
      locale: 'en',
    });
    expect(prepared).toEqual(
      expect.objectContaining({
        recipientEmail: null,
        senderIdentity: 'RankMeFast <no-reply@rankme.test>',
        suppressionReason: 'no-recipient',
      }),
    );
    const result = await notifyMonitorMaterialChange(frozenRequest({
      ownerUserId: '000000000000000000000fff',
      ...prepared,
      idempotencyKey: 'content-monitor/missing-owner',
    }));
    expect(result).toEqual({ delivered: false, reason: 'no-recipient' });
    expect(deliverMonitorChangeEmail).not.toHaveBeenCalled();
  });

  it('replays the exact frozen eligible payload after the owner email changes', async () => {
    const user = await User.create({ email: 'owner@example.com', emailVerified: true });
    const prepared = await prepareMonitorMaterialChangeNotification({
      ownerUserId: String(user._id),
      siteId: SITE,
      targetUrl: 'https://example.com/page',
      locale: 'fr',
    });
    await User.updateOne({ _id: user._id }, { $set: { email: 'new@example.com' } });
    deliverMonitorChangeEmail.mockResolvedValue({ delivered: true });
    const result = await notifyMonitorMaterialChange(frozenRequest({
      ownerUserId: String(user._id),
      ...prepared,
      idempotencyKey: 'content-monitor/french-owner',
    }));
    expect(result).toEqual({ delivered: true });
    expect(deliverMonitorChangeEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'owner@example.com',
        senderIdentity: 'RankMeFast <no-reply@rankme.test>',
        idempotencyKey: 'content-monitor/french-owner',
        subject: prepared.subject,
        text: prepared.text,
        locale: 'fr',
      }),
    );
    expect(prepared.text).toContain('view=monitoring');
  });

  it('freezes opt-out and never rechecks it during replay', async () => {
    const user = await User.create({ email: 'muted@example.com', emailVerified: true });
    shouldSendNotification.mockResolvedValue(false);
    const prepared = await prepareMonitorMaterialChangeNotification({
      ownerUserId: String(user._id),
      siteId: SITE,
      targetUrl: 'https://example.com/page',
      locale: 'en',
    });
    shouldSendNotification.mockResolvedValue(true);
    const result = await notifyMonitorMaterialChange(frozenRequest({
      ownerUserId: String(user._id),
      ...prepared,
      idempotencyKey: 'content-monitor/muted-owner',
    }));
    expect(result).toEqual({ delivered: false, reason: 'opted-out' });
    expect(deliverMonitorChangeEmail).not.toHaveBeenCalled();
    expect(shouldSendNotification).toHaveBeenCalledOnce();
  });

  it('fails closed when an eligible frozen payload has no recipient', async () => {
    await expect(
      notifyMonitorMaterialChange(frozenRequest({
        ownerUserId: '000000000000000000000fff',
        recipientEmail: null,
        senderIdentity: 'RankMeFast <no-reply@rankme.test>',
        suppressionReason: null,
        subject: 'Page changed',
         text: 'Review the monitored page in RankMeFast.',
         html: '<html lang="en" dir="ltr"><body>Review the monitored page in RankMeFast.</body></html>',
         locale: 'en',
         idempotencyKey: 'content-monitor/malformed-recipient',
       })),
    ).rejects.toThrow('eligible content-monitor notification is missing its recipient');
    expect(deliverMonitorChangeEmail).not.toHaveBeenCalled();
  });

  it('fails closed before delivery when the frozen request fingerprint drifts', async () => {
    const request = frozenRequest({
      ownerUserId: '000000000000000000000fff',
      recipientEmail: 'owner@example.com',
      senderIdentity: 'RankMeFast <no-reply@rankme.test>',
      suppressionReason: null,
      subject: 'Page changed',
      text: 'Review the monitored page in RankMeFast.',
      html: '<html lang="en" dir="ltr"><body>Review the monitored page in RankMeFast.</body></html>',
      locale: 'en',
      idempotencyKey: 'content-monitor/fingerprint-drift',
    });
    request.requestFingerprint = `request-hmac-v1:${'0'.repeat(64)}`;
    await expect(notifyMonitorMaterialChange(request)).rejects.toThrow(
      'content-monitor notification request fingerprint drifted',
    );
    expect(deliverMonitorChangeEmail).not.toHaveBeenCalled();
  });

  it('preserves a classified delivery failure reason', async () => {
    deliverMonitorChangeEmail.mockResolvedValueOnce({
      delivered: false,
      reason: 'transport-failure',
    });
    await expect(
      notifyMonitorMaterialChange(frozenRequest({
        ownerUserId: '000000000000000000000fff',
        recipientEmail: 'owner@example.com',
        senderIdentity: 'RankMeFast <no-reply@rankme.test>',
        suppressionReason: null,
        subject: 'Page changed',
         text: 'Review the monitored page in RankMeFast.',
         html: '<html lang="en" dir="ltr"><body>Review the monitored page in RankMeFast.</body></html>',
         locale: 'en',
         idempotencyKey: 'content-monitor/transport-failure',
       })),
    ).resolves.toEqual({ delivered: false, reason: 'transport-failure' });
  });
});
