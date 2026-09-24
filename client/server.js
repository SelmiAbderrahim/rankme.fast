// RankMeFast web server — the public entrypoint.
// Serves the server-rendered public docs and the CSR shell for the
// authenticated app. The self-hosted edition has no marketing site: the root
// (and every locale root) redirects straight to sign-in. Plain ESM JS so it needs no build step.
//
// Dev:  Vite middlewareMode + ssrLoadModule (HMR).
// Prod: sirv static assets + imported dist/server/entry-server.js.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import express from 'express';
import {
  DocsContentError,
  DocsNotFoundError,
  createDocsReader,
  docsRoutePath,
  explicitlyAcceptsMarkdown,
} from './docs-runtime.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.WEB_PORT ?? process.env.PORT ?? 3000);
const DEFAULT_PROXY_TIMEOUT_MS = 30_000;
// Schema generation may make two bounded provider attempts. Keep this below
// the browser's 60-second request timeout and above the AI profile's 50-second
// deadline so the proxy never becomes the first layer to abort.
const DEFAULT_PROXY_SCHEMA_GENERATION_TIMEOUT_MS = 55_000;
// AI Assistant SSE stream proxy: the chat message
// POST holds its response open for the whole model stream, so it gets a
// dedicated (much longer) upstream timeout. Web-container-only knob —
// documented in CLAUDE.md §4, never read by the API's env schema.
const DEFAULT_PROXY_STREAM_TIMEOUT_MS = Number(
  process.env.PROXY_STREAM_TIMEOUT_MS ?? 300_000,
);
const STREAM_PROXY_PATHS = /^\/api\/chat\/conversations\/[^/]+\/messages$/;
const SCHEMA_GENERATION_PROXY_PATH = /^\/api\/schema-generator\/generations$/;
const isStreamProxyRequest = (req) =>
  req.method === 'POST' && STREAM_PROXY_PATHS.test(req.path);
const isSchemaGenerationProxyRequest = (req) =>
  req.method === 'POST' && SCHEMA_GENERATION_PROXY_PATH.test(req.path);
const SSR_CACHE_TTL_MS = 5 * 60 * 1000;
const SSR_CACHE_MAX = 200;
const ssrCache = new Map();
const DEFAULT_DOCS_DIR = path.resolve(__dirname, '..', 'docs');
const SUPPORTED_LOCALES = ['en', 'ar', 'fr', 'de', 'es', 'ru', 'zh'];
const SUPPORTED_LOCALE_SET = new Set(SUPPORTED_LOCALES);
const RTL_LOCALES = new Set(['ar']);
const WEB_COPY = {
  en: {
    title: 'RankMeFast — clear SEO and AI-answer audits',
    description: 'Audit your site, track rankings, and see which fixes matter most.',
    noscript: 'Turn on JavaScript to use the RankMeFast dashboard.',
    docsNotFound: 'Documentation page not found',
    docsUnavailable: 'Documentation is temporarily unavailable',
    internalError: 'Something went wrong',
    apiUnavailable: 'The API is temporarily unavailable',
    seoUnavailable: 'SEO files are temporarily unavailable',
  },
  ar: {
    title: 'RankMeFast — تدقيق واضح لتحسين محركات البحث وإجابات الذكاء الاصطناعي',
    description: 'دقّق موقعك وتابع ترتيبه واعرف الإصلاحات الأكثر أهمية.',
    noscript: 'فعّل JavaScript لاستخدام لوحة تحكم RankMeFast.',
    docsNotFound: 'صفحة التوثيق غير موجودة',
    docsUnavailable: 'التوثيق غير متاح مؤقتًا',
    internalError: 'حدث خطأ ما',
    apiUnavailable: 'واجهة API غير متاحة مؤقتًا',
    seoUnavailable: 'ملفات تحسين محركات البحث غير متاحة مؤقتًا',
  },
  fr: {
    title: 'RankMeFast — des audits SEO et IA clairs',
    description: 'Auditez votre site, suivez vos positions et repérez les corrections prioritaires.',
    noscript: 'Activez JavaScript pour utiliser le tableau de bord RankMeFast.',
    docsNotFound: 'Page de documentation introuvable',
    docsUnavailable: 'La documentation est temporairement indisponible',
    internalError: 'Une erreur est survenue',
    apiUnavailable: "L’API est temporairement indisponible",
    seoUnavailable: 'Les fichiers SEO sont temporairement indisponibles',
  },
  de: {
    title: 'RankMeFast — klare SEO- und KI-Audits',
    description: 'Prüfe deine Website, verfolge Rankings und erkenne die wichtigsten Verbesserungen.',
    noscript: 'Aktiviere JavaScript, um das RankMeFast-Dashboard zu verwenden.',
    docsNotFound: 'Dokumentationsseite nicht gefunden',
    docsUnavailable: 'Die Dokumentation ist vorübergehend nicht verfügbar',
    internalError: 'Etwas ist schiefgelaufen',
    apiUnavailable: 'Die API ist vorübergehend nicht verfügbar',
    seoUnavailable: 'Die SEO-Dateien sind vorübergehend nicht verfügbar',
  },
  es: {
    title: 'RankMeFast — auditorías claras de SEO e IA',
    description: 'Audita tu sitio, sigue tus posiciones y descubre qué mejoras son prioritarias.',
    noscript: 'Activa JavaScript para usar el panel de RankMeFast.',
    docsNotFound: 'No se encontró la página de documentación',
    docsUnavailable: 'La documentación no está disponible temporalmente',
    internalError: 'Algo salió mal',
    apiUnavailable: 'La API no está disponible temporalmente',
    seoUnavailable: 'Los archivos SEO no están disponibles temporalmente',
  },
  ru: {
    title: 'RankMeFast — понятные SEO- и AI-аудиты',
    description: 'Проверяйте сайт, отслеживайте позиции и находите самые важные исправления.',
    noscript: 'Включите JavaScript, чтобы пользоваться панелью RankMeFast.',
    docsNotFound: 'Страница документации не найдена',
    docsUnavailable: 'Документация временно недоступна',
    internalError: 'Что-то пошло не так',
    apiUnavailable: 'API временно недоступен',
    seoUnavailable: 'SEO-файлы временно недоступны',
  },
  zh: {
    title: 'RankMeFast — 清晰的 SEO 与 AI 审计',
    description: '审计网站、跟踪排名，并找出最值得优先修复的问题。',
    noscript: '请启用 JavaScript 以使用 RankMeFast 控制面板。',
    docsNotFound: '找不到该文档页面',
    docsUnavailable: '文档暂时不可用',
    internalError: '出现了问题',
    apiUnavailable: 'API 暂时不可用',
    seoUnavailable: 'SEO 文件暂时不可用',
  },
};

function explicitPathLocale(pathname) {
  const leading = pathname.match(/^\/(en|ar|fr|de|es|ru|zh)(?:\/|$)/)?.[1];
  if (leading) return leading;
  const docsData = pathname.match(/^\/_docs-data\/(en|ar|fr|de|es|ru|zh)(?:\/|$)/)?.[1];
  if (docsData) return docsData;
  const markdown = pathname.match(/\.(en|ar|fr|de|es|ru|zh)\.md$/)?.[1];
  if (markdown) return markdown;
  const manifest = pathname.match(/^\/site\.(en|ar|fr|de|es|ru|zh)\.webmanifest$/)?.[1];
  return manifest ?? null;
}

function negotiatedLocale(req) {
  const cookie = req.headers.cookie ?? '';
  for (const part of cookie.split(';')) {
    const [name, rawValue] = part.trim().split('=', 2);
    if (name === 'lang') {
      try {
        const value = decodeURIComponent(rawValue ?? '');
        if (SUPPORTED_LOCALE_SET.has(value)) return value;
      } catch {
        // Ignore malformed client cookies and continue with safe negotiation.
      }
    }
  }
  for (const part of String(req.headers['accept-language'] ?? '').split(',')) {
    const value = part.trim().split(';', 1)[0]?.toLowerCase().split('-', 1)[0];
    if (SUPPORTED_LOCALE_SET.has(value)) return value;
  }
  return 'en';
}

// Where the API serves /robots.txt + /sitemap*.xml (SEO module). The public
// origin must serve them, so we reverse-proxy those paths to the API.
function apiOriginValue() {
  const raw = process.env.API_INTERNAL_URL ?? process.env.VITE_API_BASE_URL;
  if (!raw) return '';
  if (!/^https?:\/\//i.test(raw)) return '';
  return new URL(raw.replace(/\/api\/?$/, '')).origin;
}

const API_ORIGIN = apiOriginValue();

function configuredOrigin(raw, fallback = '') {
  if (!raw) return fallback;
  try {
    return new URL(raw).origin;
  } catch {
    return fallback;
  }
}

const PUBLIC_ORIGIN = configuredOrigin(process.env.CLIENT_URL ?? process.env.VITE_SITE_URL);
const APP_ORIGIN = configuredOrigin(process.env.APP_URL, PUBLIC_ORIGIN);
const PUBLIC_HOSTNAME = PUBLIC_ORIGIN ? new URL(PUBLIC_ORIGIN).hostname.toLowerCase() : '';
const APP_HOSTNAME = APP_ORIGIN ? new URL(APP_ORIGIN).hostname.toLowerCase() : '';
const SPLIT_HOSTS = Boolean(PUBLIC_ORIGIN && APP_ORIGIN && PUBLIC_ORIGIN !== APP_ORIGIN);

function connectSrcValue() {
  const origins = new Set(["'self'"]);
  for (const raw of [process.env.VITE_API_BASE_URL, process.env.VITE_SOCKET_URL]) {
    if (!raw || !/^https?:\/\//i.test(raw)) continue;
    origins.add(new URL(raw).origin);
  }
  return [...origins].join(' ');
}

const CONNECT_SRC = connectSrcValue();

// `/`, `/ar`, `/fr/`, … — the root and each locale root. There is no landing
// page; these go straight to sign-in (which bounces a live session onward to
// the dashboard). Non-default locales carry `?lng=` like every auth entry.
const LOCALE_ROOT_PATH = /^\/(?:(ar|fr|de|es|ru|zh)\/?)?$/;
function rootRedirectTarget(pathname, requestTarget) {
  const match = LOCALE_ROOT_PATH.exec(pathname);
  if (!match) return null;
  const params = new URLSearchParams(
    requestTarget.includes('?') ? requestTarget.slice(requestTarget.indexOf('?') + 1) : '',
  );
  if (match[1]) params.set('lng', match[1]);
  const query = params.toString();
  return `${SPLIT_HOSTS ? APP_ORIGIN : ''}/login${query ? `?${query}` : ''}`;
}

const PORTAL_PATH = /^\/(?:(?:ar|fr|de|es|ru|zh)\/)?portal\/[^/]+\/?$/;
const isPortalPath = (pathname) => PORTAL_PATH.test(pathname);
const REPORT_SHARE_PATH = /^\/(?:(?:ar|fr|de|es|ru|zh)\/)?share\/[^/]+\/?$/;
const isReportSharePath = (pathname) => REPORT_SHARE_PATH.test(pathname);
const INVITATION_DECISION_PATH = /^\/team\/(?:accept|reject)\/[^/]+\/?$/;
const isInvitationDecisionPath = (pathname) => INVITATION_DECISION_PATH.test(pathname);
const hasInvitationReturnTo = (requestTarget) => {
  try {
    const returnTo = new URL(requestTarget, 'https://rankme.invalid').searchParams.get('returnTo');
    return returnTo !== null && isInvitationDecisionPath(returnTo);
  } catch {
    return false;
  }
};

const DOCS_PATH = /^\/(?:(?:ar|fr|de|es|ru|zh)\/)?docs(?:\/|$)/;
const isDocsPath = (pathname) => DOCS_PATH.test(pathname);

// The only server-rendered (public-host) surfaces: the docs and the
// token-scoped client portals / report shares. Every other path belongs to
// the authenticated SPA and gets the CSR shell, so a new app route never has
// to be mirrored here and can never be SSR-404'd before the SPA takes over.
const isPublicPath = (pathname) =>
  isDocsPath(pathname) || isPortalPath(pathname) || isReportSharePath(pathname);

/**
 * Content-Security-Policy for the SSR web surface. `script-src` allows only
 * same-origin scripts plus the per-request nonce carried by the two inline
 * scripts (theme bootstrap + ssr-init). Inline JSON-LD (`type=application/ld+json`)
 * is inert data and does not execute, so it needs no nonce. `style-src` keeps
 * `unsafe-inline` for React style props; fonts are self-hosted (`font-src 'self'`).
 */
function contentSecurityPolicy(nonce) {
  return [
    "default-src 'self'",
    // Google Analytics: gtag loader host in script-src, beacon endpoints in
    // connect-src (below), image-fallback pixel hosts in img-src.
    `script-src 'self' 'nonce-${nonce}' https://www.googletagmanager.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://www.google-analytics.com https://www.googletagmanager.com",
    // Small font subsets are inlined as self-contained `data:` URIs by the
    // bundler (no external request) — still SEC-07-safe.
    "font-src 'self' data:",
    `connect-src ${CONNECT_SRC} https://www.google-analytics.com https://region1.google-analytics.com https://www.googletagmanager.com`,
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

/** Assemble the final HTML from the template + SSR fragments. */
function renderHtml(template, {
  headTags = '',
  htmlAttrs = '',
  appHtml = '',
  ssr = false,
  nonce = '',
  locale = 'en',
}) {
  const copy = WEB_COPY[locale] ?? WEB_COPY.en;
  const attributes = htmlAttrs || `lang="${locale}" dir="${RTL_LOCALES.has(locale) ? 'rtl' : 'ltr'}"`;
  const html = template
    .replace(/<html\b[^>]*>/i, `<html ${attributes}>`)
    .replace(/href="\/site\.webmanifest"/, `href="/site.${locale}.webmanifest"`)
    .replace(
      /<title>RankMeFast[^<]*<\/title>/,
      `<title>${copy.title}</title>`,
    )
    .replace(
      /content="rankme\.fast is a plain-language SEO and AI-answer-engine audit tool\.[^"]*"/,
      `content="${copy.description}"`,
    )
    .replace(
      /<noscript>RankMeFast requires JavaScript for the dashboard\.<\/noscript>/,
      `<noscript>${copy.noscript}</noscript>`,
    )
    .replace('<!--ssr-head-->', headTags)
    .replace('<!--ssr-outlet-->', appHtml)
    .replace('<!--ssr-init-->', ssr ? '<script>window.__SSR__=true</script>' : '');
  // Nonce every bare inline <script> AFTER assembly so the CSP allows them:
  // the theme bootstrap, any bundler-injected inline script, the ssr-init flag,
  // and React Router's `window.__staticRouterHydrationData` script (in appHtml).
  // Scripts with attributes (`type="module" src=…`, JSON-LD) are left untouched.
  return html.replaceAll('<script>', `<script nonce="${nonce}">`);
}

function getCachedRender(pathname) {
  const cached = ssrCache.get(pathname);
  if (!cached) return undefined;
  if (cached.expiresAt <= Date.now()) {
    ssrCache.delete(pathname);
    return undefined;
  }
  ssrCache.delete(pathname);
  ssrCache.set(pathname, cached);
  return cached.result;
}

function setCachedRender(pathname, result) {
  if (ssrCache.size >= SSR_CACHE_MAX) {
    const oldest = ssrCache.keys().next().value;
    if (oldest !== undefined) ssrCache.delete(oldest);
  }
  ssrCache.set(pathname, {
    result,
    expiresAt: Date.now() + SSR_CACHE_TTL_MS,
  });
}

/**
 * Combined upstream abort signal: the per-request timeout PLUS client
 * disconnect. Without the disconnect half, an abandoned browser tab would
 * keep the upstream request (and a long-lived chat stream) running for the
 * full timeout. `res` 'close' also fires after a normal end — aborting a
 * finished fetch is a no-op.
 */
function upstreamSignal(res, timeoutMs) {
  const disconnect = new AbortController();
  res.on('close', () => disconnect.abort());
  return AbortSignal.any([AbortSignal.timeout(timeoutMs), disconnect.signal]);
}

function pipeUpstream(upstream, res) {
  if (!upstream.body) {
    res.end();
    return;
  }
  const readable = Readable.fromWeb(upstream.body);
  // A client disconnect aborts the upstream fetch (see `upstreamSignal`),
  // which errors this stream mid-pipe — swallow it and close the response
  // instead of surfacing an uncaught AbortError.
  readable.on('error', () => {
    res.end();
  });
  res.on('error', () => {});
  readable.pipe(res);
}

/** Proxy /robots.txt, /llms.txt, and /sitemap*.xml to the API's SEO module. */
async function proxySeo(req, res, { apiOrigin = API_ORIGIN, timeoutMs = DEFAULT_PROXY_TIMEOUT_MS } = {}) {
  if (!apiOrigin) {
    const locale = negotiatedLocale(req);
    res.set('Content-Language', locale).status(502).type('text/plain').send(WEB_COPY[locale].seoUnavailable);
    return;
  }
  try {
    const upstream = await fetch(`${apiOrigin}${req.originalUrl}`, {
      headers: { accept: req.headers.accept ?? '*/*' },
      signal: upstreamSignal(res, timeoutMs),
    });
    res.status(upstream.status);
    const type = upstream.headers.get('content-type');
    if (type) res.set('content-type', type);
    pipeUpstream(upstream, res);
  } catch {
    const locale = negotiatedLocale(req);
    res.set('Content-Language', locale).status(502).type('text/plain').send(WEB_COPY[locale].seoUnavailable);
  }
}

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
]);

// Client-controllable forwarding-identity headers. This container is the
// trusted hop in front of the API (which runs `trust proxy: 1` and derives
// req.ip from X-Forwarded-For for per-IP rate limiting), so any inbound value
// is spoofable and MUST NOT be relayed — we drop these and set a single clean
// X-Forwarded-For from the real socket peer below. Node's fetch does not append
// a hop of its own, so without this an attacker could rotate the limiter bucket.
const FORWARDING_HEADERS = new Set(['x-forwarded-for', 'x-real-ip', 'forwarded']);

async function proxyApi(
  req,
  res,
  {
    apiOrigin = API_ORIGIN,
    timeoutMs = DEFAULT_PROXY_TIMEOUT_MS,
    schemaGenerationTimeoutMs = DEFAULT_PROXY_SCHEMA_GENERATION_TIMEOUT_MS,
    streamTimeoutMs = DEFAULT_PROXY_STREAM_TIMEOUT_MS,
  } = {},
) {
  if (!apiOrigin) {
    const locale = negotiatedLocale(req);
    res.set('Content-Language', locale).status(502).type('text/plain').send(WEB_COPY[locale].apiUnavailable);
    return;
  }
  try {
    const forwardHeaders = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (v === undefined) continue;
      const lower = k.toLowerCase();
      if (HOP_BY_HOP.has(lower)) continue;
      // Drop client-supplied forwarding-identity headers — see FORWARDING_HEADERS.
      if (FORWARDING_HEADERS.has(lower)) continue;
      forwardHeaders[k] = Array.isArray(v) ? v.join(', ') : v;
    }
    // Set the single trusted forwarding hop from the immediate socket peer, so
    // the API's `trust proxy: 1` resolves req.ip to a value this container
    // observed — never one the client asserted.
    const peer = req.socket?.remoteAddress;
    if (peer) forwardHeaders['x-forwarded-for'] = peer;
    const hasBody = !['GET', 'HEAD'].includes(req.method);
    // Long-running AI routes get explicit ceilings; ordinary API calls retain
    // the stricter default timeout.
    const effectiveTimeoutMs = isStreamProxyRequest(req)
      ? streamTimeoutMs
      : isSchemaGenerationProxyRequest(req)
        ? schemaGenerationTimeoutMs
        : timeoutMs;
    const upstreamOptions = {
      method: req.method,
      headers: forwardHeaders,
      redirect: 'manual',
      signal: upstreamSignal(res, effectiveTimeoutMs),
    };
    if (hasBody) {
      upstreamOptions.body = req;
      upstreamOptions.duplex = 'half';
    }
    const upstream = await fetch(`${apiOrigin}${req.originalUrl}`, upstreamOptions);
    res.status(upstream.status);
    upstream.headers.forEach((value, name) => {
      if (HOP_BY_HOP.has(name.toLowerCase())) return;
      res.append(name, value);
    });
    pipeUpstream(upstream, res);
  } catch {
    const locale = negotiatedLocale(req);
    res.set('Content-Language', locale).status(502).type('text/plain').send(WEB_COPY[locale].apiUnavailable);
  }
}

const SEO_PATHS = /^\/(robots\.txt|llms\.txt|sitemap.*\.xml)$/;

async function createServer({
  listen = true,
  port = PORT,
  host,
  production = isProd,
  template: templateOverride,
  renderFn: renderOverride,
  apiOrigin = API_ORIGIN,
  proxyTimeoutMs = DEFAULT_PROXY_TIMEOUT_MS,
  proxySchemaGenerationTimeoutMs = DEFAULT_PROXY_SCHEMA_GENERATION_TIMEOUT_MS,
  proxyStreamTimeoutMs = DEFAULT_PROXY_STREAM_TIMEOUT_MS,
  registerSignals = listen,
  exitOnSigterm = true,
  compressionEnabled = true,
  serverFactory,
  docsDir = DEFAULT_DOCS_DIR,
} = {}) {
  const app = express();
  const docsReader = createDocsReader(docsDir);
  app.disable('x-powered-by');
  if (compressionEnabled) {
    const compression = (await import('compression')).default;
    app.use(compression({ threshold: 0 }));
  }

  // Baseline security headers for every response the web container ORIGINATES
  // (HTML shell, SSR pages, static assets, /docs). The `/api/*` responses are
  // reverse-proxied and already carry the API's own helmet headers — re-setting
  // them here would emit conflicting duplicate values (e.g. two X-Frame-Options),
  // which browsers treat as invalid, so those paths are skipped. HSTS is
  // prod-only (dev serves plain HTTP). CSP is set per-request on the SSR branch
  // (it needs the nonce); these four are static.
  app.use((req, res, next) => {
    if (!req.path.startsWith('/api/')) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
      if (production) {
        res.setHeader(
          'Strict-Transport-Security',
          'max-age=63072000; includeSubDomains; preload',
        );
      }
    }
    next();
  });

  app.get('/healthz', (_req, res) => res.type('text/plain').send('ok'));
  app.get(SEO_PATHS, (req, res) =>
    proxySeo(req, res, { apiOrigin, timeoutMs: proxyTimeoutMs }),
  );
  app.all(/^\/api\//, (req, res) =>
    proxyApi(req, res, {
      apiOrigin,
      timeoutMs: proxyTimeoutMs,
      schemaGenerationTimeoutMs: proxySchemaGenerationTimeoutMs,
      streamTimeoutMs: proxyStreamTimeoutMs,
    }),
  );

  const sendDocsJson = (res, locale, read) => {
    const resolvedLocale = SUPPORTED_LOCALE_SET.has(locale) ? locale : 'en';
    const copy = WEB_COPY[resolvedLocale];
    res.set('Content-Language', resolvedLocale);
    res.set('X-Robots-Tag', 'noindex, nofollow');
    res.set('Cache-Control', 'public, max-age=60');
    try {
      res.json(read());
    } catch (error) {
      if (error instanceof DocsNotFoundError) {
        res.status(404).json({ error: copy.docsNotFound });
        return;
      }
      if (error instanceof DocsContentError) {
        console.error('[web] invalid documentation content', error.message);
        res.status(500).json({ error: copy.docsUnavailable });
        return;
      }
      throw error;
    }
  };

  // Browser loaders use these same-origin JSON endpoints. SSR loaders receive
  // the reader directly below, so article HTML still contains the full content.
  app.get('/_docs-data/:locale/catalog', (req, res) => {
    sendDocsJson(res, req.params.locale, () => docsReader.readCatalog(req.params.locale));
  });
  app.get('/_docs-data/:locale/search', (req, res) => {
    sendDocsJson(res, req.params.locale, () => docsReader.readSearch(req.params.locale));
  });
  app.get('/_docs-data/:locale/:slug', (req, res) => {
    sendDocsJson(res, req.params.locale, () => docsReader.readArticle(req.params.locale, req.params.slug));
  });

  // Preserve the original Markdown contract for explicit machine clients, but
  // send normal browser requests to the canonical localized HTML route.
  app.get(/^\/docs\/([a-z0-9-]+)\.(en|ar|fr|de|es|ru|zh)\.md$/, (req, res) => {
    const slug = req.params[0];
    const locale = req.params[1];
    res.set('Content-Language', locale);
    try {
      const source = docsReader.readRaw(locale, slug);
      if (explicitlyAcceptsMarkdown(req.headers.accept)) {
        res.type('text/markdown').send(source);
        return;
      }
      res.redirect(301, docsRoutePath(slug, locale));
    } catch (error) {
      if (error instanceof DocsNotFoundError) {
        res.status(404).type('text/plain').send(WEB_COPY[locale].docsNotFound);
        return;
      }
      throw error;
    }
  });

  app.get(/^\/site(?:\.(en|ar|fr|de|es|ru|zh))?\.webmanifest$/, (req, res, next) => {
    const locale = req.params[0] ?? 'en';
    const filename = req.params[0] ? `site.${locale}.webmanifest` : 'site.webmanifest';
    const candidates = [
      ...(production ? [path.resolve(__dirname, 'dist/client', filename)] : []),
      path.resolve(__dirname, 'public', filename),
    ];
    const manifestPath = candidates.find((candidate) => fs.existsSync(candidate));
    if (!manifestPath) return next();
    res
      .set('Content-Language', locale)
      .set('Cache-Control', 'public, max-age=86400')
      .type('application/manifest+json')
      .send(fs.readFileSync(manifestPath, 'utf-8'));
  });

  let vite;
  let template = templateOverride;
  let render = renderOverride;

  if (!production && !render) {
    const { createServer: createViteServer } = await import('vite');
    vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'custom',
    });
    app.use(vite.middlewares);
  } else if (production) {
    const sirv = (await import('sirv')).default;
    const clientDist = path.resolve(__dirname, 'dist/client');
    if (fs.existsSync(clientDist)) {
      app.use(
        '/assets',
        sirv(path.join(clientDist, 'assets'), {
          immutable: true,
          maxAge: 31_536_000,
        }),
      );
      const clientStatic = sirv(clientDist, {
        extensions: [],
        ignores: ['^/index\\.html$'],
      });
      app.use((req, res, next) => {
        if (req.path === '/index.html') return next();
        return clientStatic(req, res, next);
      });
    }
    template ??= fs.readFileSync(
      path.resolve(__dirname, 'dist/client/index.html'),
      'utf-8',
    );
    const serverEntry = pathToFileURL(
      path.resolve(__dirname, 'dist/server/entry-server.js'),
    ).href;
    render ??= (await import(serverEntry)).render;
  }

  app.use('*', async (req, res, next) => {
    const url = req.originalUrl;
    const pathname = req.baseUrl || req.path || url.split('?')[0];
    const requestHostname = req.hostname?.toLowerCase();
    const explicitLocale = explicitPathLocale(pathname);
    const presentationLocale = explicitLocale ??
      (isDocsPath(pathname) ? 'en' : negotiatedLocale(req));
    res.set('Content-Language', presentationLocale);

    const rootTarget = rootRedirectTarget(pathname, url);
    if (rootTarget) {
      return res.redirect(302, rootTarget);
    }

    if (SPLIT_HOSTS && requestHostname === PUBLIC_HOSTNAME && !isPublicPath(pathname)) {
      return res.redirect(302, `${APP_ORIGIN}${url}`);
    }
    if (SPLIT_HOSTS && requestHostname === APP_HOSTNAME) {
      if (isPublicPath(pathname)) {
        return res.redirect(302, `${PUBLIC_ORIGIN}${url}`);
      }
    }

    const portalRequest = isPortalPath(pathname);
    const reportShareRequest = isReportSharePath(pathname);
    // Capability URLs must never be cached, indexed, or sent as Referer values.
    // The policy also covers same-origin API calls made from the CSR decision page.
    const privateSsrRequest =
      portalRequest ||
      reportShareRequest ||
      isInvitationDecisionPath(pathname) ||
      hasInvitationReturnTo(url);
    const nonce = crypto.randomBytes(16).toString('base64');
    res.set('Content-Security-Policy', contentSecurityPolicy(nonce));
    if (privateSsrRequest) {
      res.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
      res.set('Cache-Control', 'private, no-store');
      res.set('Referrer-Policy', 'no-referrer');
      res.set('X-Content-Type-Options', 'nosniff');
    }
    let tpl = template;

    try {
      if (!production) {
        tpl = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf-8');
        if (vite) tpl = await vite.transformIndexHtml(url, tpl);
      } else {
        tpl = template;
      }
      if (!tpl) throw new Error('SSR template is not available');

      // Authenticated app routes: serve the CSR shell (no SSR).
      if (!isPublicPath(pathname)) {
        return res
          .status(200)
          .set('Content-Type', 'text/html')
          .send(renderHtml(tpl, { ssr: false, nonce, locale: presentationLocale }));
      }

      const renderFn = renderOverride ?? (production
        ? render
        : (await vite.ssrLoadModule('/src/entry-server.tsx')).render);
      if (!renderFn) throw new Error('SSR render function is not available');

      const cached = production && !privateSsrRequest ? getCachedRender(url) : undefined;
      const result = cached ?? (await renderFn(url, { docsReader, apiOrigin }));

      if (result.redirect) {
        return res.redirect(result.statusCode || 302, result.redirect);
      }

      // Unmatched public path → real HTTP 404. The public catch-all
      // renders the shared NotFound server-side (appHtml present), so crawlers
      // and AI engines get a hard 404 with the localized not-found page instead
      // of yesterday's soft-404 (200 + blank CSR shell). If NotFound somehow did
      // not render, still return 404 — never a 200 for an unmatched path.
      if (result.statusCode === 404) {
        if (result.appHtml) {
          return res
            .status(404)
            .set('Content-Type', 'text/html')
            .send(
              renderHtml(tpl, {
                headTags: result.headTags,
                htmlAttrs: result.htmlAttrs,
                appHtml: result.appHtml,
                ssr: true,
                nonce,
                locale: presentationLocale,
              }),
            );
        }
        return res
          .status(404)
          .set('Content-Type', 'text/html')
          .send(renderHtml(tpl, { ssr: false, nonce, locale: presentationLocale }));
      }

      // Defensive: a non-404 render with no appHtml → CSR shell.
      if (!result.appHtml) {
        return res
          .status(200)
          .set('Content-Type', 'text/html')
          .send(renderHtml(tpl, { ssr: false, nonce, locale: presentationLocale }));
      }

      if (production && !privateSsrRequest && !cached && result.statusCode === 200) {
        setCachedRender(url, result);
      }

      return res
        .status(result.statusCode || 200)
        .set(
          'Cache-Control',
          privateSsrRequest
            ? 'private, no-store'
            : 'public, s-maxage=300, stale-while-revalidate=600',
        )
        .set('Content-Type', 'text/html')
        .send(
          renderHtml(tpl, {
            headTags: result.headTags,
            htmlAttrs: result.htmlAttrs,
            appHtml: result.appHtml,
            ssr: true,
            nonce,
            locale: presentationLocale,
          }),
        );
    } catch (err) {
      if (vite) vite.ssrFixStacktrace(err);
      console.error('[web] SSR render failed — serving CSR shell', err);
      try {
        if (!tpl) throw err;
        if (privateSsrRequest) {
          return res
            .status(502)
            .set('Content-Type', 'text/html')
            .send(renderHtml(tpl, { ssr: false, nonce, locale: presentationLocale }));
        }
        return res
          .status(200)
          .set('Content-Type', 'text/html')
          .send(renderHtml(tpl, { ssr: false, nonce, locale: presentationLocale }));
      } catch (innerErr) {
        return next(innerErr);
      }
    }
  });

  app.use((err, req, res, _next) => {
    console.error('[web] unhandled error', err);
    const locale = explicitPathLocale(req.path) ?? negotiatedLocale(req);
    res
      .set('Content-Language', locale)
      .status(500)
      .type('text/plain')
      .send(WEB_COPY[locale].internalError);
  });

  let server = null;
  let closeServer = () => Promise.resolve();
  if (listen) {
    server = await new Promise((resolve, reject) => {
      const onListening = () => {
        listener.off('error', reject);
        resolve(listener);
      };
      const listener = serverFactory
        ? serverFactory(app, { port, host, onListening, onError: reject })
        : app.listen(port, host, onListening);
      listener.keepAliveTimeout = 65_000;
      listener.headersTimeout = 66_000;
      listener.once('error', reject);
    });
    console.log(`web server listening on :${port} (${production ? 'prod' : 'dev'})`);

    let closing = false;
    closeServer = () =>
      new Promise((resolve) => {
        if (!server || !server.listening) {
          resolve();
          return;
        }
        server.close(() => resolve());
      });

    if (registerSignals) {
      const handleSigterm = () => {
        if (closing) return;
        closing = true;
        void closeServer().then(() => {
          if (exitOnSigterm) process.exit(0);
        });
      };
      process.on('SIGTERM', handleSigterm);
      server.on('close', () => {
        process.off('SIGTERM', handleSigterm);
      });
    }
  }

  return { app, server, close: () => closeServer() };
}

function __clearSsrCacheForTests() {
  ssrCache.clear();
}

export { createServer, __clearSsrCacheForTests };

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  createServer().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
