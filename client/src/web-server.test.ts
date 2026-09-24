// Security hardening tests for the web/SSR container entrypoint (client/server.js).
// Runs in the default jsdom env (the shared setup file needs `window`); node's
// http/fetch/express still work there. Uses native fetch against a real
// ephemeral listener (the client package has no supertest); the behaviour is
// security-critical, so it gets an explicit test.
//
// `client/server.js` is plain ESM JS; its sibling `server.d.ts` supplies the
// types so this imports cleanly (no `@ts-nocheck`, which lint bans).
import { describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createServer, type CreateServerOptions, type WebServer } from '../server.js';
import { DOCS_SLUGS } from '@shared/docs/docsUrl';

const TEMPLATE = '<html><!--ssr-head--><!--ssr-outlet--><!--ssr-init--></html>';

async function boot(opts: CreateServerOptions = {}): Promise<WebServer & { base: string }> {
  const inst = await createServer({
    listen: true,
    port: 0,
    host: '127.0.0.1',
    production: false,
    compressionEnabled: false,
    registerSignals: false,
    exitOnSigterm: false,
    template: TEMPLATE,
    renderFn: async () => ({ statusCode: 404 }),
    ...opts,
  });
  const { port } = (inst.server as http.Server).address() as AddressInfo;
  return { ...inst, base: `http://127.0.0.1:${port}` };
}

interface Echo {
  origin: string;
  received: () => http.IncomingHttpHeaders;
  close: () => Promise<void>;
}

function startEcho(): Promise<Echo> {
  let last: http.IncomingHttpHeaders = {};
  const srv = http.createServer((req, res) => {
    last = req.headers;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true }));
  });
  return new Promise<Echo>((resolve) => {
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as AddressInfo;
      resolve({
        origin: `http://127.0.0.1:${port}`,
        received: () => last,
        close: () => new Promise<void>((r) => srv.close(() => r())),
      });
    });
  });
}

describe('web server — security headers', () => {
  it('sets nosniff / X-Frame-Options / Referrer-Policy on non-API responses (dev → no HSTS)', async () => {
    const { base, close } = await boot();
    try {
      const res = await fetch(`${base}/healthz`);
      expect(res.status).toBe(200);
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('x-frame-options')).toBe('DENY');
      expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
      // HSTS is prod-only — never on a plain-HTTP dev origin.
      expect(res.headers.get('strict-transport-security')).toBeNull();
    } finally {
      await close();
    }
  });

  it('does NOT set the web security headers on /api/* (proxied — the API sets its own, no duplicates)', async () => {
    const { base, close } = await boot({ apiOrigin: '' });
    try {
      // No apiOrigin configured → proxy returns 502; the point is the skip: the
      // web layer must not stamp its own headers on an /api response.
      const res = await fetch(`${base}/api/anything`);
      expect(res.headers.get('x-frame-options')).toBeNull();
      expect(res.headers.get('x-content-type-options')).toBeNull();
      expect(res.headers.get('referrer-policy')).toBeNull();
    } finally {
      await close();
    }
  });
});

describe('web server — inbound forwarding-header stripping', () => {
  it('drops client-supplied X-Forwarded-For / X-Real-IP / Forwarded and sets XFF from the socket peer', async () => {
    const echo = await startEcho();
    const { base, close } = await boot({ apiOrigin: echo.origin });
    try {
      const res = await fetch(`${base}/api/ping`, {
        headers: {
          'x-forwarded-for': '1.2.3.4',
          'x-real-ip': '5.6.7.8',
          forwarded: 'for=9.9.9.9',
        },
      });
      expect(res.status).toBe(200);

      const recv = echo.received();
      // The spoofable identity headers were NOT relayed to the API.
      expect(recv['x-real-ip']).toBeUndefined();
      expect(recv['forwarded']).toBeUndefined();
      // XFF is what this container observed as the peer, never the client's
      // asserted value — so the API's per-IP rate limiter can't be bucket-rotated.
      expect(recv['x-forwarded-for']).not.toContain('1.2.3.4');
      expect(recv['x-forwarded-for']).toMatch(/127\.0\.0\.1|::1|::ffff:127/);
    } finally {
      await close();
      await echo.close();
    }
  });
});

describe('web server — chat SSE stream proxy', () => {
  const CHAT_PATH = '/api/chat/conversations/64b000000000000000000001/messages';

  interface StreamUpstream {
    origin: string;
    aborted: () => boolean;
    close: () => Promise<void>;
  }

  /** Upstream that emits three delayed SSE chunks and records aborts. */
  function startStreamUpstream(chunkDelayMs = 30, chunkCount = 3): Promise<StreamUpstream> {
    let wasAborted = false;
    const srv = http.createServer((req, res) => {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
      });
      let sent = 0;
      const timer = setInterval(() => {
        sent += 1;
        res.write(`event: delta\ndata: {"text":"chunk${sent}"}\n\n`);
        if (sent >= chunkCount) {
          clearInterval(timer);
          res.end();
        }
      }, chunkDelayMs);
      req.on('close', () => {
        if (!res.writableEnded) {
          wasAborted = true;
          clearInterval(timer);
        }
      });
    });
    return new Promise((resolve) => {
      srv.listen(0, '127.0.0.1', () => {
        const { port } = srv.address() as AddressInfo;
        resolve({
          origin: `http://127.0.0.1:${port}`,
          aborted: () => wasAborted,
          close: () => new Promise<void>((r) => srv.close(() => r())),
        });
      });
    });
  }

  it('delivers all SSE chunks unbuffered, in order, past the default proxy timeout', async () => {
    const upstream = await startStreamUpstream(30, 3);
    // Default timeout of 50ms would kill the ~90ms stream — the stream route
    // must use the dedicated stream timeout instead.
    const inst = await boot({
      apiOrigin: upstream.origin,
      proxyTimeoutMs: 50,
      proxyStreamTimeoutMs: 10_000,
    });
    try {
      const chunks: string[] = [];
      const res = await fetch(`${inst.base}${CHAT_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'hi' }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(decoder.decode(value));
      }
      const raw = chunks.join('');
      expect(raw.indexOf('chunk1')).toBeGreaterThan(-1);
      expect(raw.indexOf('chunk1')).toBeLessThan(raw.indexOf('chunk2'));
      expect(raw.indexOf('chunk2')).toBeLessThan(raw.indexOf('chunk3'));
      // Unbuffered: the delayed writes arrived as separate reads.
      expect(chunks.length).toBeGreaterThan(1);
    } finally {
      await inst.close();
      await upstream.close();
    }
  });

  it('propagates a client disconnect upstream as an abort', async () => {
    const upstream = await startStreamUpstream(30, 100);
    const inst = await boot({ apiOrigin: upstream.origin, proxyStreamTimeoutMs: 10_000 });
    try {
      await new Promise<void>((resolve, reject) => {
        const url = new URL(`${inst.base}${CHAT_PATH}`);
        const clientRequest = http.request(
          {
            host: url.hostname,
            port: url.port,
            method: 'POST',
            path: url.pathname,
            headers: { 'content-type': 'application/json', 'content-length': 2 },
          },
          (response) => {
            response.once('data', () => {
              clientRequest.destroy();
              resolve();
            });
            response.on('error', () => {});
          },
        );
        clientRequest.on('error', () => {});
        clientRequest.setTimeout(5_000, () => reject(new Error('no chunk seen')));
        clientRequest.end('{}');
      });
      const deadline = Date.now() + 5_000;
      while (!upstream.aborted() && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(upstream.aborted()).toBe(true);
    } finally {
      await inst.close();
      await upstream.close();
    }
  });

  it('non-chat API routes still time out at the default proxy timeout', async () => {
    // Upstream that never responds — the default timeout must 502 quickly.
    const srv = http.createServer(() => {
      /* hang forever */
    });
    await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', () => resolve()));
    const { port } = srv.address() as AddressInfo;
    const inst = await boot({
      apiOrigin: `http://127.0.0.1:${port}`,
      proxyTimeoutMs: 100,
      proxyStreamTimeoutMs: 60_000,
    });
    try {
      const started = Date.now();
      const res = await fetch(`${inst.base}/api/health`);
      expect(res.status).toBe(502);
      expect(Date.now() - started).toBeLessThan(5_000);
    } finally {
      await inst.close();
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });
});

describe('web server — schema generation proxy', () => {
  it('lets generation outlive the ordinary API timeout', async () => {
    const upstream = http.createServer((_req, res) => {
      setTimeout(() => {
        res.setHeader('content-type', 'application/json');
        res.end('{"status":"complete"}');
      }, 100);
    });
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const { port } = upstream.address() as AddressInfo;
    const inst = await boot({
      apiOrigin: `http://127.0.0.1:${port}`,
      proxyTimeoutMs: 20,
      proxySchemaGenerationTimeoutMs: 1_000,
    });
    try {
      const res = await fetch(`${inst.base}/api/schema-generator/generations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: 'complete' });
    } finally {
      await inst.close();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });
});

describe('web server — documentation delivery', () => {
  it('permanently redirects legacy browser Markdown URLs to canonical HTML routes', async () => {
    const { base, close } = await boot();
    try {
      const english = await fetch(`${base}/docs/ai-summary.en.md`, { redirect: 'manual' });
      expect(english.status).toBe(301);
      expect(english.headers.get('location')).toBe('/docs/ai-summary');

      const arabic = await fetch(`${base}/docs/ai-summary.ar.md`, { redirect: 'manual' });
      expect(arabic.status).toBe(301);
      expect(arabic.headers.get('location')).toBe('/ar/docs/ai-summary');
    } finally {
      await close();
    }
  });

  it('preserves raw Markdown for clients that explicitly request text/markdown', async () => {
    const { base, close } = await boot();
    try {
      const res = await fetch(`${base}/docs/ai-summary.en.md`, {
        headers: { accept: 'text/markdown' },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/text\/markdown/);
      expect(await res.text()).toContain('# AI summary');
    } finally {
      await close();
    }
  });

  it('serves localized loader data without making it indexable', async () => {
    const { base, close } = await boot();
    try {
      const res = await fetch(`${base}/_docs-data/fr/catalog`);
      const payload = await res.json() as { locale: string; docs: unknown[] };
      expect(res.status).toBe(200);
      expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
      expect(res.headers.get('content-language')).toBe('fr');
      expect(payload.locale).toBe('fr');
      expect(payload.docs).toHaveLength(DOCS_SLUGS.length - 1); // catalog excludes 'index'
    } finally {
      await close();
    }
  });

  it('keeps localized documentation failures in the existing JSON and text families', async () => {
    const { base, close } = await boot();
    try {
      const json = await fetch(`${base}/_docs-data/ar/not-a-doc`);
      expect(json.status).toBe(404);
      expect(json.headers.get('content-language')).toBe('ar');
      expect(await json.json()).toEqual({ error: 'صفحة التوثيق غير موجودة' });

      const markdown = await fetch(`${base}/docs/not-a-doc.fr.md`, {
        headers: { accept: 'text/markdown' },
      });
      expect(markdown.status).toBe(404);
      expect(markdown.headers.get('content-language')).toBe('fr');
      expect(await markdown.text()).toBe('Page de documentation introuvable');
    } finally {
      await close();
    }
  });

  it('passes the docs reader into SSR route loaders for full article HTML', async () => {
    let sawReader = false;
    const { base, close } = await boot({
      renderFn: async (_url, context) => {
        sawReader = Boolean(
          (context as { docsReader?: { readArticle?: unknown } } | undefined)?.docsReader
            ?.readArticle,
        );
        return { statusCode: 200, appHtml: '<article>Rendered docs</article>', headTags: '', htmlAttrs: '' };
      },
    });
    try {
      const res = await fetch(`${base}/docs/ai-summary`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('Rendered docs');
      expect(sawReader).toBe(true);
    } finally {
      await close();
    }
  });
});

describe('web server — locale-coherent shell and manifests', () => {
  it.each(['en', 'ar', 'fr', 'de', 'es', 'ru', 'zh'])(
    '%s manifest is path-keyed and language-labelled',
    async (locale) => {
      const { base, close } = await boot();
      try {
        const response = await fetch(`${base}/site.${locale}.webmanifest`);
        const manifest = await response.json() as {
          name: string;
          description: string;
          icons: unknown[];
          display: string;
        };
        expect(response.status).toBe(200);
        expect(response.headers.get('content-language')).toBe(locale);
        expect(manifest.name).toBe('RankMeFast');
        expect(manifest.description).not.toHaveLength(0);
        expect(manifest.icons).toHaveLength(3);
        expect(manifest.display).toBe('standalone');
      } finally {
        await close();
      }
    },
  );

  it('keeps the compatibility manifest English and localizes the authenticated fallback shell', async () => {
    const shellTemplate = `<!doctype html><html lang="en"><head>
      <link rel="manifest" href="/site.webmanifest">
      <title>RankMeFast — plain-language SEO &amp; AI answer engine audits</title>
      <meta name="description" content="rankme.fast is a plain-language SEO and AI-answer-engine audit tool. Paste a URL, get a free audit, and see exactly what to fix and where your keywords rank.">
      <!--ssr-head--></head><body><!--ssr-outlet-->
      <noscript>RankMeFast requires JavaScript for the dashboard.</noscript><!--ssr-init--></body></html>`;
    const { base, close } = await boot({ template: shellTemplate });
    try {
      const legacy = await fetch(`${base}/site.webmanifest`);
      expect(legacy.headers.get('content-language')).toBe('en');

      const shell = await fetch(`${base}/dashboard`, {
        headers: { cookie: 'lang=ar' },
      });
      const html = await shell.text();
      expect(shell.headers.get('content-language')).toBe('ar');
      expect(html).toContain('<html lang="ar" dir="rtl">');
      expect(html).toContain('href="/site.ar.webmanifest"');
      expect(html).toContain('فعّل JavaScript');
      expect(html).not.toContain('requires JavaScript');
    } finally {
      await close();
    }
  });
});

describe('web server — token-scoped client portal SSR', () => {
  it('passes the API origin, disables shared caching, and always emits noindex headers', async () => {
    let calls = 0;
    let contextOrigin = '';
    const { base, close } = await boot({
      production: true,
      apiOrigin: 'http://api.internal:8080',
      renderFn: async (_url, context) => {
        calls += 1;
        contextOrigin = (context as { apiOrigin?: string }).apiOrigin ?? '';
        return {
          statusCode: 200,
          appHtml: '<main>Private client report</main>',
          headTags: '<meta name="robots" content="noindex, nofollow">',
          htmlAttrs: 'lang="ar" dir="rtl"',
        };
      },
    });
    try {
      const first = await fetch(`${base}/ar/portal/token-value-that-is-long-enough`);
      const second = await fetch(`${base}/ar/portal/token-value-that-is-long-enough`);
      expect(first.status).toBe(200);
      expect(first.headers.get('x-robots-tag')).toBe('noindex, nofollow, noarchive');
      expect(first.headers.get('cache-control')).toBe('private, no-store');
      expect(await first.text()).toContain('Private client report');
      expect(second.status).toBe(200);
      expect(calls).toBe(2);
      expect(contextOrigin).toBe('http://api.internal:8080');
    } finally {
      await close();
    }
  });

  it('returns hard 404 for revoked links and hard 502 when rendering fails', async () => {
    const revoked = await boot({
      renderFn: async () => ({
        statusCode: 404,
        appHtml: '<main>Unavailable</main>',
        headTags: '',
        htmlAttrs: '',
      }),
    });
    try {
      const response = await fetch(`${revoked.base}/portal/revoked-token-value`);
      expect(response.status).toBe(404);
      expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow, noarchive');
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    } finally {
      await revoked.close();
    }

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failed = await boot({
      renderFn: async () => {
        throw new Error('upstream unavailable');
      },
    });
    try {
      const response = await fetch(`${failed.base}/portal/failing-token-value`);
      expect(response.status).toBe(502);
      expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow, noarchive');
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(errorSpy.mock.calls.flat().join(' ')).not.toContain('failing-token-value');
    } finally {
      await failed.close();
      errorSpy.mockRestore();
    }
  });
});
