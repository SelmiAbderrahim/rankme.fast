/** HTTP acceptance tests for the SERP-overlap clustering workflow. */
import type { Queue } from 'bullmq';
import { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../app.js';
import { env } from '../../config/env.js';
import { keywords as keywordsTable } from '../../db/schema/keywords.js';
import { serpObservations } from '../../db/schema/serp-observations.js';
import {
  installTestAuth,
  signupVerifiedUser,
  uninstallTestAuth,
  type TestUser,
} from '../../shared/testing/auth.js';
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
import { Site } from '../sites/sites.model.js';
import {
  setKeywordClustersDb,
  setKeywordClustersQueue,
} from './keyword-clusters.holder.js';
import { SerpClusterRun } from './keyword-clusters.model.js';

const app = createApp();
let sequence = 0;

const url = (n: number): string => `https://serp-${n}.example/page`;

async function seedUser() {
  sequence += 1;
  return signupVerifiedUser(app, {
    email: `keyword-clusters-${sequence}@example.test`,
  });
}

async function seedSite(user: TestUser, domain = 'clusters.test') {
  const site = await Site.create({
    accountId: new Types.ObjectId(user.id),
    url: `https://${domain}`,
    domain,
    displayName: domain,
  });
  return String(site._id);
}

interface SeedKeywordInput {
  user: TestUser;
  siteId: string;
  phrase: string;
  /** Omit to seed a keyword with NO observation at all. */
  urls?: readonly number[];
  checkedAt?: Date;
  active?: boolean;
  engine?: 'google' | 'bing';
}

async function seedKeyword(input: SeedKeywordInput): Promise<string> {
  const db = getTestDb();
  const [row] = await db
    .insert(keywordsTable)
    .values({
      accountId: input.user.id,
      siteId: input.siteId,
      phrase: input.phrase,
      locationCode: 2840,
      languageCode: 'en',
      device: 'desktop',
      engine: input.engine ?? 'google',
      active: input.active ?? true,
    })
    .returning({ id: keywordsTable.id });
  const keywordId = row!.id;
  if (input.urls) {
    await db.insert(serpObservations).values({
      accountId: input.user.id,
      siteId: input.siteId,
      keywordId,
      engine: 'google',
      checkedAt: input.checkedAt ?? new Date(),
      source: 'fresh',
      features: { features: [], featuredSnippet: null, paa: [] },
      topResults: input.urls.map((n, index) => ({
        domain: `serp-${n}.example`,
        url: url(n),
        rankGroup: index + 1,
        rankAbsolute: index + 1,
      })),
    });
  }
  return keywordId;
}

/** Two keywords that share three of ten results — one grouped cluster. */
async function seedGroupablePair(user: TestUser, siteId: string) {
  const a = await seedKeyword({ user, siteId, phrase: 'aaa shoes', urls: [1, 2, 3, 4] });
  const b = await seedKeyword({ user, siteId, phrase: 'bbb shoes', urls: [1, 2, 3, 9] });
  return { a, b };
}

function fakeQueue(options: { reject?: boolean } = {}) {
  const add = options.reject
    ? vi.fn(async () => {
        throw new Error('redis unavailable');
      })
    : vi.fn(async () => ({ id: 'queued' }));
  return { queue: { add } as unknown as Queue, add };
}

const preview = (user: TestUser, siteId: string, body: object = {}) =>
  request(app)
    .post(`/api/sites/${siteId}/keyword-cluster-runs/preview`)
    .set('Cookie', user.cookie)
    .send(body);

const start = (user: TestUser, siteId: string, body: object = {}) =>
  request(app)
    .post(`/api/sites/${siteId}/keyword-cluster-runs`)
    .set('Cookie', user.cookie)
    .send(body);

beforeAll(async () => {
  await startMemoryMongo();
  const db = await startTestPostgres();
  installTestAuth();
  setKeywordClustersDb(db as never);
});

afterAll(async () => {
  uninstallTestAuth();
  setKeywordClustersQueue(null);
  setKeywordClustersDb(null);
  (env as { KEYWORD_CLUSTERING_ENABLED: boolean }).KEYWORD_CLUSTERING_ENABLED = false;
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  (env as { KEYWORD_CLUSTERING_ENABLED: boolean }).KEYWORD_CLUSTERING_ENABLED = true;
  setKeywordClustersQueue(fakeQueue().queue);
});

describe('keyword-cluster HTTP auth and validation', () => {
  it('protects every route and validates ids, bodies, and list bounds', async () => {
    const id = new Types.ObjectId().toString();
    await request(app)
      .post(`/api/sites/${id}/keyword-cluster-runs/preview`)
      .send({})
      .expect(401);
    await request(app).post(`/api/sites/${id}/keyword-cluster-runs`).send({}).expect(401);
    await request(app).get(`/api/sites/${id}/keyword-cluster-runs`).expect(401);
    await request(app).get(`/api/keyword-cluster-runs/${id}`).expect(401);

    const user = await seedUser();
    await preview(user, 'bad-id').expect(400);
    // Body/query validation is asserted against a site this account owns: the
    // site work lease resolves ownership ahead of the route, so a well-formed
    // id for a site that does not exist is a 404 long before zod sees a body.
    const ownedSiteId = await seedSite(user);
    await start(user, ownedSiteId, { locale: 'it' }).expect(400);
    await start(user, ownedSiteId, { locale: 'en', surprise: true }).expect(400);
    await start(user, ownedSiteId, { keywordIds: ['not-a-uuid'] }).expect(400);
    await request(app)
      .get(`/api/sites/${ownedSiteId}/keyword-cluster-runs?limit=51`)
      .set('Cookie', user.cookie)
      .expect(400);
    await request(app)
      .get('/api/keyword-cluster-runs/not-an-id')
      .set('Cookie', user.cookie)
      .expect(400);
  });

  it('returns 404 for a foreign or unknown site and run — never 403', async () => {
    const owner = await seedUser();
    const stranger = await seedUser();
    const siteId = await seedSite(owner);
    await seedGroupablePair(owner, siteId);

    await preview(stranger, siteId).expect(404);
    await start(stranger, siteId).expect(404);
    await request(app)
      .get(`/api/sites/${siteId}/keyword-cluster-runs`)
      .set('Cookie', stranger.cookie)
      .expect(404);

    const created = await start(owner, siteId).expect(202);
    await request(app)
      .get(`/api/keyword-cluster-runs/${created.body.id}`)
      .set('Cookie', stranger.cookie)
      .expect(404);
  });
});

describe('keyword-cluster preflight', () => {
  it('previews the frozen thresholds with the community spend preview', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    await seedGroupablePair(user, siteId);

    const res = await preview(user, siteId).expect(200);
    expect(res.body).toMatchObject({
      ready: true,
      reason: null,
      readyCount: 2,
      blockedTotal: 0,
      minSharedUrls: 3,
      topUrlWindow: 10,
      freshnessDays: 7,
      minKeywords: 2,
      spend: { deploymentMode: 'community', capacityEnforced: false },
    });
    expect(res.body).not.toHaveProperty('aiSpend');
    expect(await SerpClusterRun.countDocuments({ accountId: user.id })).toBe(0);
  });

  it('starts repeated runs without any usage ceiling', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    await seedGroupablePair(user, siteId);

    for (let index = 0; index < 5; index += 1) {
      await start(user, siteId).expect(202);
    }
    expect(await SerpClusterRun.countDocuments({ accountId: user.id })).toBe(5);
  });

  it('lists every blocked keyword with its reason', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    await seedGroupablePair(user, siteId);
    await seedKeyword({ user, siteId, phrase: 'zzz never checked' });
    await seedKeyword({
      user,
      siteId,
      phrase: 'zzz stale',
      urls: [1, 2, 3],
      checkedAt: new Date(Date.now() - 8 * 86_400_000),
    });
    await seedKeyword({ user, siteId, phrase: 'zzz empty serp', urls: [] });

    const res = await preview(user, siteId).expect(200);
    expect(res.body.readyCount).toBe(2);
    expect(res.body.blockedTotal).toBe(3);
    expect(
      res.body.blocked.map((row: { phrase: string; reason: string }) => [
        row.phrase,
        row.reason,
      ]),
    ).toEqual([
      ['zzz empty serp', 'empty'],
      ['zzz never checked', 'missing'],
      ['zzz stale', 'stale'],
    ]);
  });

  it('refuses below two ready keywords BEFORE creating a run', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    await seedKeyword({ user, siteId, phrase: 'only one', urls: [1, 2, 3] });
    await seedKeyword({ user, siteId, phrase: 'stale one', urls: [1, 2, 3],
      checkedAt: new Date(Date.now() - 30 * 86_400_000) });

    const previewed = await preview(user, siteId).expect(200);
    expect(previewed.body).toMatchObject({
      ready: false,
      reason: 'notEnoughKeywords',
      spend: null,
    });

    await start(user, siteId).expect(409);
    expect(await SerpClusterRun.countDocuments({ accountId: user.id })).toBe(0);
  });

  it('ignores inactive and non-Google keywords', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    await seedGroupablePair(user, siteId);
    await seedKeyword({ user, siteId, phrase: 'inactive', urls: [1, 2, 3], active: false });
    await seedKeyword({ user, siteId, phrase: 'bing one', urls: [1, 2, 3], engine: 'bing' });

    const res = await preview(user, siteId).expect(200);
    expect(res.body.readyCount).toBe(2);
    expect(res.body.blockedTotal).toBe(0);
  });

  it('honours an explicit keyword subset', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    const { a, b } = await seedGroupablePair(user, siteId);
    await seedKeyword({ user, siteId, phrase: 'ccc shoes', urls: [1, 2, 3, 7] });

    const all = await preview(user, siteId).expect(200);
    expect(all.body.readyCount).toBe(3);

    const subset = await preview(user, siteId, { keywordIds: [a, b] }).expect(200);
    expect(subset.body.readyCount).toBe(2);

    const run = await start(user, siteId, { keywordIds: [a, b] }).expect(202);
    expect(run.body.keywordCount).toBe(2);
  });
});

describe('keyword-cluster run records and stored reads', () => {
  it('creates a queued run pinned to the ready set and lists it back free', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    const { a, b } = await seedGroupablePair(user, siteId);
    await seedKeyword({ user, siteId, phrase: 'zzz never checked' });

    const created = await start(user, siteId, { keywordIds: [a, b] }).expect(202);
    expect(created.body).toMatchObject({
      status: 'queued',
      aiStatus: 'pending',
      minSharedUrls: 3,
      topUrlWindow: 10,
      keywordCount: 2,
      blockedCount: 0,
      clusterCount: 0,
      groupedClusterCount: 0,
      error: null,
    });
    expect(created.body.rulesVersion).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/u);

    const stored = await SerpClusterRun.findById(created.body.id).lean();
    expect(stored?.keywordIds).toHaveLength(2);
    expect(stored?.inputs).toHaveLength(2);
    expect(stored?.blocked).toHaveLength(0);

    const listed = await request(app)
      .get(`/api/sites/${siteId}/keyword-cluster-runs`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(listed.body.items).toHaveLength(1);

    const detail = await request(app)
      .get(`/api/keyword-cluster-runs/${created.body.id}`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(detail.body.blocked).toEqual([]);
  });

  it('marks the run failed when the queue refuses the job', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    await seedGroupablePair(user, siteId);
    setKeywordClustersQueue(fakeQueue({ reject: true }).queue);

    await start(user, siteId).expect(503);
    const stored = await SerpClusterRun.findOne({ accountId: user.id }).lean();
    expect(stored?.status).toBe('failed');
    expect(stored?.error?.category).toBe('queue_failed');
  });

  it('refuses to start with no queue wired', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    await seedGroupablePair(user, siteId);
    setKeywordClustersQueue(null);
    await start(user, siteId).expect(503);
    expect(await SerpClusterRun.countDocuments({ accountId: user.id })).toBe(0);
  });
});

describe('keyword-cluster kill switch', () => {
  it('refuses preview and create while stored reads stay open', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    await seedGroupablePair(user, siteId);
    const created = await start(user, siteId).expect(202);

    (env as { KEYWORD_CLUSTERING_ENABLED: boolean }).KEYWORD_CLUSTERING_ENABLED = false;
    await preview(user, siteId).expect(503);
    await start(user, siteId).expect(503);

    await request(app)
      .get(`/api/sites/${siteId}/keyword-cluster-runs`)
      .set('Cookie', user.cookie)
      .expect(200);
    await request(app)
      .get(`/api/keyword-cluster-runs/${created.body.id}`)
      .set('Cookie', user.cookie)
      .expect(200);
  });
});
