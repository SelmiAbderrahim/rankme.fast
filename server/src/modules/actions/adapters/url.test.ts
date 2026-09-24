import { describe, expect, it } from 'vitest';
import { ACTION_MAX_AFFECTED_URLS } from '../actions.orders.js';
import { canonicalizeAffectedUrls } from './url.js';

describe('canonicalizeAffectedUrls', () => {
  it('keeps http(s) URLs and drops unparseable values', () => {
    expect(
      canonicalizeAffectedUrls([
        'https://example.com/a',
        'http://example.com/b',
        'not a url',
        '',
        '/relative/path',
      ]),
    ).toEqual(['https://example.com/a', 'http://example.com/b']);
  });

  it('rejects non-http schemes', () => {
    expect(
      canonicalizeAffectedUrls([
        'javascript:alert(1)',
        'data:text/html,x',
        'file:///etc/passwd',
        'ftp://example.com/x',
        'https://safe.example/x',
      ]),
    ).toEqual(['https://safe.example/x']);
  });

  it('strips fragments and embedded credentials', () => {
    expect(
      canonicalizeAffectedUrls(['https://user:pass@example.com/page#section']),
    ).toEqual(['https://example.com/page']);
  });

  it('dedupes canonically-equal URLs preserving first-seen order', () => {
    expect(
      canonicalizeAffectedUrls([
        'https://example.com/a#one',
        'https://example.com/a#two',
        'https://example.com/b',
        'https://example.com/a',
      ]),
    ).toEqual(['https://example.com/a', 'https://example.com/b']);
  });

  it('caps output at ACTION_MAX_AFFECTED_URLS', () => {
    const urls = Array.from(
      { length: ACTION_MAX_AFFECTED_URLS + 5 },
      (_, i) => `https://example.com/page-${i}`,
    );
    const out = canonicalizeAffectedUrls(urls);
    expect(out).toHaveLength(ACTION_MAX_AFFECTED_URLS);
    expect(out[0]).toBe('https://example.com/page-0');
  });

  it('returns an empty array for empty input', () => {
    expect(canonicalizeAffectedUrls([])).toEqual([]);
  });
});
