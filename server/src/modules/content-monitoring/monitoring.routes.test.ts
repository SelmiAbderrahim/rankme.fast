/**
 * Content-monitoring router integration tests (spec 10). Real PGlite Postgres,
 * mongodb-memory-server, Better Auth sessions, an in-process fake queue + fake
 * provider. Covers cross-account 404, the env kill switch
 * (503 on create, 200 on reads), the active-monitor limit 409 on the 6th, a full
 * create → list → get → pause → resume → delete flow, and the middleware-order
 * guarantee that the unauthenticated webhook sits OUTSIDE the CSRF/auth chain
 * while the product routes are inside it.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Job, Queue } from 'bullmq';
import pino from 'pino';
import { createApp } from '../../app.js';
import { env } from '../../config/env.js';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import {
  installTestAuth,
  signupVerifiedUser,
  uninstallTestAuth,
  type TestUser,
} from '../../shared/testing/auth.js';
import { setSitesDb } from '../sites/index.js';
import {
  setRateLimitMetricsDb,
  setRateLimitMetricsLogger,
} from '../../shared/middleware/rate-limit-metrics.js';
import type { ContentMonitorProvider } from '../../shared/providers/index.js';
import {
  setContentMonitorDb,
  setContentMonitorProvider,
  setContentMonitorQueue,
} from './monitoring.holders.js';

const app = createApp();

function fakeProvider(): ContentMonitorProvider {
  let seq = 0;
  return {
    createMonitor: vi.fn(async () => {
      seq += 1;
      return {
        providerMonitorId: `vendor-${seq}`,
        providerCredentialRef: 'route-test-credential',
        status: 'active',
        cadence: 'weekly',
      };
    }),
    pauseMonitor: vi.fn().mockResolvedValue({ providerMonitorId: 'v', status: 'paused' }),
    resumeMonitor: vi.fn().mockResolvedValue({ providerMonitorId: 'v', status: 'active' }),
    deleteMonitor: vi.fn().mockResolvedValue(undefined),
    getMonitorStatus: vi.fn().mockResolvedValue({ providerMonitorId: 'v', status: 'active' }),
    normalizeWebhookDelivery: vi.fn(),
  } as ContentMonitorProvider;
}

function fakeQueue() {
  const jobs: Array<{ name: string; data: unknown }> = [];
  const queue = {
    async add(name: string, data: unknown): Promise<Job> {
      jobs.push({ name, data });
      return { id: 'x' } as Job;
    },
  } as unknown as Queue;
  return { queue, jobs };
}

// The SSRF authority resolves live DNS; monitor create targets the site origin,
// so stub the global resolver via the module's injected default is not exposed
// here — instead we target `https://example.com` whose real resolution is
// public. Better Auth's trusted origins are unaffected.
// Test auth bypasses CSRF (installTestAuth), so the session cookie alone
// authorizes a mutation — no CSRF header is needed.
async function addSite(user: TestUser, origin = 'https://example.com'): Promise<string> {
  const res = await request(app)
    .post('/api/sites')
    .set('Cookie', user.cookie)
    .send({ url: origin });
  return (res.body as { site: { id: string } }).site.id;
}

const BASE = (siteId: string) => `/api/sites/${siteId}/content-monitoring/monitors`;

beforeAll(async () => {
  await startMemoryMongo();
  await startTestPostgres();
  setSitesDb(getTestDb() as unknown as never);
  setContentMonitorDb(getTestDb() as unknown as never);
  setRateLimitMetricsDb(getTestDb() as unknown as never);
  setRateLimitMetricsLogger(pino({ level: 'silent' }));
  installTestAuth();
});
afterAll(async () => {
  uninstallTestAuth();
  setSitesDb(null);
  setContentMonitorDb(null);
  setContentMonitorProvider(null);
  setContentMonitorQueue(null);
  await stopMemoryMongo();
  await stopTestPostgres();
});

let emailSeq = 0;
async function freshUser(): Promise<TestUser> {
  emailSeq += 1;
  const user = await signupVerifiedUser(app, {
    email: `mon${emailSeq}@example.com`,
    password: 'CorrectHorseBattery9!',
  });
  return user;
}

beforeEach(() => {
  setContentMonitorProvider(fakeProvider());
  setContentMonitorQueue(fakeQueue().queue);
  env.CONTENT_MONITORING_ENABLED = true;
});
afterEach(async () => {
  await clearCollections();
  await truncateAllTables();
  env.CONTENT_MONITORING_ENABLED = true;
});

function auth(user: TestUser) {
  return { Cookie: user.cookie };
}

async function createMonitorReq(user: TestUser, siteId: string, targetUrl: string) {
  return request(app)
    .post(BASE(siteId))
    .set(auth(user))
    .send({ targetUrl, targetKind: 'owned', locale: 'en' });
}

describe('cross-account isolation', () => {

  it('404 for a site owned by another account (no existence leak)', async () => {
    const owner = await freshUser();
    const stranger = await freshUser();
    const siteId = await addSite(owner);
    const res = await request(app).get(BASE(siteId)).set(auth(stranger));
    expect(res.status).toBe(404);
  });
});

describe('kill switch', () => {
  it('503 on create, 200 on reads when CONTENT_MONITORING_ENABLED is off', async () => {
    const user = await freshUser();
    const siteId = await addSite(user);
    env.CONTENT_MONITORING_ENABLED = false;
    const create = await createMonitorReq(user, siteId, 'https://example.com/x');
    expect(create.status).toBe(503);
    const list = await request(app).get(BASE(siteId)).set(auth(user));
    expect(list.status).toBe(200);
  });
});

describe('active-monitor limit', () => {
  it('rejects the 6th monitor with 409', async () => {
    const user = await freshUser();
    const siteId = await addSite(user);
    for (let i = 0; i < 5; i += 1) {
      const res = await createMonitorReq(user, siteId, `https://example.com/p${i}`);
      expect(res.status).toBe(201);
    }
    const sixth = await createMonitorReq(user, siteId, 'https://example.com/p6');
    expect(sixth.status).toBe(409);
  });
});

describe('duplicate create', () => {
  it('returns 200 (not 201) when the same target is created twice', async () => {
    const user = await freshUser();
    const siteId = await addSite(user);
    const first = await createMonitorReq(user, siteId, 'https://example.com/dup');
    expect(first.status).toBe(201);
    const second = await createMonitorReq(user, siteId, 'https://example.com/dup');
    expect(second.status).toBe(200);
    expect((second.body as { duplicate: boolean }).duplicate).toBe(true);
  });
});

describe('change feed pagination', () => {
  it('400s on an invalid cursor query param on the detail route', async () => {
    const user = await freshUser();
    const siteId = await addSite(user);
    const created = await createMonitorReq(user, siteId, 'https://example.com/feed');
    const monitorId = (created.body as { monitor: { monitorId: string } }).monitor.monitorId;
    const res = await request(app)
      .get(`${BASE(siteId)}/${monitorId}?cursor=not-a-real-cursor&limit=5`)
      .set(auth(user));
    expect(res.status).toBe(400);
  });
});

describe('full lifecycle', () => {
  it('create → list → get → pause → resume → delete', async () => {
    const user = await freshUser();
    const siteId = await addSite(user);
    const created = await createMonitorReq(user, siteId, 'https://example.com/watch');
    expect(created.status).toBe(201);
    const monitorId = (created.body as { monitor: { monitorId: string } }).monitor.monitorId;

    const list = await request(app).get(BASE(siteId)).set(auth(user));
    expect(list.status).toBe(200);
    expect((list.body as { monitors: unknown[] }).monitors).toHaveLength(1);
    expect((list.body as { activeLimit: number }).activeLimit).toBe(5);

    const detail = await request(app).get(`${BASE(siteId)}/${monitorId}`).set(auth(user));
    expect(detail.status).toBe(200);
    expect((detail.body as { feed: unknown[] }).feed).toEqual([]);

    const paused = await request(app).post(`${BASE(siteId)}/${monitorId}/pause`).set(auth(user));
    expect(paused.status).toBe(200);
    expect((paused.body as { monitor: { status: string } }).monitor.status).toBe('paused');

    const resumed = await request(app).post(`${BASE(siteId)}/${monitorId}/resume`).set(auth(user));
    expect(resumed.status).toBe(200);

    const del = await request(app).delete(`${BASE(siteId)}/${monitorId}`).set(auth(user));
    expect(del.status).toBe(200);
    const afterList = await request(app).get(BASE(siteId)).set(auth(user));
    expect((afterList.body as { monitors: unknown[] }).monitors).toHaveLength(0);
  });
});

describe('middleware order — webhook is outside the auth chain', () => {
  it('a product route requires auth, but the webhook is reached by the HMAC verifier', async () => {
    const user = await freshUser();
    const siteId = await addSite(user);
    // Product route WITHOUT any cookie → blocked by requireAuth (401).
    const noAuth = await request(app).get(BASE(siteId));
    expect(noAuth.status).toBe(401);

    // Webhook route WITHOUT any cookie, WITH a configured secret + bad signature
    // → the HANDLER's own 401 (`{ received: false }`), NOT the auth-chain 401.
    // Proving it is mounted before express.json and OUTSIDE requireAuth/CSRF.
    const previousApiKey = env.FIRECRAWL_API_KEY;
    const previousFallbackKeys = env.FIRECRAWL_FALLBACK_API_KEYS;
    const previousBindings = env.FIRECRAWL_WEBHOOK_SECRET_BINDINGS;
    try {
      env.FIRECRAWL_API_KEY = 'route-test-api-key';
      env.FIRECRAWL_FALLBACK_API_KEYS = [];
      env.FIRECRAWL_WEBHOOK_SECRET_BINDINGS = [
        { credential: 'primary', secrets: ['a-configured-secret'] },
      ];
      const webhook = await request(app)
        .post('/api/firecrawl/webhook')
        .set('Content-Type', 'application/json')
        .set('X-Firecrawl-Signature', 'sha256=deadbeef')
        .send('{"type":"monitor.check.completed"}');
      expect(webhook.status).toBe(401);
      expect(webhook.body).toEqual({ received: false });
    } finally {
      env.FIRECRAWL_API_KEY = previousApiKey;
      env.FIRECRAWL_FALLBACK_API_KEYS = previousFallbackKeys;
      env.FIRECRAWL_WEBHOOK_SECRET_BINDINGS = previousBindings;
    }
  });
});
