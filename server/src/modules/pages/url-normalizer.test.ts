import { describe, expect, it, vi } from 'vitest';
import { canonicalizePageUrl, PAGE_URL_MAX_BYTES } from './url-normalizer.js';

describe('canonicalizePageUrl', () => {
  it('converges scheme, host case, www, default ports, fragments, and query ordering', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const result = canonicalizePageUrl(
      'http://EXAMPLE.com:80/a/../Path/?z=2&a=3&a=1#section',
      'https://www.example.com',
    );
    expect(result).toEqual({
      ok: true,
      value: {
        canonicalUrl: 'https://www.example.com/Path/?a=1&a=3&z=2',
        displayUrl: 'www.example.com/Path/?a=1&a=3&z=2',
        pageHash: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('orders duplicate query keys by values and preserves equal pairs', () => {
    expect(canonicalizePageUrl(
      'https://example.com/path?b=0&a=2&a=1&a=1',
      'https://example.com',
    )).toMatchObject({
      ok: true,
      value: { canonicalUrl: 'https://example.com/path?a=1&a=1&a=2&b=0' },
    });
  });

  it('uses the full stable SHA-256 digest and preserves trailing-slash distinctions', () => {
    expect(canonicalizePageUrl('https://example.com', 'https://example.com')).toEqual({
      ok: true,
      value: {
        canonicalUrl: 'https://example.com/',
        displayUrl: 'example.com/',
        pageHash: 'DxFdsGK3wN0DCxaHjJnepcNUtJ3DezjriEYXnHeD6dc',
      },
    });
    const withoutSlash = canonicalizePageUrl(
      'https://example.com/docs',
      'https://example.com',
    );
    const withSlash = canonicalizePageUrl(
      'https://example.com/docs/',
      'https://example.com',
    );
    expect(withoutSlash.ok && withoutSlash.value.pageHash).not.toBe(
      withSlash.ok && withSlash.value.pageHash,
    );
  });

  it('matches IDNs by their ASCII host and follows the stored www policy', () => {
    expect(
      canonicalizePageUrl('https://www.bücher.example/seite', 'https://xn--bcher-kva.example'),
    ).toMatchObject({
      ok: true,
      value: { canonicalUrl: 'https://xn--bcher-kva.example/seite' },
    });
    expect(
      canonicalizePageUrl('https://bücher.example/seite', 'https://www.xn--bcher-kva.example'),
    ).toMatchObject({
      ok: true,
      value: { canonicalUrl: 'https://www.xn--bcher-kva.example/seite' },
    });
  });

  it.each([
    ['https://blog.example.com/', 'offsite_url'],
    ['https://example.com.evil.test/', 'offsite_url'],
    ['https://example.test/', 'offsite_url'],
    ['https://exаmple.com/', 'offsite_url'],
    ['https://127.0.0.1/', 'offsite_url'],
    ['https://[::1]/', 'offsite_url'],
    ['https://example.com:8443/', 'offsite_url'],
    ['https://user:pass@example.com/', 'malformed_url'],
    ['https://:pass@example.com/', 'malformed_url'],
    ['ftp://example.com/', 'malformed_url'],
    ['//example.com/path', 'malformed_url'],
    ['/relative', 'malformed_url'],
    ['not a url', 'malformed_url'],
    ['', 'malformed_url'],
  ] as const)('rejects %s as %s', (candidate, reason) => {
    expect(canonicalizePageUrl(candidate, 'https://example.com')).toEqual({ ok: false, reason });
  });

  it('requires an explicit stored custom port and bounds raw and canonical UTF-8 bytes', () => {
    expect(
      canonicalizePageUrl('http://example.com:8443/path', 'https://example.com:8443'),
    ).toMatchObject({ ok: true });
    expect(canonicalizePageUrl('https://example.com/path', 'https://example.com:8443')).toEqual({
      ok: false,
      reason: 'offsite_url',
    });
    expect(
      canonicalizePageUrl(`https://example.com/${'é'.repeat(PAGE_URL_MAX_BYTES)}`, 'https://example.com'),
    ).toEqual({ ok: false, reason: 'malformed_url' });
    expect(
      canonicalizePageUrl(`https://example.com/${'é'.repeat(500)}`, 'https://example.com'),
    ).toEqual({ ok: false, reason: 'malformed_url' });
    expect(canonicalizePageUrl('https://example.com', 'invalid stored url')).toEqual({
      ok: false,
      reason: 'malformed_url',
    });
  });
});
