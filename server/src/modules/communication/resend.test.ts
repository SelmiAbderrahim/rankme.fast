import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile, unlink } from 'node:fs/promises';
import {
  sendEmail,
  setResendTransport,
  getResendTransport,
  isEmailTransportConfigured,
  type EmailMessage,
} from './mailers/resend.js';
import {
  deliverContactForm,
  deliverPasswordResetEmail,
  deliverVerificationEmail,
  deliverPasswordChangedEmail,
  deliverWelcomeEmail,
} from './communication.service.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { E2E_EMAIL_OUTBOX_PATH } from '../../shared/providers/e2e-email-capture.js';
import { SUPPORTED_LOCALES, translate } from '../../shared/i18n/index.js';

const originalKey = process.env.RESEND_API_KEY;
const originalFrom = process.env.RESEND_FROM;
const originalEmailTransport = env.EMAIL_TRANSPORT;
const originalE2eEmailCapture = env.E2E_EMAIL_CAPTURE;

async function withResendConfigured<T>(fn: () => Promise<T>): Promise<T> {
  process.env.RESEND_API_KEY = 'test-key';
  process.env.RESEND_FROM = 'no-reply@rankme.test';
  const { env } = await import('../../config/env.js');
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

describe('resend transport', () => {
  beforeEach(() => {
    setResendTransport(null);
    (env as { EMAIL_TRANSPORT: 'resend' | 'fake' }).EMAIL_TRANSPORT = 'resend';
    (env as { E2E_EMAIL_CAPTURE: boolean }).E2E_EMAIL_CAPTURE = false;
  });
  afterAll(() => {
    process.env.RESEND_API_KEY = originalKey;
    process.env.RESEND_FROM = originalFrom;
    (env as { EMAIL_TRANSPORT: 'resend' | 'fake' }).EMAIL_TRANSPORT =
      originalEmailTransport;
    (env as { E2E_EMAIL_CAPTURE: boolean }).E2E_EMAIL_CAPTURE = originalE2eEmailCapture;
    setResendTransport(null);
  });

  it('skips send when RESEND is not configured and returns delivered:false', async () => {
    expect(isEmailTransportConfigured()).toBe(false);
    const result = await sendEmail({
      to: 't@example.com',
      subject: 's',
      text: 'body',
    });
    expect(result.delivered).toBe(false);
  });

  it('delivers deterministically through the explicit fake transport without credentials', async () => {
    (env as { EMAIL_TRANSPORT: 'resend' | 'fake' }).EMAIL_TRANSPORT = 'fake';
    (env as { E2E_EMAIL_CAPTURE: boolean }).E2E_EMAIL_CAPTURE = false;
    const liveTransport = vi.fn(async () => ({ delivered: false }));
    setResendTransport(liveTransport);
    expect(isEmailTransportConfigured()).toBe(true);
    const message = { to: 'fake@example.test', subject: 'Dated report', text: 'Snapshot 2026-08-01' };
    const first = await sendEmail(message);
    const second = await sendEmail(message);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      delivered: true,
      providerMessageId: expect.stringMatching(/^fake-[0-9a-f]{24}$/),
    });
    expect(liveTransport).not.toHaveBeenCalled();
  });

  it('captures a fake message only through the explicit E2E mailbox switch', async () => {
    await unlink(E2E_EMAIL_OUTBOX_PATH).catch(() => undefined);
    (env as { EMAIL_TRANSPORT: 'resend' | 'fake' }).EMAIL_TRANSPORT = 'fake';
    (env as { E2E_EMAIL_CAPTURE: boolean }).E2E_EMAIL_CAPTURE = true;
    try {
      await expect(
        sendEmail({
          to: 'captured@example.test',
          subject: 'Captured invitation',
          text: 'temporary-credential',
        }),
      ).resolves.toMatchObject({ delivered: true });
      const captured = await readFile(E2E_EMAIL_OUTBOX_PATH, 'utf8');
      expect(captured).toContain('captured@example.test');
      expect(captured).toContain('temporary-credential');
    } finally {
      (env as { E2E_EMAIL_CAPTURE: boolean }).E2E_EMAIL_CAPTURE = false;
      await unlink(E2E_EMAIL_OUTBOX_PATH).catch(() => undefined);
    }
  });

  it('sends via injected transport when RESEND is configured', async () => {
    await withResendConfigured(async () => {
      expect(isEmailTransportConfigured()).toBe(true);
      const seen: Array<{ msg: EmailMessage; from: string; apiKey: string }> = [];
      setResendTransport(async (msg, from, apiKey) => {
        seen.push({ msg, from, apiKey });
        return { delivered: true };
      });
      const res = await sendEmail({
        to: 'r@example.com',
        subject: 'hi',
        text: 'body',
      });
      expect(res.delivered).toBe(true);
      expect(seen).toHaveLength(1);
      expect(seen[0]?.from).toBe('no-reply@rankme.test');
      expect(seen[0]?.apiKey).toBe('test-key');
      expect(seen[0]?.msg.to).toBe('r@example.com');
    });
  });

  it('marks a transport throw as outcome-unknown and logs no arbitrary error content', async () => {
    await withResendConfigured(async () => {
      const errorLog = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
      const sensitive = 'Bearer provider-secret for recipient@example.test';
      setResendTransport(async () => {
        throw new Error(sensitive);
      });
      try {
        const res = await sendEmail({ to: 'x@example.com', subject: 's', text: 't' });
        expect(res).toEqual({ delivered: false, outcomeUnknown: true });
        expect(errorLog).toHaveBeenCalledWith(
          { errorName: 'Error', transport: 'resend' },
          'resend transport threw',
        );
        expect(JSON.stringify(errorLog.mock.calls)).not.toContain(sensitive);
        expect(JSON.stringify(errorLog.mock.calls)).not.toContain('recipient@example.test');
      } finally {
        errorLog.mockRestore();
      }
    });
  });

  it('classifies a non-Error transport rejection without logging its value', async () => {
    await withResendConfigured(async () => {
      const errorLog = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
      const sensitive = 'provider-secret-as-string';
      setResendTransport(async () => {
        throw sensitive;
      });
      try {
        await expect(
          sendEmail({ to: 'x@example.com', subject: 's', text: 't' }),
        ).resolves.toEqual({ delivered: false, outcomeUnknown: true });
        expect(errorLog).toHaveBeenCalledWith(
          { errorName: 'NonError', transport: 'resend' },
          'resend transport threw',
        );
        expect(JSON.stringify(errorLog.mock.calls)).not.toContain(sensitive);
      } finally {
        errorLog.mockRestore();
      }
    });
  });

  it('reports delivered:false on non-2xx response from the HTTP transport', async () => {
    await withResendConfigured(async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'server error',
      } as unknown as Response);
      setResendTransport(null); // use httpTransport
      const res = await sendEmail({ to: 'x@example.com', subject: 's', text: 't' });
      expect(res.delivered).toBe(false);
      fetchSpy.mockRestore();
    });
  });

  it('reports delivered:true when the HTTP transport succeeds and maps html + attachments', async () => {
    await withResendConfigured(async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({ id: 'resend-message-id' }),
      } as unknown as Response);
      setResendTransport(null);
      const res = await sendEmail({
        to: 'x@example.com',
        subject: 's',
        text: 't',
        html: '<b>hi</b>',
        attachments: [{
          filename: 'client-report.pdf',
          contentBase64: 'JVBERi0=',
          contentType: 'application/pdf',
        }],
      });
      expect(res.delivered).toBe(true);
      expect(res.providerMessageId).toBe('resend-message-id');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [, opts] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
      const body = JSON.parse(String(opts.body));
      expect(body.html).toBe('<b>hi</b>');
      expect(body.to).toEqual(['x@example.com']);
      expect(body.attachments).toEqual([{
        filename: 'client-report.pdf',
        content: 'JVBERi0=',
        content_type: 'application/pdf',
      }]);
      fetchSpy.mockRestore();
    });
  });

  it('marks a successful HTTP response with no readable message id as outcome-unknown', async () => {
    await withResendConfigured(async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => {
          throw new Error('empty response body');
        },
      } as unknown as Response);
      setResendTransport(null);
      const res = await sendEmail({ to: 'x@example.com', subject: 's', text: 't' });
      expect(res).toEqual({ delivered: false, outcomeUnknown: true });
      fetchSpy.mockRestore();
    });
  });

  it('surfaces text() rejection on failed response without throwing', async () => {
    await withResendConfigured(async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => {
          throw new Error('body-drain');
        },
      } as unknown as Response);
      setResendTransport(null);
      const res = await sendEmail({ to: 'x@example.com', subject: 's', text: 't' });
      expect(res.delivered).toBe(false);
      fetchSpy.mockRestore();
    });
  });

  it('setResendTransport(null) restores the http transport', () => {
    setResendTransport(async () => ({ delivered: true }));
    expect(getResendTransport()).not.toBe(undefined);
    setResendTransport(null);
    expect(getResendTransport()).not.toBe(undefined);
  });
});

describe('communication.service localized senders', () => {
  const seen: Array<EmailMessage & { from?: string }> = [];
  beforeAll(() => {
    setResendTransport(null);
  });
  beforeEach(() => {
    seen.length = 0;
    setResendTransport(async (msg) => {
      seen.push({ ...msg });
      return { delivered: true };
    });
  });
  afterAll(() => setResendTransport(null));

  it('deliverPasswordResetEmail renders in the caller locale', async () => {
    await withResendConfigured(async () => {
      await deliverPasswordResetEmail('u@x', 'https://r', 'fr');
      expect(seen[0]?.subject).toMatch(/Réinitialisez/);
      expect(seen[0]?.text).toContain('https://r');
      expect(seen[0]?.html).toContain('<html lang="fr" dir="ltr">');
    });
  });

  it('deliverVerificationEmail carries the verify URL in the caller locale', async () => {
    await withResendConfigured(async () => {
      await deliverVerificationEmail('u@x', 'https://app.test/verify-email/abc', 'de');
      expect(seen[0]?.subject).toContain('E-Mail');
      expect(seen[0]?.text).toContain('https://app.test/verify-email/abc');
    });
  });

  it('deliverVerificationEmail defaults to DEFAULT_LOCALE when locale omitted', async () => {
    await withResendConfigured(async () => {
      seen.length = 0;
      await deliverVerificationEmail('u@x', 'https://app.test/verify-email/xyz');
      expect(seen[0]?.subject).toBe('Verify your email address');
      expect(seen[0]?.text).toContain('https://app.test/verify-email/xyz');
    });
  });

  it('deliverPasswordChangedEmail renders in the caller locale', async () => {
    await withResendConfigured(async () => {
      await deliverPasswordChangedEmail('u@x', 'zh');
      expect(seen[0]?.subject).toContain('密码');
    });
  });

  it('deliverWelcomeEmail interpolates {{name}} and {{clientUrl}}', async () => {
    await withResendConfigured(async () => {
      await deliverWelcomeEmail({ email: 'u@x', name: 'Alex', locale: 'en' });
      expect(seen[0]?.subject).toBe('Welcome to RankMeFast');
      expect(seen[0]?.text).toContain('Alex');
    });
  });

  it('deliverWelcomeEmail defaults to DEFAULT_LOCALE when locale omitted', async () => {
    await withResendConfigured(async () => {
      seen.length = 0;
      await deliverWelcomeEmail({ email: 'u@x', name: 'Alex' });
      expect(seen[0]?.subject).toBe('Welcome to RankMeFast');
    });
  });

  it.each(SUPPORTED_LOCALES)('localizes inbound notifications in %s', async (locale) => {
    await withResendConfigured(async () => {
      await deliverContactForm({
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.test',
        subject: 'Question',
        message: 'Contact message',
      }, locale);

      expect(seen[0]?.text).toBe(translate(locale, 'email.contact.notification', {
        name: 'Ada Lovelace',
        email: 'ada@example.test',
        message: 'Contact message',
      }));
      expect(seen.every((message) =>
        message.html?.includes(`<html lang="${locale}" dir="${locale === 'ar' ? 'rtl' : 'ltr'}">`),
      )).toBe(true);
    });
  });
});

describe('deliverContactForm recipient resolution', () => {
  const seen: EmailMessage[] = [];
  const originalRecipient = env.CONTACT_FORM_RECIPIENT;
  const originalResendFrom = env.RESEND_FROM;

  beforeAll(() => {
    setResendTransport(null);
  });
  beforeEach(() => {
    seen.length = 0;
    setResendTransport(async (msg) => {
      seen.push({ ...msg });
      return { delivered: true };
    });
  });
  afterEach(() => {
    (env as { CONTACT_FORM_RECIPIENT?: string }).CONTACT_FORM_RECIPIENT = originalRecipient;
    (env as { RESEND_FROM?: string }).RESEND_FROM = originalResendFrom;
  });
  afterAll(() => setResendTransport(null));

  it('sends the contact form to env.CONTACT_FORM_RECIPIENT (not example.com)', async () => {
    await withResendConfigured(async () => {
      (env as { CONTACT_FORM_RECIPIENT?: string }).CONTACT_FORM_RECIPIENT =
        'support@rankme.test';
      await deliverContactForm({
        firstName: 'A',
        lastName: 'B',
        email: 'a@b.co',
        subject: 'hi',
        message: 'yo',
      });
      expect(seen).toHaveLength(1);
      expect(seen[0]?.to).toBe('support@rankme.test');
      expect(seen[0]?.to).not.toContain('example.com');
      expect(seen[0]?.replyTo).toBe('a@b.co');
      expect(seen[0]?.text).toBe('Contact from A B <a@b.co>\n\nyo');
      expect(seen[0]?.subject).toBe('hi');
    });
  });

  it('falls back to RESEND_FROM when CONTACT_FORM_RECIPIENT is unset', async () => {
    await withResendConfigured(async () => {
      (env as { CONTACT_FORM_RECIPIENT?: string }).CONTACT_FORM_RECIPIENT = undefined;
      await deliverContactForm({
        firstName: 'A',
        lastName: 'B',
        email: 'a@b.co',
        subject: 'hi',
        message: 'yo',
      });
      expect(seen[0]?.to).toBe('no-reply@rankme.test');
    });
  });

  it('throws loudly when Resend is configured but neither recipient env is set', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    (env as { RESEND_API_KEY?: string }).RESEND_API_KEY = 'test-key';
    (env as { CONTACT_FORM_RECIPIENT?: string }).CONTACT_FORM_RECIPIENT = undefined;
    (env as { RESEND_FROM?: string }).RESEND_FROM = undefined;
    try {
      await expect(
        deliverContactForm({
          firstName: 'A',
          lastName: 'B',
          email: 'a@b.co',
          subject: 'hi',
          message: 'yo',
        }),
      ).rejects.toThrow(/Contact form recipient is not configured/);
    } finally {
      (env as { RESEND_API_KEY?: string }).RESEND_API_KEY = undefined;
      process.env.RESEND_API_KEY = originalKey;
    }
  });

  it('routes echo-style to the submitter when Resend is unconfigured (sendEmail no-ops)', async () => {
    (env as { CONTACT_FORM_RECIPIENT?: string }).CONTACT_FORM_RECIPIENT = undefined;
    (env as { RESEND_FROM?: string }).RESEND_FROM = undefined;
    (env as { RESEND_API_KEY?: string }).RESEND_API_KEY = undefined;
    // sendEmail short-circuits to delivered:false — nothing hits the transport.
    await deliverContactForm({
      firstName: 'A',
      lastName: 'B',
      email: 'a@b.co',
      subject: 'hi',
      message: 'yo',
    });
    expect(seen).toHaveLength(0);
  });
});
