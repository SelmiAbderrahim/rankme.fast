import { afterEach, describe, expect, it } from 'vitest';
import { env } from '../../config/env.js';
import {
  getEmailSenderIdentity,
  isEmailTransportConfigured,
  sendEmail,
} from './email-registry.js';

const original = {
  transport: env.EMAIL_TRANSPORT,
  from: env.RESEND_FROM,
  apiKey: env.RESEND_API_KEY,
};

afterEach(() => {
  (env as { EMAIL_TRANSPORT: string }).EMAIL_TRANSPORT = original.transport;
  (env as { RESEND_FROM?: string }).RESEND_FROM = original.from;
  (env as { RESEND_API_KEY?: string }).RESEND_API_KEY = original.apiKey;
});

describe('getEmailSenderIdentity', () => {
  it('reports the deterministic fake identity when the fake transport is selected', () => {
    (env as { EMAIL_TRANSPORT: string }).EMAIL_TRANSPORT = 'fake';
    expect(getEmailSenderIdentity()).toBe('fake');
    // The fake transport is configured by definition — it needs no credential.
    expect(isEmailTransportConfigured()).toBe(true);
  });

  it('reports the configured live sender, and null when none is set', () => {
    (env as { EMAIL_TRANSPORT: string }).EMAIL_TRANSPORT = 'resend';
    (env as { RESEND_FROM?: string }).RESEND_FROM = 'alerts@rankme.test';
    expect(getEmailSenderIdentity()).toBe('alerts@rankme.test');

    (env as { RESEND_FROM?: string }).RESEND_FROM = undefined;
    expect(getEmailSenderIdentity()).toBeNull();
    // A live transport without both halves of the credential is not configured.
    expect(isEmailTransportConfigured()).toBe(false);
  });

  it('refuses an idempotent replay after the configured sender identity changes', async () => {
    (env as { EMAIL_TRANSPORT: string }).EMAIL_TRANSPORT = 'fake';
    await expect(sendEmail({
      to: 'recipient@example.test',
      subject: 'bounded',
      text: 'safe body',
      expectedSenderIdentity: 'old-sender@example.test',
    })).resolves.toEqual({ delivered: false });
  });
});
