import { createServer, type Server } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  UnsafeUrlError,
  assertPublicUrlSafe,
  assertPublicUrlSyntaxSafe,
  fetchPublicUrlSafe,
  fetchPublicUrlSafeWithFinalUrl,
  pinnedHttpTransport,
  type PublicUrlResolver,
  type PublicUrlTransport,
  type UrlSafetyClock,
} from './url-safety.js';

const publicResolver: PublicUrlResolver = async () => [
  { address: '93.184.216.34', family: 4 },
  { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
];

describe('assertPublicUrlSyntaxSafe — synchronous schema preflight', () => {
  it.each([
    'https://127.0.0.1/private',
    'https://[::1]/private',
    'https://localhost/private',
    'https://nested.localhost/private',
    'https://metadata.google.internal/computeMetadata/v1',
    'https://user:pass@example.com/private',
    'ftp://example.com/file',
    'http://example.com/insecure',
  ])('rejects unsafe input %s without DNS', (url) => {
    expect(() => assertPublicUrlSyntaxSafe(url)).toThrow(UnsafeUrlError);
  });

  it('normalizes a public HTTPS origin and optionally permits HTTP', () => {
    expect(assertPublicUrlSyntaxSafe(' HTTPS://Example.COM:443/path ')).toEqual(
      new URL('https://example.com/path'),
    );
    expect(assertPublicUrlSyntaxSafe('http://example.com/path', { allowHttp: true })).toEqual(
      new URL('http://example.com/path'),
    );
  });
});

describe('assertPublicUrlSafe — blocked IPv4 range matrix', () => {
  it.each([
    '0.0.0.0',
    '10.1.2.3',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.0.0.1',
    '192.0.2.1',
    '192.88.99.1',
    '192.168.1.1',
    '198.18.0.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '240.0.0.1',
  ])('blocks %s', async (address) => {
    await expect(assertPublicUrlSafe(`https://${address}`)).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it('accepts a public IPv4 literal without DNS', async () => {
    const resolver = vi.fn<PublicUrlResolver>();
    await expect(assertPublicUrlSafe('https://8.8.8.8/path', { resolver })).resolves.toEqual(
      new URL('https://8.8.8.8/path'),
    );
    expect(resolver).not.toHaveBeenCalled();
  });
});

describe('assertPublicUrlSafe — blocked IPv6 range matrix', () => {
  it.each([
    '::',
    '::1',
    '::7f00:1',
    '::ffff:7f00:1',
    '64:ff9b::7f00:1',
    '100::1',
    '2001::1',
    '2001:2::1',
    '2001:10::1',
    '2001:20::1',
    '2001:db8::1',
    '2002:7f00:1::',
    '3fff::1',
    '4000::1',
    '8000::1',
    'fd00::1',
    'fe80::1',
    'ff00::1',
  ])('blocks %s', async (address) => {
    await expect(assertPublicUrlSafe(`https://[${address}]`)).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it('accepts a globally routable IPv6 literal', async () => {
    await expect(assertPublicUrlSafe('https://[2606:4700:4700::1111]/')).resolves.toEqual(
      new URL('https://[2606:4700:4700::1111]/'),
    );
  });

  it('re-checks public IPv4-compatible and mapped IPv6 literals', async () => {
    await expect(assertPublicUrlSafe('https://[::808:808]/')).resolves.toEqual(
      new URL('https://[::808:808]/'),
    );
    await expect(assertPublicUrlSafe('https://[::ffff:8.8.8.8]/')).resolves.toEqual(
      new URL('https://[::ffff:808:808]/'),
    );
  });
});

describe('assertPublicUrlSafe — parsing, DNS, and evasion guards', () => {
  it.each([
    'https://2130706433',
    'https://0177.0.0.1',
    'https://0x7f.0.0.1',
    'https://127.000.000.001',
    'https://example.com.',
    'https://%65xample.com',
    'https://münchen.de',
    'https://xn--mnchen-3ya.de',
  ])('rejects encoded or homograph-prone host %s', async (url) => {
    await expect(assertPublicUrlSafe(url, { resolver: publicResolver })).rejects.toBeInstanceOf(
      UnsafeUrlError,
    );
  });

  it.each(['not a url', 'https:example.com', 'ftp://example.com', 'http://example.com']) (
    'rejects invalid/disallowed URL %s',
    async (url) => {
      await expect(assertPublicUrlSafe(url, { resolver: publicResolver })).rejects.toBeInstanceOf(
        UnsafeUrlError,
      );
    },
  );

  it('allows HTTP only through explicit operator/test configuration', async () => {
    await expect(
      assertPublicUrlSafe('http://example.com/a', { allowHttp: true, resolver: publicResolver }),
    ).resolves.toEqual(new URL('http://example.com/a'));
  });

  it('rejects userinfo', async () => {
    await expect(
      assertPublicUrlSafe('https://user:pass@example.com', { resolver: publicResolver }),
    ).rejects.toThrow('credentials');
  });

  it('normalizes a safe DNS URL and validates every record', async () => {
    const resolver = vi.fn(publicResolver);
    await expect(
      assertPublicUrlSafe(' HTTPS://Example.COM:443/a ', { resolver }),
    ).resolves.toEqual(new URL('https://example.com/a'));
    expect(resolver).toHaveBeenCalledWith('example.com');
  });

  it('rejects a DNS answer set when any record is private', async () => {
    const resolver: PublicUrlResolver = async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ];
    await expect(assertPublicUrlSafe('https://example.com', { resolver })).rejects.toThrow(
      'not publicly routable',
    );
  });

  it('uses the Node DNS resolver by default and rejects its local answer', async () => {
    await expect(assertPublicUrlSafe('https://localhost')).rejects.toThrow('not publicly routable');
  });

  it.each([
    [async () => [], 'no addresses'],
    [async () => [{ address: 'not-an-ip', family: 4 as const }], 'invalid address'],
    [async () => Promise.reject(new Error('offline')), 'DNS resolution failed'],
  ] satisfies Array<[PublicUrlResolver, string]>)('rejects bad resolver output', async (resolver, message) => {
    await expect(assertPublicUrlSafe('https://example.com', { resolver })).rejects.toThrow(message);
  });
});

describe('SEC-URL direct-fetch guard', () => {
  it('allows direct server fetch only at reviewed fixed/internal boundaries', () => {
    const sourceRoot = fileURLToPath(new URL('../../', import.meta.url));
    const matches: string[] = [];
    const visit = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) visit(path);
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
          const relativePath = relative(sourceRoot, path).replaceAll('\\', '/');
          if (
            relativePath.startsWith('shared/security/') ||
            relativePath.startsWith('shared/providers/')
          ) continue;
          const lines = readFileSync(path, 'utf8').split('\n');
          if (lines.some((line) => !line.trimStart().startsWith('*') && /\bfetch\s*\(/.test(line))) {
            matches.push(relativePath);
          }
        }
      }
    };
    visit(sourceRoot);
    expect(matches.sort()).toEqual([]);
  });
});

describe('fetchPublicUrlSafe — pinning, redirects, and bounds', () => {
  it('returns the authority-derived final URL without trusting response headers', async () => {
    const transport: PublicUrlTransport = async (url) =>
      url.pathname === '/start'
        ? new Response(null, { status: 302, headers: { location: '/reviewed' } })
        : new Response('ok', { status: 200, headers: { 'x-final-url': 'https://evil.test/' } });
    const result = await fetchPublicUrlSafeWithFinalUrl(
      'https://example.com/start',
      { method: 'HEAD' },
      { resolver: publicResolver, transport },
    );
    expect(result.response.status).toBe(200);
    expect(result.finalUrl).toEqual(new URL('https://example.com/reviewed'));
  });

  it('pins the validated address and does not resolve again at connect time', async () => {
    const resolver = vi
      .fn<PublicUrlResolver>()
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValueOnce([{ address: '10.0.0.1', family: 4 }]);
    const transport = vi.fn<PublicUrlTransport>(async (_url, pinned, init) => {
      expect(pinned.address).toBe('93.184.216.34');
      expect(init.redirect).toBe('manual');
      expect(init.credentials).toBe('omit');
      expect(new Headers(init.headers).get('authorization')).toBeNull();
      expect(new Headers(init.headers).get('cookie')).toBeNull();
      return new Response('ok', { status: 200 });
    });
    await expect(
      fetchPublicUrlSafe(
        'https://example.com',
        { headers: { authorization: 'Bearer ambient', cookie: 'session=x' } },
        { resolver, transport },
      ),
    ).resolves.toHaveProperty('status', 200);
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it('rejects a redirect to a private destination', async () => {
    const transport: PublicUrlTransport = async () =>
      new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/private' } });
    await expect(
      fetchPublicUrlSafe('https://example.com', {}, { resolver: publicResolver, transport }),
    ).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it('preserves a non-abort transport error', async () => {
    const failure = new Error('connector failed');
    const transport: PublicUrlTransport = async () => Promise.reject(failure);
    await expect(
      fetchPublicUrlSafe('https://example.com', {}, { resolver: publicResolver, transport }),
    ).rejects.toBe(failure);
  });

  it('revalidates relative redirects and caps hops at three by default', async () => {
    const transport = vi.fn<PublicUrlTransport>(async (url) =>
      new Response(null, { status: 302, headers: { location: `${url.pathname}x` } }),
    );
    await expect(
      fetchPublicUrlSafe('https://example.com/a', {}, { resolver: publicResolver, transport }),
    ).rejects.toThrow('redirect ceiling exceeded');
    expect(transport).toHaveBeenCalledTimes(4);
  });

  it('returns a redirect response without Location and a non-redirect error response', async () => {
    const noLocation: PublicUrlTransport = async () => new Response(null, { status: 304 });
    await expect(
      fetchPublicUrlSafe('https://example.com', {}, { resolver: publicResolver, transport: noLocation }),
    ).resolves.toHaveProperty('status', 304);
    const error: PublicUrlTransport = async () => new Response('bad', { status: 400 });
    await expect(
      fetchPublicUrlSafe('https://example.com', {}, { resolver: publicResolver, transport: error }),
    ).resolves.toHaveProperty('status', 400);
  });

  it.each([
    [301, 'GET'],
    [302, 'GET'],
    [303, 'GET'],
    [307, 'POST'],
  ])('applies redirect method semantics for HTTP %i', async (status, expectedMethod) => {
    const methods: Array<string | undefined> = [];
    const bodies: Array<RequestInit['body']> = [];
    const transport: PublicUrlTransport = async (_url, _pinned, init) => {
      methods.push(init.method);
      bodies.push(init.body);
      return methods.length === 1
        ? new Response(null, { status, headers: { location: '/next' } })
        : new Response('ok');
    };
    await fetchPublicUrlSafe(
      'https://example.com/start',
      { method: 'POST', body: 'x' },
      { resolver: publicResolver, transport },
    );
    expect(methods).toEqual(['POST', expectedMethod]);
    expect(bodies[1]).toBe(expectedMethod === 'GET' ? undefined : 'x');
  });

  it.each([
    [{ maxRedirects: -1 }, 'redirect'],
    [{ deadlineMs: 0 }, 'deadline'],
    [{ maxResponseBytes: 0 }, 'response'],
  ])('rejects invalid ceilings', async (options, message) => {
    await expect(
      fetchPublicUrlSafe('https://example.com', {}, { resolver: publicResolver, ...options }),
    ).rejects.toThrow(message);
  });

  it('aborts at the injected deadline', async () => {
    let expire: () => void = () => {};
    const clock: UrlSafetyClock = {
      now: () => 0,
      setTimeout: (callback) => {
        expire = callback;
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeout: vi.fn(),
    };
    const transport: PublicUrlTransport = async (_url, _pin, _init, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        expire();
      });
    await expect(
      fetchPublicUrlSafe('https://example.com', {}, { resolver: publicResolver, transport, clock }),
    ).rejects.toThrow('deadline exceeded');
    expect(clock.clearTimeout).toHaveBeenCalled();
  });

  it('stops when the deadline expires during DNS resolution', async () => {
    let expire: () => void = () => {};
    const clock: UrlSafetyClock = {
      now: () => 0,
      setTimeout: (callback) => {
        expire = callback;
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeout: vi.fn(),
    };
    const resolver: PublicUrlResolver = async () => {
      expire();
      return [{ address: '93.184.216.34', family: 4 }];
    };
    await expect(
      fetchPublicUrlSafe('https://example.com', {}, { resolver, clock }),
    ).rejects.toThrow('deadline exceeded');
  });

  it('interrupts a resolver that never returns', async () => {
    let expire: () => void = () => {};
    const clock: UrlSafetyClock = {
      now: () => 0,
      setTimeout: (callback) => {
        expire = callback;
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeout: vi.fn(),
    };
    const resolver: PublicUrlResolver = () => new Promise(() => {});
    const pending = fetchPublicUrlSafe('https://example.com', {}, { resolver, clock });
    await Promise.resolve();
    expire();
    await expect(pending).rejects.toThrow('deadline exceeded');
  });

  it('honors a caller AbortSignal and an elapsed injected clock', async () => {
    const aborted = new AbortController();
    aborted.abort('caller');
    const transport: PublicUrlTransport = async (_url, _pin, _init, signal) => {
      if (signal.aborted) throw new Error('aborted');
      return new Response('unexpected');
    };
    await expect(
      fetchPublicUrlSafe(
        'https://example.com',
        { signal: aborted.signal },
        { resolver: publicResolver, transport },
      ),
    ).rejects.toThrow('deadline exceeded');

    const times = [0, 11];
    const clock: UrlSafetyClock = {
      now: () => times.shift() ?? 11,
      setTimeout: () => 1 as unknown as ReturnType<typeof setTimeout>,
      clearTimeout: vi.fn(),
    };
    await expect(
      fetchPublicUrlSafe('https://example.com', {}, {
        resolver: publicResolver,
        transport,
        deadlineMs: 10,
        clock,
      }),
    ).rejects.toThrow('deadline exceeded');

    const defaultTransportClock: UrlSafetyClock = {
      now: vi.fn().mockReturnValueOnce(0).mockReturnValue(11),
      setTimeout: () => 1 as unknown as ReturnType<typeof setTimeout>,
      clearTimeout: vi.fn(),
    };
    await expect(
      fetchPublicUrlSafe('https://example.com', {}, {
        resolver: publicResolver,
        deadlineMs: 10,
        clock: defaultTransportClock,
      }),
    ).rejects.toThrow('deadline exceeded');
  });
});

describe('pinnedHttpTransport — native resolve-then-pin connector', () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/large') {
        res.end('12345');
        return;
      }
      if (req.url === '/slow') return;
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        res.setHeader('x-method', req.method ?? '');
        res.setHeader('x-auth-seen', req.headers.authorization ?? 'none');
        res.setHeader('set-cookie', ['a=1', 'b=2']);
        res.end(Buffer.concat(chunks).toString() || 'ok');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server did not bind');
    port = address.port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it('connects to the pin, preserves Host/TLS identity, strips credentials, and supports string bodies', async () => {
    const response = await pinnedHttpTransport(
      new URL(`http://public.example:${port}/echo`),
      { address: '127.0.0.1', family: 4 },
      { method: 'POST', body: 'payload', headers: { authorization: 'Bearer secret', cookie: 'x=1' } },
      new AbortController().signal,
      100,
    );
    expect(await response.text()).toBe('payload');
    expect(response.headers.get('x-method')).toBe('POST');
    expect(response.headers.get('x-auth-seen')).toBe('none');
    expect(response.headers.getSetCookie()).toEqual(['a=1', 'b=2']);
  });

  it('rejects unsupported bodies and oversized responses', async () => {
    await expect(
      pinnedHttpTransport(
        new URL(`http://public.example:${port}/echo`),
        { address: '127.0.0.1', family: 4 },
        { body: new Uint8Array([1]) },
        new AbortController().signal,
        100,
      ),
    ).rejects.toThrow('string request bodies');
    await expect(
      pinnedHttpTransport(
        new URL(`http://public.example:${port}/large`),
        { address: '127.0.0.1', family: 4 },
        {},
        new AbortController().signal,
        4,
      ),
    ).rejects.toThrow('byte ceiling');
  });

  it('maps aborts and HTTPS connection failures to typed errors', async () => {
    const controller = new AbortController();
    const pending = pinnedHttpTransport(
      new URL(`http://public.example:${port}/slow`),
      { address: '127.0.0.1', family: 4 },
      {},
      controller.signal,
      100,
    );
    controller.abort();
    await expect(pending).rejects.toThrow('deadline exceeded');
    await expect(
      pinnedHttpTransport(
        new URL('https://public.example:1/'),
        { address: '127.0.0.1', family: 4 },
        {},
        new AbortController().signal,
        100,
      ),
    ).rejects.toThrow('request failed');
  });
});
