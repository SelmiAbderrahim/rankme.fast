/**
 * `/on_page/pages` deep fields → vendor-neutral page facts.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { normalizeDeepPageFields } from './onpage-checks.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'testing', 'fixtures', 'dataforseo-onpage');

function items(kase: string): Record<string, unknown>[] {
  const body = JSON.parse(readFileSync(join(FIXTURES, 'pages', `${kase}.json`), 'utf8')) as {
    tasks: { result: { items: Record<string, unknown>[] }[] }[];
  };
  return body.tasks[0]!.result[0]!.items;
}

describe('normalizeDeepPageFields', () => {
  it('recorded crawl: maps the checks, link counts, sizes and social tags of a healthy page', () => {
    const fields = normalizeDeepPageFields(items('json-ld-undetected')[0]);
    expect(fields.checks).toMatchObject({
      clientError: false,
      serverError: false,
      placeholderText: false,
      imagesMissingAlt: true,
      renderBlocking: true,
      urlHasUnusualCharacters: false,
      urlHasParameters: false,
      urlTooLong: false,
      duplicateTitle: false,
      duplicateContent: false,
    });
    expect(fields).toMatchObject({
      clickDepth: 0,
      inboundInternalLinks: 40,
      outboundInternalLinks: 24,
      outboundExternalLinks: 3,
      pageSizeBytes: 119312,
      transferSizeBytes: 0,
      contentEncoding: 'gzip',
      imageCount: 2,
      renderBlockingScripts: 0,
      renderBlockingStylesheets: 1,
      socialTags: { openGraph: true, twitterCard: true },
    });
    // The recorded row timed no first byte (`waiting_time: 0`).
    expect(fields.serverResponseMs).toBeUndefined();
  });

  it('recorded sandbox shape parses (values are placeholders, so only the shape is checked)', () => {
    const fields = normalizeDeepPageFields(items('sandbox-shape')[0]);
    expect(typeof fields).toBe('object');
  });

  it('inverts the pass-phrased URL checks and reads the item-level duplicate flags', () => {
    const [, , , , , , blog] = items('deep-signals');
    const fields = normalizeDeepPageFields(blog);
    expect(fields.checks).toMatchObject({
      urlHasParameters: true,
      urlHasUnusualCharacters: false,
      duplicateTitle: true,
      duplicateContent: true,
      placeholderText: true,
      slowServerResponse: true,
      uncompressed: true,
      canonicalToBroken: true,
      orphan: true,
    });
    expect(fields).toMatchObject({ clickDepth: 6, serverResponseMs: 2400, contentEncoding: null });
    expect(fields.socialTags).toEqual({ openGraph: false, twitterCard: false });
  });

  it('a redirect or error row keeps its checks and depth but no body facts', () => {
    const redirect = items('deep-signals')[1];
    const fields = normalizeDeepPageFields(redirect);
    expect(fields.checks).toMatchObject({ redirects: true });
    expect(fields.clickDepth).toBe(1);
    expect(fields.pageSizeBytes).toBeUndefined();
    expect(fields.contentEncoding).toBeUndefined();
    expect(fields.socialTags).toBeUndefined();
    expect(fields.serverResponseMs).toBeUndefined();
  });

  it('omitted fields stay absent, never false', () => {
    expect(normalizeDeepPageFields({ url: 'https://example.com/', status_code: 200 })).toEqual({});
    const sparse = normalizeDeepPageFields({
      url: 'https://example.com/',
      status_code: 200,
      checks: { lorem_ipsum: null, no_doctype: true },
      meta: { social_media_tags: null },
      click_depth: -1,
      size: -5,
    });
    expect(sparse).toEqual({
      checks: { missingDoctype: true },
      socialTags: { openGraph: false, twitterCard: false },
    });
  });

  it('a row that drifts from the deep schema contributes nothing instead of failing', () => {
    expect(normalizeDeepPageFields({ status_code: 200, checks: { no_doctype: 'yes' } })).toEqual({});
    expect(normalizeDeepPageFields(null)).toEqual({});
  });

  it('rounds fractional numbers and lowercases the encoding', () => {
    const fields = normalizeDeepPageFields({
      status_code: 200,
      click_depth: 2.6,
      content_encoding: 'BR',
      page_timing: { waiting_time: 812.4 },
    });
    expect(fields).toEqual({ clickDepth: 3, contentEncoding: 'br', serverResponseMs: 812 });
  });
});
