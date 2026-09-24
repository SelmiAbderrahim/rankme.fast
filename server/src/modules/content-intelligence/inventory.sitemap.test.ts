import { describe, expect, it } from 'vitest';
import {
  SITEMAP_MAX_BYTES,
  SITEMAP_MAX_URLS,
  parseSitemapLocs,
} from './inventory.sitemap.js';

const wrap = (locs: string[]): string =>
  `<?xml version="1.0"?><urlset>${locs
    .map((l) => `<loc>${l}</loc>`)
    .join('')}</urlset>`;

describe('parseSitemapLocs', () => {
  it('extracts valid http(s) URLs in document order, deduped', () => {
    const result = parseSitemapLocs(
      wrap([
        'https://example.com/a',
        'https://example.com/b',
        'https://example.com/a', // duplicate dropped
      ]),
    );
    expect(result.rejected).toBeNull();
    expect(result.truncated).toBe(false);
    expect(result.urls).toEqual(['https://example.com/a', 'https://example.com/b']);
  });

  it('rejects a document with a DOCTYPE declaration (XXE guard)', () => {
    const xml = '<!DOCTYPE foo><urlset><loc>https://example.com/a</loc></urlset>';
    const result = parseSitemapLocs(xml);
    expect(result.rejected).toBe('dtd_forbidden');
    expect(result.urls).toEqual([]);
  });

  it('rejects a document with an ENTITY declaration (XML-bomb guard)', () => {
    const xml =
      '<!ENTITY lol "lollollol"><urlset><loc>https://example.com/a</loc></urlset>';
    const result = parseSitemapLocs(xml);
    expect(result.rejected).toBe('dtd_forbidden');
    expect(result.urls).toEqual([]);
  });

  it('rejects an over-size document by byte cap before parsing', () => {
    const result = parseSitemapLocs('<loc>https://example.com/a</loc>', {
      maxBytes: 4,
    });
    expect(result.rejected).toBe('too_large');
    expect(result.urls).toEqual([]);
  });

  it('never fetches — a non-http(s) scheme is dropped', () => {
    const result = parseSitemapLocs(
      wrap([
        'file:///etc/passwd',
        'ftp://example.com/x',
        'javascript:alert(1)',
        'https://example.com/ok',
      ]),
    );
    expect(result.urls).toEqual(['https://example.com/ok']);
  });

  it('drops an unparseable / empty / over-long loc value', () => {
    const longUrl = `https://example.com/${'x'.repeat(2_100)}`;
    const result = parseSitemapLocs(
      wrap(['not a url', '', longUrl, 'https://example.com/ok']),
    );
    expect(result.urls).toEqual(['https://example.com/ok']);
  });

  it('decodes the five predefined XML entities in a loc', () => {
    const xml = '<urlset><loc>https://example.com/a?x=1&amp;y=2</loc></urlset>';
    const result = parseSitemapLocs(xml);
    expect(result.urls).toEqual(['https://example.com/a?x=1&y=2']);
  });

  it('caps the number of ingested URLs and reports truncation', () => {
    const many = Array.from({ length: 5 }, (_, i) => `https://example.com/p${i}`);
    const result = parseSitemapLocs(wrap(many), { maxUrls: 3 });
    expect(result.urls).toHaveLength(3);
    expect(result.truncated).toBe(true);
  });

  it('stops cleanly when a <loc> is never closed', () => {
    const xml = '<urlset><loc>https://example.com/a</loc><loc>https://example.com/unclosed';
    const result = parseSitemapLocs(xml);
    expect(result.urls).toEqual(['https://example.com/a']);
    expect(result.truncated).toBe(false);
  });

  it('returns an empty list for a document with no <loc> entries', () => {
    const result = parseSitemapLocs('<urlset></urlset>');
    expect(result.urls).toEqual([]);
    expect(result.rejected).toBeNull();
  });

  it('exposes sane default caps', () => {
    expect(SITEMAP_MAX_BYTES).toBeGreaterThan(0);
    expect(SITEMAP_MAX_URLS).toBe(500);
  });
});
