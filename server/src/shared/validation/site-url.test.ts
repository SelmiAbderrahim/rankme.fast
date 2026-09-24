import { describe, expect, it } from 'vitest';
import {
  SITE_URL_MAX_LENGTH,
  validateSiteUrl,
  type SiteUrlRejectReason,
} from './site-url.js';

describe('validateSiteUrl — accepts', () => {
  it.each([
    ['plain https', 'https://example.com', 'https://example.com', 'example.com'],
    ['plain http', 'http://example.com', 'http://example.com', 'example.com'],
    ['subdomain', 'https://app.staging.example.com', 'https://app.staging.example.com', 'app.staging.example.com'],
    ['uppercase scheme + host + default port', 'HTTPS://Example.COM:443/', 'https://example.com', 'example.com'],
    ['default http port stripped', 'http://example.com:80/', 'http://example.com', 'example.com'],
    ['non-default port kept', 'https://example.com:8443', 'https://example.com:8443', 'example.com'],
    ['path dropped (origin only)', 'https://example.com/some/deep/path', 'https://example.com', 'example.com'],
    ['trailing slash stripped', 'https://example.com/', 'https://example.com', 'example.com'],
    ['query + hash dropped', 'https://example.com/?a=1#frag', 'https://example.com', 'example.com'],
    ['surrounding whitespace trimmed', '  https://example.com  ', 'https://example.com', 'example.com'],
    ['IDN domain punycoded', 'https://münchen.de', 'https://xn--mnchen-3ya.de', 'xn--mnchen-3ya.de'],
  ])('%s', (_label, input, url, domain) => {
    expect(validateSiteUrl(input)).toEqual({ ok: true, url, domain });
  });
});

describe('validateSiteUrl — rejects', () => {
  it.each<[string, string, SiteUrlRejectReason]>([
    ['empty string', '', 'required'],
    ['whitespace only', '   ', 'required'],
    ['over 2048 chars', `https://example.com/${'a'.repeat(SITE_URL_MAX_LENGTH)}`, 'tooLong'],
    ['unparseable', 'http://', 'invalid'],
    ['no scheme', 'example.com', 'invalid'],
    ['spaces inside', 'https://exa mple.com', 'invalid'],
    ['data scheme', 'data:text/html,hello', 'scheme'],
    ['javascript scheme', 'javascript:alert(1)', 'scheme'],
    ['file scheme', 'file:///etc/passwd', 'scheme'],
    ['ftp scheme', 'ftp://example.com', 'scheme'],
    ['userinfo user:pass', 'https://user:pass@example.com', 'userinfo'],
    ['userinfo user only', 'https://user@example.com', 'userinfo'],
    ['userinfo password only', 'https://:pass@example.com', 'userinfo'],
    ['IPv4 literal', 'https://192.168.1.1', 'ipLiteral'],
    ['IPv4 literal with port', 'http://10.0.0.1:8080', 'ipLiteral'],
    ['IPv6 literal', 'https://[::1]', 'ipLiteral'],
    ['IPv6 literal full', 'http://[2001:db8::1]:80', 'ipLiteral'],
    ['no TLD', 'https://intranet', 'noTld'],
    ['localhost rejected by default', 'http://localhost:3000', 'noTld'],
  ])('%s', (_label, input, reason) => {
    expect(validateSiteUrl(input)).toEqual({ ok: false, reason });
  });

  it('rejects a dotless host even with allowLocalhost when it is not localhost', () => {
    expect(validateSiteUrl('https://intranet', { allowLocalhost: true })).toEqual({
      ok: false,
      reason: 'noTld',
    });
  });

  it('accepts localhost only when explicitly allowed (test env escape hatch)', () => {
    expect(validateSiteUrl('http://localhost:3000', { allowLocalhost: true })).toEqual({
      ok: true,
      url: 'http://localhost:3000',
      domain: 'localhost',
    });
  });
});
