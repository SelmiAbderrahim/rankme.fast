import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pino } from 'pino';
import {
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
  getTestDb,
} from '../testing/postgres.js';
import { rateLimitHits } from '../../db/schema/rate-limit-hits.js';
import {
  setRateLimitMetricsDb,
  setRateLimitMetricsLogger,
} from './rate-limit-metrics.js';
import {
  apiRateLimitKey,
  BATCH_RATE_LIMIT_BUCKETS,
  classifyRateLimitRoute,
  createBatchRateLimiter,
  createApiIpRateLimiter,
  createApiRateLimiter,
  createAuthRateLimiter,
  createContactRateLimiter,
  createReportShareIpRateLimiter,
  createReportShareTokenRateLimiter,
  markTokenAuthenticated,
  rateLimitHandler,
  resetAuthenticatedTokens,
} from './rate-limit.js';
import { translate, type SupportedLocale } from '../i18n/index.js';
import { env } from '../../config/env.js';
import { createHash } from 'node:crypto';

beforeAll(async () => {
  const db = await startTestPostgres();
  setRateLimitMetricsDb(db as unknown as never);
  setRateLimitMetricsLogger(pino({ level: 'silent' }));
});

afterAll(async () => {
  setRateLimitMetricsDb(null);
  setRateLimitMetricsLogger(null);
  await stopTestPostgres();
});

beforeEach(async () => {
  await truncateAllTables();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('rateLimitHandler direct call', () => {
  const legacyEnvelope = (locale: SupportedLocale) => ({
    error: translate(locale, 'security.error.rateLimited'),
    errorInfo: {
      code: 'SECURITY_ERROR_RATE_LIMITED',
      messageKey: 'security.error.rateLimited',
      message: translate(locale, 'security.error.rateLimited'),
    },
  });

  const fakeRes = (req: unknown) => {
    const jsonSpy = vi.fn();
    const statusSpy = vi.fn().mockReturnValue({ json: jsonSpy });
    const setHeaderSpy = vi.fn();
    const res = {
      status: statusSpy,
      setHeader: setHeaderSpy,
      req,
    } as unknown as Parameters<typeof rateLimitHandler>[1];
    return { res, jsonSpy, statusSpy, setHeaderSpy };
  };

  it('sends 429 with the default-locale message and additive errorInfo', () => {
    const req = { path: '/api/auth/sign-in', ip: '127.0.0.1' } as unknown as Parameters<
      typeof rateLimitHandler
    >[0];
    const { res, jsonSpy, statusSpy, setHeaderSpy } = fakeRes(req);
    rateLimitHandler(req, res);
    expect(statusSpy).toHaveBeenCalledWith(429);
    // The legacy family keeps `error` as a plain string.
    expect(jsonSpy).toHaveBeenCalledWith(legacyEnvelope('en'));
    expect(setHeaderSpy).toHaveBeenCalledWith('Content-Language', 'en');
  });

  it('renders in the resolved request locale', () => {
    const req = {
      path: '/api/auth/sign-in',
      ip: '127.0.0.1',
      language: 'fr',
    } as unknown as Parameters<typeof rateLimitHandler>[0];
    const { res, jsonSpy, setHeaderSpy } = fakeRes(req);
    rateLimitHandler(req, res);
    expect(jsonSpy).toHaveBeenCalledWith(legacyEnvelope('fr'));
    expect(setHeaderSpy).toHaveBeenCalledWith('Content-Language', 'fr');
  });

  it('handles undefined req.ip (still emits 429)', () => {
    const req = { path: '/api/auth/sign-in' } as unknown as Parameters<
      typeof rateLimitHandler
    >[0];
    const { res, statusSpy } = fakeRes(req);
    rateLimitHandler(req, res);
    expect(statusSpy).toHaveBeenCalledWith(429);
  });

  it('handles missing req.path (defensive against unmounted callers)', () => {
    const req = {} as unknown as Parameters<typeof rateLimitHandler>[0];
    const { res, statusSpy } = fakeRes(req);
    rateLimitHandler(req, res);
    expect(statusSpy).toHaveBeenCalledWith(429);
  });

  it('handles req.user set but with no id — recorded as null', () => {
    const req = {
      path: '/api/auth/sign-in',
      user: {},
    } as unknown as Parameters<typeof rateLimitHandler>[0];
    const { res, statusSpy } = fakeRes(req);
    rateLimitHandler(req, res);
    expect(statusSpy).toHaveBeenCalledWith(429);
  });

  it('records accountId when req.user carries a session id', () => {
    const req = {
      path: '/api/auth/sign-in',
      ip: '10.0.0.1',
      user: { id: 'user-42' },
    } as unknown as Parameters<typeof rateLimitHandler>[0];
    const { res, jsonSpy } = fakeRes(req);
    rateLimitHandler(req, res);
    expect(jsonSpy).toHaveBeenCalledWith(legacyEnvelope('en'));
  });
});

describe('rate-limit handler records to rate_limit_hits', () => {
  const batchPaths = {
    content_intelligence_create: '/api/sites/site-1/content-intelligence',
    content_recommendation_state: '/api/content-analyses/507f1f77bcf86cd799439011/recommendations/rec-1/accept',
    inventory_start: '/api/sites/site-1/content-intelligence/inventory',
    competitor_manage: '/api/sites/site-1/competitor-content',
    link_intel: '/api/backlinks/deep/referring-domains',
    firecrawl_webhook: '/api/firecrawl/webhook',
    mcp: '/api/mcp',
    superadmin_ops: '/api/superadmin/providers',
  } as const;

  it('classifies and records every intelligence-batch bucket', async () => {
    expect(classifyRateLimitRoute({
      originalUrl: '/api/v1/sites',
      method: 'GET',
    } as unknown as express.Request)).toBe('api');
    expect(classifyRateLimitRoute({
      originalUrl: '/api/report-exports/export-1/download',
      method: 'GET',
    } as unknown as express.Request)).toBe('report_exports_download');
    expect(classifyRateLimitRoute({
      originalUrl: '/api/report-exports/export-1',
      method: 'GET',
    } as unknown as express.Request)).toBe('report_exports_manage');
    expect(classifyRateLimitRoute({
      originalUrl: '/api/report-exports',
      method: 'POST',
    } as unknown as express.Request)).toBe('report_exports_create');
    expect(classifyRateLimitRoute({
      originalUrl: '/api/report-exports?limit=20',
      method: 'GET',
    } as unknown as express.Request)).toBe('report_exports_manage');
    for (const [route, path] of Object.entries(batchPaths)) {
      const req = { originalUrl: path, ip: '203.0.113.1' } as unknown as express.Request;
      expect(classifyRateLimitRoute(req)).toBe(route);
      const json = vi.fn();
      const res = {
        req,
        status: () => ({ json }),
        setHeader: () => undefined,
      } as unknown as express.Response;
      rateLimitHandler(req, res);
    }
    expect(classifyRateLimitRoute({
      originalUrl: '/api/sites/site-1/content-intelligence/recommendations',
      method: 'POST',
    } as unknown as express.Request)).toBe('content_recommendation_state');
    expect(classifyRateLimitRoute({
      originalUrl: '/api/backlinks/gap/example-run',
      method: 'GET',
    } as unknown as express.Request)).toBe('auth');
    expect(classifyRateLimitRoute({
      originalUrl: '/api/competitors/traffic-snapshots',
      method: 'POST',
    } as unknown as express.Request)).toBe('competitor_manage');
    // Review Intelligence: mutations bucket to `review_sync`; stored-result
    // reads fall through to the default bucket.
    expect(classifyRateLimitRoute({
      originalUrl: '/api/local-seo/reviews/sync',
      method: 'POST',
    } as unknown as express.Request)).toBe('review_sync');
    expect(classifyRateLimitRoute({
      originalUrl: '/api/local-seo/reviews/runs',
      method: 'GET',
    } as unknown as express.Request)).toBe('auth');
    expect(classifyRateLimitRoute({
      originalUrl: '/api/keyword-research/trends/explore',
      method: 'POST',
    } as unknown as express.Request)).toBe('auth');
    expect(classifyRateLimitRoute({
      originalUrl: '/api/keyword-research/trends',
      method: 'GET',
    } as unknown as express.Request)).toBe('auth');
    // Content Intelligence poll bucket — GET on the analysis list/detail
    // paths classifies to `content_intelligence_poll`; a state-changing
    // POST on the same path classifies to `content_intelligence_create`.
    const pollReq = {
      originalUrl: '/api/sites/site-1/content-analyses',
      method: 'GET',
      ip: '203.0.113.2',
    } as unknown as express.Request;
    expect(classifyRateLimitRoute(pollReq)).toBe('content_intelligence_poll');
    rateLimitHandler(pollReq, {
      req: pollReq,
      status: () => ({ json: vi.fn() }),
      setHeader: () => undefined,
    } as unknown as express.Response);
    const cancelReq = {
      originalUrl: '/api/content-analyses/abc123/cancel',
      method: 'POST',
      ip: '203.0.113.3',
    } as unknown as express.Request;
    expect(classifyRateLimitRoute(cancelReq)).toBe('content_intelligence_create');
    await new Promise((resolve) => setImmediate(resolve));
    const rows = await getTestDb().select().from(rateLimitHits);
    expect(rows.map(({ route }) => route).sort()).toEqual(
      [...Object.keys(batchPaths), 'content_intelligence_poll'].sort(),
    );
  });

  it('reads a named bucket limit from env and records its explicit name', async () => {
    const original = env.RATE_LIMIT_CONTENT_CREATE_MAX;
    (env as { RATE_LIMIT_CONTENT_CREATE_MAX: number }).RATE_LIMIT_CONTENT_CREATE_MAX = 1;
    const app = express();
    app.use(createBatchRateLimiter('content_intelligence_create', { windowMs: 60_000 }));
    app.get('/api/sites/site-1/content-intelligence', (_req, res) => res.json({ ok: true }));
    await request(app).get('/api/sites/site-1/content-intelligence');
    expect((await request(app).get('/api/sites/site-1/content-intelligence')).status).toBe(429);
    await new Promise((resolve) => setImmediate(resolve));
    expect((await getTestDb().select().from(rateLimitHits))[0]?.route).toBe('content_intelligence_create');
    (env as { RATE_LIMIT_CONTENT_CREATE_MAX: number }).RATE_LIMIT_CONTENT_CREATE_MAX = original;
  });

  it('keys account buckets by the authenticated account', async () => {
    const app = express();
    app.use((req, _res, next) => {
      req.user = { id: 'account-1' } as typeof req.user;
      next();
    });
    app.use(createBatchRateLimiter('content_intelligence_create', { max: 1, windowMs: 60_000 }));
    app.get('/api/sites/site-1/content-intelligence', (_req, res) => res.json({ ok: true }));
    expect((await request(app).get('/api/sites/site-1/content-intelligence')).status).toBe(200);
    expect((await request(app).get('/api/sites/site-1/content-intelligence')).status).toBe(429);
  });

  it('returns the structured coded envelope for buckets that carry an error code', async () => {
    const app = express();
    app.use((req, _res, next) => {
      req.user = { id: 'account-coded' } as typeof req.user;
      next();
    });
    app.use(createBatchRateLimiter('pages_read', { max: 1, windowMs: 60_000 }));
    app.get('/api/sites/site-1/pages', (_req, res) => res.json({ ok: true }));
    expect((await request(app).get('/api/sites/site-1/pages')).status).toBe(200);
    const overflow = await request(app).get('/api/sites/site-1/pages');
    expect(overflow.status).toBe(429);
    expect(overflow.body).toEqual({
      error: {
        code: 'PAGES_RATE_LIMITED',
        message: translate('en', 'pages.errors.rateLimited'),
        messageKey: 'pages.errors.rateLimited',
      },
    });
  });

  it('uses one bounded fallback bucket when account and IP are unavailable', async () => {
    const app = express();
    app.use((req, _res, next) => {
      Object.defineProperty(req, 'ip', { configurable: true, value: undefined });
      next();
    });
    app.use(createBatchRateLimiter('content_intelligence_create', { max: 1, windowMs: 60_000 }));
    app.get('/api/sites/site-1/content-intelligence', (_req, res) => res.json({ ok: true }));
    expect((await request(app).get('/api/sites/site-1/content-intelligence')).status).toBe(200);
    expect((await request(app).get('/api/sites/site-1/content-intelligence')).status).toBe(429);
  });

  it('builds every named bucket with its documented keying mode', () => {
    expect(BATCH_RATE_LIMIT_BUCKETS.keyword_trends.keying).toBe('account');
    expect(BATCH_RATE_LIMIT_BUCKETS.link_intel_poll).toMatchObject({
      keying: 'account',
      window: 'RATE_LIMIT_LINK_INTEL_POLL_WINDOW_MS',
      max: 'RATE_LIMIT_LINK_INTEL_POLL_MAX',
      metricsRoute: 'link_intel',
    });
    expect(typeof createBatchRateLimiter('mcp')).toBe('function');
    for (const bucket of Object.keys(BATCH_RATE_LIMIT_BUCKETS) as Array<keyof typeof BATCH_RATE_LIMIT_BUCKETS>) {
      expect(typeof createBatchRateLimiter(bucket, { max: 2, windowMs: 1_000 })).toBe('function');
    }
  });

  it('auth limiter → route=auth', async () => {
    const app = express();
    app.use(createAuthRateLimiter({ max: 1, windowMs: 60_000 }));
    // Credential mutations are POSTs; the limiter exempts read-only GETs.
    app.post('/api/auth/sign-in', (_req, res) => {
      res.status(200).json({ ok: true });
    });
    await request(app).post('/api/auth/sign-in');
    const overflow = await request(app).post('/api/auth/sign-in');
    expect(overflow.status).toBe(429);
    // Give the fire-and-forget insert a tick to settle.
    await new Promise((r) => setImmediate(r));
    const rows = await getTestDb().select().from(rateLimitHits);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.route).toBe('auth');
  });

  it('still emits 429 even when the metrics insert fails', async () => {
    const brokenDb = {
      insert: () => ({ values: () => Promise.reject(new Error('boom')) }),
    };
    setRateLimitMetricsDb(brokenDb as never);
    const app = express();
    app.use(createAuthRateLimiter({ max: 1, windowMs: 60_000 }));
    app.post('/api/auth/x', (_req, res) => {
      res.status(200).json({ ok: true });
    });
    await request(app).post('/api/auth/x');
    const overflow = await request(app).post('/api/auth/x');
    expect(overflow.status).toBe(429);
    setRateLimitMetricsDb(getTestDb() as unknown as never);
  });

  it('applies the public report-share IP and token abuse boundaries', async () => {
    const ipApp = express();
    ipApp.use((req, _res, next) => {
      req.language = 'de';
      next();
    });
    ipApp.use(createReportShareIpRateLimiter({ max: 1, windowMs: 60_000 }));
    ipApp.get('/api/report-exports/shares/token', (_req, res) => res.json({ ok: true }));

    expect((await request(ipApp).get('/api/report-exports/shares/token')).status).toBe(200);
    const ipOverflow = await request(ipApp).get('/api/report-exports/shares/token');
    expect(ipOverflow.status).toBe(429);
    expect(ipOverflow.body).toEqual({
      error: translate('de', 'reportExports.errors.rateLimited'),
      errorInfo: {
        code: 'REPORT_EXPORTS_ERRORS_RATE_LIMITED',
        messageKey: 'reportExports.errors.rateLimited',
        message: translate('de', 'reportExports.errors.rateLimited'),
      },
    });

    const tokenApp = express();
    tokenApp.use(createReportShareTokenRateLimiter({ max: 1, windowMs: 60_000 }));
    tokenApp.get('/api/report-exports/shares/token', (_req, res) => res.json({ ok: true }));

    expect((await request(tokenApp).get('/api/report-exports/shares/token')).status).toBe(200);
    expect((await request(tokenApp).get('/api/report-exports/shares/token')).status).toBe(429);

    const unknownTokenApp = express();
    unknownTokenApp.use((req, _res, next) => {
      Object.defineProperty(req, 'ip', { configurable: true, value: undefined });
      next();
    });
    unknownTokenApp.use(createReportShareTokenRateLimiter({ max: 1, windowMs: 60_000 }));
    unknownTokenApp.get('/api/report-exports/shares/token', (_req, res) => res.json({ ok: true }));

    expect((await request(unknownTokenApp).get('/api/report-exports/shares/token')).status).toBe(200);
    expect((await request(unknownTokenApp).get('/api/report-exports/shares/token')).status).toBe(429);
  });
});

describe('apiRateLimitKey — proven-token gate', () => {
  beforeEach(() => {
    resetAuthenticatedTokens();
  });

  it('an unproven bearer token keys by IP (no per-token bucket allocated)', () => {
    const req = {
      get: (name: string) => (name === 'authorization' ? 'Bearer rmf_unknown' : undefined),
      ip: '10.9.9.9',
    } as unknown as express.Request;
    expect(apiRateLimitKey(req)).toBe('10.9.9.9');
  });

  it('an authenticated bearer token keys by its sha256 hash', () => {
    const hash = createHash('sha256').update('rmf_proven').digest('hex');
    markTokenAuthenticated(hash);
    const req = {
      get: (name: string) => (name === 'authorization' ? 'Bearer rmf_proven' : undefined),
      ip: '10.9.9.9',
    } as unknown as express.Request;
    expect(apiRateLimitKey(req)).toBe(hash);
  });

  it('no Authorization header keys by IP', () => {
    const req = {
      get: () => undefined,
      ip: '10.9.9.9',
    } as unknown as express.Request;
    expect(apiRateLimitKey(req)).toBe('10.9.9.9');
  });

  it('missing req.ip falls back to "unknown"', () => {
    const req = { get: () => undefined } as unknown as express.Request;
    expect(apiRateLimitKey(req)).toBe('unknown');
  });
});

describe('markTokenAuthenticated eviction', () => {
  beforeEach(() => {
    resetAuthenticatedTokens();
  });

  it('evicts the oldest entry once the cap is reached', () => {
    // The cap is 10_000. Fill it, then push one more and confirm the
    // very-first entry is no longer proven.
    const CAP = 10_000;
    const first = createHash('sha256').update('first').digest('hex');
    markTokenAuthenticated(first);
    for (let i = 1; i < CAP; i += 1) {
      markTokenAuthenticated(createHash('sha256').update(`t${i}`).digest('hex'));
    }
    // Cap reached; add one more → oldest (`first`) evicted.
    markTokenAuthenticated(createHash('sha256').update('overflow').digest('hex'));
    const reqFirst = {
      get: (name: string) => (name === 'authorization' ? 'Bearer first' : undefined),
      ip: '1.1.1.1',
    } as unknown as express.Request;
    expect(apiRateLimitKey(reqFirst)).toBe('1.1.1.1');
  });

  it('resetAuthenticatedTokens clears the set', () => {
    const hash = createHash('sha256').update('cleared').digest('hex');
    markTokenAuthenticated(hash);
    resetAuthenticatedTokens();
    const req = {
      get: (name: string) =>
        name === 'authorization' ? 'Bearer cleared' : undefined,
      ip: '2.2.2.2',
    } as unknown as express.Request;
    expect(apiRateLimitKey(req)).toBe('2.2.2.2');
  });
});

describe('rate-limit factories honor overrides + env defaults', () => {
  it('createApiIpRateLimiter accepts overrides and falls back to env', () => {
    const withOverride = createApiIpRateLimiter({ max: 3, windowMs: 1_000 });
    expect(typeof withOverride).toBe('function');
    const withDefaults = createApiIpRateLimiter();
    expect(typeof withDefaults).toBe('function');
  });

  it('createApiRateLimiter accepts overrides and falls back to env', () => {
    const withOverride = createApiRateLimiter({ max: 3, windowMs: 1_000 });
    expect(typeof withOverride).toBe('function');
    const withDefaults = createApiRateLimiter();
    expect(typeof withDefaults).toBe('function');
  });

  it('createContactRateLimiter accepts overrides and falls back to env', () => {
    const withOverride = createContactRateLimiter({ max: 3, windowMs: 1_000 });
    expect(typeof withOverride).toBe('function');
    const withDefaults = createContactRateLimiter();
    expect(typeof withDefaults).toBe('function');
    expect(env.RATE_LIMIT_CONTACT_MAX).toBeGreaterThan(0);
  });
});
