/**
 * Competitor content router integration tests (spec 09). Real PGlite Postgres
 * (generated migrations), mongodb-memory-server, Better Auth sessions, an
 * in-process fake queue. Covers open access for every verified account,
 * cross-account 404, the kill switch (503 on run start, 200 on reads), the
 * `competitor_manage` / `content_intelligence_poll` rate buckets, zod 400
 * before any run is created, manual-add unsafe-URL 400, registrable dedupe,
 * and a full suggest → add → run → read flow.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
import { competitors } from '../../db/schema/index.js';
import {
  setRateLimitMetricsDb,
  setRateLimitMetricsLogger,
} from '../../shared/middleware/rate-limit-metrics.js';
import {
  setCompetitorContentDb,
  setCompetitorContentQueue,
} from './competitor-content.holders.js';

const app = createApp();

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

async function addSite(user: TestUser, origin = 'https://example.com'): Promise<string> {
  const res = await request(app).post('/api/sites').set('Cookie', user.cookie).send({ url: origin });
  return (res.body as { site: { id: string } }).site.id;
}

const BASE = (siteId: string) => `/api/sites/${siteId}/competitor-content`;

beforeAll(async () => {
  await startMemoryMongo();
  await startTestPostgres();
  setSitesDb(getTestDb() as unknown as never);
  setCompetitorContentDb(getTestDb() as unknown as never);
  setRateLimitMetricsDb(getTestDb() as unknown as never);
  setRateLimitMetricsLogger(pino({ level: 'silent' }));
  installTestAuth();
});
afterAll(async () => {
  uninstallTestAuth();
  setSitesDb(null);
  setCompetitorContentDb(null);
  setCompetitorContentQueue(null);
  await stopMemoryMongo();
  await stopTestPostgres();
});

let emailSeq = 0;
async function freshUser(): Promise<TestUser> {
  emailSeq += 1;
  return signupVerifiedUser(app, { email: `cc${emailSeq}@example.com`, password: 'CorrectHorseBattery9!' });
}

beforeEach(() => {
  setCompetitorContentQueue(fakeQueue().queue);
});
afterEach(async () => {
  await clearCollections();
  await truncateAllTables();
});

describe('open access + cross-account isolation', () => {
  it('serves every verified account without a plan gate', async () => {
    const user = await freshUser();
    const siteId = await addSite(user);
    const res = await request(app).get(`${BASE(siteId)}/suggestions`).set('Cookie', user.cookie);
    expect(res.status).toBe(200);
  });

  it('404 for a site owned by another account (no existence leak)', async () => {
    const alice = await freshUser();
    const bob = await freshUser();
    const bobSite = await addSite(bob);
    const res = await request(app).get(`${BASE(bobSite)}/suggestions`).set('Cookie', alice.cookie);
    expect(res.status).toBe(404);
  });
});

describe('competitor management', () => {
  it('suggests from the competitors snapshot, confirms, dedups, lists, archives, restores', async () => {
    const user = await freshUser();
    const siteId = await addSite(user);
    await getTestDb().insert(competitors).values({
      siteId, accountId: user.id, competitorDomain: 'rival.com', intersections: 7, source: 'domain', fetchedAt: new Date(), snapshotDay: '2026-07-20',
    });

    const suggest = await request(app).get(`${BASE(siteId)}/suggestions`).set('Cookie', user.cookie);
    expect(suggest.status).toBe(200);
    expect((suggest.body as { suggestions: unknown[] }).suggestions).toHaveLength(1);

    const add = await request(app).post(`${BASE(siteId)}/competitors`).set('Cookie', user.cookie).send({ url: 'https://example.org' });
    expect(add.status).toBe(201);
    const cid = (add.body as { profile: { id: string } }).profile.id;

    // Registrable dedupe → 200 duplicate.
    const dup = await request(app).post(`${BASE(siteId)}/competitors`).set('Cookie', user.cookie).send({ url: 'https://www.example.org/x' });
    expect(dup.status).toBe(200);
    expect((dup.body as { duplicate: boolean }).duplicate).toBe(true);

    const list = await request(app).get(`${BASE(siteId)}/competitors`).set('Cookie', user.cookie);
    expect((list.body as { competitors: unknown[] }).competitors).toHaveLength(1);

    const archived = await request(app).post(`${BASE(siteId)}/competitors/${cid}/archive`).set('Cookie', user.cookie);
    expect((archived.body as { profile: { status: string } }).profile.status).toBe('archived');
    const restored = await request(app).post(`${BASE(siteId)}/competitors/${cid}/restore`).set('Cookie', user.cookie);
    expect((restored.body as { profile: { status: string } }).profile.status).toBe('active');
  });

  it('400 for an unsafe (private) competitor URL', async () => {
    const user = await freshUser();
    const siteId = await addSite(user);
    const res = await request(app).post(`${BASE(siteId)}/competitors`).set('Cookie', user.cookie).send({ url: 'https://127.0.0.1/' });
    expect(res.status).toBe(400);
  });
});

describe('run start — validation and kill switch', () => {
  async function confirmedSite(user: TestUser): Promise<{ siteId: string; cid: string }> {
    const siteId = await addSite(user);
    const add = await request(app).post(`${BASE(siteId)}/competitors`).set('Cookie', user.cookie).send({ url: 'https://example.org' });
    return { siteId, cid: (add.body as { profile: { id: string } }).profile.id };
  }

  it('zod 400 (empty competitorIds) before any run is created', async () => {
    const user = await freshUser();
    const siteId = await addSite(user);
    const res = await request(app).post(`${BASE(siteId)}/runs`).set('Cookie', user.cookie).send({ competitorIds: [], ownedUrl: 'https://example.com/p', locale: 'en' });
    expect(res.status).toBe(400);
  });

  it('starts a run, lists it, reads its detail, and cancels it', async () => {
    const user = await freshUser();
    const { siteId, cid } = await confirmedSite(user);
    const start = await request(app).post(`${BASE(siteId)}/runs`).set('Cookie', user.cookie)
      .send({ competitorIds: [cid], competitorUrls: [{ competitorId: cid, url: 'https://example.org/ranking-page' }], ownedUrl: 'https://example.com/page', keyword: 'shoes', locale: 'en' });
    expect(start.status).toBe(202);
    const runId = (start.body as { runId: string }).runId;

    const list = await request(app).get(`${BASE(siteId)}/runs`).set('Cookie', user.cookie);
    expect((list.body as { items: unknown[] }).items).toHaveLength(1);

    // A supplied (garbage) cursor exercises the controller's cursor spread → 400.
    const badCursor = await request(app).get(`${BASE(siteId)}/runs?cursor=garbage`).set('Cookie', user.cookie);
    expect(badCursor.status).toBe(400);

    const detail = await request(app).get(`${BASE(siteId)}/runs/${runId}`).set('Cookie', user.cookie);
    expect(detail.status).toBe(200);
    expect((detail.body as { status: string }).status).toBe('queued');

    const cancel = await request(app).post(`${BASE(siteId)}/runs/${runId}/cancel`).set('Cookie', user.cookie);
    expect(cancel.status).toBe(202);
  });

  it('kill switch: 503 on run start, 200 on reads', async () => {
    const user = await freshUser();
    const { siteId, cid } = await confirmedSite(user);
    const prior = env.COMPETITOR_CONTENT_INTELLIGENCE_ENABLED;
    (env as { COMPETITOR_CONTENT_INTELLIGENCE_ENABLED: boolean }).COMPETITOR_CONTENT_INTELLIGENCE_ENABLED = false;
    try {
      const start = await request(app).post(`${BASE(siteId)}/runs`).set('Cookie', user.cookie)
        .send({ competitorIds: [cid], ownedUrl: 'https://example.com/page', locale: 'en' });
      expect(start.status).toBe(503);
      const reads = await request(app).get(`${BASE(siteId)}/runs`).set('Cookie', user.cookie);
      expect(reads.status).toBe(200);
    } finally {
      (env as { COMPETITOR_CONTENT_INTELLIGENCE_ENABLED: boolean }).COMPETITOR_CONTENT_INTELLIGENCE_ENABLED = prior;
    }
  });

});

describe('rate buckets', () => {
  it('429s the competitor_manage bucket on a burst of mutations', async () => {
    const priorMax = env.RATE_LIMIT_COMPETITOR_MAX;
    const priorWin = env.RATE_LIMIT_COMPETITOR_WINDOW_MS;
    (env as { RATE_LIMIT_COMPETITOR_MAX: number }).RATE_LIMIT_COMPETITOR_MAX = 1;
    (env as { RATE_LIMIT_COMPETITOR_WINDOW_MS: number }).RATE_LIMIT_COMPETITOR_WINDOW_MS = 60_000;
    const rateApp = createApp();
    setCompetitorContentQueue(fakeQueue().queue);
    try {
      const user = await freshUser();
      const siteId = await addSite(user);
      const first = await request(rateApp).post(`${BASE(siteId)}/competitors`).set('Cookie', user.cookie).send({ url: 'https://example.org' });
      expect(first.status).toBeLessThan(429);
      const second = await request(rateApp).post(`${BASE(siteId)}/competitors`).set('Cookie', user.cookie).send({ url: 'https://example.net' });
      expect(second.status).toBe(429);
    } finally {
      (env as { RATE_LIMIT_COMPETITOR_MAX: number }).RATE_LIMIT_COMPETITOR_MAX = priorMax;
      (env as { RATE_LIMIT_COMPETITOR_WINDOW_MS: number }).RATE_LIMIT_COMPETITOR_WINDOW_MS = priorWin;
    }
  });

  it('429s the content_intelligence_poll bucket on a burst of reads', async () => {
    const priorMax = env.RATE_LIMIT_CONTENT_POLL_MAX;
    const priorWin = env.RATE_LIMIT_CONTENT_POLL_WINDOW_MS;
    (env as { RATE_LIMIT_CONTENT_POLL_MAX: number }).RATE_LIMIT_CONTENT_POLL_MAX = 1;
    (env as { RATE_LIMIT_CONTENT_POLL_WINDOW_MS: number }).RATE_LIMIT_CONTENT_POLL_WINDOW_MS = 60_000;
    const rateApp = createApp();
    try {
      const user = await freshUser();
      const siteId = await addSite(user);
      const first = await request(rateApp).get(`${BASE(siteId)}/competitors`).set('Cookie', user.cookie);
      expect(first.status).toBeLessThan(429);
      const second = await request(rateApp).get(`${BASE(siteId)}/competitors`).set('Cookie', user.cookie);
      expect(second.status).toBe(429);
    } finally {
      (env as { RATE_LIMIT_CONTENT_POLL_MAX: number }).RATE_LIMIT_CONTENT_POLL_MAX = priorMax;
      (env as { RATE_LIMIT_CONTENT_POLL_WINDOW_MS: number }).RATE_LIMIT_CONTENT_POLL_WINDOW_MS = priorWin;
    }
  });
});
