import type { Queue } from 'bullmq';
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
  linkGapSnapshots,
  vendorResponses,
} from '../../db/schema/index.js';
import { translate } from '../../shared/i18n/index.js';
import {
  VendorUnavailableError,
  createFakeBacklinkProvider,
  recordVendorCostUsd,
  type BacklinkCompetitorRow,
  type BacklinkProvider,
} from '../../shared/providers/index.js';
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
import { createBacklinkDeepProcessor } from './backlink-deep.processor.js';
import {
  setBacklinkDeepQueue,
  setBacklinkProvider,
  setBacklinksDb,
} from './backlinks.holder.js';
import { LinkGapRun } from './backlink-runs.model.js';
import {
  createLinkGapProcessor,
  fetchLinkGapPayload,
  settleLinkGapLeg,
} from './link-gap.processor.js';
import { linkGapBodySchema, linkGapParamsSchema } from './link-gap.schema.js';
import {
  computeLinkGapOverlap,
  getLinkGapRun,
  normalizeGapCompetitors,
  failUnstartedRunOnce,
  startLinkGapRun,
} from './link-gap.service.js';
import { BACKLINK_VENDOR_OPERATIONS } from './backlink-vendor-operations.js';

const app = createApp();
const originalEnabled = env.LINK_INTELLIGENCE_ENABLED;
let queuedJobs: Array<{ accountId: string; siteId: string; runId: string }> = [];
let queueAdd = vi.fn();

function installQueue(implementation?: () => Promise<never>): void {
  queuedJobs = [];
  queueAdd = implementation
    ? vi.fn(implementation)
    : vi.fn(async (_name: string, data: (typeof queuedJobs)[number]) => {
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

function providerFor(
  handler: (competitor: string) => Promise<BacklinkCompetitorRow[]>,
): BacklinkProvider {
  return {
    ...createFakeBacklinkProvider(),
    getBacklinkCompetitors: (competitor) => handler(competitor),
  };
}

function startGap(
  user: TestUser,
  siteId: string,
  competitors: string[],
) {
  return request(app)
    .post('/api/backlinks/gap')
    .set('Cookie', user.cookie)
    .send({ siteId, competitors });
}

async function processLatest(provider: BacklinkProvider): Promise<void> {
  await createBacklinkDeepProcessor({
    db: getTestDb() as never,
    provider,
  })({ data: queuedJobs.at(-1)! } as never);
}

beforeAll(async () => {
  await startMemoryMongo();
  const db = await startTestPostgres();
  installTestAuth();
  setBacklinksDb(db as never);
});

afterAll(async () => {
  (env as { LINK_INTELLIGENCE_ENABLED: boolean }).LINK_INTELLIGENCE_ENABLED =
    originalEnabled;
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

describe('link-gap request boundary', () => {
  it('requires authentication and validates the strict body and run id', async () => {
    await request(app)
      .post('/api/backlinks/gap')
      .send({ siteId: 'a'.repeat(24), competitors: ['rival.example'] })
      .expect(401);
    expect(() =>
      linkGapBodySchema.parse({
        siteId: 'a'.repeat(24),
        competitors: [],
      }),
    ).toThrow();
    expect(() =>
      linkGapBodySchema.parse({
        siteId: 'a'.repeat(24),
        competitors: ['a.example', 'b.example', 'c.example', 'd.example'],
      }),
    ).toThrow();
    expect(() =>
      linkGapBodySchema.parse({
        siteId: 'a'.repeat(24),
        competitors: ['a.example'],
        extra: true,
      }),
    ).toThrow();
    expect(() => linkGapParamsSchema.parse({ runId: 'bad' })).toThrow();
  });

  it('normalizes and deduplicates after ownership', async () => {
    const user = await seedUser('dedupe@gap.test');
    const siteId = await seedSite(user.id);
    const result = await startLinkGapRun(
      {
        accountId: user.id,
        siteId,
        competitors: [
          ' HTTPS://WWW.Rival.Example/path ',
          'rival.example',
          'other.example',
        ],
      },
      {
        queue: { add: queueAdd } as unknown as Queue,
      },
    );
    expect(result.competitors).toEqual(['rival.example', 'other.example']);
    expect(result).not.toHaveProperty('reservedUnits');
    expect(queueAdd).toHaveBeenCalledTimes(1);
  });
  it('rejects the owned domain and invalid domains before creating a run', async () => {
    const user = await seedUser('own@gap.test');
    const siteId = await seedSite(user.id);
    const own = await startGap(user, siteId, ['HTTPS://WWW.EXAMPLE.COM/']);
    expect(own.status).toBe(400);
    expect(queueAdd).not.toHaveBeenCalled();
    await expect(
      startLinkGapRun(
        { accountId: user.id, siteId, competitors: ['localhost'] },
        { queue: {} as Queue },
      ),
    ).rejects.toBeDefined();
    expect(normalizeGapCompetitors(['RIVAL.EXAMPLE', 'rival.example'], 'example.com')).toEqual([
      'rival.example',
    ]);
  });

  it('checks ownership before starting a run', async () => {
    const owner = await seedUser('owner@gap.test');
    const stranger = await seedUser('stranger@gap.test');
    const siteId = await seedSite(owner.id);
    expect((await startGap(stranger, siteId, ['rival.example'])).status).toBe(404);
    expect(queueAdd).not.toHaveBeenCalled();
    await expect(
      startLinkGapRun(
        {
          accountId: stranger.id,
          siteId: 'not-an-object-id',
          competitors: ['rival.example'],
        },
        { queue: null },
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('honors the kill switch and missing queue', async () => {
    const user = await seedUser('disabled@gap.test');
    const siteId = await seedSite(user.id);
    (env as { LINK_INTELLIGENCE_ENABLED: boolean }).LINK_INTELLIGENCE_ENABLED = false;
    const disabled = await request(app)
      .post('/api/backlinks/gap')
      .set('Cookie', user.cookie)
      .set('Accept-Language', 'fr')
      .send({ siteId, competitors: ['rival.example'] });
    expect(disabled.status).toBe(503);
    expect(disabled.body.error.message).toBe(
      translate('fr', 'backlinks.errors.unavailable'),
    );
    (env as { LINK_INTELLIGENCE_ENABLED: boolean }).LINK_INTELLIGENCE_ENABLED = true;
    setBacklinkDeepQueue(null);
    expect((await startGap(user, siteId, ['rival.example'])).status).toBe(503);
  });

  it('fails every leg exactly once when enqueue fails', async () => {
    const user = await seedUser('enqueue@gap.test');
    const siteId = await seedSite(user.id);
    installQueue(async () => {
      throw new Error('redis down');
    });
    const response = await startGap(user, siteId, ['one.example', 'two.example']);
    expect(response.status).toBe(503);
    const run = await LinkGapRun.findOne({ accountId: user.id });
    expect(run).toMatchObject({ status: 'failed' });
    expect(run?.perLegOutcomes.map((outcome) => outcome.status)).toEqual(['failed', 'failed']);
    expect(await failUnstartedRunOnce(run!, { queue: null })).toBe(false);
  });
  it('uses the injected clock when failing an unstarted run', async () => {
    const user = await seedUser('enqueue-seam@gap.test');
    const siteId = await seedSite(user.id);
    const fixed = new Date('2026-07-22T12:00:00.000Z');
    await expect(
      startLinkGapRun(
        { accountId: user.id, siteId, competitors: ['rival.example'] },
        {
          queue: { add: vi.fn(async () => { throw new Error('queue down'); }) } as unknown as Queue,
          now: () => fixed,
        },
      ),
    ).rejects.toMatchObject({ status: 503 });
    expect((await LinkGapRun.findOne({ accountId: user.id }))?.completedAt).toEqual(fixed);
  });
  it('surfaces a run-create failure without enqueueing', async () => {
    const user = await seedUser('create-fail@gap.test');
    const siteId = await seedSite(user.id);
    vi.spyOn(LinkGapRun, 'create').mockRejectedValueOnce(new Error('mongo down'));
    await expect(
      startLinkGapRun(
        { accountId: user.id, siteId, competitors: ['rival.example'] },
        { queue: { add: queueAdd } as unknown as Queue },
      ),
    ).rejects.toThrow('mongo down');
    expect(queueAdd).not.toHaveBeenCalled();
  });

});

describe('per-leg state machine', () => {
  it('archives competitor discovery and bulk-rank enrichment as separate pinned-cost calls', async () => {
    const user = await seedUser('cost@gap.test');
    const siteId = await seedSite(user.id);
    await startGap(user, siteId, ['rival.example']).expect(202);
    const costProvider = createFakeBacklinkProvider();
    costProvider.getBacklinkCompetitors = async () => {
      recordVendorCostUsd(0.0204);
      return [{ domain: 'link.example', intersections: 3, rank: 40 }];
    };
    costProvider.getBulkRanks = async () => {
      recordVendorCostUsd(0.0204);
      return [{ domain: 'link.example', rank: 42 }];
    };
    await processLatest(costProvider);
    const archived = await getTestDb().select().from(vendorResponses);
    expect(archived).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: 'backlink',
          operation: BACKLINK_VENDOR_OPERATIONS.competitors,
          accountId: null,
          costMicros: 20_400n,
        }),
        expect.objectContaining({
          capability: 'backlink',
          operation: BACKLINK_VENDOR_OPERATIONS.bulkRanks,
          accountId: null,
          costMicros: 20_400n,
        }),
      ]),
    );
    expect(archived).toHaveLength(2);
  });

  const rows: BacklinkCompetitorRow[] = [
    { domain: 'New-Link.Example', intersections: 7, rank: 51 },
    { domain: 'example.com', intersections: 2, rank: 20 },
    { domain: 'new-link.example', intersections: 99, rank: 99 },
  ];

  it('all OK normalizes/dedupes rows and persists each leg', async () => {
    const user = await seedUser('all-ok@gap.test');
    const siteId = await seedSite(user.id);
    await startGap(user, siteId, ['one.example', 'two.example']).expect(202);
    await processLatest(providerFor(async () => rows));
    const run = await LinkGapRun.findById(queuedJobs[0]!.runId);
    expect(run).toMatchObject({ status: 'succeeded' });
    expect(run?.perLegOutcomes.map((outcome) => outcome.status)).toEqual(['ok', 'ok']);
    const snapshots = await getTestDb().select().from(linkGapSnapshots);
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]?.payload).toEqual([
      {
        domain: 'new-link.example',
        intersections: 7,
        rank: 51,
        firstSeen: null,
      },
    ]);
  });

  it('all provider failures fail every leg', async () => {
    const user = await seedUser('all-fail@gap.test');
    const siteId = await seedSite(user.id);
    await startGap(user, siteId, ['one.example', 'two.example']).expect(202);
    const failing = providerFor(async (competitor) => {
      throw new VendorUnavailableError(`down ${competitor}`, {
        provider: 'test',
        operation: 'gap',
      });
    });
    await expect(processLatest(failing)).rejects.toBeInstanceOf(VendorUnavailableError);
    const run = await LinkGapRun.findById(queuedJobs[0]!.runId);
    expect(run).toMatchObject({ status: 'failed' });
    expect(run?.perLegOutcomes.every((outcome) => outcome.status === 'failed')).toBe(true);
  });

  it('mixed outcomes fail only the failed leg', async () => {
    const user = await seedUser('mixed@gap.test');
    const siteId = await seedSite(user.id);
    await startGap(user, siteId, ['ok.example', 'fail.example']).expect(202);
    const mixed = providerFor(async (competitor) => {
      if (competitor === 'fail.example') {
        throw new VendorUnavailableError('down', {
          provider: 'test',
          operation: 'gap',
        });
      }
      return rows;
    });
    await expect(processLatest(mixed)).rejects.toBeInstanceOf(VendorUnavailableError);
    const run = await LinkGapRun.findById(queuedJobs[0]!.runId);
    expect(run?.perLegOutcomes.map((outcome) => outcome.status)).toEqual(['ok', 'failed']);
    expect(run?.status).toBe('failed');
  });

  it('clean zero results settle as zeroRetained', async () => {
    const user = await seedUser('zero@gap.test');
    const siteId = await seedSite(user.id);
    await startGap(user, siteId, ['empty.example']).expect(202);
    await processLatest(providerFor(async () => []));
    const run = await LinkGapRun.findById(queuedJobs[0]!.runId);
    expect(run).toMatchObject({ status: 'succeeded' });
    expect(run?.perLegOutcomes[0]).toMatchObject({
      status: 'zeroRetained',
      retainedCount: 0,
    });
  });

  it('provider failure then BullMQ retry does not recall the provider', async () => {
    const user = await seedUser('retry@gap.test');
    const siteId = await seedSite(user.id);
    await startGap(user, siteId, ['fail.example']).expect(202);
    const handler = vi.fn(async () => {
      throw new VendorUnavailableError('down', {
        provider: 'test',
        operation: 'gap',
      });
    });
    const processor = createLinkGapProcessor({
      db: getTestDb() as never,
      provider: providerFor(handler),
    });
    await expect(processor({ data: queuedJobs[0] } as never)).rejects.toBeInstanceOf(
      VendorUnavailableError,
    );
    await processor({ data: queuedJobs[0] } as never);
    expect(handler).toHaveBeenCalledTimes(1);
    expect((await LinkGapRun.findById(queuedJobs[0]!.runId))?.perLegOutcomes).toHaveLength(1);
  });
  it('duplicate settlement is idempotent', async () => {
    const user = await seedUser('settle@gap.test');
    const siteId = await seedSite(user.id);
    const run = await LinkGapRun.create({
      accountId: user.id,
      siteId,
      ownDomain: 'example.com',
      competitors: ['rival.example'],
      status: 'running',
    });
    const outcome = {
      competitor: 'rival.example',
      status: 'failed' as const,
      retainedCount: 0,
    };
    expect(await settleLinkGapLeg(String(run._id), user.id, outcome)).toBe(true);
    expect(await settleLinkGapLeg(String(run._id), user.id, outcome)).toBe(false);
    expect((await LinkGapRun.findById(run._id))?.perLegOutcomes).toHaveLength(1);
  });

  it('keeps the first settlement when a concurrent failure settlement already won', async () => {
    const user = await seedUser('settle-race@gap.test');
    const siteId = await seedSite(user.id);
    await startGap(user, siteId, ['race.example']).expect(202);
    const processor = createLinkGapProcessor({
      db: getTestDb() as never,
      provider: providerFor(async () => {
        await settleLinkGapLeg(queuedJobs[0]!.runId, user.id, {
          competitor: 'race.example',
          status: 'failed',
          retainedCount: 0,
        });
        throw new VendorUnavailableError('lost race', {
          provider: 'test',
          operation: 'gap',
        });
      }),
    });
    await expect(processor({ data: queuedJobs[0] } as never)).rejects.toBeInstanceOf(
      VendorUnavailableError,
    );
    expect((await LinkGapRun.findById(queuedJobs[0]!.runId))?.perLegOutcomes).toHaveLength(1);
  });
  it('recovers a retained snapshot after a crash without provider recall', async () => {
    const user = await seedUser('recover@gap.test');
    const siteId = await seedSite(user.id);
    await startGap(user, siteId, ['rival.example']).expect(202);
    await getTestDb().insert(linkGapSnapshots).values({
      accountId: user.id,
      siteId,
      runId: queuedJobs[0]!.runId,
      ownDomain: 'example.com',
      competitor: 'rival.example',
      payload: [],
      retainedCount: 0,
      retainedAt: new Date('2026-07-22T00:00:00.000Z'),
    });
    const handler = vi.fn(async () => rows);
    await processLatest(providerFor(handler));
    expect(handler).not.toHaveBeenCalled();
    expect((await LinkGapRun.findById(queuedJobs[0]!.runId))?.perLegOutcomes[0]).toMatchObject({
      status: 'zeroRetained',
    });
  });

  it('recovers a non-empty snapshot as ok and skips an already-settled leg', async () => {
    const user = await seedUser('recover-ok@gap.test');
    const siteId = await seedSite(user.id);
    const run = await LinkGapRun.create({
      accountId: user.id,
      siteId,
      ownDomain: 'example.com',
      competitors: ['settled.example', 'stored.example'],
      status: 'running',
      perLegOutcomes: [
        {
          competitor: 'settled.example',
          status: 'zeroRetained',
          retainedCount: 0,
        },
      ],
    });
    await getTestDb().insert(linkGapSnapshots).values({
      accountId: user.id,
      siteId,
      runId: String(run._id),
      ownDomain: 'example.com',
      competitor: 'stored.example',
      payload: [
        {
          domain: 'link.example',
          intersections: 1,
          rank: 20,
          firstSeen: null,
        },
      ],
      retainedCount: 1,
      retainedAt: new Date(),
    });
    const handler = vi.fn(async () => []);
    await createLinkGapProcessor({
      db: getTestDb() as never,
      provider: providerFor(handler),
    })({ data: { accountId: user.id, siteId, runId: String(run._id) } } as never);
    expect(handler).not.toHaveBeenCalled();
    expect((await LinkGapRun.findById(run._id))?.perLegOutcomes.map((leg) => leg.status)).toEqual([
      'zeroRetained',
      'ok',
    ]);
  });

  it('missing provider operation and non-provider failures both fail the leg', async () => {
    const user = await seedUser('errors@gap.test');
    const siteId = await seedSite(user.id);
    await startGap(user, siteId, ['missing.example']).expect(202);
    const minimal: BacklinkProvider = {
      getSummary: createFakeBacklinkProvider().getSummary,
      listBacklinks: createFakeBacklinkProvider().listBacklinks,
    };
    await expect(processLatest(minimal)).rejects.toBeInstanceOf(VendorUnavailableError);

    await clearCollections();
    await truncateAllTables();
    const second = await seedUser('non-provider@gap.test');
    const secondSite = await seedSite(second.id);
    installQueue();
    await startGap(second, secondSite, ['boom.example']).expect(202);
    await expect(
      processLatest(providerFor(async () => {
        throw new Error('internal persistence-adjacent failure');
      })),
    ).rejects.toThrow('internal persistence-adjacent failure');
    expect((await LinkGapRun.findById(queuedJobs[0]!.runId))?.perLegOutcomes[0]?.status).toBe(
      'failed',
    );
  });
});

describe('stored gap read and processor boundaries', () => {
  it('computes deterministic overlap for empty and de-duplicated retained rows', () => {
    expect(computeLinkGapOverlap([])).toEqual({
      totalUnique: 0,
      exclusiveToCompetitor: 0,
      exclusivePct: 0,
    });
    expect(
      computeLinkGapOverlap([
        { domain: ' Link.Example ' },
        { domain: 'link.example' },
        { domain: 'other.example' },
      ]),
    ).toEqual({
      totalUnique: 2,
      exclusiveToCompetitor: 2,
      exclusivePct: 100,
    });
  });

  it('reads stored rows while disabled and returns observation metadata', async () => {
    const user = await seedUser('read@gap.test');
    const siteId = await seedSite(user.id);
    await startGap(user, siteId, ['rival.example']).expect(202);
    await processLatest(providerFor(async () => [
      { domain: 'link.example', intersections: 3, rank: 42 },
    ]));
    (env as { LINK_INTELLIGENCE_ENABLED: boolean }).LINK_INTELLIGENCE_ENABLED = false;
    const response = await request(app)
      .get(`/api/backlinks/gap/${queuedJobs[0]!.runId}`)
      .set('Cookie', user.cookie);
    expect(response.status).toBe(200);
    expect(response.body.legs[0].result).toMatchObject({
      rows: [
        {
          domain: 'link.example',
          intersections: 3,
          rank: 42,
          firstSeen: null,
        },
      ],
      overlap: {
        totalUnique: 1,
        exclusiveToCompetitor: 1,
        exclusivePct: 100,
      },
      observation: { source: 'provider_observation' },
    });
  });

  it('serializes queued and failed legs without snapshots as null results', async () => {
    const user = await seedUser('null-read@gap.test');
    const siteId = await seedSite(user.id);
    const queued = await LinkGapRun.create({
      accountId: user.id,
      siteId,
      ownDomain: 'example.com',
      competitors: ['queued.example'],
      status: 'queued',
    });
    const queuedView = await getLinkGapRun(user.id, String(queued._id), getTestDb() as never);
    expect(queuedView.completedAt).toBeNull();
    expect(queuedView.legs).toEqual([]);
    const failed = await LinkGapRun.create({
      accountId: user.id,
      siteId,
      ownDomain: 'example.com',
      competitors: ['failed.example'],
      status: 'failed',
      perLegOutcomes: [
        {
          competitor: 'failed.example',
          status: 'failed',
          retainedCount: 0,
        },
      ],
      completedAt: new Date(),
    });
    const failedView = await getLinkGapRun(user.id, String(failed._id), getTestDb() as never);
    expect(failedView.legs[0]?.result).toBeNull();
  });

  it('returns 404 for a different account', async () => {
    const owner = await seedUser('read-owner@gap.test');
    const stranger = await seedUser('read-stranger@gap.test');
    const siteId = await seedSite(owner.id);
    await startGap(owner, siteId, ['rival.example']).expect(202);
    const response = await request(app)
      .get(`/api/backlinks/gap/${queuedJobs[0]!.runId}`)
      .set('Cookie', stranger.cookie);
    expect(response.status).toBe(404);
    await expect(
      getLinkGapRun(owner.id, new mongoose.Types.ObjectId().toString(), getTestDb() as never),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('bounds and validates normalized provider rows', async () => {
    const result = await fetchLinkGapPayload(
      'example.com',
      'rival.example',
      providerFor(async () => [
        { domain: 'WWW.Link.Example', intersections: 1, rank: null },
        { domain: 'link.example', intersections: 2, rank: 30 },
        { domain: 'example.com', intersections: 9, rank: 99 },
      ]),
    );
    expect(result).toEqual([
      {
        domain: 'link.example',
        intersections: 1,
        rank: null,
        firstSeen: null,
      },
    ]);
  });

  it('skips bulk rank on an empty candidate set and rejects a missing bulk-rank operation', async () => {
    const getBulkRanks = vi.fn().mockResolvedValue([]);
    const emptyProvider = providerFor(async () => []);
    emptyProvider.getBulkRanks = getBulkRanks;
    await expect(
      fetchLinkGapPayload('example.com', 'rival.example', emptyProvider),
    ).resolves.toEqual([]);
    expect(getBulkRanks).not.toHaveBeenCalled();

    const withoutBulk = providerFor(async () => [
      { domain: 'link.example', intersections: 1, rank: 10 },
    ]);
    delete withoutBulk.getBulkRanks;
    await expect(
      fetchLinkGapPayload('example.com', 'rival.example', withoutBulk),
    ).rejects.toBeInstanceOf(VendorUnavailableError);
  });

  it('ignores unknown jobs and already-terminal runs', async () => {
    const user = await seedUser('terminal@gap.test');
    const siteId = await seedSite(user.id);
    const processor = createLinkGapProcessor({
      db: getTestDb() as never,
      provider: createFakeBacklinkProvider(),
    });
    await processor({
      data: { accountId: user.id, siteId, runId: new mongoose.Types.ObjectId().toString() },
    } as never);
    const run = await LinkGapRun.create({
      accountId: user.id,
      siteId,
      ownDomain: 'example.com',
      competitors: ['rival.example'],
      status: 'succeeded',
    });
    await processor({
      data: { accountId: user.id, siteId, runId: String(run._id) },
    } as never);
    expect((await LinkGapRun.findById(run._id))?.status).toBe('succeeded');
  });

  it('uses the injected clock and leaves a deliberately stale final read running', async () => {
    const user = await seedUser('incomplete@gap.test');
    const siteId = await seedSite(user.id);
    const run = await LinkGapRun.create({
      accountId: user.id,
      siteId,
      ownDomain: 'example.com',
      competitors: ['rival.example'],
      status: 'running',
    });
    const stale = await LinkGapRun.findById(run._id);
    const findSpy = vi
      .spyOn(LinkGapRun, 'findOne')
      .mockResolvedValueOnce(stale)
      .mockResolvedValueOnce(stale);
    const fixed = new Date('2026-07-22T13:00:00.000Z');
    await createLinkGapProcessor({
      db: getTestDb() as never,
      provider: providerFor(async () => []),
      now: () => fixed,
    })({ data: { accountId: user.id, siteId, runId: String(run._id) } } as never);
    findSpy.mockRestore();
    expect((await LinkGapRun.findById(run._id))?.status).toBe('running');
  });

  it('returns safely if the run disappears before finalization', async () => {
    const user = await seedUser('disappear@gap.test');
    const siteId = await seedSite(user.id);
    const run = await LinkGapRun.create({
      accountId: user.id,
      siteId,
      ownDomain: 'example.com',
      competitors: ['rival.example'],
      status: 'running',
    });
    await createLinkGapProcessor({
      db: getTestDb() as never,
      provider: providerFor(async () => {
        await LinkGapRun.deleteOne({ _id: run._id });
        return [];
      }),
    })({ data: { accountId: user.id, siteId, runId: String(run._id) } } as never);
    expect(await LinkGapRun.findById(run._id)).toBeNull();
  });
});

// The route suite can never reach the service-level ownership guard:
// `siteMutationLease` answers 404 for an unowned or missing site before the
// router runs. This is the defence-in-depth layer every non-HTTP caller hits.
describe('link-gap service ownership guard', () => {
  const GUARD_ACCOUNT = '6a6fa7c28d75c2fd32d84a63';

  it('refuses a well-formed site id this account does not own', async () => {
    await expect(startLinkGapRun({ accountId: GUARD_ACCOUNT, siteId: '6a6fa7c28d75c2fd32d84a99', competitors: ['rival.example'] }, { queue: null })).rejects.toMatchObject({ status: 404 });
  });
});
