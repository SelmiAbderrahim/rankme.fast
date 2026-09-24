import { describe, expect, it } from 'vitest';
import {
  SITE_URL_MAX_LENGTH,
  REASON_TO_MESSAGE_KEY,
  buildAddSiteSchema,
  validateSiteUrl,
  type SiteUrlRejectReason,
} from './validation';

describe('validateSiteUrl (client mirror) — accepts', () => {
  it.each([
    ['plain https', 'https://example.com', 'https://example.com', 'example.com'],
    ['plain http', 'http://example.com', 'http://example.com', 'example.com'],
    ['subdomain', 'https://app.staging.example.com', 'https://app.staging.example.com', 'app.staging.example.com'],
    ['uppercase + default port', 'HTTPS://Example.COM:443/', 'https://example.com', 'example.com'],
    ['non-default port kept', 'https://example.com:8443', 'https://example.com:8443', 'example.com'],
    ['path/query/hash dropped', 'https://example.com/a/b?q=1#x', 'https://example.com', 'example.com'],
    ['whitespace trimmed', '  https://example.com  ', 'https://example.com', 'example.com'],
    ['IDN punycoded', 'https://münchen.de', 'https://xn--mnchen-3ya.de', 'xn--mnchen-3ya.de'],
  ])('%s', (_label, input, url, domain) => {
    expect(validateSiteUrl(input)).toEqual({ ok: true, url, domain });
  });
});

describe('validateSiteUrl (client mirror) — rejects', () => {
  it.each<[string, string, SiteUrlRejectReason]>([
    ['empty', '', 'required'],
    ['whitespace only', '   ', 'required'],
    ['over 2048 chars', `https://example.com/${'a'.repeat(SITE_URL_MAX_LENGTH)}`, 'tooLong'],
    ['unparseable', 'http://', 'invalid'],
    ['no scheme', 'example.com', 'invalid'],
    ['data scheme', 'data:text/html,x', 'scheme'],
    ['javascript scheme', 'javascript:alert(1)', 'scheme'],
    ['file scheme', 'file:///etc/passwd', 'scheme'],
    ['userinfo', 'https://user:pass@example.com', 'userinfo'],
    ['userinfo password only', 'https://:pass@example.com', 'userinfo'],
    ['IPv4 literal', 'https://10.0.0.1', 'ipLiteral'],
    ['IPv6 literal', 'http://[::1]', 'ipLiteral'],
    ['no TLD', 'https://intranet', 'noTld'],
    ['localhost always rejected on the client', 'http://localhost:3000', 'noTld'],
  ])('%s', (_label, input, reason) => {
    expect(validateSiteUrl(input)).toEqual({ ok: false, reason });
  });

  it('covers every reject reason with an i18n key', () => {
    const reasons: SiteUrlRejectReason[] = [
      'required',
      'tooLong',
      'invalid',
      'scheme',
      'userinfo',
      'ipLiteral',
      'noTld',
    ];
    for (const reason of reasons) {
      expect(REASON_TO_MESSAGE_KEY[reason]).toMatch(/^errors\./);
    }
  });
});

describe('validateSiteUrl — unreachable empty-hostname guard (branch coverage)', () => {
  it('returns invalid when URL constructor yields empty hostname (mocked)', () => {
    // The WHATWG URL API never produces an empty hostname for http/https — this
    // branch exists as a defence.  We mock the global URL constructor once to
    // return a fake object that bypasses all earlier guards so the empty-hostname
    // `if` branch is reachable in the coverage instrumentation.
    const OrigURL = globalThis.URL;
    globalThis.URL = function MockURL(input: string) {
      const real = new OrigURL(input);
      // For this one specific sentinel URL, return a fake with empty hostname
      if (input.startsWith('https://sentinel-empty-host.example')) {
        return {
          protocol: 'https:',
          origin: 'https://sentinel-empty-host.example',
          username: '',
          password: '',
          hostname: '',
          href: input,
        };
      }
      return real;
    } as unknown as typeof URL;
    try {
      expect(validateSiteUrl('https://sentinel-empty-host.example')).toEqual({
        ok: false,
        reason: 'invalid',
      });
    } finally {
      globalThis.URL = OrigURL;
    }
  });
});

describe('buildAddSiteSchema', () => {
  const t = (key: string) => `t:${key}`;
  const schema = buildAddSiteSchema(t);

  it('passes a valid URL through unchanged', () => {
    const parsed = schema.safeParse({ url: 'https://example.com' });
    expect(parsed.success).toBe(true);
  });

  it('maps reject reasons to translated messages', () => {
    const parsed = schema.safeParse({ url: 'ftp://example.com' });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toBe('t:errors.urlScheme');
    }
  });
});
