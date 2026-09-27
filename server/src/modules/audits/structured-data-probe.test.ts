/**
 * JSON-LD structured-data probe (issue #2): a page whose initial HTML
 * carries a valid `application/ld+json` block must count as having
 * structured data even when the vendor's microdata flag says otherwise.
 */
import { describe, expect, it, vi } from 'vitest';

const fetchPublicUrlSafe = vi.hoisted(() => vi.fn());
vi.mock('../../shared/security/url-safety.js', () => ({ fetchPublicUrlSafe }));

import { createStructuredDataProbe, htmlHasJsonLd } from './structured-data-probe.js';

const GRAPH_PAGE = `<!doctype html><html><head>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
  {"@type":"Organization","name":"Bot Trades"},
  {"@type":"WebSite","url":"https://bottradesforyou.com/"},
  {"@type":"WebPage"},{"@type":"SoftwareApplication"}]}</script>
</head><body></body></html>`;

describe('htmlHasJsonLd', () => {
  it('recognises @graph-style documents', () => {
    expect(htmlHasJsonLd(GRAPH_PAGE)).toBe(true);
  });

  it('recognises top-level, array and multi-type documents with any attribute quoting', () => {
    expect(htmlHasJsonLd(`<script type='application/ld+json'>{"@type":"Article"}</script>`)).toBe(true);
    expect(htmlHasJsonLd('<script id=x type=application/ld+json>[{"@type":"Product"}]</script>')).toBe(true);
    expect(htmlHasJsonLd('<SCRIPT TYPE="application/ld+json" nonce="n">{"@type":["Thing","Place"]}</SCRIPT>')).toBe(true);
    expect(htmlHasJsonLd('<script type="application/ld+json"><!-- {"@type":"Event"} --></script>')).toBe(true);
  });

  it('keeps scanning past broken or type-less blocks', () => {
    const html = [
      '<script type="application/ld+json">{not json</script>',
      '<script type="application/ld+json">{"@context":"https://schema.org"}</script>',
      '<script type="application/ld+json">{"@type":"FAQPage"}</script>',
    ].join('');
    expect(htmlHasJsonLd(html)).toBe(true);
  });

  it('rejects pages without a usable JSON-LD block', () => {
    expect(htmlHasJsonLd('<html><body>No markup</body></html>')).toBe(false);
    expect(htmlHasJsonLd('<script>{"@type":"Organization"}</script>')).toBe(false);
    expect(htmlHasJsonLd('<script type="text/javascript">{"@type":"Organization"}</script>')).toBe(false);
    expect(htmlHasJsonLd('<script type="application/ld+json">{"@type":"  ","@graph":"x"}</script>')).toBe(false);
    expect(htmlHasJsonLd('<script type="application/ld+json">{"@type":[1, ""]}</script>')).toBe(false);
    expect(htmlHasJsonLd('<script type="application/ld+json">"just a string"</script>')).toBe(false);
    expect(htmlHasJsonLd('<script type="application/ld+json">null</script>')).toBe(false);
  });

  it('bounds recursion on deeply nested graphs', () => {
    let node: Record<string, unknown> = { '@type': 'Deep' };
    for (let i = 0; i < 12; i += 1) node = { '@graph': [node] };
    expect(htmlHasJsonLd(`<script type="application/ld+json">${JSON.stringify(node)}</script>`)).toBe(false);
  });
});

describe('createStructuredDataProbe', () => {
  it('returns the URLs whose HTML carries JSON-LD, tolerating failed fetches', async () => {
    const fetchHtml = vi.fn(async (url: string) => {
      if (url.endsWith('/boom')) throw new Error('network');
      if (url.endsWith('/gone')) return null;
      if (url.endsWith('/plain')) return '<html></html>';
      return GRAPH_PAGE;
    });
    const probe = createStructuredDataProbe({ fetchHtml, concurrency: 2 });
    const found = await probe([
      'https://e.test/', 'https://e.test/about', 'https://e.test/boom',
      'https://e.test/gone', 'https://e.test/plain', 'https://e.test/',
    ]);
    expect([...found].sort()).toEqual(['https://e.test/', 'https://e.test/about']);
    // Duplicates are fetched once.
    expect(fetchHtml).toHaveBeenCalledTimes(5);
  });

  it('caps the number of pages and stops once the stage budget is spent', async () => {
    const fetchHtml = vi.fn(async () => GRAPH_PAGE);
    const capped = createStructuredDataProbe({ fetchHtml, maxPages: 2, concurrency: 0 });
    expect((await capped(['https://e.test/a', 'https://e.test/b', 'https://e.test/c'])).size).toBe(2);

    let clock = 0;
    const budgeted = createStructuredDataProbe({
      fetchHtml: async () => {
        clock += 1000;
        return GRAPH_PAGE;
      },
      concurrency: 1,
      stageBudgetMs: 1500,
      now: () => clock,
    });
    expect((await budgeted(['https://e.test/a', 'https://e.test/b', 'https://e.test/c'])).size).toBe(2);
  });

  it('resolves to an empty set for an empty URL list', async () => {
    expect((await createStructuredDataProbe()([])).size).toBe(0);
  });
});

describe('createStructuredDataProbe default fetch', () => {
  it('reads HTML through the shared SSRF authority with bounded options', async () => {
    fetchPublicUrlSafe.mockImplementation(async (url: string) => {
      if (url.endsWith('/html')) {
        return new Response(GRAPH_PAGE, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
      }
      if (url.endsWith('/untyped')) {
        const res = new Response(GRAPH_PAGE, { status: 200 });
        res.headers.delete('content-type');
        return res;
      }
      if (url.endsWith('/pdf')) {
        return new Response(GRAPH_PAGE, { status: 200, headers: { 'content-type': 'application/pdf' } });
      }
      return new Response(GRAPH_PAGE, { status: 404, headers: { 'content-type': 'text/html' } });
    });
    const probe = createStructuredDataProbe({ pageDeadlineMs: 1234, maxResponseBytes: 5678 });
    const found = await probe(['https://e.test/html', 'https://e.test/untyped', 'https://e.test/pdf', 'https://e.test/missing']);
    expect([...found].sort()).toEqual(['https://e.test/html', 'https://e.test/untyped']);
    expect(fetchPublicUrlSafe).toHaveBeenCalledWith(
      'https://e.test/html',
      expect.objectContaining({ method: 'GET' }),
      { deadlineMs: 1234, maxResponseBytes: 5678 },
    );
  });
});
