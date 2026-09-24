/**
 * Transactional emails carry the correct Arabic content when
 * locale=ar, placeholders line up across locales, and the mailer transport
 * emits a plain-text fallback and one shared escaped HTML surface.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setResendTransport, type EmailMessage } from './mailers/resend.js';
import {
  deliverPasswordResetEmail,
  deliverVerificationEmail,
  deliverPasswordChangedEmail,
  deliverEmailChangeVerification,
  deliverTeamInviteEmail,
} from './communication.service.js';
import { env } from '../../config/env.js';
import { SUPPORTED_LOCALES } from '../../shared/i18n/index.js';

// Arabic-script codepoint class — used to assert the translated body is
// actually Arabic (never an English fallback leaking through).
const ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-ﻼ]/;

let sent: EmailMessage[];
const originalKey = env.RESEND_API_KEY;
const originalFrom = env.RESEND_FROM;

beforeAll(() => {
  (env as { RESEND_API_KEY?: string }).RESEND_API_KEY = 'test-key';
  (env as { RESEND_FROM?: string }).RESEND_FROM = 'noreply@example.com';
});

afterAll(() => {
  setResendTransport(null);
  (env as { RESEND_API_KEY?: string }).RESEND_API_KEY = originalKey;
  (env as { RESEND_FROM?: string }).RESEND_FROM = originalFrom;
});

beforeEach(() => {
  sent = [];
  setResendTransport(async (msg) => {
    sent.push(msg);
    return { delivered: true };
  });
});

describe('email templates render Arabic content when locale=ar', () => {
  it('deliverPasswordResetEmail(locale=ar) subject and body contain Arabic script', async () => {
    await deliverPasswordResetEmail('user@example.com', 'https://x/reset', 'ar');
    expect(sent).toHaveLength(1);
    const msg = sent[0]!;
    expect(msg.subject).toMatch(ARABIC_RE);
    expect(msg.text ?? '').toMatch(ARABIC_RE);
    // Placeholder interpolated into the body.
    expect(msg.text ?? '').toContain('https://x/reset');
  });

  it('deliverVerificationEmail(locale=ar) subject and body contain Arabic script', async () => {
    await deliverVerificationEmail('user@example.com', 'https://x/verify', 'ar');
    expect(sent).toHaveLength(1);
    const msg = sent[0]!;
    expect(msg.subject).toMatch(ARABIC_RE);
    expect(msg.text ?? '').toMatch(ARABIC_RE);
    expect(msg.text ?? '').toContain('https://x/verify');
  });

  it('deliverPasswordChangedEmail(locale=ar) is Arabic', async () => {
    await deliverPasswordChangedEmail('user@example.com', 'ar');
    const msg = sent[0]!;
    expect(msg.subject).toMatch(ARABIC_RE);
    expect(msg.text ?? '').toMatch(ARABIC_RE);
  });

  it('deliverEmailChangeVerification(locale=ar) is Arabic and carries the verify URL', async () => {
    await deliverEmailChangeVerification('new@example.com', 'https://x/change', 'ar');
    const msg = sent[0]!;
    expect(msg.subject).toMatch(ARABIC_RE);
    expect(msg.text ?? '').toMatch(ARABIC_RE);
    expect(msg.text ?? '').toContain('https://x/change');
  });

  it('deliverTeamInviteEmail(locale=ar) is Arabic and carries the interpolated team name', async () => {
    await deliverTeamInviteEmail({
      email: 'invitee@example.com',
      inviterName: 'مالك الحساب',
      teamName: 'فريق التسويق',
      link: 'https://x/invite/abc',
      locale: 'ar',
    });
    const msg = sent[0]!;
    expect(msg.subject).toMatch(ARABIC_RE);
    expect(msg.text ?? '').toContain('فريق التسويق');
    expect(msg.text ?? '').toContain('مالك الحساب');
    expect(msg.text ?? '').toContain('https://x/invite/abc');
  });
});

describe('shared email HTML is escaped and RTL-aware', () => {
  it('wraps security mail and the team invitation in the same Arabic shell', async () => {
    await deliverPasswordResetEmail('u@x', 'https://x/reset', 'ar');
    await deliverVerificationEmail('u@x', 'https://x/verify', 'ar');
    await deliverPasswordChangedEmail('u@x', 'ar');
    await deliverEmailChangeVerification('u@x', 'https://x/change', 'ar');
    await deliverTeamInviteEmail({
      email: 'u@x',
      inviterName: 'A',
      teamName: 'B',
      link: 'https://x/i',
      locale: 'ar',
    });
    expect(sent.every((msg) => msg.html?.startsWith('<!doctype html>'))).toBe(true);
    expect(sent.every((msg) => msg.html?.includes('<html lang="ar" dir="rtl">'))).toBe(true);
    expect(sent.every((msg) => msg.html?.includes('RankMeFast'))).toBe(true);
    expect(sent[4]?.html).toContain('href="https://x/i"');
    expect(sent[4]?.html).toMatch(/dir="rtl"/u);
    expect(sent.every((msg) => typeof msg.text === 'string')).toBe(true);
  });

  it.each(SUPPORTED_LOCALES)('sets lang and direction for %s security mail', async (locale) => {
    await deliverPasswordChangedEmail('u@x', locale);
    expect(sent[0]?.html).toContain(`lang="${locale}"`);
    expect(sent[0]?.html).toContain(`dir="${locale === 'ar' ? 'rtl' : 'ltr'}"`);
  });

  it('hostile team name stays literal in text and is escaped in HTML', async () => {
    const HOSTILE = '<script>alert(1)</script>';
    await deliverTeamInviteEmail({
      email: 'invitee@example.com',
      inviterName: 'Owner',
      teamName: HOSTILE,
      link: 'https://x/invite/z',
      locale: 'en',
    });
    const msg = sent[0]!;
    expect(msg.text ?? '').toContain(HOSTILE);
    expect(msg.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(msg.html).not.toContain(HOSTILE);
  });
});
