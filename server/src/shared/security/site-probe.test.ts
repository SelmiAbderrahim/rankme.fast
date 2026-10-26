import { describe, expect, it, vi } from 'vitest';
import { createPageProber, readSiteLanguageHead } from './site-probe.js';
import { UnsafeUrlError, type PublicUrlResolver, type PublicUrlTransport } from './url-safety.js';

const resolver: PublicUrlResolver = async () => [{ address: '93.184.216.34', family: 4 }];
const html = () => new Response('<h1>Page</h1>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
describe('readSiteLanguageHead', () => {
  it('reads a bounded HTML head and returns null for other responses or failures', async () => {
    const options = { resolver, transport: async () => html() };
    expect(await readSiteLanguageHead('https://example.test/', options)).toBe('<h1>Page</h1>');
    expect(await readSiteLanguageHead('https://example.test/', {
      resolver, transport: async () => new Response(null, { status: 204 }),
    })).toBeNull();
    expect(await readSiteLanguageHead('https://example.test/', {
      resolver, transport: async () => new Response('plain', { headers: { 'content-type': 'text/plain' } }),
    })).toBeNull();
    expect(await readSiteLanguageHead('https://example.test/', {
      resolver, transport: async () => new Response(null),
    })).toBeNull();
    expect(await readSiteLanguageHead('https://example.test/', {
      resolver, transport: async () => { throw new Error('connection reset'); },
    })).toBeNull();
  });
});
describe('page evidence in the site probe authority', () => {
  it('reads robots once per origin and reports only observed path blocks', async () => {
    const requests: string[] = [];
    const transport: PublicUrlTransport = async url => {
      requests.push(url.pathname);
      return url.pathname === '/robots.txt'
        ? new Response('User-agent: *\nDisallow: /private') : html();
    };
    const probe = createPageProber({ resolver, transport });
    expect((await probe.probe('https://example.test/private')).failure).toEqual({ kind: 'robots_blocked' });
    expect((await probe.probe('https://example.test/open')).failure).toBeNull();
    expect(requests.filter(path => path === '/robots.txt')).toHaveLength(1);
  });
  it.each([403, 404, 405, 501])('rechecks a refused HEAD %i with GET', async status => {
    const methods: string[] = [];
    const probe = createPageProber({ resolver, checkRobots: false, transport: async (_url, _address, init) => {
      methods.push(init.method!);
      return init.method === 'HEAD' ? new Response(null, { status }) : html();
    } });
    expect((await probe.probe('https://example.test/')).failure).toBeNull();
    expect(methods).toEqual(['HEAD', 'GET']);
  });
  it('uses GET directly for link confirmation, retaining final and redirect evidence', async () => {
    const transport = vi.fn<PublicUrlTransport>(async (url, _address, init) => {
      expect(init.method).toBe('GET');
      return url.pathname === '/start' ? new Response(null, { status: 301, headers: { location: '/final' } }) : html();
    });
    const result = await createPageProber({ resolver, transport }).probe('https://example.test/start', { method: 'GET', checkRobots: false });
    expect(result).toMatchObject({ statusCode: 200, finalUrl: 'https://example.test/final', contentType: 'text/html', failure: null,
      redirectChain: [{ url: 'https://example.test/start', status: 301 }] });
  });
  it('reports terminal HTTP errors and non-HTML documents without inventing a missing page', async () => {
    const missing = createPageProber({ resolver, checkRobots: false, transport: async () => new Response(null, { status: 404 }) });
    expect((await missing.probe('https://example.test/')).failure).toEqual({ kind: 'http_error', statusCode: 404 });
    const pdf = createPageProber({ resolver, transport: async url => url.pathname === '/robots.txt'
      ? new Response(null, { status: 404 }) : new Response('PDF', { headers: { 'content-type': 'application/pdf' } }) });
    expect((await pdf.probe('https://example.test/doc')).failure).toEqual({ kind: 'non_html', contentType: 'application/pdf' });
  });
  it('keeps a headers-only verdict when a GET exceeds the response ceiling', async () => {
    const probe = createPageProber({ resolver, checkRobots: false, transport: async (_url, _address, init) => {
      if (init.method === 'GET') throw new UnsafeUrlError('large', undefined, 'response_too_large');
      return html();
    } });
    expect((await probe.probe('https://example.test/', { method: 'GET' })).failure).toBeNull();
  });
  it.each(['redirect_limit', 'redirect_loop', 'unsafe_redirect', 'timeout'] as const)('reports typed %s evidence', async kind => {
    const probe = createPageProber({ resolver, transport: async () => { throw new UnsafeUrlError('failed', undefined, kind); } });
    expect(await probe.probe('https://example.test/')).toMatchObject({ statusCode: null, finalUrl: null, failure: { kind } });
  });
  it('reports unanswered requests as unreachable and tolerates an unreadable robots file', async () => {
    const failed = createPageProber({ resolver, transport: async () => { throw new Error('network failed'); } });
    expect((await failed.probe('https://example.test/')).failure).toEqual({ kind: 'unreachable' });
    const robotsFailure = createPageProber({ resolver, transport: async url => {
      if (url.pathname === '/robots.txt') throw new UnsafeUrlError('no answer');
      return html();
    } });
    expect((await robotsFailure.probe('https://example.test/')).failure).toBeNull();
  });
  it('does not invent a media type when the server omits it', async () => {
    const probe = createPageProber({ resolver, checkRobots: false, transport: async () => new Response(null) });
    expect((await probe.probe('https://example.test/')).contentType).toBeNull();
  });
  it('treats an empty media type token as unknown', async () => {
    const probe = createPageProber({ resolver, checkRobots: false, transport: async () => new Response(null, { headers: { 'content-type': '; charset=utf-8' } }) });
    expect((await probe.probe('https://example.test/')).contentType).toBeNull();
  });
  it('retains the first HEAD answer when its GET retry exceeds the body ceiling', async () => {
    const probe = createPageProber({ resolver, transport: async (_url, _address, init) => {
      if (init.method === 'GET') throw new UnsafeUrlError('large', undefined, 'response_too_large');
      return new Response(null, { status: 404 });
    } });
    expect((await probe.probe('https://example.test/')).failure).toEqual({ kind: 'http_error', statusCode: 404 });
  });
  it.each([new UnsafeUrlError('request failed'), new Error('connection failed')])('keeps GET failures as unanswered evidence', async error => {
    const probe = createPageProber({ resolver, transport: async () => { throw error; } });
    expect((await probe.probe('https://example.test/', { method: 'GET' })).failure).toEqual({ kind: 'unreachable' });
  });
});
