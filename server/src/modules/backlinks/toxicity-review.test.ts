import type { Queue } from 'bullmq';
import type { Request } from 'express';
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
  backlinkRowSnapshots,
  vendorResponses,
} from '../../db/schema/index.js';
import { createAiProfileRunner } from '../../shared/ai-profiles/index.js';
import {
  createFakeAiGenerationProvider,
  createFakeBacklinkProvider,
  VendorUnavailableError,
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
import {
  setBacklinkDeepQueue,
  setBacklinkProvider,
  setBacklinksDb,
} from './backlinks.holder.js';
import {
  bulkStageEstimate,
  candidateFromArchivedRow,
  createToxicityReviewProcessor,
  loadArchivedCandidates,
  targetDomains,
  TOXICITY_BULK_BASE_COST_MICROS,
  TOXICITY_BULK_TARGET_COST_MICROS,
} from './toxicity-review.processor.js';
import { resolveToxicityLocale } from './toxicity-review.controller.js';
import { ToxicityReviewRun } from './toxicity-review.model.js';
import {
  previewToxicityReviewSpend,
  startToxicityReview,
} from './toxicity-review.service.js';

const app = createApp();
const originalEnabled = env.TOXIC_LINKS_ENABLED;
const originalCeiling = env.TOXICITY_COST_CEILING_MICROS;

type ToxicityJob = {
  accountId: string;
  siteId: string;
  runId: string;
  operation: 'toxicity_review';
};

let queuedJobs: ToxicityJob[] = [];

function installQueue(): void {
  queuedJobs = [];
  setBacklinkDeepQueue({
    add: vi.fn(async (_name: string, data: ToxicityJob) => {
      queuedJobs.push(data);
      return { id: data.runId };
    }),
  } as unknown as Queue);
}

async function seedUser(email: string): Promise<TestUser> {
  return signupVerifiedUser(app, { email });
}

async function seedSite(accountId: string, domain: string): Promise<string> {
  const site = await Site.create({
    accountId: new mongoose.Types.ObjectId(accountId),
    url: `https://${domain}`,
    domain,
  });
  return String(site._id);
}

interface ArchiveRowOptions {
  domain?: string;
  path?: string;
  spamScore?: number | null;
  dofollow?: boolean;
  isBroken?: boolean;
  firstSeen?: string | null;
  lastSeen?: string | null;
}

function archiveRow(options: ArchiveRowOptions = {}) {
  const domain = options.domain ?? 'source.example';
  return {
    domainFrom: domain,
    urlFrom: `https://${domain}${options.path ?? '/page'}`,
    urlTo: 'https://owned.example/landing',
    anchor: '<img src=x onerror=alert(1)>',
    dofollow: options.dofollow ?? true,
    isBroken: options.isBroken ?? false,
    firstSeen:
      options.firstSeen === undefined
        ? '2026-01-01T00:00:00.000Z'
        : options.firstSeen,
    lastSeen:
      options.lastSeen === undefined
        ? '2026-07-01T00:00:00.000Z'
        : options.lastSeen,
    backlinkSpamScore: options.spamScore ?? null,
    urlToSpamScore: 4,
  };
}

async function seedArchive(domain: string, rows: ReturnType<typeof archiveRow>[]) {
  await getTestDb().insert(vendorResponses).values({
    capability: 'backlink',
    operation: 'list-first-page',
    cacheKey: `archive-${domain}-${Math.random()}`,
    params: { domain, limit: rows.length },
    payload: { rows, nextCursor: null },
    accountId: null,
    costMicros: 24_000n,
    fetchedAt: new Date('2026-07-31T00:00:00.000Z'),
  });
}

function provider(overrides: Partial<BacklinkProvider> = {}): BacklinkProvider {
  return { ...createFakeBacklinkProvider(), ...overrides };
}

function archiveDbReturning(...pages: unknown[]): Parameters<typeof loadArchivedCandidates>[0] {
  let index = 0;
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => pages[index++] ?? [],
          }),
        }),
      }),
    }),
  } as unknown as Parameters<typeof loadArchivedCandidates>[0];
}

function start(user: TestUser, siteId: string) {
  return request(app)
    .post('/api/backlinks/toxicity')
    .set('Cookie', user.cookie)
    .send({ siteId, locale: 'en' });
}

async function processLatest(p: BacklinkProvider, ceiling = 30_000) {
  (env as { TOXICITY_COST_CEILING_MICROS: number }).TOXICITY_COST_CEILING_MICROS =
    ceiling;
  const ai = createAiProfileRunner({ provider: createFakeAiGenerationProvider() });
  await createToxicityReviewProcessor({
    db: getTestDb() as never,
    provider: p,
    ai,
    aiProviderOrder: ['fake'],
    now: () => new Date('2026-08-01T12:00:00.000Z'),
  })({ data: queuedJobs.at(-1)! } as never);
}

beforeAll(async () => {
  await startMemoryMongo();
  const db = await startTestPostgres();
  installTestAuth();
  setBacklinksDb(db as never);
});

afterAll(async () => {
  (env as { TOXIC_LINKS_ENABLED: boolean }).TOXIC_LINKS_ENABLED = originalEnabled;
  (env as { TOXICITY_COST_CEILING_MICROS: number }).TOXICITY_COST_CEILING_MICROS =
    originalCeiling;
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
  (env as { TOXIC_LINKS_ENABLED: boolean }).TOXIC_LINKS_ENABLED = true;
  (env as { TOXICITY_COST_CEILING_MICROS: number }).TOXICITY_COST_CEILING_MICROS =
    30_000;
  installQueue();
  setBacklinkProvider(createFakeBacklinkProvider());
});

describe('toxicity review routes', () => {
  it('resolves supported request locales and falls back defensively', () => {
    expect(resolveToxicityLocale({ language: 'ar' } as Request)).toBe('ar');
    expect(resolveToxicityLocale({ language: 'xx' } as unknown as Request)).toBe('en');
  });

  it('previews without enqueueing and discloses the unit and clamps', async () => {
    const user = await seedUser('tox-preview@example.test');
    const siteId = await seedSite(user.id, 'owned.example');
    const response = await request(app)
      .post('/api/backlinks/toxicity/preview')
      .set('Cookie', user.cookie)
      .send({ siteId })
      .expect(200);

    expect(response.body).toMatchObject({
      deploymentMode: 'community',
      capacityEnforced: false,
      feature: 'backlinks',
      operation: 'toxicity_review',
      productUnits: 1,
      rowClamp: 1000,
      bulkDomainClamp: 100,
    });
    expect(response.body).not.toHaveProperty('packs');
    expect(queuedJobs).toHaveLength(0);
  });
  it('uses the request locale when start omits it', async () => {
    const user = await seedUser('tox-locale@example.test');
    const siteId = await seedSite(user.id, 'locale.example');
    const response = await request(app)
      .post('/api/backlinks/toxicity')
      .set('Cookie', user.cookie)
      .set('x-lang', 'ar')
      .send({ siteId })
      .expect(202);
    const run = await ToxicityReviewRun.findById(response.body.runId);
    expect(run?.locale).toBe('ar');
  });

  it('starts repeated reviews without a per-account cap', async () => {
    const user = await seedUser('tox-repeat@example.test');
    const siteId = await seedSite(user.id, 'repeat.example');
    const first = await start(user, siteId).expect(202);
    await start(user, siteId).expect(202);
    expect(first.body).not.toHaveProperty('reservedUnits');
    expect(queuedJobs).toHaveLength(2);
  });
  it('uses the named per-account toxicity creation rate bucket', async () => {
    const first = await seedUser('tox-rate-first@example.test');
    const second = await seedUser('tox-rate-second@example.test');
    const firstSite = await seedSite(first.id, 'rate-first.example');
    const secondSite = await seedSite(second.id, 'rate-second.example');

    for (let index = 0; index < 30; index += 1) {
      await request(app)
        .post('/api/backlinks/toxicity/preview')
        .set('Cookie', first.cookie)
        .send({ siteId: firstSite })
        .expect(200);
    }
    const limited = await request(app)
      .post('/api/backlinks/toxicity/preview')
      .set('Cookie', first.cookie)
      .send({ siteId: firstSite })
      .expect(429);
    expect(limited.body.error).toBe(
      'Too many link review requests. Try again shortly.',
    );
    await request(app)
      .post('/api/backlinks/toxicity/preview')
      .set('Cookie', second.cookie)
      .send({ siteId: secondSite })
      .expect(200);
  });

  it('gates preview/start while stored reads stay available and cross-account reads are 404', async () => {
    const owner = await seedUser('tox-owner@example.test');
    const stranger = await seedUser('tox-stranger@example.test');
    const siteId = await seedSite(owner.id, 'stored.example');
    const run = await ToxicityReviewRun.create({
      accountId: owner.id,
      siteId,
      domain: 'stored.example',
      status: 'succeeded',
      providerStatus: 'not_needed',
      aiStatus: 'abstained',
      completedAt: new Date(),
    });
    (env as { TOXIC_LINKS_ENABLED: boolean }).TOXIC_LINKS_ENABLED = false;

    await request(app)
      .post('/api/backlinks/toxicity/preview')
      .set('Cookie', owner.cookie)
      .send({ siteId })
      .expect(503);
    await start(owner, siteId).expect(503);
    await request(app)
      .get(`/api/backlinks/toxicity/${String(run._id)}`)
      .set('Cookie', owner.cookie)
      .expect(200);
    await request(app)
      .get(`/api/backlinks/toxicity/${String(run._id)}`)
      .set('Cookie', stranger.cookie)
      .expect(404);
  });

  it('lists with a status filter and refuses disavow for unfinished runs', async () => {
    const pro = await seedUser('tox-list@example.test');
    const siteId = await seedSite(pro.id, 'list.example');
    await ToxicityReviewRun.create({
      accountId: pro.id,
      siteId,
      domain: 'list.example',
      status: 'failed',
      providerStatus: 'failed',
      aiStatus: 'not_requested',
    });
    const listed = await request(app)
      .get('/api/backlinks/toxicity')
      .set('Cookie', pro.cookie)
      .query({ siteId, status: 'failed' })
      .expect(200);
    expect(listed.body.runs).toHaveLength(1);
    await request(app)
      .post(`/api/backlinks/toxicity/${listed.body.runs[0].runId}/disavow`)
      .set('Cookie', pro.cookie)
      .send({ entries: [] })
      .expect(409);
  });

  it('paginates unfiltered stored runs and applies the cursor', async () => {
    const pro = await seedUser('tox-pages@example.test');
    const siteId = await seedSite(pro.id, 'pages.example');
    for (const status of ['queued', 'running', 'failed'] as const) {
      await ToxicityReviewRun.create({
        accountId: pro.id,
        siteId,
        domain: 'pages.example',
        status,
      });
    }
    const first = await request(app)
      .get('/api/backlinks/toxicity')
      .set('Cookie', pro.cookie)
      .query({ siteId, limit: 1 })
      .expect(200);
    expect(first.body.runs).toHaveLength(1);
    expect(first.body.nextCursor).toMatch(/^[0-9a-f]{24}$/u);
    const second = await request(app)
      .get('/api/backlinks/toxicity')
      .set('Cookie', pro.cookie)
      .query({ siteId, limit: 1, cursor: first.body.nextCursor })
      .expect(200);
    expect(second.body.runs).toHaveLength(1);
    expect(second.body.runs[0].runId).not.toBe(first.body.runs[0].runId);
  });

  it('conceals invalid/missing sites in the preview and honors a missing queue', async () => {
    const pro = await seedUser('tox-owned-site@example.test');
    const queue = {} as Queue;
    await expect(
      previewToxicityReviewSpend(pro.id, 'not-an-object-id', { queue }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      previewToxicityReviewSpend(pro.id, new mongoose.Types.ObjectId().toString(), { queue }),
    ).rejects.toMatchObject({ status: 404 });
    const siteId = await seedSite(pro.id, 'preview-clock.example');
    const at = new Date('2026-08-01T09:00:00.000Z');
    const preview = await previewToxicityReviewSpend(pro.id, siteId, { queue, now: () => at });
    expect(preview.estimatedAt).toBe(at.toISOString());
    await expect(
      previewToxicityReviewSpend(pro.id, siteId, { queue: null }),
    ).rejects.toMatchObject({ status: 503 });
  });
  it('surfaces create failures and fails the run when enqueue fails', async () => {
    const createUser = await seedUser('tox-create-failure@example.test');
    const createSiteId = await seedSite(createUser.id, 'create-failure.example');
    const createFailure = vi
      .spyOn(ToxicityReviewRun, 'create')
      .mockRejectedValueOnce(new Error('mongo unavailable'));
    await expect(
      startToxicityReview(
        { accountId: createUser.id, siteId: createSiteId, locale: 'en' },
        { queue: {} as Queue },
      ),
    ).rejects.toThrow('mongo unavailable');
    createFailure.mockRestore();

    const enqueueUser = await seedUser('tox-enqueue-failure@example.test');
    const enqueueSiteId = await seedSite(enqueueUser.id, 'enqueue-failure.example');
    const completedAt = new Date('2026-08-01T09:30:00.000Z');
    const failingQueue = {
      add: vi.fn(async () => Promise.reject(new Error('redis unavailable'))),
    } as unknown as Queue;
    await expect(
      startToxicityReview(
        { accountId: enqueueUser.id, siteId: enqueueSiteId, locale: 'en' },
        {
          queue: failingQueue,
          now: () => completedAt,
        },
      ),
    ).rejects.toMatchObject({ status: 503 });
    const failed = await ToxicityReviewRun.findOne({ accountId: enqueueUser.id });
    expect(failed).toMatchObject({
      status: 'failed',
      providerStatus: 'not_started',
      completedAt,
    });

    const defaultClockUser = await seedUser('tox-enqueue-default-clock@example.test');
    const defaultClockSiteId = await seedSite(
      defaultClockUser.id,
      'enqueue-default-clock.example',
    );
    await expect(
      startToxicityReview(
        {
          accountId: defaultClockUser.id,
          siteId: defaultClockSiteId,
          locale: 'en',
        },
        { queue: failingQueue },
      ),
    ).rejects.toMatchObject({ status: 503 });
    expect(
      (await ToxicityReviewRun.findOne({ accountId: defaultClockUser.id }))
        ?.completedAt,
    ).toBeInstanceOf(Date);
  });
});

describe('toxicity review processor', () => {
  it('normalizes archived fallback domains and rejects malformed row boundaries', () => {
    const valid = archiveRow({ domain: 'fallback.example', spamScore: 20 });
    const { domainFrom: _domainFrom, ...withoutDomain } = valid;
    expect(candidateFromArchivedRow(withoutDomain)).toMatchObject({
      domain: 'fallback.example',
      url: 'https://fallback.example/page',
      sourceSpamScore: 20,
    });
    expect(
      candidateFromArchivedRow({
        ...withoutDomain,
        firstSeen: null,
        lastSeen: null,
      }),
    ).toMatchObject({ firstSeen: null, lastSeen: null });
    expect(
      candidateFromArchivedRow({ ...withoutDomain, urlFrom: 'not a url' }),
    ).toBeNull();
    expect(
      candidateFromArchivedRow({ ...valid, domainFrom: '', urlFrom: 'not a url' }),
    ).toBeNull();
    expect(
      candidateFromArchivedRow({ ...valid, domainFrom: 'bad_label.example' }),
    ).toBeNull();
    expect(
      candidateFromArchivedRow({ ...valid, urlFrom: 'javascript:alert(1)' }),
    ).toBeNull();

    const missing = candidateFromArchivedRow(
      archiveRow({ domain: 'missing.example', spamScore: null }),
    )!;
    const present = candidateFromArchivedRow(
      archiveRow({ domain: 'present.example', spamScore: 40 }),
    )!;
    expect(targetDomains([present, missing, present])).toEqual([
      'missing.example',
      'present.example',
    ]);
    expect(bulkStageEstimate(0)).toBe(0);
  });

  it('ignores foreign/malformed archives, dedupes URLs, and completes no-row runs without spend calls', async () => {
    const user = await seedUser('tox-archive-filter@example.test');
    const siteId = await seedSite(user.id, 'archive-filter.example');
    await getTestDb().insert(vendorResponses).values([
      {
        capability: 'backlink',
        operation: 'list-page',
        cacheKey: 'tox-foreign-archive',
        params: { domain: 'other.example' },
        payload: { rows: [archiveRow()], nextCursor: null },
        accountId: null,
        costMicros: null,
        fetchedAt: new Date('2026-08-01T00:00:00.000Z'),
      },
      {
        capability: 'backlink',
        operation: 'list-page',
        cacheKey: 'tox-malformed-archive',
        params: { domain: 'archive-filter.example' },
        payload: { rows: [{ hostile: true }] },
        accountId: null,
        costMicros: null,
        fetchedAt: new Date('2026-08-01T00:01:00.000Z'),
      },
      {
        capability: 'backlink',
        operation: 'list-page',
        cacheKey: 'tox-invalid-params-archive',
        params: { domain: 42 },
        payload: { rows: [archiveRow()], nextCursor: null },
        accountId: null,
        costMicros: null,
        fetchedAt: new Date('2026-08-01T00:02:00.000Z'),
      },
      {
        capability: 'backlink',
        operation: 'list-page',
        cacheKey: 'tox-deduped-archive',
        params: { domain: 'archive-load.example' },
        payload: {
          rows: [
            archiveRow({ domain: 'duplicate.example' }),
            archiveRow({ domain: 'duplicate.example' }),
            { ...archiveRow(), domainFrom: 'bad_label.example' },
          ],
          nextCursor: null,
        },
        accountId: null,
        costMicros: null,
        fetchedAt: new Date('2026-08-01T00:03:00.000Z'),
      },
    ]);
    expect(
      await loadArchivedCandidates(getTestDb() as never, 'archive-filter.example'),
    ).toEqual([]);
    expect(
      await loadArchivedCandidates(getTestDb() as never, 'archive-load.example'),
    ).toHaveLength(1);

    await start(user, siteId).expect(202);
    const bulk = vi.fn();
    await createToxicityReviewProcessor({
      db: getTestDb() as never,
      provider: provider({ getBulkSpamScores: bulk }),
    })({ data: queuedJobs[0]! } as never);
    expect(bulk).not.toHaveBeenCalled();
    const run = await ToxicityReviewRun.findById(queuedJobs[0]!.runId);
    expect(run).toMatchObject({
      status: 'succeeded',
      providerStatus: 'not_needed',
      aiStatus: 'abstained',
      retainedCount: 0,
    });
  });

  it('defensively revalidates archive params returned outside the SQL predicate', async () => {
    const payload = { rows: [archiveRow({ domain: 'should-not-load.example' })], nextCursor: null };
    const archives = [
      {
        id: 'malformed-params',
        params: { domain: 42 },
        payload,
        fetchedAt: new Date('2026-08-01T00:00:00.000Z'),
      },
      {
        id: 'mismatched-domain',
        params: { domain: 'other.example' },
        payload,
        fetchedAt: new Date('2026-08-01T00:01:00.000Z'),
      },
    ];

    await expect(
      loadArchivedCandidates(archiveDbReturning(archives), 'requested.example'),
    ).resolves.toEqual([]);
  });

  it('terminates a malformed full archive page that exposes no last row', async () => {
    const anomalousPage = {
      length: 100,
      *[Symbol.iterator]() {
        // A defensive adapter-boundary probe: the page reports a full batch
        // but yields no rows and has no final cursor anchor.
      },
    };

    await expect(
      loadArchivedCandidates(archiveDbReturning(anomalousPage), 'requested.example'),
    ).resolves.toEqual([]);
  });

  it('finds older domain archives beyond more than 100 newer unrelated pages', async () => {
    const requestedDomain = 'deep-archive.example';
    const requested = Array.from({ length: 101 }, (_, index) => ({
      capability: 'backlink',
      operation: index === 0 ? 'list-first-page' : 'list-page',
      cacheKey: `tox-requested-${index}`,
      params: { domain: requestedDomain },
      payload: {
        rows: [
          archiveRow({
            domain: `requested-source-${index}.example`,
            path: `/page-${index}`,
          }),
        ],
        nextCursor: null,
      },
      accountId: null,
      costMicros: null,
      fetchedAt: new Date(Date.UTC(2026, 6, 1, 0, 0, index)),
    }));
    const unrelated = Array.from({ length: 101 }, (_, index) => ({
      capability: 'backlink',
      operation: 'list-page',
      cacheKey: `tox-unrelated-newer-${index}`,
      params: { domain: `unrelated-${index}.example` },
      payload: {
        rows: [archiveRow({ domain: `unrelated-source-${index}.example` })],
        nextCursor: null,
      },
      accountId: null,
      costMicros: null,
      fetchedAt: new Date(Date.UTC(2026, 7, 1, 0, 0, index)),
    }));
    await getTestDb().insert(vendorResponses).values([...requested, ...unrelated]);

    const candidates = await loadArchivedCandidates(
      getTestDb() as never,
      requestedDomain,
    );
    expect(candidates).toHaveLength(101);
    expect(candidates.map((candidate) => candidate.url)).toEqual(
      expect.arrayContaining([
        'https://requested-source-0.example/page-0',
        'https://requested-source-100.example/page-100',
      ]),
    );
  });

  it('is replay-safe for missing, succeeded, and failed run ids', async () => {
    const processor = createToxicityReviewProcessor({
      db: getTestDb() as never,
      provider: provider(),
    });
    const accountId = new mongoose.Types.ObjectId().toString();
    const siteId = new mongoose.Types.ObjectId().toString();
    await expect(
      processor({
        data: {
          accountId,
          siteId,
          runId: new mongoose.Types.ObjectId().toString(),
          operation: 'toxicity_review',
        },
      } as never),
    ).resolves.toBeUndefined();
    for (const status of ['succeeded', 'failed'] as const) {
      const run = await ToxicityReviewRun.create({
        accountId,
        siteId,
        domain: 'terminal.example',
        status,
      });
      await expect(
        processor({
          data: {
            accountId,
            siteId,
            runId: String(run._id),
            operation: 'toxicity_review',
          },
        } as never),
      ).resolves.toBeUndefined();
    }
  });

  it('scores rows, applies versioned observation bands, annotates flagged rows, and reopens stored results', async () => {
    const user = await seedUser('tox-success@example.test');
    const siteId = await seedSite(user.id, 'success.example');
    await seedArchive('success.example', [
      archiveRow({ domain: 'toxic.example', spamScore: 70, isBroken: true }),
      archiveRow({ domain: 'watch.example', path: '/watch', spamScore: 45 }),
      archiveRow({
        domain: 'clean.example',
        path: '/clean',
        spamScore: 10,
        dofollow: false,
        firstSeen: null,
        lastSeen: null,
      }),
    ]);
    const bulk = vi.fn(async (targets: string[]) =>
      targets.map((target) => ({
        target,
        spamScore: target === 'toxic.example' ? 80 : target === 'watch.example' ? 45 : 10,
      })),
    );
    await start(user, siteId).expect(202);
    await processLatest(provider({ getBulkSpamScores: bulk }));

    const detail = await request(app)
      .get(`/api/backlinks/toxicity/${queuedJobs[0]!.runId}`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(detail.body).toMatchObject({
      status: 'succeeded',
      retainedCount: 3,
      providerStatus: 'succeeded',
      rubricVersion: 'toxicity-rubric-v1',
      sourceKind: 'provider_observation',
    });
    expect(detail.body.rows.map((row: { band: string }) => row.band).sort()).toEqual([
      'clean',
      'toxic',
      'watch',
    ]);
    for (const row of detail.body.rows) {
      expect(row.rubricVersion).toBe('toxicity-rubric-v1');
      expect(row.sourceKind).toBe('provider_observation');
      expect(row.rationale).toMatchObject({
        rubricVersion: 'toxicity-rubric-v1',
        sourceKind: 'provider_observation',
      });
    }
    expect(bulk).toHaveBeenCalledTimes(1);
    expect(bulk.mock.calls[0]![0]).toHaveLength(3);

    const toxicRow = detail.body.rows.find((row: { band: string }) => row.band === 'toxic');
    const download = await request(app)
      .post(`/api/backlinks/toxicity/${queuedJobs[0]!.runId}/disavow`)
      .set('Cookie', user.cookie)
      .send({ entries: [{ rowId: toxicRow.id, kind: 'domain' }] })
      .expect(200);
    expect(download.headers['content-type']).toContain('text/plain');
    expect(download.headers['content-disposition']).toContain('rankme-disavow-');
    expect(download.text).toContain('domain:toxic.example\n');
    const toxicOnly = await request(app)
      .get(`/api/backlinks/toxicity/${queuedJobs[0]!.runId}`)
      .set('Cookie', user.cookie)
      .query({ band: 'toxic' })
      .expect(200);
    expect(toxicOnly.body.rows).toHaveLength(1);

    const watchRow = detail.body.rows.find((row: { band: string }) => row.band === 'watch');
    const urlDownload = await request(app)
      .post(`/api/backlinks/toxicity/${queuedJobs[0]!.runId}/disavow`)
      .set('Cookie', user.cookie)
      .send({ entries: [{ rowId: watchRow.id, kind: 'url' }] })
      .expect(200);
    expect(urlDownload.text).toContain('https://watch.example/watch\n');
    const commentsOnly = await request(app)
      .post(`/api/backlinks/toxicity/${queuedJobs[0]!.runId}/disavow`)
      .set('Cookie', user.cookie)
      .send({ entries: [] })
      .expect(200);
    expect(commentsOnly.text).not.toContain('domain:');
    await request(app)
      .post(`/api/backlinks/toxicity/${queuedJobs[0]!.runId}/disavow`)
      .set('Cookie', user.cookie)
      .send({
        entries: [
          { rowId: '99999999-9999-4999-8999-999999999999', kind: 'domain' },
        ],
      })
      .expect(404);
  });

  it('clamps durable rows to 1000 and paid bulk targets to 100 domains', async () => {
    const user = await seedUser('tox-clamp@example.test');
    const siteId = await seedSite(user.id, 'clamp.example');
    const rows = Array.from({ length: 1005 }, (_, index) =>
      archiveRow({
        domain: `d${index}.source.example`,
        path: `/p${index}`,
        spamScore: 35,
      }),
    );
    await seedArchive('clamp.example', rows);
    const bulk = vi.fn(async (targets: string[]) =>
      targets.map((target) => ({ target, spamScore: 40 })),
    );
    await start(user, siteId).expect(202);
    await processLatest(provider({ getBulkSpamScores: bulk }));

    expect(bulk.mock.calls[0]![0]).toHaveLength(100);
    const persisted = await getTestDb()
      .select({ id: backlinkRowSnapshots.id })
      .from(backlinkRowSnapshots)
      .where(eq(backlinkRowSnapshots.reviewId, queuedJobs[0]!.runId));
    expect(persisted).toHaveLength(1000);
    const run = await ToxicityReviewRun.findById(queuedJobs[0]!.runId);
    expect(run?.bulkDomainCount).toBe(100);
  });

  it('halts before the provider at the rolling ceiling', async () => {
    const user = await seedUser('tox-ceiling@example.test');
    const siteId = await seedSite(user.id, 'ceiling.example');
    await seedArchive('ceiling.example', [archiveRow()]);
    const bulk = vi.fn(async () => [{ target: 'source.example', spamScore: 50 }]);
    await start(user, siteId).expect(202);
    await processLatest(
      provider({ getBulkSpamScores: bulk }),
      TOXICITY_BULK_BASE_COST_MICROS + TOXICITY_BULK_TARGET_COST_MICROS - 1,
    );
    expect(bulk).not.toHaveBeenCalled();
    const run = await ToxicityReviewRun.findById(queuedJobs[0]!.runId);
    expect(run).toMatchObject({
      status: 'failed',
      providerStatus: 'budget_halted',
      failureKind: 'ceiling_halted',
    });
  });

  it('fails once on provider failure with zero retained rows', async () => {
    const user = await seedUser('tox-provider-fail@example.test');
    const siteId = await seedSite(user.id, 'provider-fail.example');
    await seedArchive('provider-fail.example', [archiveRow({ spamScore: null })]);
    await start(user, siteId).expect(202);
    const failure = new VendorUnavailableError('offline', {
      provider: 'backlink',
      operation: 'bulk_spam_score',
    });
    await expect(
      processLatest(
        provider({ getBulkSpamScores: vi.fn(async () => Promise.reject(failure)) }),
      ),
    ).rejects.toBe(failure);
    const run = await ToxicityReviewRun.findById(queuedJobs[0]!.runId);
    expect(run).toMatchObject({
      status: 'failed',
      providerStatus: 'failed',
      retainedCount: 0,
    });

    await expect(
      createToxicityReviewProcessor({
        db: getTestDb() as never,
        provider: provider(),
      })({ data: queuedJobs[0]! } as never),
    ).resolves.toBeUndefined();
  });

  it('treats a missing bulk capability as a provider failure', async () => {
    const user = await seedUser('tox-missing-op@example.test');
    const siteId = await seedSite(user.id, 'missing-op.example');
    await seedArchive('missing-op.example', [archiveRow({ spamScore: null })]);
    await start(user, siteId).expect(202);
    const { getBulkSpamScores: _bulk, ...withoutBulk } = provider();
    await expect(processLatest(withoutBulk)).rejects.toBeInstanceOf(
      VendorUnavailableError,
    );
    expect(await ToxicityReviewRun.findById(queuedJobs[0]!.runId)).toMatchObject({
      status: 'failed',
      providerStatus: 'failed',
    });
  });

  it('fails closed for a non-provider worker error', async () => {
    const user = await seedUser('tox-worker-error@example.test');
    const siteId = await seedSite(user.id, 'worker-error.example');
    await seedArchive('worker-error.example', [archiveRow({ spamScore: null })]);
    await start(user, siteId).expect(202);
    const failure = new Error('unexpected implementation error');
    await expect(
      processLatest(
        provider({
          getBulkSpamScores: vi.fn(async () => Promise.reject(failure)),
        }),
      ),
    ).rejects.toBe(failure);
    expect(await ToxicityReviewRun.findById(queuedJobs[0]!.runId)).toMatchObject({
      status: 'failed',
      failureKind: null,
    });
  });

  it('succeeds partially when a provider fails but a normalized scored row is retained', async () => {
    const user = await seedUser('tox-partial@example.test');
    const siteId = await seedSite(user.id, 'partial.example');
    await seedArchive('partial.example', [archiveRow({ spamScore: 72 })]);
    await start(user, siteId).expect(202);
    await processLatest(
      provider({
        getBulkSpamScores: vi.fn(async () => {
          throw new VendorUnavailableError('offline', {
            provider: 'backlink',
            operation: 'bulk_spam_score',
          });
        }),
      }),
    );
    const run = await ToxicityReviewRun.findById(queuedJobs[0]!.runId);
    expect(run).toMatchObject({
      status: 'succeeded',
      providerStatus: 'partial_failed',
      retainedCount: 1,
    });
  });

  it('records an honest empty result for provider-success zero-row runs', async () => {
    const user = await seedUser('tox-zero@example.test');
    const siteId = await seedSite(user.id, 'zero.example');
    await seedArchive('zero.example', [archiveRow({ spamScore: null })]);
    await start(user, siteId).expect(202);
    await processLatest(provider({ getBulkSpamScores: vi.fn(async () => []) }));
    const run = await ToxicityReviewRun.findById(queuedJobs[0]!.runId);
    expect(run).toMatchObject({
      status: 'succeeded',
      providerStatus: 'succeeded',
      retainedCount: 0,
    });
  });

  it('ignores null bulk scores and abstains when optional AI dependencies are absent', async () => {
    const noAi = await seedUser('tox-no-ai@example.test');
    const noAiSite = await seedSite(noAi.id, 'no-ai.example');
    await seedArchive('no-ai.example', [archiveRow({ spamScore: 70 })]);
    await start(noAi, noAiSite).expect(202);
    await createToxicityReviewProcessor({
      db: getTestDb() as never,
      provider: provider({
        getBulkSpamScores: vi.fn(async () => [
          { target: 'source.example', spamScore: null },
        ]),
      }),
    })({ data: queuedJobs.at(-1)! } as never);
    expect(await ToxicityReviewRun.findOne({ accountId: noAi.id })).toMatchObject({
      status: 'succeeded',
      aiStatus: 'abstained',
      retainedCount: 1,
    });

    const noOrder = await seedUser('tox-no-ai-order@example.test');
    const noOrderSite = await seedSite(noOrder.id, 'no-ai-order.example');
    await seedArchive('no-ai-order.example', [archiveRow({ spamScore: 70 })]);
    await start(noOrder, noOrderSite).expect(202);
    const ai = { run: vi.fn() };
    await createToxicityReviewProcessor({
      db: getTestDb() as never,
      provider: provider(),
      ai: ai as never,
    })({ data: queuedJobs.at(-1)! } as never);
    expect(ai.run).not.toHaveBeenCalled();
    expect(await ToxicityReviewRun.findOne({ accountId: noOrder.id })).toMatchObject({
      aiStatus: 'abstained',
    });
  });

  it('records AI abstention and failure without changing deterministic rows', async () => {
    const cases = [
      {
        suffix: 'abstain',
        ai: {
          run: vi.fn(async () => ({ object: { rationales: [], citations: [] } })),
        },
        expected: 'abstained',
      },
      {
        suffix: 'failure',
        ai: { run: vi.fn(async () => Promise.reject(new Error('ai unavailable'))) },
        expected: 'failed',
      },
    ] as const;
    for (const scenario of cases) {
      const user = await seedUser(`tox-ai-${scenario.suffix}@example.test`);
      const siteId = await seedSite(user.id, `ai-${scenario.suffix}.example`);
      await seedArchive(`ai-${scenario.suffix}.example`, [
        archiveRow({ spamScore: 70 }),
      ]);
      await start(user, siteId).expect(202);
      await createToxicityReviewProcessor({
        db: getTestDb() as never,
        provider: provider(),
        ai: scenario.ai as never,
        aiProviderOrder: ['fake'],
        now: () => new Date('2026-08-01T12:00:00.000Z'),
      })({ data: queuedJobs.at(-1)! } as never);
      const run = await ToxicityReviewRun.findOne({ accountId: user.id });
      expect(run?.aiStatus).toBe(scenario.expected);
      const rows = await getTestDb()
        .select()
        .from(backlinkRowSnapshots)
        .where(eq(backlinkRowSnapshots.reviewId, String(run!._id)));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.rubricBand).toBe('toxic');
      expect(rows[0]?.rationaleStatus).toBe(scenario.expected);
    }
  });

  it('skips AI before its stage when the remaining ceiling is insufficient', async () => {
    const user = await seedUser('tox-ai-budget@example.test');
    const siteId = await seedSite(user.id, 'ai-budget.example');
    await seedArchive('ai-budget.example', [archiveRow({ spamScore: 70 })]);
    await start(user, siteId).expect(202);
    await processLatest(
      provider({
        getBulkSpamScores: vi.fn(async () => [
          { target: 'source.example', spamScore: 70 },
        ]),
      }),
      25_000,
    );
    const run = await ToxicityReviewRun.findById(queuedJobs[0]!.runId);
    expect(run).toMatchObject({
      status: 'succeeded',
      aiStatus: 'budget_skipped',
    });
  });
});
