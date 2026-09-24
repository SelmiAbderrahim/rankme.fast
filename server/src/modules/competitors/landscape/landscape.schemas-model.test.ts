import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../../shared/testing/mongo.js';
import {
  canonicalLandscapeJson,
  landscapeContentHash,
} from './landscape.canonical.js';
import {
  CompetitorLandscapeReportPage,
  CompetitorLandscapeRun,
  landscapeModelTestables,
} from './landscape.model.js';
import {
  LANDSCAPE_MAX_ROWS,
  landscapeCheckpointSchema,
  landscapeFindingSchema,
  landscapeReportManifestSchema,
  landscapeReportPageSchema,
  landscapeStartInputSchema,
  normalizedLandscapeRowSchema,
} from './landscape.schemas.js';

const PROFILE = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = new Types.ObjectId();
const SITE = new Types.ObjectId();

function normalizedRow(overrides: Record<string, unknown> = {}) {
  return {
    keyword: 'technical seo',
    normalizedKeyword: 'technical seo',
    ownedPosition: 8,
    competitorPosition: 3,
    ownedRankAbsolute: 8,
    competitorRankAbsolute: 3,
    ownedUrl: 'https://example.com/technical-seo',
    competitorUrl: 'https://competitor.test/technical-seo',
    searchVolume: 500,
    keywordDifficulty: 42,
    intent: 'commercial',
    ...overrides,
  };
}

function reportRow(overrides: Record<string, unknown> = {}) {
  return {
    ...normalizedRow(),
    id: 'row-1',
    class: 'shared_behind',
    competitorProfileId: PROFILE,
    competitorDomain: 'competitor.test',
    positionDelta: 5,
    competitorCoverage: 1,
    provenanceIndexes: [0],
    ...overrides,
  };
}

function run(overrides: Record<string, unknown> = {}) {
  const id = new Types.ObjectId();
  return {
    _id: id,
    accountId: ACCOUNT,
    siteId: SITE,
    requestedByUserId: String(ACCOUNT),
    ownedDomain: 'example.com',
    locale: 'en',
    state: 'completed',
    progress: { completedLegs: 3, totalLegs: 3, stage: 'completed' },
    market: {
      locationCode: 2840,
      languageCode: 'en',
      source: 'default',
      eligibleTrackedKeywords: 0,
    },
    competitors: [{ profileId: PROFILE, domain: 'competitor.test' }],
    idempotencyKey: 'idem-1',
    requestFingerprint: 'a'.repeat(64),
    queueJobId: `competitor-landscape-${String(id)}`,
    stageSummary: [
      { competitorProfileId: PROFILE, leg: 'shared', state: 'succeeded', returnedRows: 1 },
      { competitorProfileId: PROFILE, leg: 'owned_only', state: 'succeeded', returnedRows: 0 },
      { competitorProfileId: PROFILE, leg: 'competitor_only', state: 'succeeded', returnedRows: 0 },
    ],
    reportManifest: null,
    contentHash: null,
    reportVersion: 1,
    completedAt: new Date(),
    ...overrides,
  };
}

beforeAll(async () => {
  await startMemoryMongo();
  await CompetitorLandscapeRun.syncIndexes();
  await CompetitorLandscapeReportPage.syncIndexes();
});

afterAll(async () => {
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
});

describe('landscape schemas and immutable snapshots', () => {
  it('upgrades both legacy opportunity kinds and enforces bounded semantic vars', () => {
    const base = {
      id: 'legacy-opportunity',
      competitorProfileIds: [PROFILE],
      keywordKeys: ['technical seo'],
      evidenceRowIds: ['row-1'],
      confidence: 'high',
      labels: { evidence: 'observed', conclusion: 'derived', prose: 'generated' },
      title: 'Frozen title',
      recommendation: 'Frozen recommendation',
    } as const;
    expect(landscapeFindingSchema.parse({
      ...base,
      kind: 'missing_keyword',
    })).toMatchObject({
      titleKey: 'competitors.landscape.opportunities.missingTitle',
      recommendationKey: 'competitors.landscape.opportunities.missingRecommendation',
      titleVars: { count: 1 },
      recommendationVars: { count: 1 },
    });
    expect(landscapeFindingSchema.parse({
      ...base,
      kind: 'ranking_deficit',
    })).toMatchObject({
      titleKey: 'competitors.landscape.opportunities.behindTitle',
      recommendationKey: 'competitors.landscape.opportunities.behindRecommendation',
    });

    const semantic = {
      ...base,
      kind: 'missing_keyword' as const,
      titleKey: 'competitors.landscape.opportunities.missingTitle',
      recommendationKey: 'competitors.landscape.opportunities.missingRecommendation',
      titleVars: Object.fromEntries(
        Array.from({ length: 17 }, (_, index) => [`v${index}`, index]),
      ),
    };
    const { title: _title, recommendation: _recommendation, ...withoutLegacyCopy } = semantic;
    expect(landscapeFindingSchema.safeParse(withoutLegacyCopy).success).toBe(false);
  });

  it('enforces hostile input, row, profile, and 3,000-row boundaries', () => {
    expect(() =>
      landscapeStartInputSchema.parse({
        competitorProfileIds: Array.from({ length: 11 }, (_, index) =>
          `${String(index).padStart(8, '0')}-1111-4111-8111-111111111111`,
        ),
        locale: 'en',
        idempotencyKey: 'idem',
      }),
    ).toThrow();
    expect(() => normalizedLandscapeRowSchema.parse(normalizedRow({ keyword: '<script>x</script>' }))).toThrow();
    expect(() => normalizedLandscapeRowSchema.parse(normalizedRow({ keyword: 'x'.repeat(201) }))).toThrow();
    expect(() =>
      landscapeReportManifestSchema.parse({
        reportVersion: 1,
        schemaVersion: 'competitor-landscape/1',
        taxonomyVersion: '2026-08-08.1',
        ownedDomain: 'example.com',
        locale: 'en',
        market: { locationCode: 2840, languageCode: 'en', source: 'default', eligibleTrackedKeywords: 0 },
        competitors: [{ profileId: PROFILE, domain: 'competitor.test' }],
        coverage: {
          requestedCompetitors: 1,
          usableCompetitors: 1,
          requestedLegs: 3,
          succeededLegs: 3,
          failedLegs: 0,
          truncatedLegs: 0,
          unclassifiedSharedRows: 0,
          rowsByClass: { missing: 0, owned_only: 0, shared_behind: 0, shared_ahead: 0, shared_even: 0 },
        },
        provenance: [], warnings: [], errors: [], pageSuggestions: [], opportunities: [], sourceDates: [],
        pageCount: 30,
        rowCount: LANDSCAPE_MAX_ROWS + 1,
        completedAt: new Date().toISOString(),
      }),
    ).toThrow();
  });

  it('validates strict checkpoint/page DTOs and rejects raw HTML in Mongo pages', async () => {
    const checkpoint = {
      accountId: String(ACCOUNT), siteId: String(SITE), runId: String(new Types.ObjectId()),
      competitorProfileId: PROFILE, leg: 'shared', state: 'pending', attempt: 0,
      cache: 'miss', dispatchMarkedAt: null, safeErrorCode: null, provenance: null, rows: [],
    };
    expect(landscapeCheckpointSchema.parse(checkpoint)).toEqual(checkpoint);
    const page = {
      accountId: String(ACCOUNT), siteId: String(SITE), runId: String(new Types.ObjectId()),
      pageIndex: 0, rows: [reportRow()], rowCount: 1, pageHash: 'b'.repeat(64),
    };
    expect(landscapeReportPageSchema.parse(page).rowCount).toBe(1);
    await expect(
      CompetitorLandscapeReportPage.create({
        ...page,
        rows: [reportRow({ keyword: '<img src=x>' })],
      }),
    ).rejects.toThrow(/raw HTML|validation/i);
  });

  it('keeps terminal report identity immutable through saves and query updates', async () => {
    const saved = await CompetitorLandscapeRun.create(run());
    saved.ownedDomain = 'changed.example';
    await expect(saved.save()).rejects.toThrow(/immutable|validation/i);
    await expect(
      CompetitorLandscapeRun.updateOne(
        { _id: saved._id },
        { $set: { taxonomyVersion: 'changed' } },
      ),
    ).rejects.toThrow(/immutable/);
    await expect(
      CompetitorLandscapeRun.updateOne(
        { _id: saved._id },
        { $set: { expiresAt: new Date('2027-01-01T00:00:00.000Z') } },
      ),
    ).resolves.toMatchObject({ modifiedCount: 1 });
  });

  it('hashes the canonical manifest/page stream in page order with framing', () => {
    const first = landscapeContentHash({ b: 2, a: 1 }, [{ pageIndex: 0 }, { pageIndex: 1 }]);
    expect(first).toBe(landscapeContentHash({ a: 1, b: 2 }, [{ pageIndex: 0 }, { pageIndex: 1 }]));
    expect(first).not.toBe(landscapeContentHash({ a: 1, b: 2 }, [{ pageIndex: 1 }, { pageIndex: 0 }]));
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects unsupported canonical values and exhausts defensive model invariants', async () => {
    expect(canonicalLandscapeJson({ z: undefined, a: true })).toBe('{"a":true}');
    expect(() => canonicalLandscapeJson(Number.NaN)).toThrow(/non-finite/u);
    expect(() => canonicalLandscapeJson(undefined)).toThrow(/rejects undefined/u);
    expect(() =>
      landscapeModelTestables.assertDocumentBytes(
        'x'.repeat(2 * 1024 * 1024 + 1),
        'oversized',
      ),
    ).toThrow(/2 MiB/u);
    expect(() => landscapeModelTestables.assertNoRawHtml('<main>x</main>')).toThrow(
      /raw HTML/u,
    );
    expect(() =>
      landscapeModelTestables.assertNoRawHtml({ nested: ['plain', '<b>x</b>'] }),
    ).toThrow(/document\.nested\.1/u);
    expect(() => landscapeModelTestables.assertNoRawHtml({ safe: ['plain'] })).not.toThrow();

    expect([...landscapeModelTestables.changedTopLevelPaths(null)]).toEqual([]);
    expect([
      ...landscapeModelTestables.changedTopLevelPaths({
        $set: { 'progress.stage': 'failed' },
        $unset: null,
        ownedDomain: 'changed.example',
      }),
    ]).toEqual(['progress', 'ownedDomain']);
    expect(landscapeModelTestables.reportPageValidationErrors(1, true, true)).toEqual(
      [],
    );
    expect(
      landscapeModelTestables.reportPageValidationErrors(
        LANDSCAPE_MAX_ROWS + 1,
        false,
        true,
      ),
    ).toEqual([
      'report row ceiling exceeded',
      'published report pages are immutable',
    ]);
    expect(
      landscapeModelTestables.reportPageValidationErrors(1, false, false),
    ).toEqual([]);
    const invalidations: Array<[string, string]> = [];
    landscapeModelTestables.applyReportPageValidation(
      LANDSCAPE_MAX_ROWS + 1,
      false,
      true,
      (path, error) => invalidations.push([path, error]),
    );
    expect(invalidations).toEqual([
      ['rows', 'report row ceiling exceeded'],
      ['rows', 'published report pages are immutable'],
    ]);

    await expect(
      CompetitorLandscapeRun.updateOne(
        { _id: new Types.ObjectId() },
        { $set: { taxonomyVersion: 'changed' } },
      ),
    ).resolves.toMatchObject({ matchedCount: 0 });
    const savedRun = await CompetitorLandscapeRun.create(run());
    await expect(
      CompetitorLandscapeRun.replaceOne(
        { _id: savedRun._id },
        run({ _id: savedRun._id, ownedDomain: 'changed.example' }),
      ),
    ).rejects.toThrow(/immutable/u);

    const page = await CompetitorLandscapeReportPage.create({
      accountId: ACCOUNT,
      siteId: SITE,
      runId: savedRun._id,
      pageIndex: 0,
      rows: [reportRow()],
      rowCount: 1,
      pageHash: 'c'.repeat(64),
    });
    page.rowCount = 2;
    await expect(page.save()).rejects.toThrow(
      /immutable|validation|rowCount must match rows length/iu,
    );
    await expect(
      CompetitorLandscapeReportPage.updateOne(
        { _id: page._id },
        { $set: { rowCount: 2 } },
      ),
    ).rejects.toThrow(/immutable/u);
  });
});
