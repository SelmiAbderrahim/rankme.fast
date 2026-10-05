/**
 * Site probe (issues #16, #17): the site-wide signals the on-page vendor does
 * not report — robots.txt sitemap directive, `/llms.txt`, and where each
 * http/https × apex/www address ends up.
 */
import { describe, expect, it, vi } from 'vitest';
import { createSiteProbe, detectHostRedirect, robotsSitemapDirectives, type ProbeResponse } from './site-probe.js';

type Route = { status: number; finalUrl?: string; contentType?: string; body?: string } | 'down';

function fakeNetwork(routes: Record<string, Route>) {
  return vi.fn(async (url: string): Promise<ProbeResponse | null> => {
    const route = routes[url];
    if (route === undefined || route === 'down') return null;
    return {
      status: route.status,
      finalUrl: route.finalUrl ?? url,
      contentType: route.contentType ?? 'text/plain',
      text: async () => route.body ?? '',
    };
  });
}

const target = { domain: 'bottradesforyou.com', url: 'https://bottradesforyou.com' };
const HOME = 'https://bottradesforyou.com/';

describe('createSiteProbe', () => {
  it('reports the variant that serves its own page instead of redirecting (issue #17)', async () => {
    const fetchUrl = fakeNetwork({
      [HOME]: { status: 200, contentType: 'text/html' },
      'http://bottradesforyou.com/': { status: 200, finalUrl: HOME, contentType: 'text/html' },
      'https://www.bottradesforyou.com/': { status: 200, finalUrl: HOME, contentType: 'text/html' },
      // The default nginx page — answers on plain http, never redirects.
      'http://www.bottradesforyou.com/': { status: 200, contentType: 'text/html' },
      'https://bottradesforyou.com/robots.txt': {
        status: 200,
        body: 'User-agent: *\nAllow: /\n\nSitemap: https://bottradesforyou.com/sitemap.xml\n',
      },
      'https://bottradesforyou.com/llms.txt': { status: 404, contentType: 'text/html' },
    });
    const result = await createSiteProbe({ fetchUrl })(target);
    expect(result.addressVariants).toEqual([
      { url: 'http://bottradesforyou.com/', status: 200, finalUrl: HOME, ok: true },
      { url: 'http://www.bottradesforyou.com/', status: 200, finalUrl: 'http://www.bottradesforyou.com/', ok: false },
      { url: HOME, status: 200, finalUrl: HOME, ok: true },
      { url: 'https://www.bottradesforyou.com/', status: 200, finalUrl: HOME, ok: true },
    ]);
    // Sitemap declared in robots.txt, llms.txt missing (issue #16).
    expect(result.sitemapReferencedInRobots).toBe(true);
    expect(result.llmsTxtFound).toBe(false);
    // The site's own https address is read once and reused as a variant.
    expect(fetchUrl.mock.calls.filter(([url]) => url === HOME)).toHaveLength(1);
  });

  it('uses the https origin the site redirects to as the canonical one', async () => {
    const www = 'https://www.example.com/';
    const fetchUrl = fakeNetwork({
      'https://example.com/': { status: 200, finalUrl: www },
      'http://example.com/': { status: 200, finalUrl: www },
      'http://www.example.com/': { status: 200, finalUrl: www },
      [www]: { status: 200 },
      'https://www.example.com/robots.txt': { status: 200, body: 'User-agent: *\nDisallow:\n' },
      'https://www.example.com/llms.txt': { status: 200, contentType: 'text/plain; charset=utf-8' },
    });
    const result = await createSiteProbe({ fetchUrl })({ domain: 'example.com', url: 'https://example.com' });
    expect(result.addressVariants?.every((v) => v.ok === true)).toBe(true);
    expect(result.sitemapReferencedInRobots).toBe(false);
    expect(result.llmsTxtFound).toBe(true);
  });

  it('marks a variant that ends on an error page or does not answer', async () => {
    const fetchUrl = fakeNetwork({
      'https://example.com/': { status: 200 },
      'http://example.com/': { status: 502, finalUrl: 'https://example.com/' },
      'http://www.example.com/': 'down',
      'https://www.example.com/': { status: 200, finalUrl: 'https://other.example.net/' },
      'https://example.com/robots.txt': { status: 410 },
      'https://example.com/llms.txt': { status: 200, contentType: 'text/html; charset=utf-8' },
    });
    const result = await createSiteProbe({ fetchUrl })({ domain: 'example.com', url: 'not a url' });
    expect(result.addressVariants).toEqual([
      { url: 'http://example.com/', status: 502, finalUrl: 'https://example.com/', ok: false },
      { url: 'http://www.example.com/', status: null, finalUrl: null, ok: null },
      { url: 'https://example.com/', status: 200, finalUrl: 'https://example.com/', ok: true },
      { url: 'https://www.example.com/', status: 200, finalUrl: 'https://other.example.net/', ok: false },
    ]);
    // No robots.txt → the sitemap is not declared there.
    expect(result.sitemapReferencedInRobots).toBe(false);
    // An HTML shell answering every path is not an llms.txt file.
    expect(result.llmsTxtFound).toBe(false);
  });

  it('leaves a signal absent when its file could not be read', async () => {
    for (const [robots, llms] of [
      [{ status: 500 }, 'down'],
      ['down', { status: 500 }],
    ] as Route[][]) {
      const fetchUrl = fakeNetwork({
        'https://example.com/': { status: 200 },
        'https://example.com/robots.txt': robots!,
        'https://example.com/llms.txt': llms!,
      });
      const result = await createSiteProbe({ fetchUrl })({ domain: 'example.com', url: 'https://example.com' });
      expect(result).not.toHaveProperty('sitemapReferencedInRobots');
      expect(result).not.toHaveProperty('llmsTxtFound');
    }

    const unreadable = vi.fn(async (url: string): Promise<ProbeResponse | null> => ({
      status: 200,
      finalUrl: url,
      contentType: 'text/plain',
      text: async () => {
        throw new Error('stream reset');
      },
    }));
    const partial = await createSiteProbe({ fetchUrl: unreadable })({ domain: 'example.com', url: 'https://example.com' });
    expect(partial).not.toHaveProperty('sitemapReferencedInRobots');
    expect(partial.llmsTxtFound).toBe(true);
  });

  it('still reads robots.txt, sitemap.xml and llms.txt when the start page is blocked (issue #38)', async () => {
    const fetchUrl = fakeNetwork({
      [HOME]: { status: 403, contentType: 'text/html' },
      'https://bottradesforyou.com/robots.txt': { status: 200, body: 'User-agent: *\nSitemap: https://bottradesforyou.com/sitemap.xml\n' },
      'https://bottradesforyou.com/sitemap.xml': { status: 200, contentType: 'application/xml' },
      'https://bottradesforyou.com/llms.txt': { status: 200, contentType: 'text/plain' },
    });
    const result = await createSiteProbe({ fetchUrl })(target);
    expect(result).toEqual({ sitemapReferencedInRobots: true, sitemapFound: true, llmsTxtFound: true });
    // Nothing is judged against an unreadable start page: no variants, no host evidence.
    expect(fetchUrl).toHaveBeenCalledTimes(4);
  });

  it('reads the root files even when the start page does not answer at all', async () => {
    const fetchUrl = fakeNetwork({
      [HOME]: 'down',
      'https://bottradesforyou.com/robots.txt': { status: 404, contentType: 'text/html' },
      'https://bottradesforyou.com/sitemap.xml': { status: 404, contentType: 'text/html' },
      'https://bottradesforyou.com/llms.txt': { status: 404, contentType: 'text/html' },
    });
    expect(await createSiteProbe({ fetchUrl })(target)).toEqual({ sitemapReferencedInRobots: false, llmsTxtFound: false });
  });

  it('reads the root files from the redirected host, even when its start page errors', async () => {
    const www = 'https://www.example.com/';
    const fetchUrl = fakeNetwork({
      'https://example.com/': { status: 403, finalUrl: www },
      'https://www.example.com/robots.txt': { status: 200, body: 'Sitemap: https://www.example.com/s.xml' },
      'https://www.example.com/sitemap.xml': { status: 200, contentType: 'text/xml' },
      'https://www.example.com/llms.txt': { status: 404 },
    });
    const result = await createSiteProbe({ fetchUrl })({ domain: 'example.com', url: 'https://example.com' });
    expect(result).toEqual({ sitemapReferencedInRobots: true, sitemapFound: true, llmsTxtFound: false });
    // An error page on a foreign host says nothing about the site's own files.
    const foreign = fakeNetwork({ 'https://example.com/': { status: 403, finalUrl: 'https://challenge.example.net/x' } });
    await createSiteProbe({ fetchUrl: foreign })({ domain: 'example.com', url: 'https://example.com' });
    expect(foreign).toHaveBeenCalledWith('https://example.com/robots.txt');
  });

  it('treats a missing sitemap.xml as no sitemap evidence, and an HTML robots.txt as no directive', async () => {
    const fetchUrl = fakeNetwork({
      [HOME]: { status: 200 },
      'https://bottradesforyou.com/robots.txt': { status: 200, contentType: 'text/html', body: '<html></html>' },
      'https://bottradesforyou.com/sitemap.xml': { status: 404 },
      'https://bottradesforyou.com/llms.txt': { status: 404 },
    });
    const result = await createSiteProbe({ fetchUrl })(target);
    expect(result.sitemapReferencedInRobots).toBe(false);
    expect(result).not.toHaveProperty('sitemapFound');
    expect(result).not.toHaveProperty('failures');
    // An HTML shell answering /sitemap.xml is not a sitemap.
    const soft = fakeNetwork({ [HOME]: { status: 200 }, 'https://bottradesforyou.com/sitemap.xml': { status: 200, contentType: 'text/html' } });
    expect(await createSiteProbe({ fetchUrl: soft })(target)).not.toHaveProperty('sitemapFound');
  });

  it('records why a root file gave no verdict: blocked, HTTP error, or unreachable', async () => {
    const fetchUrl = fakeNetwork({
      [HOME]: { status: 200 },
      'https://bottradesforyou.com/robots.txt': { status: 403 },
      'https://bottradesforyou.com/llms.txt': { status: 503 },
    });
    expect((await createSiteProbe({ fetchUrl })(target)).failures).toEqual({
      robots: { reason: 'blocked', status: 403 },
      llms: { reason: 'http-error', status: 503 },
    });
    const down = fakeNetwork({ [HOME]: { status: 200 } });
    expect((await createSiteProbe({ fetchUrl: down })(target)).failures).toEqual({
      robots: { reason: 'unreachable' },
      llms: { reason: 'unreachable' },
    });
    const unreadable = vi.fn(async (url: string): Promise<ProbeResponse | null> => ({
      status: 200,
      finalUrl: url,
      contentType: 'text/plain',
      text: async () => {
        throw new Error('stream reset');
      },
    }));
    expect((await createSiteProbe({ fetchUrl: unreadable })(target)).failures).toEqual({ robots: { reason: 'unreachable' } });
  });

  it('judges nothing against a start page that ends on plain http', async () => {
    const fetchUrl = fakeNetwork({ 'https://example.com/': { status: 200, finalUrl: 'http://example.com/' } });
    const result = await createSiteProbe({ fetchUrl })({ domain: 'example.com', url: 'https://example.com' });
    expect(result.startPageFinalUrl).toBe('http://example.com/');
    expect(result).not.toHaveProperty('addressVariants');
  });

  it('reports the final start-page URL so a cross-host redirect is visible (issue #29)', async () => {
    const apex = 'https://example.com/';
    const fetchUrl = fakeNetwork({
      'https://www.example.com/': { status: 200, finalUrl: apex },
      [apex]: { status: 200 },
      'http://example.com/': { status: 200, finalUrl: apex },
      'http://www.example.com/': { status: 200, finalUrl: apex },
    });
    const result = await createSiteProbe({ fetchUrl })({ domain: 'www.example.com', url: 'https://www.example.com' });
    expect(result.startPageFinalUrl).toBe(apex);
  });

  it('reads through the shared SSRF authority by default', async () => {
    // A private address fails closed: nothing is read, the failures say so, and it never throws.
    expect(await createSiteProbe()({ domain: 'localhost', url: 'https://localhost' })).toEqual({
      failures: { robots: { reason: 'unreachable' }, llms: { reason: 'unreachable' } },
    });

    const seen: string[] = [];
    const probe = createSiteProbe({
      safety: {
        resolver: async () => [{ address: '93.184.216.34', family: 4 }],
        transport: async (url) => {
          seen.push(url.href);
          if (url.pathname === '/robots.txt') return new Response('Sitemap: https://example.com/s.xml\n', { status: 200 });
          if (url.pathname === '/llms.txt') return new Response(null, { status: 404 });
          // http:// is allowed for the variant probe; it redirects to https.
          if (url.protocol === 'http:') return new Response(null, { status: 301, headers: { location: 'https://example.com/' } });
          return new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } });
        },
      },
    });
    const result = await probe({ domain: 'example.com', url: 'https://example.com' });
    expect(result.sitemapReferencedInRobots).toBe(true);
    expect(result.llmsTxtFound).toBe(false);
    expect(result.addressVariants?.find((v) => v.url === 'http://www.example.com/')).toEqual({
      url: 'http://www.example.com/',
      status: 200,
      finalUrl: 'https://example.com/',
      ok: true,
    });
    expect(seen).toContain('http://www.example.com/');
  });
});

describe('robotsSitemapDirectives', () => {
  it('collects Sitemap lines case-insensitively', () => {
    expect(robotsSitemapDirectives('user-agent: *\r\nSITEMAP:https://a.test/s.xml\n  sitemap : https://a.test/b.xml\n# Sitemap: nope')).toEqual([
      'https://a.test/s.xml',
      'https://a.test/b.xml',
    ]);
    expect(robotsSitemapDirectives('User-agent: *\nDisallow: /')).toEqual([]);
  });
});

describe('detectHostRedirect', () => {
  it('prefers the crawled page hosts when none is on the site host', () => {
    expect(detectHostRedirect('www.example.com', undefined, [
      'https://example.com/',
      'https://example.com/a',
      'https://cdn.example.net/b',
    ])).toEqual({ from: 'www.example.com', to: 'example.com' });
  });

  it('falls back to the start page final URL, and ignores same-host evidence', () => {
    expect(detectHostRedirect('WWW.example.com', 'https://example.com/', [])).toEqual({
      from: 'www.example.com',
      to: 'example.com',
    });
    expect(detectHostRedirect('www.example.com', 'https://www.example.com/', ['https://www.example.com/a'])).toBeNull();
    expect(detectHostRedirect('www.example.com', undefined, ['::bad::'])).toBeNull();
  });
});
