import type { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import mongoose from 'mongoose';
import request from 'supertest';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { createApp } from '../../app.js';
import { env } from '../../config/env.js';
import {
  backlinkDeepSnapshots,
  vendorResponses,
} from '../../db/schema/index.js';
import {
  VendorUnavailableError,
  createFakeBacklinkProvider,
  recordVendorCostUsd,
  type BacklinkProvider,
} from '../../shared/providers/index.js';
import { translate } from '../../shared/i18n/index.js';
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
import { Site } from '../sites/index.js';
import {
  setBacklinkDeepQueue,
  setBacklinkProvider,
  setBacklinksDb,
} from './backlinks.holder.js';
import { BacklinkPullRun } from './backlink-runs.model.js';
import {
  backlinkDeepDomainSchema,
  bulkRanksBodySchema,
  historyBodySchema,
  referringDomainsBodySchema,
} from './backlink-deep.schema.js';
import {
  createBacklinkDeepProcessor,
  fetchDeepPayload,
} from './backlink-deep.processor.js';
import { startBacklinkDeepPull } from './backlink-deep.service.js';
import { BACKLINK_VENDOR_OPERATIONS } from './backlink-vendor-operations.js';

const app = createApp();
const originalEnabled = env.LINK_INTELLIGENCE_ENABLED;
let queuedJobs: Array<{ accountId: string; siteId: string; runId: string }> = [];
let queueAdd = vi.fn();

function installQueue(): void {
  queuedJobs = [];
  queueAdd = vi.fn(async (_name: string, data: typeof queuedJobs[number]) => {
    queuedJobs.push(data);
    return { id: data.runId };
  });
  setBacklinkDeepQueue({ add: queueAdd } as unknown as Queue);
}

async function seedUser(email: string): Promise<TestUser> {
  return signupVerifiedUser(app, { email });
}

async function seedSite(accountId: string, domain = 'example.com'): Promise<string> {
  const site = await Site.create({
    accountId: new mongoose.Types.ObjectId(accountId),
    url: `https://${domain}`,
    domain,
  });
  return String(site._id);
}

function provider(overrides: Partial<BacklinkProvider> = {}): BacklinkProvider {
  return { ...createFakeBacklinkProvider(), ...overrides };
}

async function processLatest(p: BacklinkProvider): Promise<void> {
  const data = queuedJobs.at(-1)!;
  await createBacklinkDeepProcessor({
    db: getTestDb() as never,
    provider: p,
  })({ data } as never);
}

beforeAll(async () => {
  await startMemoryMongo();
  const db = await startTestPostgres();
  installTestAuth();
  setBacklinksDb(db as never);
});

afterAll(async () => {
  (env as { LINK_INTELLIGENCE_ENABLED: boolean }).LINK_INTELLIGENCE_ENABLED = originalEnabled;
  setBacklinkDeepQueue(null);
  setBacklinkProvider(null);
  setBacklinksDb(null);
  uninstallTestAuth();
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  (env as { LINK_INTELLIGENCE_ENABLED: boolean }).LINK_INTELLIGENCE_ENABLED = true;
  installQueue();
  setBacklinkProvider(createFakeBacklinkProvider());
});

const operations = [
  { path: 'referring-domains', type: 'refDomains', body: { limit: 500 } },
  { path: 'anchors', type: 'anchors', body: { limit: 500 } },
  { path: 'history', type: 'history', body: { limit: 24 } },
  { path: 'bulk-ranks', type: 'bulkRanks', body: { domains: ['a.example'] } },
] as const;

describe('Link Intelligence deep POST routes', () => {
  it('shares the named per-account mutation bucket across all five entry points', async () => {
    const originalMax = env.RATE_LIMIT_LINK_INTEL_MAX;
    (env as { RATE_LIMIT_LINK_INTEL_MAX: number }).RATE_LIMIT_LINK_INTEL_MAX = 1;
    const limitedApp = createApp();

    try {
      const entries = [
        ...operations.map((operation) => ({
          path: `/api/backlinks/deep/${operation.path}`,
          body: operation.body,
        })),
        { path: '/api/backlinks/gap', body: { competitors: ['rival.example'] } },
      ];

      for (const [index, entry] of entries.entries()) {
        const user = await seedUser(`rate-${index}@deep.test`);
        const siteId = await seedSite(user.id, `rate-${index}.example`);
        const body = { siteId, ...entry.body };
        await request(limitedApp)
          .post(entry.path)
          .set('Cookie', user.cookie)
          .send(body)
          .expect(202);
        const rejected = await request(limitedApp)
          .post(entry.path)
          .set('Cookie', user.cookie)
          .set('Accept-Language', 'fr')
          .send(body)
          .expect(429);
        expect(rejected.body.error).toBe(
          translate('fr', 'security.error.rateLimited'),
        );
      }
    } finally {
      (env as { RATE_LIMIT_LINK_INTEL_MAX: number }).RATE_LIMIT_LINK_INTEL_MAX = originalMax;
    }
  });

  it('rate-limits previews with mutations while stored reads use an independent account poll bucket', async () => {
    const originalMutationMax = env.RATE_LIMIT_LINK_INTEL_MAX;
    const originalPollMax = env.RATE_LIMIT_LINK_INTEL_POLL_MAX;
    (env as { RATE_LIMIT_LINK_INTEL_MAX: number }).RATE_LIMIT_LINK_INTEL_MAX = 1;
    (env as { RATE_LIMIT_LINK_INTEL_POLL_MAX: number }).RATE_LIMIT_LINK_INTEL_POLL_MAX = 1;
    const limitedApp = createApp();

    try {
      const user = await seedUser('rate-separation@deep.test');
      const siteId = await seedSite(user.id, 'rate-separation.example');

      await request(limitedApp)
        .post('/api/backlinks/deep/preview')
        .set('Cookie', user.cookie)
        .send({ type: 'history', domain: 'rate-separation.example', limit: 12 })
        .expect(200);

      await request(limitedApp)
        .get('/api/backlinks/runs')
        .set('Cookie', user.cookie)
        .query({ siteId })
        .expect(200);

      const pollOverflow = await request(limitedApp)
        .get('/api/backlinks/runs')
        .set('Cookie', user.cookie)
        .set('Accept-Language', 'fr')
        .query({ siteId })
        .expect(429);
      expect(pollOverflow.body.error).toBe(
        translate('fr', 'security.error.rateLimited'),
      );

      await request(limitedApp)
        .post('/api/backlinks/deep/history')
        .set('Cookie', user.cookie)
        .send({ siteId, limit: 12 })
        .expect(429);

      const otherUser = await seedUser('rate-separation-other@deep.test');
      const otherSiteId = await seedSite(
        otherUser.id,
        'rate-separation-other.example',
      );
      await request(limitedApp)
        .get('/api/backlinks/runs')
        .set('Cookie', otherUser.cookie)
        .query({ siteId: otherSiteId })
        .expect(200);
    } finally {
      (env as { RATE_LIMIT_LINK_INTEL_MAX: number }).RATE_LIMIT_LINK_INTEL_MAX =
        originalMutationMax;
      (env as { RATE_LIMIT_LINK_INTEL_POLL_MAX: number }).RATE_LIMIT_LINK_INTEL_POLL_MAX =
        originalPollMax;
    }
  });

  it('is authenticated and reports a missing queue after ownership', async () => {
    await request(app)
      .post('/api/backlinks/deep/history')
      .send({ siteId: 'a'.repeat(24), limit: 12 })
      .expect(401);
    const user = await seedUser('queue-missing@deep.test');
    const siteId = await seedSite(user.id);
    setBacklinkDeepQueue(null);
    await request(app)
      .post('/api/backlinks/deep/history')
      .set('Cookie', user.cookie)
      .send({ siteId, limit: 12 })
      .expect(503);
    await expect(
      startBacklinkDeepPull(
        { accountId: user.id, siteId: 'not-an-object-id', type: 'history', limit: 12 },
        { queue: null },
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it.each(operations)('$path returns 404 for another account before enqueueing', async (op) => {
    const owner = await seedUser(`owner-${op.path}@scope.test`);
    const stranger = await seedUser(`stranger-${op.path}@scope.test`);
    const siteId = await seedSite(owner.id);
    const response = await request(app)
      .post(`/api/backlinks/deep/${op.path}`)
      .set('Cookie', stranger.cookie)
      .send({ siteId, ...op.body });
    expect(response.status).toBe(404);
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it.each(operations)('$path is kill-switched before enqueueing', async (op) => {
    const user = await seedUser(`${op.path}@disabled.test`);
    const siteId = await seedSite(user.id);
    (env as { LINK_INTELLIGENCE_ENABLED: boolean }).LINK_INTELLIGENCE_ENABLED = false;
    const response = await request(app)
      .post(`/api/backlinks/deep/${op.path}`)
      .set('Cookie', user.cookie)
      .set('Accept-Language', 'fr')
      .send({ siteId, ...op.body });
    expect(response.status).toBe(503);
    expect(response.body.error.message).toBe(
      translate('fr', 'backlinks.errors.unavailable'),
    );
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('marks the run failed when the enqueue fails', async () => {
    const user = await seedUser('enqueue-fail@deep.test');
    const siteId = await seedSite(user.id);
    setBacklinkDeepQueue({
      add: vi.fn().mockRejectedValue(new Error('redis down')),
    } as unknown as Queue);
    await request(app)
      .post('/api/backlinks/deep/history')
      .set('Cookie', user.cookie)
      .send({ siteId, limit: 12 })
      .expect(503);
    const run = await BacklinkPullRun.findOne({ accountId: user.id });
    expect(run).toMatchObject({ status: 'failed' });
    expect(run?.toObject()).not.toHaveProperty('refunded');
  });

  it('surfaces a Mongo create failure and accepts an injected clock on enqueue failure', async () => {
    const user = await seedUser('create-fail@deep.test');
    const siteId = await seedSite(user.id);
    const create = vi.spyOn(BacklinkPullRun, 'create').mockRejectedValueOnce(new Error('mongo down'));
    await request(app)
      .post('/api/backlinks/deep/history')
      .set('Cookie', user.cookie)
      .send({ siteId, limit: 12 })
      .expect(500);
    create.mockRestore();
    expect(queueAdd).not.toHaveBeenCalled();

    const clock = new Date('2026-07-22T10:00:00.000Z');
    await expect(
      startBacklinkDeepPull(
        { accountId: user.id, siteId, type: 'anchors', limit: 10 },
        {
          queue: { add: vi.fn().mockRejectedValue(new Error('redis down')) } as unknown as Queue,
          now: () => clock,
        },
      ),
    ).rejects.toMatchObject({ status: 503 });
    const failed = await BacklinkPullRun.findOne({ accountId: user.id });
    expect(failed?.status).toBe('failed');
    expect(failed?.completedAt).toEqual(clock);
  });
});

describe('deep processing and cache reuse', () => {
  it.each([
    {
      path: 'referring-domains',
      operation: BACKLINK_VENDOR_OPERATIONS.refDomains,
      body: { limit: 500 },
      costMicros: 20_000n + 72n,
      override: {
        getReferringDomains: async () => {
          recordVendorCostUsd(0.020072);
          return [{ domain: 'link.example', backlinks: 1, domainRank: 10, firstSeen: null, lastSeen: null }];
        },
      },
    },
    {
      path: 'anchors',
      operation: BACKLINK_VENDOR_OPERATIONS.anchors,
      body: { limit: 500 },
      costMicros: 20_000n + 72n,
      override: {
        getAnchors: async () => {
          recordVendorCostUsd(0.020072);
          return [{ anchor: 'safe', backlinks: 1, referringDomains: 1 }];
        },
      },
    },
    {
      path: 'history',
      operation: BACKLINK_VENDOR_OPERATIONS.history,
      body: { limit: 24 },
      costMicros: 20_000n + 400n,
      override: {
        getHistory: async () => {
          recordVendorCostUsd(0.0204);
          return [{ year: 2026, month: 7, backlinks: 1, referringDomains: 1 }];
        },
      },
    },
    {
      path: 'bulk-ranks',
      operation: BACKLINK_VENDOR_OPERATIONS.bulkRanks,
      body: { domains: ['link.example'] },
      costMicros: 20_000n + 400n,
      override: {
        getBulkRanks: async () => {
          recordVendorCostUsd(0.0204);
          return [{ domain: 'link.example', rank: 10 }];
        },
      },
    },
  ])('$operation archives canonical capability/operation and pinned cost math', async (entry) => {
    const user = await seedUser(`${entry.path}@cost.test`);
    const siteId = await seedSite(user.id, `${entry.path}.example`);
    await request(app)
      .post(`/api/backlinks/deep/${entry.path}`)
      .set('Cookie', user.cookie)
      .send({ siteId, ...entry.body })
      .expect(202);
    await processLatest(provider(entry.override));
    const archived = await getTestDb()
      .select()
      .from(vendorResponses)
      .where(eq(vendorResponses.operation, entry.operation));
    expect(archived).toHaveLength(1);
    expect(archived[0]).toMatchObject({
      capability: 'backlink',
      operation: entry.operation,
      accountId: null,
      costMicros: entry.costMicros,
    });
  });

  it('a clean empty provider result persists an empty snapshot', async () => {
    const user = await seedUser('empty@deep.test');
    const siteId = await seedSite(user.id);
    await request(app)
      .post('/api/backlinks/deep/anchors')
      .set('Cookie', user.cookie)
      .send({ siteId, limit: 500 })
      .expect(202);
    await processLatest(provider({ getAnchors: vi.fn().mockResolvedValue([]) }));
    const run = await BacklinkPullRun.findById(queuedJobs[0]!.runId);
    expect(run).toMatchObject({ status: 'succeeded', retainedCount: 0 });
    const snapshots = await getTestDb().select().from(backlinkDeepSnapshots);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({ payload: [], retainedCount: 0 });
  });

  it('provider failure fails the run once and retains no snapshot', async () => {
    const user = await seedUser('fail-once@deep.test');
    const siteId = await seedSite(user.id);
    await request(app)
      .post('/api/backlinks/deep/referring-domains')
      .set('Cookie', user.cookie)
      .send({ siteId, limit: 10 })
      .expect(202);
    const failing = provider({
      getReferringDomains: vi.fn().mockRejectedValue(
        new VendorUnavailableError('down', {
          provider: 'fake',
          operation: 'refDomains',
        }),
      ),
    });
    const processor = createBacklinkDeepProcessor({ db: getTestDb() as never, provider: failing });
    await expect(processor({ data: queuedJobs[0] } as never)).rejects.toBeInstanceOf(
      VendorUnavailableError,
    );
    await processor({ data: queuedJobs[0] } as never);
    expect(await getTestDb().select().from(backlinkDeepSnapshots)).toHaveLength(0);
    expect(await BacklinkPullRun.findById(queuedJobs[0]!.runId)).toMatchObject({
      status: 'failed',
      retainedCount: 0,
    });
  });

  it('cache hits avoid a second provider call', async () => {
    const user = await seedUser('cache-hit@deep.test');
    const siteId = await seedSite(user.id);
    const getHistory = vi.fn().mockResolvedValue([
      { year: 2026, month: 7, backlinks: 10, referringDomains: 4 },
    ]);
    const cachedProvider = provider({ getHistory });
    for (let index = 0; index < 2; index += 1) {
      await request(app)
        .post('/api/backlinks/deep/history')
        .set('Cookie', user.cookie)
        .send({ siteId, limit: 12 })
        .expect(202);
      await processLatest(cachedProvider);
    }
    expect(getHistory).toHaveBeenCalledTimes(1);
    expect(await getTestDb().select().from(backlinkDeepSnapshots)).toHaveLength(2);
  });

  it('already queued work finishes while disabled and a persisted replay is idempotent', async () => {
    const user = await seedUser('queued-disabled@deep.test');
    const siteId = await seedSite(user.id);
    await request(app)
      .post('/api/backlinks/deep/history')
      .set('Cookie', user.cookie)
      .send({ siteId, limit: 12 })
      .expect(202);
    (env as { LINK_INTELLIGENCE_ENABLED: boolean }).LINK_INTELLIGENCE_ENABLED = false;
    const fixed = new Date('2026-07-22T11:00:00.000Z');
    const processor = createBacklinkDeepProcessor({
      db: getTestDb() as never,
      provider: createFakeBacklinkProvider(),
      now: () => fixed,
    });
    await processor({ data: queuedJobs[0] } as never);
    await processor({ data: queuedJobs[0] } as never);
    await BacklinkPullRun.updateOne({ _id: queuedJobs[0]!.runId }, { $set: { status: 'queued' } });
    await createBacklinkDeepProcessor({
      db: getTestDb() as never,
      provider: createFakeBacklinkProvider(),
    })({ data: queuedJobs[0] } as never);
    const replayed = await BacklinkPullRun.findById(queuedJobs[0]!.runId);
    expect(replayed?.status).toBe('succeeded');
    expect(replayed?.completedAt).toBeInstanceOf(Date);
    expect(await getTestDb().select().from(backlinkDeepSnapshots)).toHaveLength(1);
  });

  it('missing provider operations fail and unexpected failures fail the run', async () => {
    const run = { domain: 'example.com', inputs: {} };
    const base = createFakeBacklinkProvider();
    for (const type of ['refDomains', 'anchors', 'history', 'bulkRanks'] as const) {
      const without = { ...base } as Record<string, unknown>;
      const method = {
        refDomains: 'getReferringDomains',
        anchors: 'getAnchors',
        history: 'getHistory',
        bulkRanks: 'getBulkRanks',
      }[type];
      delete without[method];
      await expect(fetchDeepPayload(type, run, without as unknown as BacklinkProvider)).rejects.toBeInstanceOf(
        VendorUnavailableError,
      );
    }

    const user = await seedUser('unexpected@deep.test');
    const siteId = await seedSite(user.id);
    await request(app)
      .post('/api/backlinks/deep/history')
      .set('Cookie', user.cookie)
      .send({ siteId, limit: 12 })
      .expect(202);
    const processor = createBacklinkDeepProcessor({
      db: getTestDb() as never,
      provider: provider({ getHistory: vi.fn().mockRejectedValue(new Error('db-shaped bug')) }),
    });
    await expect(processor({ data: queuedJobs[0] } as never)).rejects.toThrow('db-shaped bug');
    expect(await BacklinkPullRun.findById(queuedJobs[0]!.runId)).toMatchObject({
      status: 'failed',
    });
  });

  it('provider helper applies default limits/domains and serializes nullable dates', async () => {
    const ref = vi.fn().mockResolvedValue([
      { domain: 'a.example', backlinks: 1, domainRank: null, firstSeen: null, lastSeen: null },
    ]);
    const anchors = vi.fn().mockResolvedValue([]);
    const history = vi.fn().mockResolvedValue([]);
    const bulk = vi.fn().mockResolvedValue([]);
    const custom = provider({
      getReferringDomains: ref,
      getAnchors: anchors,
      getHistory: history,
      getBulkRanks: bulk,
    });
    const run = { domain: 'example.com', inputs: {} };
    expect(await fetchDeepPayload('refDomains', run, custom)).toMatchObject([
      { firstSeen: null, lastSeen: null },
    ]);
    await fetchDeepPayload('anchors', run, custom);
    await fetchDeepPayload('history', run, custom);
    await fetchDeepPayload('bulkRanks', run, custom);
    expect(ref).toHaveBeenCalledWith('example.com', { limit: 500 });
    expect(anchors).toHaveBeenCalledWith('example.com', { limit: 500 });
    expect(history).toHaveBeenCalledWith('example.com', { limit: 24 });
    expect(bulk).toHaveBeenCalledWith([]);
  });

  it('malformed jobs and missing/terminal runs are safe processor no-ops', async () => {
    const processor = createBacklinkDeepProcessor({
      db: getTestDb() as never,
      provider: createFakeBacklinkProvider(),
    });
    await expect(processor({ data: { crafted: true } } as never)).rejects.toThrow(
      /malformed job payload/,
    );
    await processor({
      data: { accountId: 'a'.repeat(24), siteId: 'b'.repeat(24), runId: 'c'.repeat(24) },
    } as never);
    await processor({
      data: {
        accountId: 'a'.repeat(24),
        siteId: 'b'.repeat(24),
        runId: 'c'.repeat(24),
        operation: 'toxicity_review',
      },
    } as never);
  });

  it.each(operations)('$type processor persists bounded normalized rows', async (op) => {
    const user = await seedUser(`${op.path}@process.test`);
    const siteId = await seedSite(user.id);
    await request(app)
      .post(`/api/backlinks/deep/${op.path}`)
      .set('Cookie', user.cookie)
      .send({ siteId, ...op.body })
      .expect(202);
    await processLatest(createFakeBacklinkProvider());
    const run = await BacklinkPullRun.findById(queuedJobs[0]!.runId);
    expect(run?.status).toBe('succeeded');
    expect(run?.retainedCount).toBeGreaterThan(0);
  });
});

describe('boundaries and stored reads', () => {
  it('clamps limits, normalizes/deduplicates domains, and rejects unsafe domains', () => {
    expect(referringDomainsBodySchema.parse({ siteId: 'a'.repeat(24), limit: 900 }).limit).toBe(500);
    expect(historyBodySchema.parse({ siteId: 'a'.repeat(24), limit: -2 }).limit).toBe(1);
    const domains = bulkRanksBodySchema.parse({
      siteId: 'a'.repeat(24),
      domains: ['HTTPS://WWW.Example.com/path', 'example.com', ...Array.from({ length: 105 }, (_, index) => `d${index}.example`)],
    }).domains;
    expect(domains[0]).toBe('example.com');
    expect(domains).toHaveLength(100);
    expect(() => backlinkDeepDomainSchema.parse('127.0.0.1')).toThrow();
    expect(() => backlinkDeepDomainSchema.parse('localhost')).toThrow();
  });

  it('stored list/detail reads work while disabled and include observation metadata', async () => {
    const user = await seedUser('read-disabled@deep.test');
    const siteId = await seedSite(user.id);
    await request(app)
      .post('/api/backlinks/deep/bulk-ranks')
      .set('Cookie', user.cookie)
      .send({ siteId, domains: ['example.com'] })
      .expect(202);
    await processLatest(createFakeBacklinkProvider());
    const runId = queuedJobs[0]!.runId;
    (env as { LINK_INTELLIGENCE_ENABLED: boolean }).LINK_INTELLIGENCE_ENABLED = false;
    const list = await request(app)
      .get(`/api/backlinks/runs?siteId=${siteId}&type=bulkRanks&limit=1`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(list.body.runs).toHaveLength(1);
    expect(list.body.runs[0].runId).toBe(runId);
    const detail = await request(app)
      .get(`/api/backlinks/runs/${runId}`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(detail.body.result.rows.length).toBeGreaterThan(0);
    expect(detail.body.result.observation.source).toBe('provider_observation');
  });

  it('list and detail return 404 cross-account', async () => {
    const owner = await seedUser('read-owner@scope.test');
    const stranger = await seedUser('read-stranger@scope.test');
    const siteId = await seedSite(owner.id);
    await request(app)
      .post('/api/backlinks/deep/history')
      .set('Cookie', owner.cookie)
      .send({ siteId, limit: 12 })
      .expect(202);
    const runId = queuedJobs[0]!.runId;
    await request(app)
      .get(`/api/backlinks/runs?siteId=${siteId}`)
      .set('Cookie', stranger.cookie)
      .expect(404);
    await request(app)
      .get(`/api/backlinks/runs/${runId}`)
      .set('Cookie', stranger.cookie)
      .expect(404);
  });

  it('paginates account runs and returns null result before processing', async () => {
    const user = await seedUser('paginate@deep.test');
    const siteId = await seedSite(user.id);
    for (let index = 0; index < 2; index += 1) {
      await request(app)
        .post('/api/backlinks/deep/anchors')
        .set('Cookie', user.cookie)
        .send({ siteId, limit: 10 })
        .expect(202);
    }
    const first = await request(app)
      .get(`/api/backlinks/runs?siteId=${siteId}&limit=1`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(first.body.runs).toHaveLength(1);
    expect(first.body.nextCursor).toBeTruthy();
    const second = await request(app)
      .get(`/api/backlinks/runs?siteId=${siteId}&limit=1&cursor=${first.body.nextCursor}`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(second.body.runs).toHaveLength(1);
    expect(second.body.nextCursor).toBeNull();
    const detail = await request(app)
      .get(`/api/backlinks/runs/${second.body.runs[0].runId}`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(detail.body.result).toBeNull();
    await request(app)
      .get('/api/backlinks/runs/not-an-object-id')
      .set('Cookie', user.cookie)
      .expect(400);
  });
});
