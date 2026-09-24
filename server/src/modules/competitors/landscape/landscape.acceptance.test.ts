import mongoose from 'mongoose';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  competitorProfiles,
  landscapeOpportunityAcceptances,
  landscapePageMatchReviews,
  type LandscapePageMatchReviewRow,
} from '../../../db/schema/index.js';
import { eq } from 'drizzle-orm';
import type {
  PublicUrlResolver,
  PublicUrlTransport,
} from '../../../shared/security/index.js';
import { getTestDb, startTestPostgres, stopTestPostgres, truncateAllTables } from '../../../shared/testing/postgres.js';
import { clearCollections, startMemoryMongo, stopMemoryMongo } from '../../../shared/testing/mongo.js';
import {
  getActionHistory,
  listActionsForSite,
  mutateActionState,
  registerBuiltInActionAdapters,
} from '../../actions/index.js';
import { competitorOpportunityActionAdapter } from '../../actions/adapters/competitor-opportunity.adapter.js';
import { hashActionId } from '../../actions/actions.identity.js';
import { Site } from '../../sites/index.js';
import { aggregateLandscape, type LandscapeAggregationCheckpoint } from './landscape.aggregate.js';
import {
  acceptLandscapeOpportunity,
  listLandscapeOpportunityAcceptances,
  overlayLandscapeOpportunityAcceptances,
} from './landscape.acceptance.js';
import { landscapeContentHash, sha256CanonicalLandscape } from './landscape.canonical.js';
import {
  CompetitorLandscapeReportPage,
  CompetitorLandscapeRun,
} from './landscape.model.js';
import {
  loadFrozenReviewedPageMatch,
  landscapeReviewTestables,
  overlayLandscapePageMatchReviews,
  reviewLandscapePageMatch,
  type ReviewPageMatchInput,
} from './landscape.review.js';
import {
  exportLandscapeRuns,
  getFilteredLandscapeRun,
  getLandscapeRun,
  landscapeRepositoryTestables,
  listLandscapeRuns,
  purgeLandscapeRuns,
} from './landscape.repository.js';
import { landscapeReportRowSchema } from './landscape.schemas.js';

const PROFILE = '11111111-1111-4111-8111-111111111111';
let mongoUri: string;

function dbWithAcceptanceInsert(
  returning: (values: Record<string, unknown>) => Promise<unknown[]>,
): ApplicationDb {
  const base = getTestDb();
  return new Proxy(base, {
    get(target, property, receiver) {
      if (property === 'insert') {
        return () => ({
          values: (values: Record<string, unknown>) => ({ returning: () => returning(values) }),
        });
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as ApplicationDb;
}

function checkpoints(): LandscapeAggregationCheckpoint[] {
  const base = {
    competitorProfileId: PROFILE,
    state: 'succeeded' as const,
    safeErrorCode: null,
  };
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
    capturedAt: '2026-08-09T10:00:00.000Z',
    returnedRows: leg === 'shared' ? 1 : 0,
    truncated: false,
  });
  return [
    {
      ...base,
      leg: 'shared',
      provenance: provenance('shared'),
      rows: [
        {
          keyword: 'seo audit',
          normalizedKeyword: 'seo audit',
          ownedPosition: 8,
          competitorPosition: 2,
          ownedRankAbsolute: 9,
          competitorRankAbsolute: 3,
          ownedUrl: 'https://owned.example/seo-audit',
          competitorUrl: 'https://rival.example/seo-audit',
          searchVolume: 500,
          keywordDifficulty: 50,
          intent: 'commercial',
        },
      ],
    },
    { ...base, leg: 'owned_only', provenance: provenance('owned_only'), rows: [] },
    { ...base, leg: 'competitor_only', provenance: provenance('competitor_only'), rows: [] },
  ];
}

async function seedReport(accountId = new mongoose.Types.ObjectId().toHexString()) {
  const siteId = new mongoose.Types.ObjectId().toHexString();
  await Site.create({
    _id: siteId,
    accountId,
    url: 'https://owned.example',
    domain: 'owned.example',
    displayName: 'Owned',
  });
  await getTestDb().insert(competitorProfiles).values({
    id: PROFILE,
    accountId,
    siteId,
    origin: 'https://rival.example',
    registrableDomain: 'rival.example',
    source: 'manual',
    status: 'active',
  });
  const aggregation = aggregateLandscape({
    ownedDomain: 'owned.example',
    locale: 'en',
    market: {
      locationCode: 2840,
      languageCode: 'en',
      source: 'default',
      eligibleTrackedKeywords: 0,
    },
    competitors: [{ profileId: PROFILE, domain: 'rival.example' }],
    checkpoints: checkpoints(),
    completedAt: new Date('2026-08-09T11:00:00.000Z'),
  });
  const runId = new mongoose.Types.ObjectId();
  const rows = aggregation.rows;
  const page = {
    pageIndex: 0,
    rows,
    rowCount: rows.length,
    pageHash: sha256CanonicalLandscape(rows),
  };
  await CompetitorLandscapeRun.create({
    _id: runId,
    accountId,
    siteId,
    requestedByUserId: accountId,
    ownedDomain: 'owned.example',
    locale: 'en',
    state: 'completed',
    progress: { completedLegs: 3, totalLegs: 3, stage: 'completed' },
    market: aggregation.manifest.market,
    competitors: aggregation.manifest.competitors,
    idempotencyKey: 'run-idem',
    requestFingerprint: 'a'.repeat(64),
    queueJobId: `competitor-landscape-${runId.toHexString()}`,
    cancelRequestedAt: null,
    firstProviderDispatchAt: new Date(),
    stageSummary: checkpoints().map((checkpoint) => ({
      competitorProfileId: checkpoint.competitorProfileId,
      leg: checkpoint.leg,
      state: 'succeeded',
      returnedRows: checkpoint.rows.length,
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
    accountId,
    siteId,
    runId,
    ...page,
    expiresAt: null,
  });
  return {
    accountId,
    siteId,
    reportId: runId.toHexString(),
    opportunityId: aggregation.manifest.opportunities[0]!.id,
    manifest: aggregation.manifest,
  };
}

function pageMatchInput(
  seeded: Awaited<ReturnType<typeof seedReport>>,
  overrides: Partial<ReviewPageMatchInput> = {},
): ReviewPageMatchInput {
  return {
    accountId: seeded.accountId,
    siteId: seeded.siteId,
    reportId: seeded.reportId,
    suggestionId: seeded.manifest.pageSuggestions[0]!.id,
    reviewedByUserId: seeded.accountId,
    idempotencyKey: 'page-match-review',
    decision: 'approved',
    ownedUrl: 'https://owned.example/seo-audit',
    competitorUrl: 'https://rival.example/guides/seo-audit',
    version: 0,
    ...overrides,
  };
}

describe('reviewed landscape page matches', () => {
  it('approves a same-domain ranking page, overlays it, and freezes keyword evidence', async () => {
    const seeded = await seedReport();
    const suggestion = seeded.manifest.pageSuggestions[0]!;
    const saved = await reviewLandscapePageMatch({
      accountId: seeded.accountId,
      siteId: seeded.siteId,
      reportId: seeded.reportId,
      suggestionId: suggestion.id,
      reviewedByUserId: seeded.accountId,
      idempotencyKey: 'review-ok',
      decision: 'approved',
      ownedUrl: 'https://owned.example/seo-audit',
      competitorUrl: 'https://rival.example/guides/seo-audit',
      version: 0,
    }, { db: getTestDb() as never, validateUrl: async (url) => new URL(url) });
    expect(saved.review).toMatchObject({ state: 'approved', version: 1 });
    const replay = await reviewLandscapePageMatch({
      accountId: seeded.accountId,
      siteId: seeded.siteId,
      reportId: seeded.reportId,
      suggestionId: suggestion.id,
      reviewedByUserId: seeded.accountId,
      idempotencyKey: 'review-ok',
      decision: 'approved',
      ownedUrl: 'https://owned.example/seo-audit',
      competitorUrl: 'https://rival.example/guides/seo-audit',
      version: 0,
    }, { db: getTestDb() as never, validateUrl: async (url) => new URL(url) });
    expect(replay.replayed).toBe(true);
    const overlaid = await overlayLandscapePageMatchReviews(getTestDb() as never, {
      accountId: seeded.accountId,
      siteId: seeded.siteId,
      reportId: seeded.reportId,
      manifest: seeded.manifest,
    });
    expect(overlaid.pageSuggestions[0]!.review.state).toBe('approved');
    const frozen = await loadFrozenReviewedPageMatch(getTestDb() as never, {
      accountId: seeded.accountId,
      siteId: seeded.siteId,
      reportId: seeded.reportId,
      suggestionId: suggestion.id,
      opportunityId: seeded.opportunityId,
    });
    expect(frozen.selectedUrl).toBe('https://rival.example/guides/seo-audit');
    expect(frozen.keywordEvidence[0]).toMatchObject({ keyword: 'seo audit', class: 'shared_behind', searchVolume: 500 });
  });

  it('rejects a wrong-domain override and an archived profile', async () => {
    const seeded = await seedReport();
    const suggestion = seeded.manifest.pageSuggestions[0]!;
    await expect(reviewLandscapePageMatch({
      accountId: seeded.accountId,
      siteId: seeded.siteId,
      reportId: seeded.reportId,
      suggestionId: suggestion.id,
      reviewedByUserId: seeded.accountId,
      idempotencyKey: 'wrong-domain',
      decision: 'approved',
      ownedUrl: 'https://owned.example/seo-audit',
      competitorUrl: 'https://attacker.example/page',
      version: 0,
    }, { db: getTestDb() as never, validateUrl: async (url) => new URL(url) })).rejects.toMatchObject({ status: 400 });
    await getTestDb().update(competitorProfiles).set({ status: 'archived' }).where(eq(competitorProfiles.id, PROFILE));
    await expect(reviewLandscapePageMatch({
      accountId: seeded.accountId,
      siteId: seeded.siteId,
      reportId: seeded.reportId,
      suggestionId: suggestion.id,
      reviewedByUserId: seeded.accountId,
      idempotencyKey: 'archived',
      decision: 'rejected',
      ownedUrl: null,
      competitorUrl: null,
      version: 0,
    }, { db: getTestDb() as never })).rejects.toMatchObject({ status: 404 });
  });

  it('bounds the default URL authority and exhausts pure review policies', async () => {
    expect(landscapeReviewTestables.boundedReviewedFetchOptions()).toMatchObject({
      deadlineMs: 10_000,
      maxRedirects: 3,
      maxResponseBytes: 1_024,
    });
    expect(
      landscapeReviewTestables.boundedReviewedFetchOptions({
        deadlineMs: 9_000,
        maxRedirects: 2,
        maxResponseBytes: 900,
      }),
    ).toMatchObject({ deadlineMs: 9_000, maxRedirects: 2, maxResponseBytes: 900 });
    expect(
      landscapeReviewTestables.boundedReviewedFetchOptions({
        deadlineMs: 20_000,
        maxRedirects: 20,
        maxResponseBytes: 2_048,
      }),
    ).toMatchObject({ deadlineMs: 10_000, maxRedirects: 3, maxResponseBytes: 1_024 });

    const resolver: PublicUrlResolver = async () => [
      { address: '93.184.216.34', family: 4 },
    ];
    const transport: PublicUrlTransport = async (url, _pinned, init, _signal, bytes) => {
      expect(init.method).toBe('HEAD');
      expect(bytes).toBe(1_024);
      return new Response(null, {
        status: 204,
        headers: { 'x-observed-host': url.hostname },
      });
    };
    await expect(
      landscapeReviewTestables.defaultReviewedUrlAuthority('https://owned.example/path', {
        resolver,
        transport,
        maxResponseBytes: 9_999,
      }),
    ).resolves.toEqual(new URL('https://owned.example/path'));

    expect(
      landscapeReviewTestables.sameOrigin(
        new URL('https://owned.example/child'),
        'https://owned.example/root',
      ),
    ).toBe(true);
    expect(
      landscapeReviewTestables.sameOrigin(
        new URL('https://other.example/child'),
        'https://owned.example/root',
      ),
    ).toBe(false);
    expect(
      landscapeReviewTestables.sameRegistrableDomain(
        new URL('https://docs.rival.example/page'),
        'rival.example',
      ),
    ).toBe(true);
    expect(
      landscapeReviewTestables.sameRegistrableDomain(
        new URL('https://other.example/page'),
        'rival.example',
      ),
    ).toBe(false);
    for (const value of ['a', 'x'.repeat(128)]) {
      expect(landscapeReviewTestables.idempotencyValid(value)).toBe(true);
    }
    for (const value of ['', 'x'.repeat(129), 'contains space', 'tab\t', 'é']) {
      expect(landscapeReviewTestables.idempotencyValid(value)).toBe(false);
    }

    const row: LandscapePageMatchReviewRow = {
      id: '22222222-2222-4222-8222-222222222222',
      accountId: 'account',
      siteId: 'site',
      reportId: 'report',
      suggestionId: 'suggestion',
      competitorProfileId: PROFILE,
      decision: 'approved',
      ownedUrl: 'https://owned.example/page',
      competitorUrl: 'https://rival.example/page',
      reviewedByUserId: 'reviewer',
      idempotencyKey: 'key',
      version: 1,
      reviewedAt: new Date('2026-08-12T00:00:00.000Z'),
    };
    const input: ReviewPageMatchInput = {
      accountId: row.accountId,
      siteId: row.siteId,
      reportId: row.reportId,
      suggestionId: row.suggestionId,
      reviewedByUserId: row.reviewedByUserId,
      idempotencyKey: row.idempotencyKey,
      decision: row.decision,
      ownedUrl: row.ownedUrl,
      competitorUrl: row.competitorUrl,
      version: row.version,
    };
    expect(landscapeReviewTestables.sameReview(row, input)).toBe(true);
    for (const changed of [
      { ...input, siteId: 'other' },
      { ...input, reportId: 'other' },
      { ...input, suggestionId: 'other' },
      { ...input, decision: 'rejected' as const },
      { ...input, ownedUrl: 'https://owned.example/other' },
      { ...input, competitorUrl: 'https://rival.example/other' },
    ]) {
      expect(landscapeReviewTestables.sameReview(row, changed)).toBe(false);
    }
    const seeded = await seedReport();
    const suggestion = seeded.manifest.pageSuggestions[0]!;
    expect(landscapeReviewTestables.approvedReviewedPageMatch(undefined, row)).toBeNull();
    expect(landscapeReviewTestables.approvedReviewedPageMatch(suggestion, null)).toBeNull();
    expect(
      landscapeReviewTestables.approvedReviewedPageMatch(suggestion, {
        ...row,
        decision: 'rejected',
      }),
    ).toBeNull();
    expect(
      landscapeReviewTestables.approvedReviewedPageMatch(suggestion, {
        ...row,
        ownedUrl: null,
      }),
    ).toBeNull();
    expect(
      landscapeReviewTestables.approvedReviewedPageMatch(suggestion, {
        ...row,
        competitorUrl: null,
      }),
    ).toBeNull();
    expect(landscapeReviewTestables.approvedReviewedPageMatch(suggestion, row)).toMatchObject({
      suggestion,
      review: row,
    });
  });

  it('rejects every malformed review coordinate and decision shape before storage', async () => {
    const validId = new mongoose.Types.ObjectId().toHexString();
    const base: ReviewPageMatchInput = {
      accountId: validId,
      siteId: validId,
      reportId: validId,
      suggestionId: 'suggestion',
      reviewedByUserId: validId,
      idempotencyKey: 'valid-key',
      decision: 'approved',
      ownedUrl: 'https://owned.example/page',
      competitorUrl: 'https://rival.example/page',
      version: 0,
    };
    const cases: Array<{ input: ReviewPageMatchInput; status: number }> = [
      { input: { ...base, siteId: 'invalid' }, status: 404 },
      { input: { ...base, reportId: 'invalid' }, status: 404 },
      { input: { ...base, idempotencyKey: '' }, status: 400 },
      { input: { ...base, version: 0.5 }, status: 400 },
      { input: { ...base, version: -1 }, status: 400 },
      { input: { ...base, ownedUrl: null }, status: 400 },
      { input: { ...base, competitorUrl: null }, status: 400 },
      {
        input: {
          ...base,
          decision: 'rejected',
          competitorUrl: null,
        },
        status: 400,
      },
      {
        input: {
          ...base,
          decision: 'rejected',
          ownedUrl: null,
        },
        status: 400,
      },
    ];
    for (const scenario of cases) {
      await expect(
        reviewLandscapePageMatch(scenario.input, { db: getTestDb() }),
      ).rejects.toMatchObject({ status: scenario.status });
    }
  });

  it('fails closed for missing ownership, manifests, suggestions, profiles, and unsafe URLs', async () => {
    const seeded = await seedReport();
    const base = pageMatchInput(seeded);
    const unreviewed = await overlayLandscapePageMatchReviews(getTestDb(), {
      accountId: seeded.accountId,
      siteId: seeded.siteId,
      reportId: seeded.reportId,
      manifest: seeded.manifest,
    });
    expect(unreviewed.pageSuggestions[0]?.review).toEqual({
      state: 'unreviewed',
      ownedUrl: null,
      competitorUrl: null,
      version: 0,
      reviewedAt: null,
    });
    await expect(
      reviewLandscapePageMatch(
        { ...base, accountId: new mongoose.Types.ObjectId().toHexString() },
        { db: getTestDb() },
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      reviewLandscapePageMatch(
        { ...base, reportId: new mongoose.Types.ObjectId().toHexString() },
        { db: getTestDb() },
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      reviewLandscapePageMatch(
        { ...base, suggestionId: 'missing-suggestion' },
        { db: getTestDb() },
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      reviewLandscapePageMatch(
        { ...base, idempotencyKey: 'unsafe' },
        { db: getTestDb(), validateUrl: async () => Promise.reject(new Error('unsafe')) },
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      reviewLandscapePageMatch(
        { ...base, idempotencyKey: 'off-origin' },
        { db: getTestDb(), validateUrl: async () => new URL('https://other.example') },
      ),
    ).rejects.toMatchObject({ status: 400 });

    await getTestDb()
      .update(competitorProfiles)
      .set({ registrableDomain: 'changed.example' })
      .where(eq(competitorProfiles.id, PROFILE));
    await expect(
      reviewLandscapePageMatch(
        { ...base, idempotencyKey: 'domain-drift' },
        { db: getTestDb() },
      ),
    ).rejects.toMatchObject({ status: 404 });
    await getTestDb()
      .update(competitorProfiles)
      .set({ registrableDomain: 'rival.example' })
      .where(eq(competitorProfiles.id, PROFILE));
    await CompetitorLandscapeRun.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(seeded.reportId) },
      { $set: { competitors: [] } },
    );
    await expect(
      reviewLandscapePageMatch(
        { ...base, idempotencyKey: 'missing-frozen-profile' },
        { db: getTestDb() },
      ),
    ).rejects.toMatchObject({ status: 404 });
    await CompetitorLandscapeRun.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(seeded.reportId) },
      { $set: { competitors: seeded.manifest.competitors, reportManifest: null } },
    );
    await expect(
      reviewLandscapePageMatch(
        { ...base, idempotencyKey: 'missing-manifest' },
        { db: getTestDb() },
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('updates reviews, detects replays and stale writers, and fails a lost update closed', async () => {
    const seeded = await seedReport();
    const resolver: PublicUrlResolver = async () => [
      { address: '93.184.216.34', family: 4 },
    ];
    const transport: PublicUrlTransport = async () => new Response(null, { status: 204 });
    const approvedInput = pageMatchInput(seeded, { idempotencyKey: 'default-authority' });
    const approved = await reviewLandscapePageMatch(approvedInput, {
      db: getTestDb(),
      fetchOptions: { resolver, transport },
    });
    expect(approved).toMatchObject({ replayed: false, review: { version: 1 } });
    await expect(
      reviewLandscapePageMatch(
        { ...approvedInput, competitorUrl: 'https://rival.example/different' },
        { db: getTestDb() },
      ),
    ).rejects.toMatchObject({ status: 409 });

    const rejectedInput = pageMatchInput(seeded, {
      idempotencyKey: 'reject-update',
      decision: 'rejected',
      ownedUrl: null,
      competitorUrl: null,
      version: 1,
    });
    const rejected = await reviewLandscapePageMatch(rejectedInput, { db: getTestDb() });
    expect(rejected).toMatchObject({ replayed: false, review: { state: 'rejected', version: 2 } });
    await expect(
      reviewLandscapePageMatch(
        { ...rejectedInput, idempotencyKey: 'stale-update', version: 1 },
        { db: getTestDb() },
      ),
    ).rejects.toMatchObject({ status: 409 });

    await expect(
      reviewLandscapePageMatch(
        pageMatchInput(seeded, {
          idempotencyKey: 'lost-update',
          version: 2,
        }),
        {
          db: getTestDb(),
          validateUrl: async (url) => new URL(url),
          beforeWrite: async () => {
            await getTestDb().delete(landscapePageMatchReviews);
          },
        },
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('settles equivalent and conflicting insert races deterministically', async () => {
    const runScenario = async (equivalent: boolean) => {
      const seeded = await seedReport();
      const input = pageMatchInput(seeded, {
        idempotencyKey: equivalent ? 'equivalent-race' : 'conflicting-race',
        decision: 'rejected',
        ownedUrl: null,
        competitorUrl: null,
      });
      const promise = reviewLandscapePageMatch(input, {
        db: getTestDb(),
        beforeWrite: async () => {
          await getTestDb().insert(landscapePageMatchReviews).values({
            accountId: input.accountId,
            siteId: input.siteId,
            reportId: input.reportId,
            suggestionId: input.suggestionId,
            competitorProfileId: PROFILE,
            decision: equivalent ? 'rejected' : 'approved',
            ownedUrl: equivalent ? null : 'https://owned.example/raced',
            competitorUrl: equivalent ? null : 'https://rival.example/raced',
            reviewedByUserId: input.reviewedByUserId,
            idempotencyKey: input.idempotencyKey,
            version: 1,
          });
        },
      });
      if (equivalent) {
        await expect(promise).resolves.toMatchObject({
          replayed: true,
          review: { state: 'rejected', version: 1 },
        });
      } else {
        await expect(promise).rejects.toBeInstanceOf(Error);
      }
    };

    await runScenario(true);
    await clearCollections();
    await truncateAllTables();
    await runScenario(false);
  });

  it('fails closed and freezes null evidence across every reviewed handoff state', async () => {
    const seeded = await seedReport();
    const suggestion = seeded.manifest.pageSuggestions[0]!;
    await expect(
      loadFrozenReviewedPageMatch(getTestDb(), {
        accountId: seeded.accountId,
        siteId: seeded.siteId,
        reportId: new mongoose.Types.ObjectId().toHexString(),
        suggestionId: suggestion.id,
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      loadFrozenReviewedPageMatch(getTestDb(), {
        accountId: seeded.accountId,
        siteId: seeded.siteId,
        reportId: seeded.reportId,
        suggestionId: 'missing-suggestion',
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      loadFrozenReviewedPageMatch(getTestDb(), {
        accountId: seeded.accountId,
        siteId: seeded.siteId,
        reportId: seeded.reportId,
        suggestionId: suggestion.id,
      }),
    ).rejects.toMatchObject({ status: 400 });

    await reviewLandscapePageMatch(
      pageMatchInput(seeded, {
        idempotencyKey: 'frozen-rejected',
        decision: 'rejected',
        ownedUrl: null,
        competitorUrl: null,
      }),
      { db: getTestDb() },
    );
    await expect(
      loadFrozenReviewedPageMatch(getTestDb(), {
        accountId: seeded.accountId,
        siteId: seeded.siteId,
        reportId: seeded.reportId,
        suggestionId: suggestion.id,
      }),
    ).rejects.toMatchObject({ status: 400 });
    await reviewLandscapePageMatch(
      pageMatchInput(seeded, {
        idempotencyKey: 'frozen-approved',
        version: 1,
      }),
      { db: getTestDb(), validateUrl: async (url) => new URL(url) },
    );
    await expect(
      loadFrozenReviewedPageMatch(getTestDb(), {
        accountId: seeded.accountId,
        siteId: seeded.siteId,
        reportId: seeded.reportId,
        suggestionId: suggestion.id,
        opportunityId: 'missing-opportunity',
      }),
    ).rejects.toMatchObject({ status: 404 });

    await CompetitorLandscapeReportPage.deleteMany({ runId: seeded.reportId });
    const frozen = await loadFrozenReviewedPageMatch(getTestDb(), {
      accountId: seeded.accountId,
      siteId: seeded.siteId,
      reportId: seeded.reportId,
      suggestionId: suggestion.id,
    });
    expect(frozen.landscapeOpportunityId).toBeNull();
    expect(frozen.keywordEvidence[0]).toEqual({
      keyword: 'seo audit',
      class: null,
      ownedPosition: null,
      competitorPosition: null,
      ownedUrl: null,
      competitorUrl: null,
      searchVolume: null,
      intent: null,
      provenanceIndexes: [],
    });

    await getTestDb()
      .update(competitorProfiles)
      .set({ status: 'archived' })
      .where(eq(competitorProfiles.id, PROFILE));
    await expect(
      loadFrozenReviewedPageMatch(getTestDb(), {
        accountId: seeded.accountId,
        siteId: seeded.siteId,
        reportId: seeded.reportId,
        suggestionId: suggestion.id,
      }),
    ).rejects.toMatchObject({ status: 404 });
    await getTestDb()
      .update(competitorProfiles)
      .set({ status: 'active' })
      .where(eq(competitorProfiles.id, PROFILE));
    await CompetitorLandscapeRun.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(seeded.reportId) },
      { $set: { competitors: [] } },
    );
    await expect(
      loadFrozenReviewedPageMatch(getTestDb(), {
        accountId: seeded.accountId,
        siteId: seeded.siteId,
        reportId: seeded.reportId,
        suggestionId: suggestion.id,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('landscape repository filters and cursor contracts', () => {
  it('validates cursor shapes, normalized filters, and every row predicate', () => {
    const objectId = new mongoose.Types.ObjectId().toHexString();
    for (const value of [
      null,
      {},
      { createdAt: 'invalid', id: objectId },
      { createdAt: new Date().toISOString(), id: 'invalid' },
    ]) {
      expect(landscapeRepositoryTestables.validLandscapeCursor(value)).toBe(false);
    }
    expect(
      landscapeRepositoryTestables.validLandscapeCursor({
        createdAt: new Date().toISOString(),
        id: objectId,
      }),
    ).toBe(true);
    for (const value of [
      null,
      {},
      { offset: -1, class: null, competitor: null, q: null },
      { offset: 0.5, class: null, competitor: null, q: null },
      { offset: 0, class: 1, competitor: null, q: null },
      { offset: 0, class: null, competitor: 1, q: null },
      { offset: 0, class: null, competitor: null, q: 1 },
    ]) {
      expect(landscapeRepositoryTestables.validLandscapeRowCursor(value)).toBe(
        false,
      );
    }
    const cursor = { offset: 1, class: null, competitor: null, q: null };
    expect(landscapeRepositoryTestables.validLandscapeRowCursor(cursor)).toBe(true);
    expect(landscapeRepositoryTestables.detailFilters({})).toEqual({
      class: null,
      competitor: null,
      q: null,
    });
    const filters = landscapeRepositoryTestables.detailFilters({
      class: 'shared_behind',
      competitor: 'RIVAL.EXAMPLE',
      q: '  Audit  ',
    });
    expect(filters).toEqual({
      class: 'shared_behind',
      competitor: 'rival.example',
      q: 'audit',
    });
    expect(
      landscapeRepositoryTestables.sameDetailFilters(
        { offset: 1, ...filters },
        filters,
      ),
    ).toBe(true);
    for (const changed of [
      { ...filters, class: 'missing' },
      { ...filters, competitor: PROFILE },
      { ...filters, q: 'other' },
    ]) {
      expect(
        landscapeRepositoryTestables.sameDetailFilters(
          { offset: 1, ...changed },
          filters,
        ),
      ).toBe(false);
    }

    const row = landscapeReportRowSchema.parse({
      ...checkpoints()[0]!.rows[0],
      id: 'repository-row',
      keyword: 'Visible label',
      normalizedKeyword: 'seo audit',
      class: 'shared_behind',
      competitorProfileId: PROFILE,
      competitorDomain: 'rival.example',
      positionDelta: 6,
      competitorCoverage: 1,
      provenanceIndexes: [0],
    });
    expect(
      landscapeRepositoryTestables.landscapeRowMatches(row, {
        class: null,
        competitor: null,
        q: null,
      }),
    ).toBe(true);
    expect(
      landscapeRepositoryTestables.landscapeRowMatches(row, {
        class: 'missing',
        competitor: null,
        q: null,
      }),
    ).toBe(false);
    for (const competitor of [PROFILE.toLowerCase(), 'rival.example']) {
      expect(
        landscapeRepositoryTestables.landscapeRowMatches(row, {
          class: 'shared_behind',
          competitor,
          q: null,
        }),
      ).toBe(true);
    }
    expect(
      landscapeRepositoryTestables.landscapeRowMatches(row, {
        class: null,
        competitor: 'other.example',
        q: null,
      }),
    ).toBe(false);
    for (const q of ['visible', 'seo audit']) {
      expect(
        landscapeRepositoryTestables.landscapeRowMatches(row, {
          class: null,
          competitor: null,
          q,
        }),
      ).toBe(true);
    }
    expect(
      landscapeRepositoryTestables.landscapeRowMatches(row, {
        class: null,
        competitor: null,
        q: 'absent',
      }),
    ).toBe(false);
  });

  it('paginates immutable pages and binds filtered cursors to their query', async () => {
    const seeded = await seedReport();
    const storedPage = await CompetitorLandscapeReportPage.findOne({
      runId: seeded.reportId,
    }).lean();
    const baseRow = landscapeReportRowSchema.parse(storedPage?.rows[0]);
    const firstRow = landscapeReportRowSchema.parse({
      ...baseRow,
      id: 'repository-first',
      keyword: 'Visible first',
      normalizedKeyword: 'canonical first',
    });
    const secondRow = landscapeReportRowSchema.parse({
      ...baseRow,
      id: 'repository-second',
      keyword: 'Visible second',
      normalizedKeyword: 'canonical second',
    });
    await CompetitorLandscapeReportPage.deleteMany({ runId: seeded.reportId });
    await CompetitorLandscapeReportPage.create([
      {
        accountId: seeded.accountId,
        siteId: seeded.siteId,
        runId: seeded.reportId,
        pageIndex: 0,
        rows: [firstRow],
        rowCount: 1,
        pageHash: sha256CanonicalLandscape([firstRow]),
      },
      {
        accountId: seeded.accountId,
        siteId: seeded.siteId,
        runId: seeded.reportId,
        pageIndex: 1,
        rows: [secondRow],
        rowCount: 1,
        pageHash: sha256CanonicalLandscape([secondRow]),
      },
    ]);

    await expect(
      getLandscapeRun({
        accountId: seeded.accountId,
        siteId: seeded.siteId,
        runId: 'invalid',
      }),
    ).rejects.toMatchObject({ status: 404 });
    const firstPage = await getLandscapeRun({
      accountId: seeded.accountId,
      siteId: seeded.siteId,
      runId: seeded.reportId,
      db: getTestDb(),
      pageLimit: 1,
      pageCursor: -10,
    });
    expect(firstPage.rows.map((row) => row.id)).toEqual(['repository-first']);
    expect(firstPage.nextCursor).toBe(1);
    const secondPage = await getLandscapeRun({
      accountId: seeded.accountId,
      siteId: seeded.siteId,
      runId: seeded.reportId,
      pageLimit: 100,
      pageCursor: 1,
    });
    expect(secondPage.rows.map((row) => row.id)).toEqual(['repository-second']);
    expect(secondPage.nextCursor).toBeNull();

    await expect(
      listLandscapeRuns({
        accountId: seeded.accountId,
        siteId: seeded.siteId,
        cursor: 'invalid',
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      listLandscapeRuns({
        accountId: seeded.accountId,
        siteId: seeded.siteId,
        cursor: landscapeRepositoryTestables.encodeCursorValue({
          createdAt: 'invalid',
          id: new mongoose.Types.ObjectId().toHexString(),
        }),
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      listLandscapeRuns({
        accountId: seeded.accountId,
        siteId: seeded.siteId,
        state: 'completed',
        limit: 500,
      }),
    ).resolves.toMatchObject({ items: [{ id: seeded.reportId }] });
    await expect(
      getFilteredLandscapeRun({
        accountId: seeded.accountId,
        siteId: seeded.siteId,
        runId: seeded.reportId,
        db: getTestDb(),
        limit: 1,
        cursor: 'invalid',
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      getFilteredLandscapeRun({
        accountId: seeded.accountId,
        siteId: seeded.siteId,
        runId: seeded.reportId,
        db: getTestDb(),
        limit: 1,
        cursor: landscapeRepositoryTestables.encodeCursorValue({
          offset: -1,
          class: null,
          competitor: null,
          q: null,
        }),
      }),
    ).rejects.toMatchObject({ status: 400 });
    const filtered = await getFilteredLandscapeRun({
      accountId: seeded.accountId,
      siteId: seeded.siteId,
      runId: seeded.reportId,
      db: getTestDb(),
      q: 'visible',
      limit: 1,
    });
    expect(filtered.items.map((row) => row.id)).toEqual(['repository-first']);
    expect(filtered.nextCursor).toEqual(expect.any(String));
    const filteredNext = await getFilteredLandscapeRun({
      accountId: seeded.accountId,
      siteId: seeded.siteId,
      runId: seeded.reportId,
      db: getTestDb(),
      q: 'VISIBLE',
      limit: 1,
      cursor: filtered.nextCursor!,
    });
    expect(filteredNext.items.map((row) => row.id)).toEqual([
      'repository-second',
    ]);
    expect(filteredNext.nextCursor).toBeNull();
    for (const mismatch of [
      { class: 'shared_behind' },
      { competitor: 'rival.example' },
      { q: 'different' },
    ]) {
      await expect(
        getFilteredLandscapeRun({
          accountId: seeded.accountId,
          siteId: seeded.siteId,
          runId: seeded.reportId,
          db: getTestDb(),
          limit: 1,
          cursor: filtered.nextCursor!,
          ...mismatch,
        }),
      ).rejects.toMatchObject({ status: 400 });
    }
    await expect(
      getFilteredLandscapeRun({
        accountId: seeded.accountId,
        siteId: seeded.siteId,
        runId: seeded.reportId,
        db: getTestDb(),
        class: 'missing',
        competitor: 'other.example',
        q: 'absent',
        limit: 10,
      }),
    ).resolves.toMatchObject({ items: [], nextCursor: null });

    const exported = await exportLandscapeRuns(seeded.accountId);
    expect(exported[0]?.rows.map((row) => row.id)).toEqual([
      'repository-first',
      'repository-second',
    ]);
    expect(await purgeLandscapeRuns({ accountId: new mongoose.Types.ObjectId().toHexString() })).toBe(0);
    expect(await purgeLandscapeRuns({ accountId: seeded.accountId })).toBe(1);
  });
});

beforeAll(async () => {
  mongoUri = await startMemoryMongo();
  await mongoose.connect(mongoUri);
  await startTestPostgres();
  registerBuiltInActionAdapters();
});

afterAll(async () => {
  await mongoose.disconnect();
  await stopMemoryMongo();
  await stopTestPostgres();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
});

afterEach(async () => {
  await clearCollections();
  await truncateAllTables();
});

describe('landscape opportunity acceptance and actions', () => {
  it('keeps unaccepted findings report-only', async () => {
    const seed = await seedReport();
    const actions = await listActionsForSite({
      accountId: seed.accountId,
      siteId: seed.siteId,
      locale: 'en',
      db: getTestDb(),
    });
    expect(actions.items).toEqual([]);
    const stored = await CompetitorLandscapeRun.findById(seed.reportId).lean();
    expect(stored?.reportManifest).toEqual(seed.manifest);
  });

  it('accepts once, scopes ownership, and rejects an idempotency-key mismatch', async () => {
    const seed = await seedReport();
    const input = {
      ...seed,
      acceptedByUserId: seed.accountId,
      idempotencyKey: 'accept-1',
    };
    const first = await acceptLandscapeOpportunity(getTestDb(), input);
    const replay = await acceptLandscapeOpportunity(getTestDb(), input);
    const secondKey = await acceptLandscapeOpportunity(getTestDb(), {
      ...input,
      idempotencyKey: 'accept-2',
    });
    expect(first.replayed).toBe(false);
    expect(replay).toMatchObject({ actionId: first.actionId, replayed: true });
    expect(secondKey).toMatchObject({ actionId: first.actionId, replayed: true });

    await expect(
      acceptLandscapeOpportunity(getTestDb(), {
        ...input,
        accountId: new mongoose.Types.ObjectId().toHexString(),
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      acceptLandscapeOpportunity(getTestDb(), {
        ...input,
        reportId: new mongoose.Types.ObjectId().toHexString(),
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('rejects malformed acceptance coordinates, keys, and missing opportunities', async () => {
    const seed = await seedReport();
    const base = {
      ...seed,
      acceptedByUserId: seed.accountId,
      idempotencyKey: 'accept-validation',
    };
    for (const input of [
      { ...base, siteId: 'invalid' },
      { ...base, reportId: 'invalid' },
      { ...base, idempotencyKey: '' },
      { ...base, idempotencyKey: 'x'.repeat(129) },
      { ...base, idempotencyKey: 'contains space' },
    ]) {
      await expect(acceptLandscapeOpportunity(getTestDb(), input)).rejects.toMatchObject({
        status: input.idempotencyKey === base.idempotencyKey ? 404 : 400,
      });
    }
    await expect(
      acceptLandscapeOpportunity(getTestDb(), {
        ...base,
        opportunityId: 'landscape-opportunity-missing',
      }),
    ).rejects.toMatchObject({ status: 404 });

    await CompetitorLandscapeRun.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(seed.reportId) },
      { $set: { reportManifest: null } },
    );
    await expect(acceptLandscapeOpportunity(getTestDb(), base)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('lists and overlays accepted decisions without changing the manifest', async () => {
    const seed = await seedReport();
    const accepted = await acceptLandscapeOpportunity(getTestDb(), {
      ...seed,
      acceptedByUserId: seed.accountId,
      idempotencyKey: 'accept-overlay',
    });
    const all = await listLandscapeOpportunityAcceptances(getTestDb(), {
      accountId: seed.accountId,
      siteId: seed.siteId,
    });
    const filtered = await listLandscapeOpportunityAcceptances(getTestDb(), {
      accountId: seed.accountId,
      siteId: seed.siteId,
      reportId: seed.reportId,
    });
    expect(all).toHaveLength(1);
    expect(filtered).toEqual(all);
    const overlaid = await overlayLandscapeOpportunityAcceptances(getTestDb(), {
      accountId: seed.accountId,
      siteId: seed.siteId,
      reportId: seed.reportId,
      manifest: seed.manifest,
    });
    expect(overlaid.opportunities[0]).toMatchObject({
      id: seed.opportunityId,
      acceptedActionId: accepted.actionId,
    });
    expect(seed.manifest.opportunities[0]).not.toHaveProperty('acceptedActionId');
    const unacceptedOverlay = await overlayLandscapeOpportunityAcceptances(getTestDb(), {
      accountId: new mongoose.Types.ObjectId().toHexString(),
      siteId: new mongoose.Types.ObjectId().toHexString(),
      reportId: seed.reportId,
      manifest: seed.manifest,
    });
    expect(unacceptedOverlay.opportunities[0]).toMatchObject({ acceptedActionId: null });
  });

  it('rejects reusing an idempotency key for a different decision', async () => {
    const seed = await seedReport();
    await getTestDb().insert(landscapeOpportunityAcceptances).values({
      accountId: seed.accountId,
      siteId: seed.siteId,
      reportId: seed.reportId,
      opportunityId: 'landscape-opportunity-other',
      actionId: 'a'.repeat(64),
      acceptedByUserId: seed.accountId,
      idempotencyKey: 'accept-conflict',
    });
    await expect(
      acceptLandscapeOpportunity(getTestDb(), {
        ...seed,
        acceptedByUserId: seed.accountId,
        idempotencyKey: 'accept-conflict',
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('settles all uniqueness-race outcomes deterministically', async () => {
    const scenarios = [
      { name: 'same-idempotency', storedOpportunity: 'same', storedKey: 'same', status: 200 },
      { name: 'mismatched-idempotency', storedOpportunity: 'other', storedKey: 'same', status: 409 },
      { name: 'same-opportunity', storedOpportunity: 'same', storedKey: 'other', status: 200 },
    ] as const;
    for (const scenario of scenarios) {
      await clearCollections();
      await truncateAllTables();
      const seed = await seedReport();
      const input = {
        ...seed,
        acceptedByUserId: seed.accountId,
        idempotencyKey: `race-${scenario.name}`,
      };
      const db = dbWithAcceptanceInsert(async (values) => {
        await getTestDb().insert(landscapeOpportunityAcceptances).values({
          ...(values as typeof landscapeOpportunityAcceptances.$inferInsert),
          opportunityId:
            scenario.storedOpportunity === 'same'
              ? seed.opportunityId
              : 'landscape-opportunity-other',
          idempotencyKey:
            scenario.storedKey === 'same' ? input.idempotencyKey : `other-${scenario.name}`,
        });
        throw new Error('simulated uniqueness race');
      });
      if (scenario.status === 409) {
        await expect(acceptLandscapeOpportunity(db, input)).rejects.toMatchObject({ status: 409 });
      } else {
        await expect(acceptLandscapeOpportunity(db, input)).resolves.toMatchObject({
          replayed: true,
        });
      }
    }
  });

  it('surfaces an empty or failed insert when no concurrent decision exists', async () => {
    const seed = await seedReport();
    const input = {
      ...seed,
      acceptedByUserId: seed.accountId,
      idempotencyKey: 'empty-insert',
    };
    await expect(
      acceptLandscapeOpportunity(dbWithAcceptanceInsert(async () => []), input),
    ).rejects.toThrow('landscape acceptance insert returned no row');
    await expect(
      acceptLandscapeOpportunity(
        dbWithAcceptanceInsert(async () => {
          throw new Error('insert unavailable');
        }),
        { ...input, idempotencyKey: 'failed-insert' },
      ),
    ).rejects.toThrow('insert unavailable');
  });

  it('enters Next Actions once and uses the append-only lifecycle without report mutation', async () => {
    const seed = await seedReport();
    const accepted = await acceptLandscapeOpportunity(getTestDb(), {
      ...seed,
      acceptedByUserId: seed.accountId,
      idempotencyKey: 'accept-lifecycle',
    });
    const listed = await listActionsForSite({
      accountId: seed.accountId,
      siteId: seed.siteId,
      locale: 'en',
      db: getTestDb(),
    });
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]).toMatchObject({
      id: accepted.actionId,
      sourceType: 'competitor_opportunity',
      affectedUrls: ['https://owned.example/seo-audit'],
      confidence: 'medium',
      effort: 'medium',
      state: 'open',
    });
    expect(listed.items[0]!.sourceLink).toContain('tab=competitors');
    expect(listed.items[0]!.evidence[0]).toMatchObject({
      url: 'https://rival.example/seo-audit',
    });

    let version = 0;
    for (const [newState, clientKey] of [
      ['planned', 'plan'],
      ['completed', 'complete'],
      ['open', 'reopen-1'],
      ['dismissed', 'dismiss'],
      ['open', 'reopen-2'],
    ] as const) {
      const changed = await mutateActionState({
        accountId: seed.accountId,
        siteId: seed.siteId,
        actionId: accepted.actionId,
        actorUserId: seed.accountId,
        newState,
        expectedVersion: version,
        note: null,
        clientKey,
        db: getTestDb(),
      });
      version = changed.version;
    }
    const history = await getActionHistory({
      accountId: seed.accountId,
      siteId: seed.siteId,
      actionId: accepted.actionId,
      db: getTestDb(),
      locale: 'en',
    });
    expect(history.entries.map((entry) => entry.newState)).toEqual([
      'planned',
      'completed',
      'open',
      'dismissed',
      'open',
    ]);
    const stored = await CompetitorLandscapeRun.findById(seed.reportId).lean();
    expect(stored?.reportManifest).toEqual(seed.manifest);
  });

  it('skips stale accepted records and projects missing opportunities without invented URLs', async () => {
    const seed = await seedReport();
    const templateRun = await CompetitorLandscapeRun.collection.findOne({
      _id: new mongoose.Types.ObjectId(seed.reportId),
    });
    const templatePage = await CompetitorLandscapeReportPage.collection.findOne({
      runId: new mongoose.Types.ObjectId(seed.reportId),
    });
    expect(templateRun).not.toBeNull();
    expect(templatePage).not.toBeNull();

    const cloneReport = async (kind: 'null-manifest' | 'missing-opportunity' | 'mismatch' | 'valid-missing' | 'valid-empty') => {
      const reportId = new mongoose.Types.ObjectId();
      const manifest = structuredClone(seed.manifest);
      const pageRows = structuredClone(templatePage!.rows);
      if (kind === 'valid-missing') {
        manifest.opportunities[0]!.kind = 'missing_keyword';
        manifest.sourceDates = manifest.sourceDates.map((source) => ({
          ...source,
          capturedAt: null,
        }));
        pageRows[0]!.ownedUrl = null;
        pageRows[0]!.competitorUrl = null;
      }
      await CompetitorLandscapeRun.collection.insertOne({
        ...templateRun!,
        _id: reportId,
        idempotencyKey: `adapter-${kind}`,
        requestFingerprint: new mongoose.Types.ObjectId().toHexString().padEnd(64, '0'),
        queueJobId: `competitor-landscape-${reportId.toHexString()}`,
        reportManifest: kind === 'null-manifest' ? null : manifest,
      });
      if (kind !== 'null-manifest' && kind !== 'missing-opportunity' && kind !== 'valid-empty') {
        await CompetitorLandscapeReportPage.collection.insertOne({
          ...templatePage!,
          _id: new mongoose.Types.ObjectId(),
          runId: reportId,
          rows: pageRows,
          pageHash: sha256CanonicalLandscape(pageRows),
        });
      }
      return { reportId: reportId.toHexString(), manifest };
    };

    const nullManifest = await cloneReport('null-manifest');
    const missingOpportunity = await cloneReport('missing-opportunity');
    const mismatch = await cloneReport('mismatch');
    const validMissing = await cloneReport('valid-missing');
    const validEmpty = await cloneReport('valid-empty');
    const acceptedAt = new Date('2026-08-09T12:34:56.000Z');
    const rows = [
      { reportId: 'invalid-report', opportunityId: 'invalid', actionId: 'a'.repeat(64) },
      {
        reportId: new mongoose.Types.ObjectId().toHexString(),
        opportunityId: 'missing-run',
        actionId: 'b'.repeat(64),
      },
      {
        reportId: nullManifest.reportId,
        opportunityId: seed.opportunityId,
        actionId: 'c'.repeat(64),
      },
      {
        reportId: missingOpportunity.reportId,
        opportunityId: 'landscape-opportunity-absent',
        actionId: 'd'.repeat(64),
      },
      {
        reportId: mismatch.reportId,
        opportunityId: seed.opportunityId,
        actionId: 'e'.repeat(64),
      },
      {
        reportId: validMissing.reportId,
        opportunityId: seed.opportunityId,
        actionId: hashActionId({
          accountId: seed.accountId,
          siteId: seed.siteId,
          sourceType: 'competitor_opportunity',
          sourceId: `${validMissing.reportId}:${seed.opportunityId}`,
        }),
      },
      {
        reportId: validEmpty.reportId,
        opportunityId: seed.opportunityId,
        actionId: hashActionId({
          accountId: seed.accountId,
          siteId: seed.siteId,
          sourceType: 'competitor_opportunity',
          sourceId: `${validEmpty.reportId}:${seed.opportunityId}`,
        }),
      },
    ];
    for (const [index, row] of rows.entries()) {
      await getTestDb().insert(landscapeOpportunityAcceptances).values({
        accountId: seed.accountId,
        siteId: seed.siteId,
        ...row,
        acceptedByUserId: seed.accountId,
        idempotencyKey: `adapter-row-${index}`,
        acceptedAt,
      });
    }
    const result = await competitorOpportunityActionAdapter({
      accountId: seed.accountId,
      siteId: seed.siteId,
      db: getTestDb(),
    });
    expect(result.actions).toHaveLength(2);
    const missingAction = result.actions.find((action) => action.sourceId.startsWith(validMissing.reportId));
    expect(missingAction).toMatchObject({
      sourceId: `${validMissing.reportId}:${seed.opportunityId}`,
      affectedUrls: [],
      evidence: [{ sourceRef: templatePage!.rows[0]!.id }],
      firstPartyImpact: 'none',
      effort: 'high',
      lastVerifiedAt: acceptedAt.toISOString(),
    });
    expect(missingAction!.evidence[0]).not.toHaveProperty('url');
  });
});
