/** HTTP acceptance tests for the stored-inventory internal-link workflow. */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Queue } from 'bullmq';
import { Types } from 'mongoose';
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
import {
  ContentInventoryPage,
  ContentInventoryRun,
} from '../content-intelligence/inventory.model.js';
import type { InventoryPageFacts } from '../content-intelligence/inventory.schemas.js';
import { Site } from '../sites/sites.model.js';
import {
  getInternalLinksDb,
  getInternalLinksQueue,
  setInternalLinksDb,
  setInternalLinksQueue,
} from './internal-links.holder.js';
import { InternalLinkRun } from './internal-links.model.js';
import { listInternalLinkRuns } from './internal-links.service.js';

const app = createApp();
let sequence = 0;

function page(
  url: string,
  headings: string[],
  overrides: Partial<InventoryPageFacts> = {},
): InventoryPageFacts {
  return {
    url,
    canonical: null,
    statusCode: 200,
    robots: [],
    language: 'en',
    title: headings[0] ?? null,
    description: null,
    headings,
    wordCount: 600,
    schemaTypes: [],
    hasSchemaOrgArticle: false,
    internalLinkCount: 0,
    externalLinkCount: 0,
    internalOutLinks: [],
    contentHash: `hash-${url}`,
    primaryTopics: [],
    secondaryTopics: [],
    targetQueries: [],
    qualityFlags: [],
    ...overrides,
  };
}

async function seedUser() {
  sequence += 1;
  return signupVerifiedUser(app, {
    email: `internal-links-${sequence}@example.test`,
  });
}

async function seedSite(user: TestUser, domain = 'example.test') {
  const site = await Site.create({
    accountId: new Types.ObjectId(user.id),
    url: `https://${domain}`,
    domain,
    displayName: domain,
  });
  return String(site._id);
}

async function seedInventory(input: {
  user: TestUser;
  siteId: string;
  completedAt?: Date;
  status?: 'completed' | 'partial';
  pages?: InventoryPageFacts[];
}) {
  const now = new Date();
  const run = await ContentInventoryRun.create({
    accountId: input.user.id,
    ownerUserId: input.user.id,
    siteId: input.siteId,
    origin: 'https://example.test',
    locale: 'en',
    status: input.status ?? 'completed',
    input: { pageLimit: 20, allowedPaths: [], excludedPaths: [], sitemapSeeds: [] },
    inputFingerprint: new Types.ObjectId().toString(),
    idempotencyKey: new Types.ObjectId().toString(),
    requestedAt: new Date(now.getTime() - 60_000),
    completedAt: input.completedAt ?? new Date(now.getTime() - 30_000),
  });
  const pages =
    input.pages ??
    [
      page('https://example.test/blog/source', ['technical seo audit guide']),
      page('https://example.test/services/target', ['technical seo audit checklist']),
    ];
  await ContentInventoryPage.insertMany(
    pages.map((facts) => ({
      runId: run._id,
      accountId: input.user.id,
      siteId: input.siteId,
      facts,
      url: facts.url,
      contentHash: facts.contentHash,
      createdAtMs: now.getTime(),
    })),
  );
  return run;
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
    .post(`/api/sites/${siteId}/internal-link-runs/preview`)
    .set('Cookie', user.cookie)
    .send(body);

const start = (user: TestUser, siteId: string, body: object = {}) =>
  request(app)
    .post(`/api/sites/${siteId}/internal-link-runs`)
    .set('Cookie', user.cookie)
    .send(body);

beforeAll(async () => {
  await startMemoryMongo();
  const db = await startTestPostgres();
  installTestAuth();
  setInternalLinksDb(db as never);
});

afterAll(async () => {
  uninstallTestAuth();
  setInternalLinksQueue(null);
  setInternalLinksDb(null);
  (env as { INTERNAL_LINKING_ENABLED: boolean }).INTERNAL_LINKING_ENABLED = false;
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  (env as { INTERNAL_LINKING_ENABLED: boolean }).INTERNAL_LINKING_ENABLED = true;
  setInternalLinksQueue(fakeQueue().queue);
});

describe('internal-link HTTP auth and validation', () => {
  it('protects every route and validates ids, bodies, and list bounds', async () => {
    const id = new Types.ObjectId().toString();
    await request(app).post(`/api/sites/${id}/internal-link-runs/preview`).send({}).expect(401);
    await request(app).post(`/api/sites/${id}/internal-link-runs`).send({}).expect(401);
    await request(app).get(`/api/sites/${id}/internal-link-runs`).expect(401);
    await request(app).get(`/api/internal-link-runs/${id}`).expect(401);
    await request(app).get(`/api/internal-link-runs/${id}/export.csv`).expect(401);

    const user = await seedUser();
    await preview(user, 'bad-id').expect(400);
    // Body/query validation is asserted against a site this account owns: the
    // site work lease resolves ownership ahead of the route, so a well-formed
    // id for a site that does not exist is a 404 long before zod sees a body.
    const ownedSiteId = await seedSite(user);
    await start(user, ownedSiteId, { locale: 'it' }).expect(400);
    await start(user, ownedSiteId, { locale: 'en', surprise: true }).expect(400);
    await request(app)
      .get(`/api/sites/${ownedSiteId}/internal-link-runs?limit=51`)
      .set('Cookie', user.cookie)
      .expect(400);
    await request(app)
      .get('/api/internal-link-runs/not-an-id')
      .set('Cookie', user.cookie)
      .expect(400);
  });
});

describe('internal-link preflight', () => {
  it('previews the pinned inventory date and community spend without enqueueing', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    const inventory = await seedInventory({ user, siteId });
    const res = await preview(user, siteId).expect(200);
    expect(res.body).toMatchObject({
      ready: true,
      reason: null,
      freshnessDays: 7,
      inventoryDate: inventory.completedAt?.toISOString(),
      spend: { deploymentMode: 'community', capacityEnforced: false },
    });
    expect(await InternalLinkRun.countDocuments()).toBe(0);
  });

  it('reports missing and stale inventory without enqueueing', async () => {
    for (const state of ['missing', 'stale'] as const) {
      const user = await seedUser();
      const siteId = await seedSite(user, `${state}.example.test`);
      const queued = fakeQueue();
      setInternalLinksQueue(queued.queue);
      if (state === 'stale') {
        await seedInventory({
          user,
          siteId,
          completedAt: new Date(Date.now() - 8 * 86_400_000),
        });
      }
      const preflight = await preview(user, siteId).expect(200);
      expect(preflight.body).toMatchObject({ ready: false, reason: state, spend: null });
      const refusal = await start(user, siteId).expect(409);
      expect(refusal.body.error.message).toBeTruthy();
      expect(queued.add).not.toHaveBeenCalled();

      await clearCollections();
      await seedSite(user, `fresh-${state}.example.test`).then(async (freshSiteId) => {
        await seedInventory({ user, siteId: freshSiteId });
        await start(user, freshSiteId).expect(202);
      });
    }
  });

  it('ignores partial inventory runs and treats a future completed run as stale', async () => {
    const user = await seedUser();
    const partialSiteId = await seedSite(user, 'partial.example.test');
    await seedInventory({ user, siteId: partialSiteId, status: 'partial' });
    expect((await preview(user, partialSiteId).expect(200)).body.reason).toBe('missing');

    const futureSiteId = await seedSite(user, 'future.example.test');
    await seedInventory({
      user,
      siteId: futureSiteId,
      completedAt: new Date(Date.now() + 86_400_000),
    });
    expect((await preview(user, futureSiteId).expect(200)).body.reason).toBe('stale');
  });

  it('checks ownership and returns a cross-account 404', async () => {
    const owner = await seedUser();
    const stranger = await seedUser();
    const siteId = await seedSite(owner);
    await seedInventory({ user: owner, siteId });
    await preview(stranger, siteId).expect(404);
    await start(stranger, siteId).expect(404);
    await request(app)
      .get(`/api/sites/${siteId}/internal-link-runs`)
      .set('Cookie', stranger.cookie)
      .expect(404);
  });

  it('honors the kill switch on mutations while stored runs remain readable', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    const inventory = await seedInventory({ user, siteId });
    const run = await InternalLinkRun.create({
      accountId: user.id,
      siteId,
      inventoryRunId: inventory._id,
      inventoryDate: inventory.completedAt,
      gscSnapshotDate: null,
      candidateRulesVersion: '2026-08-02.1',
      locale: 'en',
      status: 'completed',
      aiStatus: 'applied',
      suggestions: [],
      requestedAt: new Date(),
      completedAt: new Date(),
    });
    (env as { INTERNAL_LINKING_ENABLED: boolean }).INTERNAL_LINKING_ENABLED = false;
    await preview(user, siteId).expect(503);
    await start(user, siteId).expect(503);
    await request(app)
      .get(`/api/sites/${siteId}/internal-link-runs`)
      .set('Cookie', user.cookie)
      .expect(200);
    await request(app)
      .get(`/api/internal-link-runs/${run._id}`)
      .set('Cookie', user.cookie)
      .expect(200);
  });

  it('fails closed when the queue is unavailable or enqueue rejects', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    await seedInventory({ user, siteId });
    setInternalLinksQueue(null);
    await start(user, siteId).expect(503);
    expect(await InternalLinkRun.countDocuments()).toBe(0);

    const rejecting = fakeQueue({ reject: true });
    setInternalLinksQueue(rejecting.queue);
    await start(user, siteId).expect(503);
    const stored = await InternalLinkRun.findOne().lean();
    expect(stored).toMatchObject({
      status: 'failed',
      error: {
        category: 'queue_failed',
        messageKey: 'internalLinks.errors.queueFailed',
      },
    });
    const detail = await request(app)
      .get(`/api/internal-link-runs/${stored?._id}`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(detail.body.error).toEqual({
      category: 'queue_failed',
      messageKey: 'internalLinks.errors.queueFailed',
    });
  });
});

describe('internal-link stored reads and export', () => {
  it('enqueues identity only with a colon-free id and returns an honest run DTO', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    const inventory = await seedInventory({ user, siteId });
    const queued = fakeQueue();
    setInternalLinksQueue(queued.queue);
    const response = await start(user, siteId, { locale: 'ar' }).expect(202);
    expect(response.body).toMatchObject({
      siteId,
      status: 'queued',
      aiStatus: 'pending',
      inventoryDate: inventory.completedAt?.toISOString(),
      candidateRulesVersion: '2026-08-02.1',
      suggestionCount: 0,
      suggestions: [],
    });
    expect(response.body.requestedAt).toBeTruthy();
    expect(queued.add).toHaveBeenCalledWith(
      'internal-links',
      { accountId: user.id, siteId, runId: response.body.id },
      { jobId: `internal-links-${response.body.id}` },
    );
    expect(`internal-links-${response.body.id}`).not.toContain(':');
  });

  it('lists, reopens, and CSV-exports stored evidence', async () => {
    const user = await seedUser();
    const stranger = await seedUser();
    const siteId = await seedSite(user);
    const inventory = await seedInventory({ user, siteId });
    const inventoryDate = inventory.completedAt ?? new Date();
    const run = await InternalLinkRun.create({
      accountId: user.id,
      siteId,
      inventoryRunId: inventory._id,
      inventoryDate,
      gscSnapshotDate: '2026-07-31',
      candidateRulesVersion: '2026-08-02.1',
      locale: 'en',
      status: 'completed',
      aiStatus: 'applied',
      suggestions: [
        {
          id: 'link-0123456789abcdefabcd',
          sourceUrl: '=HYPERLINK("https://evil.test")',
          sourceSection: '/blog',
          sourceWordCount: 800,
          targetUrl: 'https://example.test/target',
          targetFlag: 'orphan',
          targetInboundCount: 0,
          confidence: 'high',
          sharedQueries: ['+shared query'],
          headingMatches: ['-shared heading'],
          anchorText: '@draft anchor',
          inventoryDate,
          rank: 1,
          rankingSource: 'ai',
        },
        {
          id: 'link-fedcba9876543210fedc',
          sourceUrl: 'https://example.test/plain-source',
          sourceSection: '/',
          sourceWordCount: 300,
          targetUrl: 'https://example.test/plain-target',
          targetFlag: 'weakly_linked',
          targetInboundCount: 1,
          confidence: 'low',
          sharedQueries: [],
          headingMatches: ['plain', 'target'],
          anchorText: 'plain anchor',
          inventoryDate,
          rank: null,
          rankingSource: 'deterministic',
        },
      ],
      requestedAt: new Date(),
      startedAt: new Date(),
      completedAt: new Date(),
      aiCostMicros: 500,
    });

    const list = await request(app)
      .get(`/api/sites/${siteId}/internal-link-runs?limit=1`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({
      id: String(run._id),
      suggestionCount: 2,
      gscSnapshotDate: '2026-07-31',
    });
    expect(list.body.items[0]).not.toHaveProperty('suggestions');

    const detail = await request(app)
      .get(`/api/internal-link-runs/${run._id}`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(detail.body.suggestions[0]).toMatchObject({
      sourceUrl: '=HYPERLINK("https://evil.test")',
      targetUrl: 'https://example.test/target',
      targetInboundCount: 0,
      targetFlag: 'orphan',
      sharedQueries: ['+shared query'],
      headingMatches: ['-shared heading'],
      inventoryDate: inventoryDate.toISOString(),
    });

    const csv = await request(app)
      .get(`/api/internal-link-runs/${run._id}/export.csv`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toContain(`internal-links-${run._id}.csv`);
    expect(csv.text.charCodeAt(0)).toBe(0xfeff);
    expect(csv.text).toContain("'=HYPERLINK");
    expect(csv.text).toContain("'+shared query");
    expect(csv.text).toContain("'-shared heading");
    expect(csv.text).toContain("'@draft anchor");

    await request(app)
      .get(`/api/internal-link-runs/${run._id}`)
      .set('Cookie', stranger.cookie)
      .expect(404);
    await request(app)
      .get(`/api/internal-link-runs/${run._id}/export.csv`)
      .set('Cookie', stranger.cookie)
      .expect(404);
  });

  it('returns 404 for absent stored runs and empty lists honestly', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    const list = await request(app)
      .get(`/api/sites/${siteId}/internal-link-runs`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(list.body).toEqual({ items: [] });
    await request(app)
      .get(`/api/internal-link-runs/${new Types.ObjectId()}`)
      .set('Cookie', user.cookie)
      .expect(404);
  });
});

describe('zero content-source boundary', () => {
  it('contains no crawler, Firecrawl, or content-source provider dependency', async () => {
    const directory = dirname(fileURLToPath(import.meta.url));
    const files = [
      'internal-links.controller.ts',
      'internal-links.service.ts',
      'internal-links.processor.ts',
      'internal-links.candidates.ts',
      'internal-links.routes.ts',
    ];
    const source = (
      await Promise.all(files.map((name) => readFile(join(directory, name), 'utf8')))
    ).join('\n');
    expect(source).not.toMatch(/firecrawl|content-source|crawlInventory|contentSourceProvider/iu);
    expect(getInternalLinksDb()).toBeTruthy();
    expect(getInternalLinksQueue()).toBeTruthy();

    const user = await seedUser();
    setInternalLinksDb(null);
    await preview(user, new Types.ObjectId().toString()).expect(404);
    setInternalLinksDb(getTestDb() as never);
    expect(getInternalLinksDb()).toBeTruthy();
  });
});

// The route suite can never reach the service-level ownership guard:
// `siteMutationLease` answers 404 for an unowned or missing site before the
// router runs. This is the defence-in-depth layer every non-HTTP caller hits.
describe('internal-links service ownership guard', () => {
  const GUARD_ACCOUNT = '6a6fa7c28d75c2fd32d84a63';

  it('refuses a well-formed site id this account does not own', async () => {
    await expect(listInternalLinkRuns({ accountId: GUARD_ACCOUNT, siteId: '6a6fa7c28d75c2fd32d84a99', limit: 10 })).rejects.toMatchObject({ status: 404 });
  });

});
