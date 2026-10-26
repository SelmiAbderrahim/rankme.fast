import { describe, expect, it, vi } from 'vitest';
import { fetchPublicUrlSafeWithFinalUrl, UnsafeUrlError, type PublicUrlResolver } from './url-safety.js';

const resolver: PublicUrlResolver = async () => [{ address: '93.184.216.34', family: 4 }];
describe('safe redirect evidence', () => {
  it('records validated redirect responses and the terminal address', async () => {
    const result = await fetchPublicUrlSafeWithFinalUrl('https://example.test/start', {}, {
      resolver,
      transport: async url => url.pathname === '/start'
        ? new Response(null, { status: 301, headers: { location: '/final' } })
        : new Response('done'),
    });
    expect(result.finalUrl.href).toBe('https://example.test/final');
    expect(result.redirects).toEqual([{ url: 'https://example.test/start', status: 301 }]);
  });
  it('reports a redirect loop without requesting the repeated address', async () => {
    const transport = vi.fn(async (url: URL) => new Response(null, {
      status: 302, headers: { location: url.pathname === '/a' ? '/b' : '/a#fragment' },
    }));
    await expect(fetchPublicUrlSafeWithFinalUrl('https://example.test/a', {}, { resolver, transport }))
      .rejects.toMatchObject({ kind: 'redirect_loop', redirectChain: [
        { url: 'https://example.test/a', status: 302 },
        { url: 'https://example.test/b', status: 302 },
      ] });
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it('retains evidence when a redirect targets a private address', async () => {
    const transport = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/' } }));
    await expect(fetchPublicUrlSafeWithFinalUrl('https://example.test/start', {}, { resolver, transport }))
      .rejects.toMatchObject({ kind: 'unsafe_redirect', redirectChain: [{ url: 'https://example.test/start', status: 302 }] });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('classifies malformed redirect locations and redirect ceilings', async () => {
    await expect(fetchPublicUrlSafeWithFinalUrl('https://example.test/start', {}, {
      resolver, transport: async () => new Response(null, { status: 302, headers: { location: 'https://[' } }),
    })).rejects.toMatchObject({ kind: 'unsafe_redirect' });
    await expect(fetchPublicUrlSafeWithFinalUrl('https://example.test/start', {}, {
      resolver, maxRedirects: 0,
      transport: async () => new Response(null, { status: 302, headers: { location: '/next' } }),
    })).rejects.toMatchObject({ kind: 'redirect_limit' });
  });
  it('leaves an invalid initial address distinct from an unsafe redirect', async () => {
    await expect(fetchPublicUrlSafeWithFinalUrl('https://127.0.0.1/', {}, { resolver }))
      .rejects.toMatchObject({ kind: undefined, redirectChain: [] });
    expect(new UnsafeUrlError('test').kind).toBeUndefined();
  });
});
