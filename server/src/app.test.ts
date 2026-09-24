import { afterAll, afterEach, beforeAll, describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import type express from 'express';
import {
  cancelLegalAccountPurge,
  createApp,
  resolveAccountWideResourceSiteId,
  resolveOwnedResourceSiteIdFromRequest,
} from './app.js';
import {
  configureHealthController,
  resetHealthController,
} from './modules/health/index.js';
import { setAuth, type Auth } from './modules/auth/index.js';
import { env } from './config/env.js';
import { setAccountPurgeQueue } from './modules/legal/index.js';

describe('app wiring after demo strip', () => {
  const app = createApp();

  beforeAll(() => {
    configureHealthController({
      probeDb: () => true,
      probeRedis: async () => true,
    });
  });
  afterAll(() => resetHealthController());

  it('exposes GET /api/health', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.db).toBe(true);
  });

  it('mounts /api/chat behind authentication', async () => {
    const res = await request(app).get('/api/chat/conversations');
    expect(res.status).toBe(401);
  });

  it('still mounts /api/auth', async () => {
    const res = await request(app).get('/api/auth/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('still mounts /api/users and /api/communication', async () => {
    for (const p of ['/api/users', '/api/communication']) {
      const res = await request(app).get(p + '/__not_a_route__');
      // 401 (auth-guarded router hit its :param route) or 404 (no route matched) —
      // both mean the router itself is mounted.
      expect([401, 404]).toContain(res.status);
    }
  });

  it('attaches a request-id header', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('honors CORS origin from CLIENT_URL', async () => {
    const res = await request(app)
      .options('/api/health')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'GET');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });

  it('honors the exact split APP_URL origin without a wildcard', async () => {
    const originalAppUrl = env.APP_URL;
    env.APP_URL = 'http://app.localhost:3000';
    const splitDomainApp = createApp();
    env.APP_URL = originalAppUrl;

    const allowed = await request(splitDomainApp)
      .options('/api/health')
      .set('Origin', 'http://app.localhost:3000')
      .set('Access-Control-Request-Method', 'GET');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://app.localhost:3000');

    const rejected = await request(splitDomainApp)
      .options('/api/health')
      .set('Origin', 'http://evil.localhost:3000')
      .set('Access-Control-Request-Method', 'GET');
    expect(rejected.headers['access-control-allow-origin']).toBeUndefined();
  });
});

// Better Auth crash guard: a rejecting handler must be routed to the global
// error handler (localized 500), NOT surface as an unhandledRejection.
describe('app / Better Auth handler rejection', () => {
  const app = createApp();

  afterEach(() => setAuth(null));

  it('routes a rejecting auth handler to the error handler, not to unhandledRejection', async () => {
    // Sanctioned test-seam cast: the crash-guard test needs a rejecting
    // handler; the full Auth surface is not required to prove the promise is
    // observed. Recorded in the self-audit.
    setAuth({
      handler: () => Promise.reject(new Error('auth boom')),
    } as unknown as Auth);

    const rejections: unknown[] = [];
    const capture = (reason: unknown) => rejections.push(reason);
    process.on('unhandledRejection', capture);
    // POST is not exempt from the auth limiter but sits well under
    // RATE_LIMIT_AUTH_MAX in a single test run.
    const res = await request(app).post('/api/auth/sign-in/email').send({});
    // Let any stray rejection surface before we assert.
    await new Promise((resolve) => setImmediate(resolve));
    process.off('unhandledRejection', capture);

    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
    expect(typeof res.body.error.message).toBe('string');
    expect(rejections).toEqual([]);
  });
});

describe('app callback wiring', () => {
  afterEach(() => setAccountPurgeQueue(null));

  it('fails closed without a purge queue and removes the exact scheduled job when wired', async () => {
    await expect(
      cancelLegalAccountPurge({ userId: 'account-one' }),
    ).rejects.toThrow('account-purge queue unavailable');

    const remove = vi.fn(async () => true);
    setAccountPurgeQueue({ remove } as never);
    await cancelLegalAccountPurge({ userId: 'account-one' });
    expect(remove).toHaveBeenCalledWith('account-purge-account-one');
  });

  it('passes a missing resource parameter as empty and keeps account-wide legacy resources explicit', async () => {
    const resolveSiteId = vi.fn(async () => null);
    const req = {
      params: {},
      user: { id: 'account-one' },
    } as unknown as express.Request;

    await expect(
      resolveOwnedResourceSiteIdFromRequest(req, resolveSiteId, 'runId'),
    ).resolves.toBeNull();
    expect(resolveSiteId).toHaveBeenCalledWith('account-one', '');
    expect(resolveAccountWideResourceSiteId()).toBeNull();
  });
});
