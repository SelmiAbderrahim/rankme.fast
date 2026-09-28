/**
 * Site probe (issue #16): the site-wide signals the on-page vendor does not
 * report — whether robots.txt declares a sitemap and whether `/llms.txt` is
 * served.
 */
import { describe, expect, it, vi } from 'vitest';
import { createSiteProbe, robotsSitemapDirectives, type ProbeResponse } from './site-probe.js';

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
  it('reads the robots.txt sitemap directive and a missing llms.txt (issue #16)', async () => {
    const fetchUrl = fakeNetwork({
      [HOME]: { status: 200, contentType: 'text/html' },
      'https://bottradesforyou.com/robots.txt': {
        status: 200,
        body: 'User-agent: *\nAllow: /\n\nSitemap: https://bottradesforyou.com/sitemap.xml\n',
      },
      'https://bottradesforyou.com/llms.txt': { status: 404, contentType: 'text/html' },
    });
    const result = await createSiteProbe({ fetchUrl })(target);
    expect(result).toEqual({ sitemapReferencedInRobots: true, llmsTxtFound: false });
  });

  it('reads the files on the https origin the site redirects to', async () => {
    const www = 'https://www.example.com/';
    const fetchUrl = fakeNetwork({
      'https://example.com/': { status: 200, finalUrl: www },
      'https://www.example.com/robots.txt': { status: 200, body: 'User-agent: *\nDisallow:\n' },
      'https://www.example.com/llms.txt': { status: 200, contentType: 'text/plain; charset=utf-8' },
    });
    const result = await createSiteProbe({ fetchUrl })({ domain: 'example.com', url: 'https://example.com' });
    expect(result).toEqual({ sitemapReferencedInRobots: false, llmsTxtFound: true });
  });

  it('treats a missing robots.txt and an HTML llms.txt as absent files', async () => {
    const fetchUrl = fakeNetwork({
      'https://example.com/': { status: 200 },
      'https://example.com/robots.txt': { status: 410 },
      'https://example.com/llms.txt': { status: 200, contentType: 'text/html; charset=utf-8' },
    });
    const result = await createSiteProbe({ fetchUrl })({ domain: 'example.com', url: 'not a url' });
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

  it('returns nothing when the site https address cannot be read', async () => {
    for (const home of ['down', { status: 503 }, { status: 200, finalUrl: 'http://example.com/' }] as Route[]) {
      const fetchUrl = fakeNetwork({ 'https://example.com/': home });
      expect(await createSiteProbe({ fetchUrl })({ domain: 'example.com', url: 'https://example.com' })).toEqual({});
      expect(fetchUrl).toHaveBeenCalledTimes(1);
    }
  });

  it('reads through the shared SSRF authority by default', async () => {
    // A private address fails closed: the probe reports nothing, never throws.
    expect(await createSiteProbe()({ domain: 'localhost', url: 'https://localhost' })).toEqual({});

    const probe = createSiteProbe({
      safety: {
        resolver: async () => [{ address: '93.184.216.34', family: 4 }],
        transport: async (url) => {
          if (url.pathname === '/robots.txt') return new Response('Sitemap: https://example.com/s.xml\n', { status: 200 });
          if (url.pathname === '/llms.txt') return new Response(null, { status: 404 });
          return new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } });
        },
      },
    });
    const result = await probe({ domain: 'example.com', url: 'https://example.com' });
    expect(result).toEqual({ sitemapReferencedInRobots: true, llmsTxtFound: false });
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
