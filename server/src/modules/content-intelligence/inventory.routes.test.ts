/**
 * Content inventory + cannibalization — router + service integration tests
 * (prompt 08). Real PGlite Postgres (generated migrations), mongodb-memory-
 * server, Better Auth-backed sessions, and an in-process fake queue. Covers:
 *
 *   - cross-account 404 (no existence leak);
 *   - kill switch → 503 on create, 200 on reads;
 *   - `inventory_start` rate limiter → 429 on the 6th start/min;
 *   - zod 400 BEFORE any write;
 *   - whole-block sizing math (1→1, 4→1, 5→2, 100→25);
 *   - idempotent duplicate returns the existing run without a second run;
 *   - single-active-run guard → 409;
 *   - URL-safety failure never writes; enqueue failure marks the run failed;
 *   - get/list/cancel.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Job, Queue } from 'bullmq';
import type { NextFunction, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
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
import { setSitesDb, Site } from '../sites/index.js';
import { contentInventoryEvents } from '../../db/schema/content-inventory-events.js';
import {
  setRateLimitMetricsDb,
  setRateLimitMetricsLogger,
} from '../../shared/middleware/rate-limit-metrics.js';
import {
  setContentInventoryQueue,
  setContentIntelligenceDb,
} from './content-intelligence.holders.js';
import { ContentInventoryRun } from './inventory.model.js';
import { resolveInventoryDb, startInventoryController } from './inventory.controller.js';
import { listInventoryRuns } from './inventory.service.js';

const app = createApp();

function fakeQueue(overrides: { onAdd?: () => void | Promise<void> } = {}) {
  const jobs: Array<{ name: string; data: unknown; opts: { jobId?: string } }> = [];
  const queue = {
    async add(name: string, data: unknown, opts: { jobId?: string }): Promise<Job> {
      await overrides.onAdd?.();
      jobs.push({ name, data, opts });
      return { id: opts.jobId } as Job;
    },
  } as unknown as Queue;
  return { queue, jobs };
}

async function addSite(user: TestUser, origin = 'https://example.com'): Promise<string> {
  const res = await request(app).post('/api/sites').set('Cookie', user.cookie).send({ url: origin });
  return (res.body as { site: { id: string } }).site.id;
}

async function eventsFor(accountId: string) {
  return getTestDb()
    .select()
    .from(contentInventoryEvents)
    .where(eq(contentInventoryEvents.accountId, accountId));
}

const START_PATH = (siteId: string) => `/api/sites/${siteId}/content-intelligence/inventory`;

beforeAll(async () => {
  await startMemoryMongo();
  await startTestPostgres();
  setSitesDb(getTestDb() as unknown as never);
  setContentIntelligenceDb(getTestDb() as unknown as never);
  setRateLimitMetricsDb(getTestDb() as unknown as never);
  setRateLimitMetricsLogger(pino({ level: 'silent' }));
  installTestAuth();
});

afterAll(async () => {
  uninstallTestAuth();
  setSitesDb(null);
  setContentIntelligenceDb(null);
  setContentInventoryQueue(null);
  await stopMemoryMongo();
  await stopTestPostgres();
});

let emailSeq = 0;
async function freshUser(): Promise<TestUser> {
  emailSeq += 1;
  const user = await signupVerifiedUser(app, {
    email: `inv${emailSeq}@example.com`,
    password: 'CorrectHorseBattery9!',
  });
  return user;
}

beforeEach(() => {
  const { queue } = fakeQueue();
  setContentInventoryQueue(queue);
});

afterEach(async () => {
  await clearCollections();
  await truncateAllTables();
});

describe('POST inventory — kill switch + validation', () => {
  it('returns 404 for a site owned by another account (no existence leak)', async () => {
    const alice = await freshUser();
    const bob = await freshUser();
    const bobSite = await addSite(bob);
    const res = await request(app)
      .post(START_PATH(bobSite))
      .set('Cookie', alice.cookie)
      .send({ pageLimit: 4, locale: 'en' });
    expect(res.status).toBe(404);
  });

  it('kill switch: 503 on create, 200 on reads when CONTENT_INVENTORY_ENABLED=false', async () => {
    const prior = env.CONTENT_INVENTORY_ENABLED;
    (env as { CONTENT_INVENTORY_ENABLED: boolean }).CONTENT_INVENTORY_ENABLED = false;
    try {
      const user = await freshUser();
      const siteId = await addSite(user);
      const create = await request(app)
        .post(START_PATH(siteId))
        .set('Cookie', user.cookie)
        .send({ pageLimit: 4, locale: 'en' });
      expect(create.status).toBe(503);
      // Reads stay open.
      const list = await request(app).get(START_PATH(siteId)).set('Cookie', user.cookie);
      expect(list.status).toBe(200);
    } finally {
      (env as { CONTENT_INVENTORY_ENABLED: boolean }).CONTENT_INVENTORY_ENABLED = prior;
    }
  });

  it('rejects an invalid body with 400 BEFORE any write', async () => {
    const user = await freshUser();
    const siteId = await addSite(user);
    const res = await request(app)
      .post(START_PATH(siteId))
      .set('Cookie', user.cookie)
      .send({ pageLimit: 0, locale: 'en' });
    expect(res.status).toBe(400);
    expect(await ContentInventoryRun.countDocuments({ accountId: user.id })).toBe(0);
  });

  it('429s the 6th start within the window', async () => {
    const priorMax = env.RATE_LIMIT_INVENTORY_MAX;
    (env as { RATE_LIMIT_INVENTORY_MAX: number }).RATE_LIMIT_INVENTORY_MAX = 5;
    const freshApp = createApp();
    setContentInventoryQueue(fakeQueue().queue);
    try {
      const user = await freshUser();
      const siteId = await addSite(user);
      const statuses: number[] = [];
      for (let i = 0; i < 6; i += 1) {
        const res = await request(freshApp)
          .post(START_PATH(siteId))
          .set('Cookie', user.cookie)
          .send({ pageLimit: 4, locale: 'en', clientKey: `k${i}` });
        statuses.push(res.status);
      }
      expect(statuses[5]).toBe(429);
    } finally {
      (env as { RATE_LIMIT_INVENTORY_MAX: number }).RATE_LIMIT_INVENTORY_MAX = priorMax;
    }
  });
});

describe('POST inventory — block math', () => {
  it('sizes runs in ceil(pageLimit/4) whole blocks (1→1, 4→1, 5→2, 100→25)', async () => {
    const priorMax = env.RATE_LIMIT_INVENTORY_MAX;
    (env as { RATE_LIMIT_INVENTORY_MAX: number }).RATE_LIMIT_INVENTORY_MAX = 999;
    const freshApp = createApp();
    setContentInventoryQueue(fakeQueue().queue);
    try {
      const user = await freshUser();
      // Distinct, publicly-resolvable origins (assertPublicUrlSafe hits real DNS).
      const cases: Array<[number, number, string]> = [
        [1, 1, 'https://example.com'],
        [4, 1, 'https://example.org'],
        [5, 2, 'https://example.net'],
        [100, 25, 'https://www.example.com'],
      ];
      for (const [pageLimit, blocks, origin] of cases) {
        const siteId = await addSite(user, origin);
        const res = await request(freshApp)
          .post(START_PATH(siteId))
          .set('Cookie', user.cookie)
          .send({ pageLimit, locale: 'en' });
        expect(res.status).toBe(202);
        expect((res.body as { reservedBlocks: number }).reservedBlocks).toBe(blocks);
        const run = await ContentInventoryRun.findById((res.body as { runId: string }).runId);
        expect(run?.progress.blocksReserved).toBe(blocks);
      }
    } finally {
      (env as { RATE_LIMIT_INVENTORY_MAX: number }).RATE_LIMIT_INVENTORY_MAX = priorMax;
    }
  });
});

describe('POST inventory — idempotency + single-active-run', () => {
  it('a duplicate identical request returns the existing run without a second run', async () => {
    const user = await freshUser();
    const siteId = await addSite(user);
    const first = await request(app)
      .post(START_PATH(siteId))
      .set('Cookie', user.cookie)
      .send({ pageLimit: 4, locale: 'en' });
    expect(first.status).toBe(202);
    const second = await request(app)
      .post(START_PATH(siteId))
      .set('Cookie', user.cookie)
      .send({ pageLimit: 4, locale: 'en' });
    expect(second.status).toBe(202);
    expect((second.body as { duplicate: boolean }).duplicate).toBe(true);
    expect((second.body as { runId: string }).runId).toBe(
      (first.body as { runId: string }).runId,
    );
    expect(await ContentInventoryRun.countDocuments({ accountId: user.id })).toBe(1);
  });

  it('a second DIFFERENT run while one is active returns 409', async () => {
    const user = await freshUser();
    const siteId = await addSite(user);
    const first = await request(app)
      .post(START_PATH(siteId))
      .set('Cookie', user.cookie)
      .send({ pageLimit: 4, locale: 'en' });
    expect(first.status).toBe(202);
    const second = await request(app)
      .post(START_PATH(siteId))
      .set('Cookie', user.cookie)
      .send({ pageLimit: 8, locale: 'en' });
    expect(second.status).toBe(409);
  });
});

describe('POST inventory — happy path + reads + cancel', () => {
  it('starts a run (202), records no event until terminal, and reads it back', async () => {
    const user = await freshUser();
    const siteId = await addSite(user);
    const res = await request(app)
      .post(START_PATH(siteId))
      .set('Cookie', user.cookie)
      .send({ pageLimit: 4, locale: 'en' });
    expect(res.status).toBe(202);
    const runId = (res.body as { runId: string }).runId;

    expect(await eventsFor(user.id)).toEqual([]);

    const detail = await request(app)
      .get(`${START_PATH(siteId)}/${runId}`)
      .set('Cookie', user.cookie);
    expect(detail.status).toBe(200);
    expect((detail.body as { status: string }).status).toBe('queued');
    expect((detail.body as { pages: unknown[] }).pages).toEqual([]);

    const list = await request(app).get(START_PATH(siteId)).set('Cookie', user.cookie);
    expect(list.status).toBe(200);
    expect((list.body as { items: unknown[] }).items).toHaveLength(1);

    // A malformed cursor exercises the controller's cursor-present branch and
    // the service cursor decode guard (400).
    const badCursor = await request(app)
      .get(`${START_PATH(siteId)}?cursor=garbage`)
      .set('Cookie', user.cookie);
    expect(badCursor.status).toBe(400);
  });

  it('covers the production-db fallback and the controller authentication guard', async () => {
    setContentIntelligenceDb(null);
    try {
      expect(resolveInventoryDb()).toBeDefined();
      const error = await new Promise<unknown>((resolve) => {
        startInventoryController(
          {} as Request,
          {} as Response,
          ((value?: unknown) => resolve(value)) as NextFunction,
        );
      });
      expect(error).toMatchObject({ status: 401 });
      const workspaceError = await new Promise<unknown>((resolve) => {
        startInventoryController(
          { workspaceAccountId: '000000000000000000000abc' } as Request,
          {} as Response,
          ((value?: unknown) => resolve(value)) as NextFunction,
        );
      });
      expect(workspaceError).toMatchObject({ status: 401 });
    } finally {
      setContentIntelligenceDb(getTestDb() as unknown as never);
    }
  });

  it('cancels a queued run (202)', async () => {
    const user = await freshUser();
    const siteId = await addSite(user);
    const res = await request(app)
      .post(START_PATH(siteId))
      .set('Cookie', user.cookie)
      .send({ pageLimit: 4, locale: 'en' });
    const runId = (res.body as { runId: string }).runId;

    const cancel = await request(app)
      .post(`${START_PATH(siteId)}/${runId}/cancel`)
      .set('Cookie', user.cookie);
    expect(cancel.status).toBe(202);

    const doc = await ContentInventoryRun.findById(runId);
    expect(doc?.status).toBe('cancelled');
    expect(doc?.error?.category).toBe('cancelled');
  });

  it('returns 404 for an unknown run id and a cross-account run', async () => {
    const alice = await freshUser();
    const aliceSite = await addSite(alice);
    const bob = await freshUser();
    const bobSite = await addSite(bob);
    const created = await request(app)
      .post(START_PATH(bobSite))
      .set('Cookie', bob.cookie)
      .send({ pageLimit: 4, locale: 'en' });
    const runId = (created.body as { runId: string }).runId;
    const res = await request(app)
      .get(`${START_PATH(aliceSite)}/${runId}`)
      .set('Cookie', alice.cookie);
    expect(res.status).toBe(404);
  });
});

describe('POST inventory — URL safety + enqueue compensation', () => {
  it('an origin that resolves private never writes a run (400)', async () => {
    const user = await freshUser();
    const site = await Site.create({
      accountId: user.id,
      url: 'https://127.0.0.1',
      domain: '127.0.0.1',
      label: 'private',
    });
    const res = await request(app)
      .post(START_PATH(String(site._id)))
      .set('Cookie', user.cookie)
      .send({ pageLimit: 4, locale: 'en' });
    expect(res.status).toBe(400);
    expect(await ContentInventoryRun.countDocuments({ accountId: user.id })).toBe(0);
  });

  it('an unsafe sitemap seed never writes a run (400)', async () => {
    const user = await freshUser();
    const siteId = await addSite(user);
    const res = await request(app)
      .post(START_PATH(siteId))
      .set('Cookie', user.cookie)
      .send({ pageLimit: 4, locale: 'en', sitemapSeeds: ['http://127.0.0.1/sitemap.xml'] });
    expect(res.status).toBe(400);
    expect(await ContentInventoryRun.countDocuments({ accountId: user.id })).toBe(0);
  });

  it('enqueue failure marks the run failed (503 + failed event)', async () => {
    const user = await freshUser();
    const siteId = await addSite(user);
    const throwing = fakeQueue({
      onAdd: () => {
        throw new Error('redis down');
      },
    });
    setContentInventoryQueue(throwing.queue);
    const res = await request(app)
      .post(START_PATH(siteId))
      .set('Cookie', user.cookie)
      .send({ pageLimit: 4, locale: 'en' });
    expect(res.status).toBe(503);
    const doc = await ContentInventoryRun.findOne({ accountId: user.id });
    expect(doc?.status).toBe('failed');
    const events = await eventsFor(user.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'failed', errorCategory: 'unexpected', reservationKey: doc?.idempotencyKey });
  });
});

// The route suite can never reach the service-level ownership guard:
// `siteMutationLease` answers 404 for an unowned or missing site before the
// router runs. This is the defence-in-depth layer every non-HTTP caller hits.
describe('content-inventory service ownership guard', () => {
  const GUARD_ACCOUNT = '6a6fa7c28d75c2fd32d84a63';
  it('refuses a well-formed site id this account does not own', async () => {
    await expect(listInventoryRuns({ accountId: GUARD_ACCOUNT, siteId: '6a6fa7c28d75c2fd32d84a99', limit: 10 })).rejects.toMatchObject({ status: 404 });
  });

  it('refuses a malformed site id', async () => {
    await expect(listInventoryRuns({ accountId: GUARD_ACCOUNT, siteId: 'not-an-id', limit: 10 })).rejects.toMatchObject({ status: 404 });
  });
});
