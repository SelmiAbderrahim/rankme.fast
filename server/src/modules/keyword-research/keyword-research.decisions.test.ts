/**
 * Cluster decision routing tests.
 *
 * Covers the full contract from spec 13 §7:
 *   - Auth / verified gate
 *   - Cross-account 404 for run, cluster, and site ownership
 *   - `accepted` delegates exactly one Content Intelligence recommendation
 *     via the public API; the returned id is deterministic
 *   - `dismissed` records the event only (no recommendation)
 *   - Idempotency: same key + same kind → 200 no-op with original row
 *   - 409: different kind with same key OR any prior non-matching decision
 *   - Localized 409 message body
 *   - Privacy: hostile phrases and cluster labels never surface in logs,
 *     DTOs, or error responses
 *   - Public `keyword-research/*` grep-clean of `modules/competitors` imports
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import mongoose from 'mongoose';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import type { Express } from 'express';
import { createApp } from '../../app.js';
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
import { setRanksDb } from '../ranks/index.js';
import {
  setKeywordProvider,
  setKeywordResearchAiRunner,
  setKeywordResearchCompetitorProvider,
  setKeywordResearchDb,
} from './keyword-research.holder.js';
import {
  createFakeCompetitorProvider,
  createFakeKeywordProvider,
} from '../../shared/providers/index.js';
import { createAiProfileRunner } from '../../shared/ai-profiles/index.js';
import { createFakeAiGenerationProvider } from '../../shared/providers/ai-generation-fake.js';
import { KeywordClusterRun } from './keyword-cluster-runs.model.js';
import {
  KEYWORD_CLUSTER_RECOMMENDATION_PREFIX,
  createRecommendationForKeywordCluster,
} from '../content-intelligence/index.js';
import { keywordClusterDecisionEvents } from '../../db/schema/index.js';
import { Site } from '../sites/index.js';
import { logger } from '../../config/logger.js';
import {
  applyClusterDecision,
  assertSiteOwnedOrNotFound,
  serializeDecision,
} from './keyword-research.decisions.js';

let app: Express;
let mongoUri: string;

it('rejects a valid but unowned site at the direct ownership boundary', async () => {
  await expect(
    assertSiteOwnedOrNotFound(
      new mongoose.Types.ObjectId().toHexString(),
      new mongoose.Types.ObjectId().toHexString(),
    ),
  ).rejects.toMatchObject({
    status: 404,
    message: 'keywordResearch.errors.siteNotFound',
  });
});

async function seedUser(email: string): Promise<TestUser> {
  return signupVerifiedUser(app, { email });
}

async function seedSite(accountId: string, domain: string): Promise<string> {
  const site = await Site.create({
    accountId,
    url: `https://${domain}`,
    domain,
    displayName: '',
  });
  return String(site._id);
}

const RUN_ID = 'a'.repeat(64);
// Real cluster ids are 32-hex sha256 prefixes (clustering pipeline
// `slice(0, 32)`); the previous 64-hex synthetic ids masked a param-schema
// mismatch that 400ed every real decision (defect J6a).
const CLUSTER_ID_A = 'b'.repeat(32);
const CLUSTER_ID_B = 'c'.repeat(32);

async function seedClusterRun(accountId: string, opts?: {
  runId?: string;
  clusters?: Array<{
    clusterId: string;
    label: string;
    memberKeywords: string[];
    suggestedRoute: 'brief' | 'seo';
  }>;
}): Promise<{ runId: string; clusterId: string }> {
  const runId = opts?.runId ?? RUN_ID;
  const clusters = opts?.clusters ?? [
    {
      clusterId: CLUSTER_ID_A,
      label: 'seo basics',
      memberKeywords: ['seo tools', 'keyword tracker'],
      suggestedRoute: 'brief' as const,
    },
  ];
  await KeywordClusterRun.create({
    runId,
    accountId,
    market: { locationCode: 2840, languageCode: 'en' },
    memberRefs: [
      { keyword: 'seo tools', source: 'vendor_cache', observedAt: new Date() },
    ],
    clusters: clusters.map((c) => ({
      ...c,
      confidence: 'medium' as const,
      summedSearchVolume: 100,
    })),
    aiProfile: { name: 'keyword_clustering', version: '1.0.0' },
    costMicros: 5_000,
  });
  return { runId, clusterId: clusters[0]!.clusterId };
}

beforeAll(async () => {
  mongoUri = await startMemoryMongo();
  await mongoose.connect(mongoUri);
  const db = await startTestPostgres();
  app = createApp();
  installTestAuth();
  setKeywordResearchDb(db as unknown as never);
  setRanksDb(db as unknown as never);
  setKeywordProvider(createFakeKeywordProvider());
  setKeywordResearchCompetitorProvider(createFakeCompetitorProvider());
  setKeywordResearchAiRunner(
    createAiProfileRunner({ provider: createFakeAiGenerationProvider() }),
    ['fake'],
  );
}, 120_000);

afterAll(async () => {
  uninstallTestAuth();
  setKeywordResearchDb(null);
  setRanksDb(null);
  setKeywordProvider(null);
  setKeywordResearchCompetitorProvider(null);
  setKeywordResearchAiRunner(null, ['fake']);
  await mongoose.disconnect();
  await stopMemoryMongo();
  await stopTestPostgres();
});

beforeEach(async () => {
  await truncateAllTables();
  await clearCollections();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Pure public API — createRecommendationForKeywordCluster
// ---------------------------------------------------------------------------

describe('createRecommendationForKeywordCluster', () => {
  it('returns a deterministic namespaced recommendation id', () => {
    const a = createRecommendationForKeywordCluster({
      accountId: 'acct-1',
      siteId: 'site-1',
      runId: 'run-1',
      clusterId: 'cluster-1',
      memberKeywords: ['a', 'b'],
      suggestedRoute: 'brief',
      aiProfile: { name: 'keyword_clustering', version: '1.0.0' },
    });
    const b = createRecommendationForKeywordCluster({
      accountId: 'acct-1',
      siteId: 'site-1',
      runId: 'run-1',
      clusterId: 'cluster-1',
      memberKeywords: ['different', 'members'],
      suggestedRoute: 'seo',
      aiProfile: { name: 'other', version: '9.9.9' },
    });
    expect(a.recommendationId).toBe(b.recommendationId);
    expect(a.recommendationId.startsWith(KEYWORD_CLUSTER_RECOMMENDATION_PREFIX)).toBe(
      true,
    );
    expect(a.recommendationId).toMatch(/^keyword-cluster:[a-f0-9]{32}$/);
  });

  it('produces distinct ids across different accounts / sites / runs / clusters', () => {
    const base = {
      accountId: 'acct-a',
      siteId: 'site-a',
      runId: 'run-a',
      clusterId: 'cluster-a',
      memberKeywords: ['x'],
      suggestedRoute: 'brief' as const,
      aiProfile: { name: 'kc', version: '1' },
    };
    const b = createRecommendationForKeywordCluster(base).recommendationId;
    const otherAccount = createRecommendationForKeywordCluster({
      ...base,
      accountId: 'acct-b',
    }).recommendationId;
    const otherSite = createRecommendationForKeywordCluster({
      ...base,
      siteId: 'site-b',
    }).recommendationId;
    const otherRun = createRecommendationForKeywordCluster({
      ...base,
      runId: 'run-b',
    }).recommendationId;
    const otherCluster = createRecommendationForKeywordCluster({
      ...base,
      clusterId: 'cluster-b',
    }).recommendationId;
    expect(new Set([b, otherAccount, otherSite, otherRun, otherCluster]).size).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// serializeDecision — pure projection to the wire shape.
// ---------------------------------------------------------------------------

describe('serializeDecision', () => {
  it('maps the row to the ISO-timestamped API shape', () => {
    const now = new Date('2026-07-18T12:00:00Z');
    expect(
      serializeDecision({
        id: '00000000-0000-4000-8000-000000000000',
        accountId: 'acct-1',
        runId: RUN_ID,
        clusterId: CLUSTER_ID_A,
        kind: 'accepted',
        siteId: '000000000000000000000001',
        recommendationId: 'keyword-cluster:aaaa',
        idempotencyKey: 'key-1',
        note: null,
        createdAt: now,
      }),
    ).toEqual({
      id: '00000000-0000-4000-8000-000000000000',
      runId: RUN_ID,
      clusterId: CLUSTER_ID_A,
      kind: 'accepted',
      siteId: '000000000000000000000001',
      recommendationId: 'keyword-cluster:aaaa',
      createdAt: '2026-07-18T12:00:00.000Z',
    });
  });
});

// ---------------------------------------------------------------------------
// Router — cross-cutting gate coverage
// ---------------------------------------------------------------------------

describe('POST /api/keyword-research/clusters/:runId/clusters/:clusterId/decision', () => {
  const path = (runId: string, clusterId: string) =>
    `/api/keyword-research/clusters/${runId}/clusters/${clusterId}/decision`;

  it('401s when unauthenticated', async () => {
    const res = await request(app)
      .post(path(RUN_ID, CLUSTER_ID_A))
      .send({ kind: 'dismissed', idempotencyKey: 'k-1' });
    expect(res.status).toBe(401);
  });

  it('404s when the run does not exist for the account', async () => {
    const user = await seedUser('missing-run@decisions.test');
    const res = await request(app)
      .post(path(RUN_ID, CLUSTER_ID_A))
      .set('Cookie', user.cookie)
      .send({ kind: 'dismissed', idempotencyKey: 'k-1' });
    expect(res.status).toBe(404);
    expect(res.body.error?.message).toContain('clustering run');
  });

  it('404s when another account owns the run (no existence leak)', async () => {
    const alice = await seedUser('alice@decisions.test');
    const bob = await seedUser('bob@decisions.test');
    await seedClusterRun(alice.id);
    const res = await request(app)
      .post(path(RUN_ID, CLUSTER_ID_A))
      .set('Cookie', bob.cookie)
      .send({ kind: 'dismissed', idempotencyKey: 'k-1' });
    expect(res.status).toBe(404);
    expect(res.body.error?.message).toContain('clustering run');
  });

  it('404s when the cluster is not in the run', async () => {
    const user = await seedUser('missing-cluster@decisions.test');
    await seedClusterRun(user.id);
    const res = await request(app)
      .post(path(RUN_ID, CLUSTER_ID_B))
      .set('Cookie', user.cookie)
      .send({ kind: 'dismissed', idempotencyKey: 'k-1' });
    expect(res.status).toBe(404);
    expect(res.body.error?.message).toContain('cluster');
  });

  it('422s on invalid body (missing kind)', async () => {
    const user = await seedUser('badbody@decisions.test');
    await seedClusterRun(user.id);
    const res = await request(app)
      .post(path(RUN_ID, CLUSTER_ID_A))
      .set('Cookie', user.cookie)
      .send({ idempotencyKey: 'k-1' });
    expect(res.status).toBe(400);
  });

  it('422s when siteId is missing on accepted', async () => {
    const user = await seedUser('no-site@decisions.test');
    await seedClusterRun(user.id);
    const res = await request(app)
      .post(path(RUN_ID, CLUSTER_ID_A))
      .set('Cookie', user.cookie)
      .send({ kind: 'accepted', idempotencyKey: 'k-1' });
    expect(res.status).toBe(400);
  });

  it('422s when siteId is present on dismissed', async () => {
    const user = await seedUser('extra-site@decisions.test');
    await seedClusterRun(user.id);
    const siteId = await seedSite(user.id, 'ex.example');
    const res = await request(app)
      .post(path(RUN_ID, CLUSTER_ID_A))
      .set('Cookie', user.cookie)
      .send({ kind: 'dismissed', idempotencyKey: 'k-1', siteId });
    expect(res.status).toBe(400);
  });

  it('422s when idempotencyKey is empty', async () => {
    const user = await seedUser('nokey@decisions.test');
    await seedClusterRun(user.id);
    const res = await request(app)
      .post(path(RUN_ID, CLUSTER_ID_A))
      .set('Cookie', user.cookie)
      .send({ kind: 'dismissed', idempotencyKey: '' });
    expect(res.status).toBe(400);
  });

  it('422s when idempotencyKey exceeds max length', async () => {
    const user = await seedUser('longkey@decisions.test');
    await seedClusterRun(user.id);
    const res = await request(app)
      .post(path(RUN_ID, CLUSTER_ID_A))
      .set('Cookie', user.cookie)
      .send({ kind: 'dismissed', idempotencyKey: 'x'.repeat(201) });
    expect(res.status).toBe(400);
  });

  it('422s when note exceeds max length', async () => {
    const user = await seedUser('longnote@decisions.test');
    await seedClusterRun(user.id);
    const res = await request(app)
      .post(path(RUN_ID, CLUSTER_ID_A))
      .set('Cookie', user.cookie)
      .send({ kind: 'dismissed', idempotencyKey: 'k-1', note: 'x'.repeat(501) });
    expect(res.status).toBe(400);
  });

  it('422s when the runId param is not a 64-hex string', async () => {
    const user = await seedUser('badrunid@decisions.test');
    const res = await request(app)
      .post(path('nothex', CLUSTER_ID_A))
      .set('Cookie', user.cookie)
      .send({ kind: 'dismissed', idempotencyKey: 'k-1' });
    expect(res.status).toBe(400);
  });

  it('422s when the clusterId param is not a 64-hex string', async () => {
    const user = await seedUser('badcid@decisions.test');
    const res = await request(app)
      .post(path(RUN_ID, 'nothex'))
      .set('Cookie', user.cookie)
      .send({ kind: 'dismissed', idempotencyKey: 'k-1' });
    expect(res.status).toBe(400);
  });

  it('422s when siteId is not a 24-hex ObjectId', async () => {
    const user = await seedUser('badsite@decisions.test');
    await seedClusterRun(user.id);
    const res = await request(app)
      .post(path(RUN_ID, CLUSTER_ID_A))
      .set('Cookie', user.cookie)
      .send({ kind: 'accepted', idempotencyKey: 'k-1', siteId: 'nothex' });
    expect(res.status).toBe(400);
  });

  it('records a dismissed decision with no recommendation and no site link', async () => {
    const user = await seedUser('dismiss@decisions.test');
    await seedClusterRun(user.id);
    const res = await request(app)
      .post(path(RUN_ID, CLUSTER_ID_A))
      .set('Cookie', user.cookie)
      .send({ kind: 'dismissed', idempotencyKey: 'k-1', note: 'not now' });
    expect(res.status).toBe(201);
    expect(res.body.kind).toBe('dismissed');
    expect(res.body.siteId).toBeNull();
    expect(res.body.recommendationId).toBeNull();

    const rows = await getTestDb().select().from(keywordClusterDecisionEvents);
    expect(rows.length).toBe(1);
    expect(rows[0]!.note).toBe('not now');
  });

  it('accepted delegates ONE Content Intelligence recommendation and stores the id', async () => {
    const user = await seedUser('accept@decisions.test');
    await seedClusterRun(user.id);
    const siteId = await seedSite(user.id, 'acc.example');
    const res = await request(app)
      .post(path(RUN_ID, CLUSTER_ID_A))
      .set('Cookie', user.cookie)
      .send({ kind: 'accepted', idempotencyKey: 'k-1', siteId });
    expect(res.status).toBe(201);
    expect(res.body.kind).toBe('accepted');
    expect(res.body.siteId).toBe(siteId);
    expect(res.body.recommendationId).toMatch(/^keyword-cluster:[a-f0-9]{32}$/);
    expect(res.body.recommendationId).toBe(
      createRecommendationForKeywordCluster({
        accountId: user.id,
        siteId,
        runId: RUN_ID,
        clusterId: CLUSTER_ID_A,
        memberKeywords: ['seo tools', 'keyword tracker'],
        suggestedRoute: 'brief',
        aiProfile: { name: 'keyword_clustering', version: '1.0.0' },
      }).recommendationId,
    );

    // Exactly one row inserted for this cluster.
    const rows = await getTestDb()
      .select()
      .from(keywordClusterDecisionEvents)
      .where(eq(keywordClusterDecisionEvents.clusterId, CLUSTER_ID_A));
    expect(rows.length).toBe(1);
  });

  it('accepted 404s when the site is owned by another account (no leak)', async () => {
    const alice = await seedUser('alice-site@decisions.test');
    const bob = await seedUser('bob-site@decisions.test');
    await seedClusterRun(bob.id);
    const aliceSite = await seedSite(alice.id, 'alice.example');
    const res = await request(app)
      .post(path(RUN_ID, CLUSTER_ID_A))
      .set('Cookie', bob.cookie)
      .send({ kind: 'accepted', idempotencyKey: 'k-1', siteId: aliceSite });
    expect(res.status).toBe(404);
    expect(res.body.error?.message).toContain('Site');
  });

  it('replays same key + same kind as a 200 no-op returning the original row', async () => {
    const user = await seedUser('replay@decisions.test');
    await seedClusterRun(user.id);
    const first = await request(app)
      .post(path(RUN_ID, CLUSTER_ID_A))
      .set('Cookie', user.cookie)
      .send({ kind: 'dismissed', idempotencyKey: 'k-1' });
    expect(first.status).toBe(201);
    const second = await request(app)
      .post(path(RUN_ID, CLUSTER_ID_A))
      .set('Cookie', user.cookie)
      .send({ kind: 'dismissed', idempotencyKey: 'k-1' });
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    const rows = await getTestDb().select().from(keywordClusterDecisionEvents);
    expect(rows.length).toBe(1);
  });

  it('409s when the same key is reused with a different kind', async () => {
    const user = await seedUser('samekey-diffkind@decisions.test');
    await seedClusterRun(user.id);
    await request(app)
      .post(path(RUN_ID, CLUSTER_ID_A))
      .set('Cookie', user.cookie)
      .send({ kind: 'dismissed', idempotencyKey: 'k-1' });
    const conflicting = await request(app)
      .post(path(RUN_ID, CLUSTER_ID_A))
      .set('Cookie', user.cookie)
      .send({ kind: 'accepted', idempotencyKey: 'k-1', siteId: await seedSite(user.id, 'x.example') });
    expect(conflicting.status).toBe(409);
    expect(conflicting.body.error?.message).toContain('different decision');
  });

  it('409s when the cluster already has a non-matching decision under a different key', async () => {
    const user = await seedUser('cluster-conflict@decisions.test');
    await seedClusterRun(user.id);
    const siteId = await seedSite(user.id, 'cc.example');
    await request(app)
      .post(path(RUN_ID, CLUSTER_ID_A))
      .set('Cookie', user.cookie)
      .send({ kind: 'accepted', idempotencyKey: 'k-1', siteId });
    const conflicting = await request(app)
      .post(path(RUN_ID, CLUSTER_ID_A))
      .set('Cookie', user.cookie)
      .send({ kind: 'dismissed', idempotencyKey: 'k-2' });
    expect(conflicting.status).toBe(409);
    expect(conflicting.body.error?.message).toContain('different decision');
  });

  it('service-layer siteRequired guard triggers when siteId is stripped after schema (defensive)', async () => {
    const user = await seedUser('defensive@decisions.test');
    await seedClusterRun(user.id);
    await expect(
      applyClusterDecision(getTestDb() as unknown as never, {
        accountId: user.id,
        runId: RUN_ID,
        clusterId: CLUSTER_ID_A,
        kind: 'accepted',
        idempotencyKey: 'k-1',
        // siteId deliberately undefined — the service backstop must reject
        // even though the router zod schema already blocks this.
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('service-layer 404 when the run is missing', async () => {
    await expect(
      applyClusterDecision(getTestDb() as unknown as never, {
        accountId: '000000000000000000000042',
        runId: RUN_ID,
        clusterId: CLUSTER_ID_A,
        kind: 'dismissed',
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('race branch: ON CONFLICT DO NOTHING returns 0 rows, service reloads and replays', async () => {
    const user = await seedUser('race@decisions.test');
    await seedClusterRun(user.id);
    // Pre-seed the exact row that a concurrent writer would have inserted
    // between our idempotency probe and our INSERT.
    await getTestDb().insert(keywordClusterDecisionEvents).values({
      accountId: user.id,
      runId: RUN_ID,
      clusterId: CLUSTER_ID_A,
      kind: 'dismissed',
      idempotencyKey: 'race-key',
    });
    // Force applyClusterDecision through the ON CONFLICT branch by monkey
    // patching the SELECT probe to return empty (as if we had raced ahead
    // of the concurrent writer). Then the INSERT hits the unique index
    // and returns [] — the "replay" fallback fetches the winning row.
    const db = getTestDb() as unknown as { select: (arg?: unknown) => unknown };
    const originalSelect = db.select.bind(db);
    let firstCall = true;
    (db as { select: (arg?: unknown) => unknown }).select = ((...args: unknown[]) => {
      const result = originalSelect(...(args as [unknown])) as {
        from: (t: unknown) => {
          where: (w: unknown) => { limit: (n: number) => Promise<unknown[]> };
        };
      };
      if (firstCall) {
        firstCall = false;
        const emptyChain: {
          from: (t: unknown) => {
            where: (w: unknown) => {
              limit: (n: number) => Promise<unknown[]>;
              then: (resolve: (v: unknown[]) => unknown) => Promise<unknown>;
            };
          };
        } = {
          from: () => ({
            where: () => {
              const chain = {
                limit: async () => [] as unknown[],
                then: (resolve: (v: unknown[]) => unknown) =>
                  Promise.resolve(resolve([])),
              };
              return chain;
            },
          }),
        };
        return emptyChain;
      }
      return result;
    }) as typeof db.select;
    try {
      const result = await applyClusterDecision(getTestDb() as unknown as never, {
        accountId: user.id,
        runId: RUN_ID,
        clusterId: CLUSTER_ID_A,
        kind: 'dismissed',
        idempotencyKey: 'race-key',
      });
      expect(result.isNew).toBe(false);
      expect(result.row.kind).toBe('dismissed');
    } finally {
      (db as { select: typeof originalSelect }).select = originalSelect;
    }
  });

  it('race branch: ON CONFLICT returns 0 but the winning row has a different kind → 409', async () => {
    const user = await seedUser('race-conflict@decisions.test');
    await seedClusterRun(user.id);
    const siteId = await seedSite(user.id, 'race-conflict.example');
    // Pre-seed a winning row with DIFFERENT kind so the replay branch
    // recognises the race + kind mismatch and throws 409.
    await getTestDb().insert(keywordClusterDecisionEvents).values({
      accountId: user.id,
      runId: RUN_ID,
      clusterId: CLUSTER_ID_A,
      kind: 'accepted',
      idempotencyKey: 'race-different-kind',
      siteId,
      recommendationId: 'keyword-cluster:testtesttest',
    });
    const db = getTestDb() as unknown as { select: (arg?: unknown) => unknown };
    const originalSelect = db.select.bind(db);
    let calls = 0;
    (db as { select: (arg?: unknown) => unknown }).select = ((...args: unknown[]) => {
      const result = originalSelect(...(args as [unknown])) as {
        from: (t: unknown) => {
          where: (w: unknown) => { limit: (n: number) => Promise<unknown[]> };
        };
      };
      calls += 1;
      // Force the first two probes (idempotency + cluster-conflict scan)
      // through the "no prior row" branch so the flow reaches INSERT. Let
      // subsequent SELECTs (the post-INSERT replay probe) fall through to
      // the real driver so it reads the pre-seeded winning row.
      if (calls <= 2) {
        return {
          from: () => ({
            where: () => ({
              limit: async () => [] as unknown[],
              then: (resolve: (v: unknown[]) => unknown) =>
                Promise.resolve(resolve([])),
            }),
          }),
        };
      }
      return result;
    }) as typeof db.select;
    try {
      await expect(
        applyClusterDecision(getTestDb() as unknown as never, {
          accountId: user.id,
          runId: RUN_ID,
          clusterId: CLUSTER_ID_A,
          kind: 'dismissed',
          idempotencyKey: 'race-different-kind',
        }),
      ).rejects.toMatchObject({ status: 409 });
    } finally {
      (db as { select: typeof originalSelect }).select = originalSelect;
    }
  });

  it('service-layer 404 when an accepted site is malformed', async () => {
    const user = await seedUser('badobjectid@decisions.test');
    await seedClusterRun(user.id);
    await expect(
      applyClusterDecision(getTestDb() as unknown as never, {
        accountId: user.id,
        runId: RUN_ID,
        clusterId: CLUSTER_ID_A,
        kind: 'accepted',
        idempotencyKey: 'k-1',
        siteId: 'not-a-valid-objectid',
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

// ---------------------------------------------------------------------------
// Feature-module isolation grep — keyword-research never imports from
// modules/competitors (spec 13 §4.4). We check every product .ts (excluding
// tests) for a real `from '.../modules/competitors...'` import.
// ---------------------------------------------------------------------------

describe('feature-module isolation', () => {
  it('no product file under modules/keyword-research imports modules/competitors', () => {
    const dir = new URL('.', import.meta.url).pathname;
    const files = readdirSync(dir).filter(
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
    );
    for (const file of files) {
      const contents = readFileSync(join(dir, file), 'utf8');
      // Real import lines only — comments/JSDoc that mention the phrase are
      // fine.
      const bad = contents.match(/^\s*import[^;]*from\s+['"][^'"]*modules\/competitors[^'"]*['"]/m);
      expect(bad, `${file} imports modules/competitors`).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Privacy / hostile-input negatives — a planted phrase, domain, and
// cluster-label attempt must not surface in logs, DTOs, or errors.
// ---------------------------------------------------------------------------

const HOSTILE_PHRASE = 'gh-jailbreak-phrase';
const HOSTILE_DOMAIN = 'hostile.example';
const HOSTILE_CLUSTER_LABEL = 'gh-jailbreak-label';

describe('cluster decision privacy negatives', () => {
  it('never surfaces hostile phrases/labels in the decision response, logs, or error body', async () => {
    const user = await seedUser('privacy@decisions.test');
    // Plant hostile content in the run doc — a subversive vendor would try
    // to smuggle it back through a decision response or a log line.
    await seedClusterRun(user.id, {
      clusters: [
        {
          clusterId: CLUSTER_ID_A,
          label: HOSTILE_CLUSTER_LABEL,
          memberKeywords: [HOSTILE_PHRASE, HOSTILE_DOMAIN],
          suggestedRoute: 'brief',
        },
      ],
    });
    // Capture every log record pino would have emitted during these two
    // requests by intercepting the underlying write stream.
    const captured: string[] = [];
    // Attach a child-processor stub via `hooks` is not portable — swap the
    // standard `.write` on the stream instead by monkey-patching the
    // top-level `logger.info/warn/error/debug` to forward through us AND
    // still return void.
    const spies = ['info', 'warn', 'error', 'debug', 'fatal', 'trace'].map((level) => {
      const original = (logger as unknown as Record<string, ((...args: unknown[]) => void) | undefined>)[level];
      return vi.spyOn(logger, level as 'info').mockImplementation(((...args: unknown[]) => {
        captured.push(JSON.stringify(args));
        original?.apply(logger, args as never);
      }) as never);
    });
    const siteId = await seedSite(user.id, 'privacy.example');
    // Attempt an accepted decision then a conflicting dismissed to force
    // both the happy-path and the 409 error branch through the logger.
    const ok = await request(app)
      .post(`/api/keyword-research/clusters/${RUN_ID}/clusters/${CLUSTER_ID_A}/decision`)
      .set('Cookie', user.cookie)
      .send({ kind: 'accepted', idempotencyKey: 'k-1', siteId })
      .expect(201);
    const conflict = await request(app)
      .post(`/api/keyword-research/clusters/${RUN_ID}/clusters/${CLUSTER_ID_A}/decision`)
      .set('Cookie', user.cookie)
      .send({ kind: 'dismissed', idempotencyKey: 'k-2' })
      .expect(409);
    for (const scan of [ok.body, conflict.body, ok.text, conflict.text]) {
      const serialized = typeof scan === 'string' ? scan : JSON.stringify(scan);
      expect(serialized).not.toContain(HOSTILE_PHRASE);
      expect(serialized).not.toContain(HOSTILE_DOMAIN);
      expect(serialized).not.toContain(HOSTILE_CLUSTER_LABEL);
    }
    const logSerialized = captured.join('\n');
    expect(logSerialized).not.toContain(HOSTILE_PHRASE);
    expect(logSerialized).not.toContain(HOSTILE_DOMAIN);
    expect(logSerialized).not.toContain(HOSTILE_CLUSTER_LABEL);
    for (const spy of spies) spy.mockRestore();
  });
});
