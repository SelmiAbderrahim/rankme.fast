import mongoose from 'mongoose';
import type { Job, Queue } from 'bullmq';
import request from 'supertest';
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
import { createApp } from '../../app.js';
import { env } from '../../config/env.js';
import {
  competitorProfiles,
  keywords,
} from '../../db/schema/index.js';
import { __setCsrfBypassForTests } from '../../shared/middleware/csrf.js';
import {
  createFakeCompetitorProvider,
  ProviderError,
  VendorMalformedError,
  VendorQuotaError,
  VendorTimeoutError,
  VendorUnavailableError,
} from '../../shared/providers/index.js';
import {
  installTestAuth,
  signupTestUser,
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
  setCompetitorContentDb,
  setCompetitorContentQueue,
} from '../competitor-content/index.js';
import { Site, setSitesDb } from '../sites/index.js';
import { CompetitorDiscoveryAttempt } from './competitor-discovery.model.js';
import {
  competitorDiscoveryTestables,
  DISCOVERY_MAX_SUGGESTIONS,
  getLatestCompetitorDiscovery,
  refreshCompetitorDiscovery,
} from './competitor-discovery.service.js';
import { competitorIntelligenceRouteTestables } from './competitor-intelligence.routes.js';
import { landscapePageMatchReviewBodySchema } from './competitor-intelligence.schemas.js';
import {
  setCompetitorProvider,
  setCompetitorsDb,
} from './competitors.holder.js';
import {
  aggregateLandscape,
  landscapeContentHash,
  sha256CanonicalLandscape,
  CompetitorLandscapeReportPage,
  CompetitorLandscapeRun,
  setCompetitorLandscapeDb,
  setCompetitorLandscapeQueue,
  type LandscapeAggregationCheckpoint,
} from './landscape/index.js';

const app = createApp();
const BASE = (siteId: string) => `/api/sites/${siteId}/competitor-intelligence`;

function queue(): Queue {
  return {
    add: vi.fn(async () => ({ id: 'landscape-job' }) as Job),
  } as unknown as Queue;
}

async function seedSite(
  accountId: string,
  domain = 'owned.example',
  paused = false,
): Promise<string> {
  const site = await Site.create({
    accountId,
    url: `https://${domain}`,
    domain,
    paused,
    pausedAt: paused ? new Date() : null,
  });
  return String(site._id);
}

async function verifiedUser(): Promise<TestUser> {
  return signupVerifiedUser(app, {
    email: `canonical-${new mongoose.Types.ObjectId().toHexString()}@example.com`,
  });
}

async function seedProfiles(
  user: TestUser,
  siteId: string,
  count: number,
): Promise<string[]> {
  const rows = await getTestDb()
    .insert(competitorProfiles)
    .values(
      Array.from({ length: count }, (_, index) => ({
        accountId: user.id,
        siteId,
        origin: `https://rival-${index}.example`,
        registrableDomain: `rival-${index}.example`,
        source: 'manual' as const,
        status: 'active' as const,
      })),
    )
    .returning({ id: competitorProfiles.id });
  return rows.map((row) => row.id);
}

async function seedPartialReport(
  user: TestUser,
  siteId: string,
  profileId: string,
) {
  const provenance = (leg: 'shared' | 'owned_only' | 'competitor_only') => ({
    provider: 'dataforseo',
    operation: 'domain_intersection_live' as const,
    leg,
    intersections: leg === 'shared',
    targetOrder:
      leg === 'competitor_only'
        ? ('competitor_owned' as const)
        : ('owned_competitor' as const),
    itemTypes: ['organic'] as ['organic'],
    limit: 100 as const,
    cache: 'miss' as const,
    status: 'success' as const,
    capturedAt: '2026-08-10T08:00:00.000Z',
    returnedRows: leg === 'competitor_only' ? 2 : leg === 'shared' ? 1 : 0,
    truncated: false,
  });
  const checkpoints: LandscapeAggregationCheckpoint[] = [
    {
      competitorProfileId: profileId,
      leg: 'shared',
      state: 'succeeded',
      safeErrorCode: null,
      provenance: provenance('shared'),
      rows: [
        {
          keyword: 'shared topic',
          normalizedKeyword: 'shared topic',
          ownedPosition: 9,
          competitorPosition: 3,
          ownedRankAbsolute: 10,
          competitorRankAbsolute: 4,
          ownedUrl: 'https://owned.example/shared-topic',
          competitorUrl: 'https://rival-0.example/shared-topic',
          searchVolume: 250,
          keywordDifficulty: 35,
          intent: 'commercial',
        },
      ],
    },
    {
      competitorProfileId: profileId,
      leg: 'owned_only',
      state: 'failed',
      safeErrorCode: 'SOURCE_TIMEOUT',
      provenance: { ...provenance('owned_only'), status: 'timeout', capturedAt: null },
      rows: [],
    },
    {
      competitorProfileId: profileId,
      leg: 'competitor_only',
      state: 'succeeded',
      safeErrorCode: null,
      provenance: provenance('competitor_only'),
      rows: [
        {
          keyword: 'missing topic',
          normalizedKeyword: 'missing topic',
          ownedPosition: null,
          competitorPosition: 3,
          ownedRankAbsolute: null,
          competitorRankAbsolute: 4,
          ownedUrl: null,
          competitorUrl: 'https://rival-0.example/missing-topic',
          searchVolume: 500,
          keywordDifficulty: 40,
          intent: 'commercial',
        },
        {
          keyword: 'second missing topic',
          normalizedKeyword: 'second missing topic',
          ownedPosition: null,
          competitorPosition: 8,
          ownedRankAbsolute: null,
          competitorRankAbsolute: 9,
          ownedUrl: null,
          competitorUrl: null,
          searchVolume: 100,
          keywordDifficulty: null,
          intent: null,
        },
      ],
    },
  ];
  const aggregation = aggregateLandscape({
    ownedDomain: 'owned.example',
    locale: 'en',
    market: {
      locationCode: 2840,
      languageCode: 'en',
      source: 'default',
      eligibleTrackedKeywords: 0,
    },
    competitors: [{ profileId, domain: 'rival-0.example' }],
    checkpoints,
    completedAt: new Date('2026-08-10T09:00:00.000Z'),
  });
  const runId = new mongoose.Types.ObjectId();
  const page = {
    pageIndex: 0,
    rows: aggregation.rows,
    rowCount: aggregation.rows.length,
    pageHash: sha256CanonicalLandscape(aggregation.rows),
  };
  await CompetitorLandscapeRun.create({
    _id: runId,
    accountId: user.id,
    siteId,
    requestedByUserId: user.id,
    ownedDomain: 'owned.example',
    locale: 'en',
    state: 'partial',
    progress: { completedLegs: 3, totalLegs: 3, stage: 'partial' },
    market: aggregation.manifest.market,
    competitors: aggregation.manifest.competitors,
    idempotencyKey: 'partial-report',
    requestFingerprint: 'b'.repeat(64),
    queueJobId: `competitor-landscape-${runId.toHexString()}`,
    cancelRequestedAt: null,
    firstProviderDispatchAt: new Date(),
    stageSummary: checkpoints.map((checkpoint) => ({
      competitorProfileId: checkpoint.competitorProfileId,
      leg: checkpoint.leg,
      state: checkpoint.state,
      returnedRows: checkpoint.rows.length,
      safeErrorCode: checkpoint.safeErrorCode,
    })),
    reportManifest: aggregation.manifest,
    contentHash: landscapeContentHash(aggregation.manifest, [page]),
    safeFailureCode: null,
    reportVersion: 1,
    schemaVersion: 'competitor-landscape/1',
    taxonomyVersion: '2026-08-08.1',
    suggestionRubricVersion: '2026-08-08.1',
    opportunityRubricVersion: '2026-08-08.1',
    startedAt: new Date(),
    completedAt: new Date(),
    expiresAt: null,
  });
  await CompetitorLandscapeReportPage.create({
    accountId: user.id,
    siteId,
    runId,
    ...page,
    expiresAt: null,
  });
  return {
    runId: runId.toHexString(),
    opportunityId: aggregation.manifest.opportunities[0]!.id,
    suggestionId: aggregation.manifest.pageSuggestions[0]!.id,
  };
}

beforeAll(async () => {
  await startMemoryMongo();
  const db = await startTestPostgres();
  installTestAuth();
  setSitesDb(db as never);
  setCompetitorsDb(db as never);
  setCompetitorContentDb(db as never);
  setCompetitorLandscapeDb(db as never);
});

afterAll(async () => {
  uninstallTestAuth();
  setSitesDb(null);
  setCompetitorsDb(null);
  setCompetitorContentDb(null);
  setCompetitorContentQueue(null);
  setCompetitorLandscapeDb(null);
  setCompetitorLandscapeQueue(null);
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(() => {
  setCompetitorProvider(createFakeCompetitorProvider());
  setCompetitorContentQueue(queue());
  setCompetitorLandscapeQueue(queue());
  (env as { COMPETITOR_INTELLIGENCE_ENABLED: boolean }).COMPETITOR_INTELLIGENCE_ENABLED = true;
});

afterEach(async () => {
  __setCsrfBypassForTests(true);
  vi.restoreAllMocks();
  await clearCollections();
  await truncateAllTables();
});

describe('canonical competitor-intelligence router', () => {
  it('fails closed on missing users, resolves every database fallback, and validates review decisions', () => {
    expect(competitorIntelligenceRouteTestables.userId({ user: { id: 'actor' } })).toBe('actor');
    expect(() => competitorIntelligenceRouteTestables.userId({})).toThrow(
      'errors.unauthorized',
    );
    expect(competitorIntelligenceRouteTestables.mutationBody({})).toEqual({});
    const suppliedBody = { value: 'kept' };
    expect(competitorIntelligenceRouteTestables.mutationBody({ body: suppliedBody })).toBe(
      suppliedBody,
    );

    const testDb = getTestDb();
    setCompetitorLandscapeDb(null);
    try {
      expect(competitorIntelligenceRouteTestables.resolveDb()).toBe(testDb);
      setCompetitorContentDb(null);
      expect(competitorIntelligenceRouteTestables.resolveDb()).not.toBe(testDb);
    } finally {
      setCompetitorContentDb(testDb as never);
      setCompetitorLandscapeDb(testDb as never);
    }

    expect(
      landscapePageMatchReviewBodySchema.safeParse({
        decision: 'approved',
        ownedUrl: 'https://owned.example/topic',
        competitorUrl: 'https://rival.example/topic',
        version: 0,
      }).success,
    ).toBe(true);
    expect(
      landscapePageMatchReviewBodySchema.safeParse({
        decision: 'rejected',
        ownedUrl: null,
        competitorUrl: null,
        version: 0,
      }).success,
    ).toBe(true);
    expect(
      landscapePageMatchReviewBodySchema.safeParse({
        decision: 'approved',
        ownedUrl: null,
        competitorUrl: null,
        version: 0,
      }).success,
    ).toBe(false);
    expect(
      landscapePageMatchReviewBodySchema.safeParse({
        decision: 'rejected',
        ownedUrl: 'https://owned.example/topic',
        competitorUrl: 'https://rival.example/topic',
        version: 0,
      }).success,
    ).toBe(false);
  });

  it('normalizes discovery candidates and classifies every safe provider error', () => {
    const ctx = { provider: 'dataforseo', operation: 'competitor-discovery' };
    expect(competitorDiscoveryTestables.errorStatus(new VendorTimeoutError('timeout', ctx)))
      .toEqual({ status: 'timeout', warning: 'SOURCE_TIMEOUT', safeCode: 'SOURCE_TIMEOUT' });
    expect(competitorDiscoveryTestables.errorStatus(new VendorMalformedError('bad', ctx)))
      .toEqual({ status: 'malformed', warning: 'SOURCE_MALFORMED', safeCode: 'SOURCE_MALFORMED' });
    expect(competitorDiscoveryTestables.errorStatus(new VendorQuotaError('quota', ctx)))
      .toEqual({ status: 'quota', warning: 'SOURCE_QUOTA', safeCode: 'SOURCE_QUOTA' });
    expect(competitorDiscoveryTestables.errorStatus(new VendorUnavailableError('down', ctx)))
      .toEqual({ status: 'failed', warning: 'SOURCE_FAILED', safeCode: 'SOURCE_FAILED' });
    expect(competitorDiscoveryTestables.errorStatus(new Error('internal')))
      .toEqual({ status: 'failed', warning: 'SOURCE_FAILED', safeCode: 'INTERNAL_FAILURE' });
    expect(
      competitorDiscoveryTestables.errorStatus(
        new ProviderError('provider', false, ctx),
      ),
    ).toMatchObject({ safeCode: 'SOURCE_FAILED' });

    const capturedAt = new Date('2026-08-12T00:00:00.000Z');
    const normalized = competitorDiscoveryTestables.normalizeSuggestions(
      [
        { domain: 'invalid', avgPosition: null, intersections: 1, estimatedTraffic: null },
        { domain: 'duplicate.example', avgPosition: null, intersections: 1, estimatedTraffic: null },
        { domain: 'DUPLICATE.EXAMPLE', avgPosition: null, intersections: 30, estimatedTraffic: null },
        { domain: 'duplicate.example', avgPosition: null, intersections: 2, estimatedTraffic: null },
        { domain: 'alpha.example', avgPosition: null, intersections: 30, estimatedTraffic: null },
        ...Array.from({ length: DISCOVERY_MAX_SUGGESTIONS + 4 }, (_, index) => ({
          domain: `candidate-${index}.example`,
          avgPosition: null,
          intersections: 20 - index,
          estimatedTraffic: null,
        })),
      ],
      capturedAt,
      new Set(['duplicate.example']),
    );
    expect(normalized).toHaveLength(DISCOVERY_MAX_SUGGESTIONS);
    expect(normalized[0]?.registrableDomain).toBe('alpha.example');
    expect(normalized.find((row) => row.registrableDomain === 'duplicate.example'))
      .toMatchObject({ alreadyConfirmed: true, capturedAt });
    expect(competitorDiscoveryTestables.utcDayStart(capturedAt).toISOString())
      .toBe('2026-08-12T00:00:00.000Z');
  });

  it('enforces authentication, verification, and CSRF for every verified account', async () => {
    await request(app).get(`${BASE(new mongoose.Types.ObjectId().toHexString())}/competitors`).expect(401);

    const unverified = await signupTestUser(app, {
      email: `canonical-unverified-${new mongoose.Types.ObjectId().toHexString()}@example.com`,
    });
    const unverifiedSite = await seedSite(unverified.id, 'unverified.example');
    await request(app)
      .get(`${BASE(unverifiedSite)}/competitors`)
      .set('Cookie', unverified.cookie)
      .expect(403);

    const user = await verifiedUser();
    const siteId = await seedSite(user.id, 'verified.example');
    await request(app)
      .get(`${BASE(siteId)}/competitors`)
      .set('Cookie', user.cookie)
      .expect(200);

    __setCsrfBypassForTests(false);
    await request(app)
      .post(`${BASE(siteId)}/discovery/preview`)
      .set('Cookie', user.cookie)
      .send({})
      .expect(403);
  });

  it('manages a public, registrable-domain-deduped portfolio without ownership claims', async () => {
    const user = await verifiedUser();
    const siteId = await seedSite(user.id);
    const add = await request(app)
      .post(`${BASE(siteId)}/competitors`)
      .set('Cookie', user.cookie)
      .set('Idempotency-Key', 'add-rival')
      .send({ url: 'https://www.example.org/path', source: 'manual' })
      .expect(201);
    expect(add.body.profile).toMatchObject({
      registrableDomain: 'example.org',
      source: 'manual',
      status: 'active',
    });
    expect(add.body.profile).not.toHaveProperty('owned');

    const duplicate = await request(app)
      .post(`${BASE(siteId)}/competitors`)
      .set('Cookie', user.cookie)
      .set('Idempotency-Key', 'add-rival-again')
      .send({ url: 'https://example.org/other', source: 'suggested' })
      .expect(200);
    expect(duplicate.body.duplicate).toBe(true);

    await request(app)
      .post(`${BASE(siteId)}/competitors`)
      .set('Cookie', user.cookie)
      .set('Idempotency-Key', 'private-rival')
      .send({ url: 'https://127.0.0.1/', source: 'manual' })
      .expect(400);

    const competitorId = add.body.profile.id as string;
    await request(app)
      .post(`${BASE(siteId)}/competitors/${competitorId}/archive`)
      .set('Cookie', user.cookie)
      .set('Idempotency-Key', 'archive-rival')
      .expect(200);
    await request(app)
      .post(`${BASE(siteId)}/competitors/${competitorId}/restore`)
      .set('Cookie', user.cookie)
      .set('Idempotency-Key', 'restore-rival')
      .send({})
      .expect(200);

    const stranger = await verifiedUser();
    await request(app)
      .get(`${BASE(siteId)}/competitors`)
      .set('Cookie', stranger.cookie)
      .expect(404);
  });

  it('keeps discovery preview zero-spend, serves same-day cache hits, and retains the last good snapshot', async () => {
    const user = await verifiedUser();
    const siteId = await seedSite(user.id);
    const fake = createFakeCompetitorProvider();
    const getCompetitors = vi.spyOn(fake, 'getCompetitors');
    setCompetitorProvider(fake);

    const preview = await request(app)
      .post(`${BASE(siteId)}/discovery/preview`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(preview.body).toEqual({
      deploymentMode: 'community',
      capacityEnforced: false,
      market: expect.objectContaining({ source: 'default' }),
      unitsRequired: 1,
      enabled: true,
      startAllowed: true,
      createsProfiles: false,
    });
    expect(getCompetitors).not.toHaveBeenCalled();

    const first = await request(app)
      .post(`${BASE(siteId)}/discovery/refresh`)
      .set('Cookie', user.cookie)
      .set('Idempotency-Key', 'discovery-one')
      .expect(200);
    expect(first.body.discovery.cache).toBe('miss');
    const replay = await request(app)
      .post(`${BASE(siteId)}/discovery/refresh`)
      .set('Cookie', user.cookie)
      .set('Idempotency-Key', 'discovery-one')
      .send({})
      .expect(200);
    expect(replay.body.replayed).toBe(true);
    const defaultLocaleReplay = await refreshCompetitorDiscovery({
      db: getTestDb() as never,
      provider: fake,
      accountId: user.id,
      siteId,
      idempotencyKey: 'discovery-one',
    });
    expect(defaultLocaleReplay).toMatchObject({ replayed: true });
    const cached = await request(app)
      .post(`${BASE(siteId)}/discovery/refresh`)
      .set('Cookie', user.cookie)
      .set('Idempotency-Key', 'discovery-two')
      .send({})
      .expect(200);
    expect(cached.body.discovery.cache).toBe('hit');
    expect(getCompetitors).toHaveBeenCalledTimes(1);

    await CompetitorDiscoveryAttempt.updateOne(
      { siteId, idempotencyKey: 'discovery-two' },
      {
        $set: {
          'provenance.0.capturedAt': null,
          warnings: [{ code: 'SOURCE_TRUNCATED', operation: 'domain_candidates', count: 1 }],
        },
      },
    );

    await CompetitorDiscoveryAttempt.updateMany({}, { $set: { attemptedAt: new Date(0) } });
    const timeout = new VendorTimeoutError('redacted timeout', {
      provider: 'dataforseo',
      operation: 'competitor-discovery',
    });
    const failing = createFakeCompetitorProvider({
      failure: timeout,
      serpFailure: timeout,
    });
    setCompetitorProvider(failing);
    await request(app)
      .post(`${BASE(siteId)}/discovery/refresh`)
      .set('Cookie', user.cookie)
      .set('Idempotency-Key', 'discovery-failed')
      .send({})
      .expect(503);
    const latest = await request(app)
      .get(`${BASE(siteId)}/discovery`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(latest.body.discovery.suggestions).toEqual(first.body.discovery.suggestions);
    expect(latest.body.discovery.lastAttempt).toMatchObject({
      state: 'failed',
      safeErrorCode: 'SOURCE_TIMEOUT',
    });
    expect(latest.body.discovery.provenance[0].capturedAt).toBeNull();
    expect(latest.body.discovery.warnings).toEqual([
      {
        code: 'SOURCE_TRUNCATED',
        operation: 'domain_candidates',
        count: 1,
        messageKey: 'competitors.discovery.warnings.sourceTruncated',
        messageVars: { operation: 'domain_candidates', count: 1 },
        message: 'The domain_candidates results were shortened to the safe limit (1 occurrence(s)).',
      },
    ]);
    await expect(getLatestCompetitorDiscovery({
      db: getTestDb() as never,
      accountId: user.id,
      siteId,
    })).resolves.toMatchObject({ suggestions: expect.any(Array) });
  });

  it('returns 404 before the first discovery and honors the disabled preview', async () => {
    const user = await verifiedUser();
    const siteId = await seedSite(user.id, 'preview-modes.example');
    await request(app)
      .get(`${BASE(siteId)}/discovery`)
      .set('Cookie', user.cookie)
      .expect(404);

    (env as { COMPETITOR_INTELLIGENCE_ENABLED: boolean }).COMPETITOR_INTELLIGENCE_ENABLED = false;
    const disabled = await request(app)
      .post(`${BASE(siteId)}/discovery/preview`)
      .set('Cookie', user.cookie)
      .send({})
      .expect(200);
    expect(disabled.body).toMatchObject({ enabled: false, startAllowed: false });
    await request(app)
      .post(`${BASE(siteId)}/discovery/refresh`)
      .set('Cookie', user.cookie)
      .set('Idempotency-Key', 'disabled-discovery')
      .send({})
      .expect(503);
  });

  it('uses tracked Google phrases for fallback success and replays a failed fallback safely', async () => {
    const user = await verifiedUser();
    const siteId = await seedSite(user.id, 'fallback.example');
    await getTestDb().insert(keywords).values([
      {
        accountId: user.id,
        siteId,
        phrase: ' zeta phrase ',
        locationCode: 2840,
        languageCode: 'en',
      },
      {
        accountId: user.id,
        siteId,
        phrase: 'alpha phrase',
        locationCode: 2840,
        languageCode: 'en',
      },
      {
        accountId: user.id,
        siteId,
        phrase: '   ',
        locationCode: 2840,
        languageCode: 'en',
      },
    ]);
    setCompetitorProvider(
      createFakeCompetitorProvider({
        competitors: [],
        serpCompetitors: [
          { domain: 'serp-result.example', avgPosition: 2, intersections: 5, estimatedTraffic: 10 },
        ],
      }),
    );
    const success = await request(app)
      .post(`${BASE(siteId)}/discovery/refresh`)
      .set('Cookie', user.cookie)
      .set('Idempotency-Key', 'fallback-success')
      .send({})
      .expect(200);
    expect(success.body.discovery).toMatchObject({
      state: 'completed',
      provenance: [
        expect.objectContaining({ operation: 'domain_candidates', status: 'success' }),
        expect.objectContaining({ operation: 'serp_candidates', status: 'success' }),
      ],
    });
    expect(success.body.discovery.suggestions[0]).toMatchObject({
      registrableDomain: 'serp-result.example',
    });

    const failedSiteId = await seedSite(user.id, 'fallback-failed.example');
    await getTestDb().insert(keywords).values({
      accountId: user.id,
      siteId: failedSiteId,
      phrase: 'tracked phrase',
      locationCode: 2840,
      languageCode: 'en',
    });
    const malformed = new VendorMalformedError('malformed', {
      provider: 'dataforseo',
      operation: 'domain_candidates',
    });
    const quota = new VendorQuotaError('quota', {
      provider: 'dataforseo',
      operation: 'serp_candidates',
    });
    setCompetitorProvider(createFakeCompetitorProvider({ failure: malformed, serpFailure: quota }));
    for (const expected of [503, 503]) {
      await request(app)
        .post(`${BASE(failedSiteId)}/discovery/refresh`)
        .set('Cookie', user.cookie)
        .set('Idempotency-Key', 'fallback-failure')
        .send({})
        .expect(expected);
    }
    const failed = await CompetitorDiscoveryAttempt.findOne({
      siteId: failedSiteId,
      idempotencyKey: 'fallback-failure',
    }).lean();
    expect(failed).toMatchObject({
      state: 'failed',
      safeErrorCode: 'SOURCE_QUOTA',
      warnings: [
        expect.objectContaining({ code: 'SOURCE_MALFORMED' }),
        expect.objectContaining({ code: 'SOURCE_QUOTA' }),
      ],
    });
  });

  it('caps an over-returning source and marks already-confirmed domains', async () => {
    const user = await verifiedUser();
    const siteId = await seedSite(user.id, 'over-return.example');
    await getTestDb().insert(competitorProfiles).values({
      accountId: user.id,
      siteId,
      origin: 'https://confirmed.example',
      registrableDomain: 'confirmed.example',
      source: 'manual',
      status: 'active',
    });
    const provider = createFakeCompetitorProvider();
    provider.getCompetitors = vi.fn(async () => [
      { domain: 'invalid', avgPosition: null, intersections: 999, estimatedTraffic: null },
      { domain: 'confirmed.example', avgPosition: 1, intersections: 500, estimatedTraffic: 1 },
      ...Array.from({ length: 30 }, (_, index) => ({
        domain: `overflow-${index}.example`,
        avgPosition: index,
        intersections: 100 - index,
        estimatedTraffic: index,
      })),
    ]);
    setCompetitorProvider(provider);
    const response = await request(app)
      .post(`${BASE(siteId)}/discovery/refresh`)
      .set('Cookie', user.cookie)
      .set('Idempotency-Key', 'over-returning-source')
      .send({})
      .expect(200);
    expect(response.body.discovery).toMatchObject({
      state: 'partial',
      coverage: { returned: 32, retained: 25, truncated: true },
      warnings: [expect.objectContaining({ code: 'SOURCE_TRUNCATED' })],
    });
    expect(
      response.body.discovery.suggestions.find(
        (candidate: { registrableDomain: string }) =>
          candidate.registrableDomain === 'confirmed.example',
      ),
    ).toMatchObject({ alreadyConfirmed: true });
  });

  it('keeps landscape preview/start inputs aligned, enforces 10, and deduplicates starts', async () => {
    const user = await verifiedUser();
    const siteId = await seedSite(user.id);
    const ids = await seedProfiles(user, siteId, 11);
    await request(app)
      .post(`${BASE(siteId)}/landscapes/preview`)
      .set('Cookie', user.cookie)
      .send({ competitorProfileIds: ids })
      .expect(400);

    const selected = ids.slice(0, 3);
    const preview = await request(app)
      .post(`${BASE(siteId)}/landscapes/preview`)
      .set('Cookie', user.cookie)
      .send({ competitorProfileIds: selected })
      .expect(200);
    expect(preview.body).toMatchObject({
      deploymentMode: 'community',
      capacityEnforced: false,
      competitorLimit: 10,
      unitsRequired: 3,
      maxRows: 900,
      startAllowed: true,
    });
    expect(preview.body.selected.map((item: { profileId: string }) => item.profileId)).toEqual(selected);

    const start = await request(app)
      .post(`${BASE(siteId)}/landscapes`)
      .set('Cookie', user.cookie)
      .set('Idempotency-Key', 'landscape-one')
      .send({ competitorProfileIds: selected, locale: 'en' })
      .expect(202);
    expect(start.body.run).toMatchObject({ state: 'queued', duplicate: false });
    expect(start.body.run).not.toHaveProperty('reservedUnits');
    const replay = await request(app)
      .post(`${BASE(siteId)}/landscapes`)
      .set('Cookie', user.cookie)
      .set('Idempotency-Key', 'landscape-one')
      .send({ competitorProfileIds: selected, locale: 'en' })
      .expect(200);
    expect(replay.body.run).toMatchObject({ runId: start.body.run.runId, duplicate: true });
    await request(app)
      .get(`${BASE(siteId)}/landscapes/${start.body.run.runId}?limit=1`)
      .set('Cookie', user.cookie)
      .expect(200);
    const cancelled = await request(app)
      .post(`${BASE(siteId)}/landscapes/${start.body.run.runId}/cancel`)
      .set('Cookie', user.cookie)
      .set('Idempotency-Key', 'cancel-landscape')
      .expect(200);
    expect(cancelled.body.run).toMatchObject({ state: 'cancelled', duplicate: false });

    const ten = ids.slice(0, 10);
    const tenPreview = await request(app)
      .post(`${BASE(siteId)}/landscapes/preview`)
      .set('Cookie', user.cookie)
      .send({ competitorProfileIds: ten })
      .expect(200);
    expect(tenPreview.body).toMatchObject({ competitorLimit: 10, unitsRequired: 10 });
  });

  it('blocks new work on disabled or paused sites while reads stay available', async () => {
    const user = await verifiedUser();
    const siteId = await seedSite(user.id);
    const [profileId] = await seedProfiles(user, siteId, 1);
    (env as { COMPETITOR_INTELLIGENCE_ENABLED: boolean }).COMPETITOR_INTELLIGENCE_ENABLED = false;
    await request(app)
      .post(`${BASE(siteId)}/landscapes`)
      .set('Cookie', user.cookie)
      .set('Idempotency-Key', 'disabled')
      .send({ competitorProfileIds: [profileId], locale: 'en' })
      .expect(503);
    await request(app)
      .get(`${BASE(siteId)}/landscapes`)
      .set('Cookie', user.cookie)
      .expect(200);

    (env as { COMPETITOR_INTELLIGENCE_ENABLED: boolean }).COMPETITOR_INTELLIGENCE_ENABLED = true;
    await Site.updateOne({ _id: siteId }, { $set: { paused: true, pausedAt: new Date() } });
    await request(app)
      .post(`${BASE(siteId)}/landscapes`)
      .set('Cookie', user.cookie)
      .set('Idempotency-Key', 'paused')
      .send({ competitorProfileIds: [profileId], locale: 'en' })
      .expect(409);
    await request(app)
      .get(`${BASE(siteId)}/landscapes`)
      .set('Cookie', user.cookie)
      .expect(200);
  });

  it('returns filtered partial evidence and accepts only an owned report opportunity', async () => {
    const user = await verifiedUser();
    const siteId = await seedSite(user.id);
    const [profileId] = await seedProfiles(user, siteId, 1);
    const report = await seedPartialReport(user, siteId, profileId!);

    const detail = await request(app)
      .get(
        `${BASE(siteId)}/landscapes/${report.runId}?class=missing&competitor=rival-0.example&q=topic&limit=1`,
      )
      .set('Cookie', user.cookie)
      .expect(200);
    expect(detail.body.run).toMatchObject({ state: 'partial' });
    expect(detail.body.items).toEqual([
      expect.objectContaining({
        class: 'missing',
        competitorUrl: 'https://rival-0.example/missing-topic',
      }),
    ]);
    expect(detail.body.nextCursor).toEqual(expect.any(String));
    expect(detail.body).not.toHaveProperty('accountId');

    const next = await request(app)
      .get(
        `${BASE(siteId)}/landscapes/${report.runId}?class=missing&competitor=rival-0.example&q=topic&limit=1&cursor=${encodeURIComponent(detail.body.nextCursor as string)}`,
      )
      .set('Cookie', user.cookie)
      .expect(200);
    expect(next.body.items).toHaveLength(1);
    expect(next.body.nextCursor).toBeNull();
    await request(app)
      .get(
        `${BASE(siteId)}/landscapes/${report.runId}?class=missing&q=different&limit=1&cursor=${encodeURIComponent(detail.body.nextCursor as string)}`,
      )
      .set('Cookie', user.cookie)
      .expect(400);
    await request(app)
      .get(`${BASE(siteId)}/landscapes/${report.runId}?limit=1&cursor=garbage`)
      .set('Cookie', user.cookie)
      .expect(400);

    const accepted = await request(app)
      .post(
        `${BASE(siteId)}/landscapes/${report.runId}/opportunities/${report.opportunityId}/accept`,
      )
      .set('Cookie', user.cookie)
      .set('Idempotency-Key', 'accept-opportunity')
      .expect(201);
    expect(accepted.body.acceptance).toMatchObject({ replayed: false });

    const replay = await request(app)
      .post(
        `${BASE(siteId)}/landscapes/${report.runId}/opportunities/${report.opportunityId}/accept`,
      )
      .set('Cookie', user.cookie)
      .set('Idempotency-Key', 'accept-opportunity')
      .send({})
      .expect(200);
    expect(replay.body.acceptance).toMatchObject({ replayed: true });

    const stranger = await verifiedUser();
    await request(app)
      .get(`${BASE(siteId)}/landscapes/${report.runId}`)
      .set('Cookie', stranger.cookie)
      .expect(404);
  });

  it('reviews page matches with strict idempotency and replay status', async () => {
    const agency = await verifiedUser();
    const siteId = await seedSite(agency.id, 'page-match-agency.example');
    const [profileId] = await seedProfiles(agency, siteId, 1);
    const report = await seedPartialReport(agency, siteId, profileId!);
    const path = `${BASE(siteId)}/landscapes/${report.runId}/page-matches/${report.suggestionId}`;
    const body = { decision: 'rejected', ownedUrl: null, competitorUrl: null, version: 0 };

    await request(app).put(path).set('Cookie', agency.cookie).send(body).expect(400);
    const created = await request(app)
      .put(path)
      .set('Cookie', agency.cookie)
      .set('Idempotency-Key', 'reject-page-match')
      .send(body)
      .expect(201);
    expect(created.body).toMatchObject({
      replayed: false,
      review: { state: 'rejected', ownedUrl: null, competitorUrl: null, version: 1 },
    });

    const replayed = await request(app)
      .put(path)
      .set('Cookie', agency.cookie)
      .set('Idempotency-Key', 'reject-page-match')
      .send(body)
      .expect(200);
    expect(replayed.body).toMatchObject({ replayed: true });
  });

  it('uses the named account mutation and poll rate-limit buckets', async () => {
    const oldMutationMax = env.RATE_LIMIT_COMPETITOR_MAX;
    const oldPollMax = env.RATE_LIMIT_CONTENT_POLL_MAX;
    (env as { RATE_LIMIT_COMPETITOR_MAX: number }).RATE_LIMIT_COMPETITOR_MAX = 1;
    (env as { RATE_LIMIT_CONTENT_POLL_MAX: number }).RATE_LIMIT_CONTENT_POLL_MAX = 1;
    const rateApp = createApp();
    try {
      const user = await verifiedUser();
      const siteId = await seedSite(user.id);
      await request(rateApp)
        .post(`${BASE(siteId)}/discovery/preview`)
        .set('Cookie', user.cookie)
        .send({})
        .expect(200);
      await request(rateApp)
        .post(`${BASE(siteId)}/discovery/preview`)
        .set('Cookie', user.cookie)
        .send({})
        .expect(429);
      await request(rateApp)
        .get(`${BASE(siteId)}/competitors`)
        .set('Cookie', user.cookie)
        .expect(200);
      await request(rateApp)
        .get(`${BASE(siteId)}/competitors`)
        .set('Cookie', user.cookie)
        .expect(429);
    } finally {
      (env as { RATE_LIMIT_COMPETITOR_MAX: number }).RATE_LIMIT_COMPETITOR_MAX = oldMutationMax;
      (env as { RATE_LIMIT_CONTENT_POLL_MAX: number }).RATE_LIMIT_CONTENT_POLL_MAX = oldPollMax;
    }
  });
});
