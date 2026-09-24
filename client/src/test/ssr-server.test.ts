import { EventEmitter } from 'node:events';
import type { Server as HttpServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

type RenderResult = {
  statusCode: number;
  redirect?: string;
  appHtml: string;
  headTags: string;
  htmlAttrs: string;
};

type ListenerFactoryArgs = {
  port: number;
  host?: string;
  onListening: () => void;
  onError: (error: Error) => void;
};

type TestApp = {
  request: object;
  response: object;
  handle: (req: unknown, res: unknown, next?: (error?: unknown) => void) => void;
};

type CreateServerOptions = {
  listen?: boolean;
  port?: number;
  host?: string;
  production?: boolean;
  template?: string;
  renderFn?: (url: string) => Promise<RenderResult>;
  apiOrigin?: string;
  proxyTimeoutMs?: number;
  registerSignals?: boolean;
  exitOnSigterm?: boolean;
  compressionEnabled?: boolean;
  serverFactory?: (app: TestApp, args: ListenerFactoryArgs) => HttpServer;
};

type CreateServerResult = {
  app: TestApp;
  server: HttpServer | null;
  close: () => Promise<void>;
};

type WebServerModule = {
  createServer: (options?: CreateServerOptions) => Promise<CreateServerResult>;
  __clearSsrCacheForTests: () => void;
};

type MockResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

type HeaderValue = number | string | readonly string[];

const template = String.raw`<!doctype html>
<html lang="en">
  <head><title>Test</title><!--ssr-head--></head>
  <body>
    <div id="root"><!--ssr-outlet--></div>
    <!--ssr-init-->
    <script type="module" src="/src/entry-client.tsx"></script>
  </body>
</html>`;

const renderOk = async (): Promise<RenderResult> => ({
  statusCode: 200,
  appHtml: '<main><h1>SSR page</h1></main>',
  headTags: '<meta name="description" content="SSR" />',
  htmlAttrs: 'lang="en" dir="ltr"',
});

const CLIENT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const loadServer = async (tag: string): Promise<WebServerModule> => {
  const serverUrl = `${pathToFileURL(path.resolve(CLIENT_ROOT, 'server.js')).href}?${tag}`;
  const mod = await import(serverUrl);
  return mod as unknown as WebServerModule;
};

const normalizeHeaders = (headers: Record<string, string> = {}): Record<string, string> =>
  Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));

const requestApp = async (
  app: TestApp,
  url: string,
  headers: Record<string, string> = {},
): Promise<MockResponse> =>
  new Promise((resolve, reject) => {
    const reqEmitter = new EventEmitter();
    const resEmitter = new EventEmitter();
    const req = Object.create(app.request) as Record<string, unknown>;
    const res = Object.create(app.response) as Record<string, unknown>;
    const responseHeaders = new Map<string, HeaderValue>();
    const bodyChunks: Buffer[] = [];
    Object.defineProperty(res, 'headersSent', {
      value: false,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(res, 'writableEnded', {
      value: false,
      writable: true,
      configurable: true,
    });

    Object.assign(req, {
      app,
      method: 'GET',
      url,
      originalUrl: url,
      headers: normalizeHeaders(headers),
      connection: {},
      socket: {},
      on: reqEmitter.on.bind(reqEmitter),
      once: reqEmitter.once.bind(reqEmitter),
      emit: reqEmitter.emit.bind(reqEmitter),
      resume: () => undefined,
    });

    Object.assign(res, {
      app,
      req,
      locals: {},
      statusCode: 200,
      statusMessage: 'OK',
      on: resEmitter.on.bind(resEmitter),
      once: resEmitter.once.bind(resEmitter),
      emit: resEmitter.emit.bind(resEmitter),
      setHeader: (name: string, value: HeaderValue) => {
        responseHeaders.set(name.toLowerCase(), value);
      },
      getHeader: (name: string) => responseHeaders.get(name.toLowerCase()),
      getHeaders: () => Object.fromEntries(responseHeaders),
      removeHeader: (name: string) => {
        responseHeaders.delete(name.toLowerCase());
      },
      writeHead: (statusCode: number, maybeHeaders?: Record<string, HeaderValue>) => {
        res.statusCode = statusCode;
        if (maybeHeaders) {
          for (const [name, value] of Object.entries(maybeHeaders)) {
            responseHeaders.set(name.toLowerCase(), value);
          }
        }
        res.headersSent = true;
        return res;
      },
      write: (chunk?: string | Buffer | Uint8Array) => {
        if (chunk !== undefined) bodyChunks.push(Buffer.from(chunk));
        return true;
      },
      end: (
        chunk?: string | Buffer | Uint8Array,
        encodingOrCallback?: BufferEncoding | (() => void),
        callback?: () => void,
      ) => {
        if (chunk !== undefined) bodyChunks.push(Buffer.from(chunk));
        res.headersSent = true;
        res.writableEnded = true;
        const cb = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;
        cb?.();
        resEmitter.emit('finish');
        resolve({
          status: Number(res.statusCode),
          headers: Object.fromEntries(
            [...responseHeaders.entries()].map(([name, value]) => [name, String(value)]),
          ),
          body: Buffer.concat(bodyChunks).toString('utf8'),
        });
        return res;
      },
    });
    req.res = res;

    app.handle(
      req,
      res,
      reject,
    );
  });

const createTestServer = async (
  tag: string,
  options: CreateServerOptions = {},
): Promise<{ mod: WebServerModule; web: CreateServerResult }> => {
  const mod = await loadServer(tag);
  const web = await mod.createServer({
    listen: false,
    production: true,
    template,
    renderFn: renderOk,
    compressionEnabled: false,
    ...options,
  });
  return { mod, web };
};

const originalEnv = {
  CLIENT_URL: process.env.CLIENT_URL,
  APP_URL: process.env.APP_URL,
  VITE_API_BASE_URL: process.env.VITE_API_BASE_URL,
  VITE_SOCKET_URL: process.env.VITE_SOCKET_URL,
};

afterEach(() => {
  vi.restoreAllMocks();
  if (originalEnv.CLIENT_URL === undefined) {
    delete process.env.CLIENT_URL;
  } else {
    process.env.CLIENT_URL = originalEnv.CLIENT_URL;
  }
  if (originalEnv.APP_URL === undefined) {
    delete process.env.APP_URL;
  } else {
    process.env.APP_URL = originalEnv.APP_URL;
  }
  if (originalEnv.VITE_API_BASE_URL === undefined) {
    delete process.env.VITE_API_BASE_URL;
  } else {
    process.env.VITE_API_BASE_URL = originalEnv.VITE_API_BASE_URL;
  }
  if (originalEnv.VITE_SOCKET_URL === undefined) {
    delete process.env.VITE_SOCKET_URL;
  } else {
    process.env.VITE_SOCKET_URL = originalEnv.VITE_SOCKET_URL;
  }
});

describe('SSR web server', () => {
  it('stamps a CSP header whose connect-src includes the env-derived origins', async () => {
    process.env.VITE_API_BASE_URL = 'http://api.internal:8080/api';
    process.env.VITE_SOCKET_URL = 'https://socket.internal/live';
    const { web } = await createTestServer('csp');

    const response = await requestApp(web.app, '/docs/getting-started');

    expect(response.headers['content-security-policy']).toContain(
      "connect-src 'self' http://api.internal:8080 https://socket.internal",
    );
  });

  it('serves the CSR shell (200, no __SSR__) when render throws', async () => {
    const { web } = await createTestServer('fallback', {
      renderFn: async () => {
        throw new Error('render exploded');
      },
    });

    const response = await requestApp(web.app, '/docs/getting-started');

    expect(response.status).toBe(200);
    expect(response.body).not.toContain('window.__SSR__');
    expect(response.body).not.toContain('render exploded');
    expect(response.body).not.toContain('Error:');
  });

  it('returns a real HTTP 404 with the SSR-rendered NotFound markup for an unmatched public path', async () => {
    const { web } = await createTestServer('notfound', {
      renderFn: async () => ({
        statusCode: 404,
        appHtml: '<main><h1>Page not found</h1></main>',
        headTags: '<title>Page not found</title>',
        htmlAttrs: 'lang="en" dir="ltr"',
      }),
    });

    const response = await requestApp(web.app, '/docs/totally-nonexistent-xyz');

    expect(response.status).toBe(404);
    expect(response.body).toContain('<main><h1>Page not found</h1></main>');
    expect(response.body).toContain('window.__SSR__');
  });

  it('still returns 404 (never a soft-404 200) when the 404 render produced no appHtml', async () => {
    const { web } = await createTestServer('notfound-empty', {
      renderFn: async () => ({
        statusCode: 404,
        appHtml: '',
        headTags: '',
        htmlAttrs: '',
      }),
    });

    const response = await requestApp(web.app, '/docs/totally-nonexistent-xyz');

    expect(response.status).toBe(404);
    expect(response.body).not.toContain('window.__SSR__');
  });

  it.each([
    '/sites',
    '/keyword-research',
    '/assistant',
    '/team',
    '/settings',
    '/verify-email',
    '/two-factor',
  ])(
    'serves the CSR shell for the authed app path %s without invoking SSR',
    async (appPath) => {
      const { web } = await createTestServer(`app-shell-${appPath.replace(/\//g, '-')}`);

      const response = await requestApp(web.app, appPath);

      expect(response.status).toBe(200);
      expect(response.body).not.toContain('SSR page');
      expect(response.body).not.toContain('window.__SSR__');
    },
  );

  it.each([
    '/team/accept/INVITE_SECRET',
    '/team/reject/REJECT_SECRET',
    '/login?returnTo=%2Fteam%2Faccept%2FINVITE_SECRET',
    '/team/change-password?returnTo=%2Fteam%2Freject%2FREJECT_SECRET',
  ])('protects the invitation capability URL %s from caches and referrers', async (appPath) => {
    const { web } = await createTestServer(`private-${appPath.replace(/\//g, '-')}`);

    const response = await requestApp(web.app, appPath);

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow, noarchive');
  });

  it('redirects app paths on the public host to the app host with the query intact', async () => {
    process.env.CLIENT_URL = 'https://site.test';
    process.env.APP_URL = 'https://app.site.test';
    const { web } = await createTestServer('public-to-app');

    const response = await requestApp(web.app, '/dashboard?tab=overview', {
      Host: 'site.test',
    });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('https://app.site.test/dashboard?tab=overview');
  });

  it('redirects the root on either host straight to app sign-in', async () => {
    process.env.CLIENT_URL = 'https://site.test';
    process.env.APP_URL = 'https://app.site.test';
    const { web } = await createTestServer('app-root');

    for (const host of ['site.test', 'app.site.test']) {
      const response = await requestApp(web.app, '/?welcome=1', { Host: host });

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('https://app.site.test/login?welcome=1');
    }
  });

  it('redirects public content on the app host back to its canonical host', async () => {
    process.env.CLIENT_URL = 'https://site.test';
    process.env.APP_URL = 'https://app.site.test';
    const { web } = await createTestServer('app-to-public');

    const response = await requestApp(web.app, '/docs/getting-started?utm_source=x', {
      Host: 'app.site.test',
    });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('https://site.test/docs/getting-started?utm_source=x');
  });

  it.each([
    ['/', '/login'],
    ['/?welcome=1', '/login?welcome=1'],
    ['/ar', '/login?lng=ar'],
    ['/fr/', '/login?lng=fr'],
    ['/zh?lng=en', '/login?lng=zh'],
  ])('redirects the landing root %s straight to sign-in without invoking SSR', async (root, target) => {
    const { web } = await createTestServer(`root-${root.replace(/[/?=]/g, '-')}`);

    const response = await requestApp(web.app, root);

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(target);
  });


  it.each(['/checkout', '/actions', '/exports/abc', '/fr/unknown', '/totally-nonexistent-xyz'])(
    'serves the CSR shell for any non-docs path %s so the SPA owns routing and 404s',
    async (appPath) => {
      const { web } = await createTestServer(`spa-${appPath.replace(/\//g, '-')}`);

      const response = await requestApp(web.app, appPath);

      expect(response.status).toBe(200);
      expect(response.body).not.toContain('SSR page');
      expect(response.body).not.toContain('window.__SSR__');
    },
  );

  it('serves /index.html as the CSR shell — no raw <!--ssr-outlet--> marker leaks', async () => {
    const { web } = await createTestServer('index');

    const response = await requestApp(web.app, '/index.html');

    expect(response.status).toBe(200);
    expect(response.body).not.toContain('SSR page');
    expect(response.body).not.toContain('<!--ssr-outlet-->');
  });

  it.each(['/docs', '/ar/docs/getting-started'])('server-renders the public docs path %s', async (docsPath) => {
    const { web } = await createTestServer(`docs-${docsPath.replace(/\//g, '-')}`);

    const response = await requestApp(web.app, docsPath);

    expect(response.status).toBe(200);
    expect(response.body).toContain('<main><h1>SSR page</h1></main>');
  });

  it('redirects non-docs paths on the public host to the app host', async () => {
    process.env.CLIENT_URL = 'https://site.test';
    process.env.APP_URL = 'https://app.site.test';
    const { web } = await createTestServer('public-actions-to-app');

    const response = await requestApp(web.app, '/actions?x=1', { Host: 'site.test' });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('https://app.site.test/actions?x=1');
  });

  it('proxies stream and time out', async () => {
    const encoder = new TextEncoder();
    let fetchCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      fetchCalls += 1;
      if (fetchCalls === 1) {
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode('{"first":true'));
              controller.enqueue(encoder.encode(',"second":true}'));
              controller.close();
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    });
    const { web } = await createTestServer('proxy', {
      apiOrigin: 'http://api.internal:8080',
      proxyTimeoutMs: 20,
    });

    const streamed = await requestApp(web.app, '/api/stream');
    const timedOut = await requestApp(web.app, '/api/hang');

    expect(streamed.status).toBe(200);
    expect(streamed.headers['content-type']).toContain('application/json');
    expect(streamed.body).toBe('{"first":true,"second":true}');
    expect(timedOut.status).toBe(502);
    expect(timedOut.body).toBe('The API is temporarily unavailable');
    expect(timedOut.headers['content-language']).toBe('en');
  });

  it('SSR responses carry s-maxage/stale-while-revalidate and repeat hits serve from the LRU', async () => {
    const { mod, web } = await createTestServer('cache', {
      renderFn: async () => {
        calls += 1;
        return renderOk();
      },
    });
    let calls = 0;
    mod.__clearSsrCacheForTests();

    const first = await requestApp(web.app, '/docs/getting-started');
    const second = await requestApp(web.app, '/docs/getting-started');

    expect(first.headers['cache-control']).toBe(
      'public, s-maxage=300, stale-while-revalidate=600',
    );
    expect(second.headers['cache-control']).toBe(
      'public, s-maxage=300, stale-while-revalidate=600',
    );
    expect(calls).toBe(1);
  });

  it('SIGTERM closes the listener gracefully', async () => {
    class FakeServer extends EventEmitter {
      listening = true;
      keepAliveTimeout = 0;
      headersTimeout = 0;

      close(callback?: () => void): this {
        this.listening = false;
        this.emit('close');
        callback?.();
        return this;
      }
    }

    const fake = new FakeServer() as unknown as HttpServer;
    const { web } = await createTestServer('sigterm', {
      listen: true,
      port: 0,
      registerSignals: true,
      exitOnSigterm: false,
      serverFactory: (_app, { onListening }) => {
        queueMicrotask(onListening);
        return fake;
      },
    });

    const closed = new Promise<void>((resolve) => {
      (web.server as HttpServer).once('close', () => resolve());
    });
    process.emit('SIGTERM');
    await closed;
    process.emit('SIGTERM');

    expect((web.server as HttpServer).listening).toBe(false);
  });
});
