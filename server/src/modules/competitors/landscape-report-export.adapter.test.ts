import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db as database } from '../../db/client.js';
import type { ReportBrandingSnapshot } from '../../shared/report-exports/index.js';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import { Site } from '../sites/sites.model.js';
import {
  competitorLandscapeReportExportTestables as internals,
  createCompetitorLandscapeReportExportAdapter,
} from './landscape-report-export.adapter.js';
import { localizeLandscapeManifest } from './landscape/landscape.copy.js';
import { getLandscapeRun } from './landscape/landscape.repository.js';
import type {
  LandscapeReportManifest,
  LandscapeReportRow,
} from './landscape/landscape.schemas.js';

vi.mock('./landscape/landscape.repository.js', () => ({ getLandscapeRun: vi.fn() }));

const accountId = '507f1f77bcf86cd799439010';
const actorUserId = '507f1f77bcf86cd799439014';
const siteId = '507f1f77bcf86cd799439011';
const runId = '507f1f77bcf86cd799439012';
const profileA = '11111111-1111-4111-8111-111111111111';
const profileB = '22222222-2222-4222-8222-222222222222';
const profileC = '33333333-3333-4333-8333-333333333333';
const completedAt = '2026-08-08T12:00:00.000Z';
const branding: ReportBrandingSnapshot = {
  mode: 'rankmefast', companyName: 'RankMeFast', accentColor: '#b5321e', logo: null,
};
function row(input: Partial<LandscapeReportRow> & Pick<LandscapeReportRow, 'id' | 'class' | 'competitorProfileId' | 'competitorDomain'>): LandscapeReportRow {
  return {
    keyword: input.id,
    normalizedKeyword: input.id,
    ownedPosition: 10,
    competitorPosition: 3,
    ownedRankAbsolute: 11,
    competitorRankAbsolute: 4,
    ownedUrl: 'https://owned.test/page',
    competitorUrl: `https://${input.competitorDomain}/page`,
    searchVolume: 100,
    keywordDifficulty: 40,
    intent: 'commercial',
    positionDelta: 7,
    competitorCoverage: 1,
    provenanceIndexes: [0],
    ...input,
  };
}

function defaultRows(): LandscapeReportRow[] {
  return [
    row({ id: 'alpha-key', class: 'missing', competitorProfileId: profileA, competitorDomain: 'alpha.test', competitorCoverage: 2, provenanceIndexes: [0, 99] }),
    row({ id: 'beta-key', class: 'missing', competitorProfileId: profileB, competitorDomain: 'beta.test', searchVolume: null, positionDelta: null, provenanceIndexes: [1] }),
    row({ id: 'behind-key', class: 'shared_behind', competitorProfileId: profileA, competitorDomain: 'alpha.test', searchVolume: 50, positionDelta: 4, provenanceIndexes: [2] }),
    row({ id: 'even-key', class: 'shared_even', competitorProfileId: profileB, competitorDomain: 'beta.test', searchVolume: 20, positionDelta: 0, provenanceIndexes: [] }),
    row({ id: 'ahead-key', class: 'shared_ahead', competitorProfileId: profileC, competitorDomain: 'gamma.test', searchVolume: 10, positionDelta: -4, provenanceIndexes: [3] }),
    row({ id: 'owned-key', class: 'owned_only', competitorProfileId: profileC, competitorDomain: 'gamma.test', competitorPosition: null, competitorUrl: null, provenanceIndexes: [3] }),
  ];
}

type TestManifest = ReturnType<typeof localizeLandscapeManifest> & {
  opportunities: Array<ReturnType<typeof localizeLandscapeManifest>['opportunities'][number] & { acceptedActionId?: string | null }>;
  pageSuggestions: Array<LandscapeReportManifest['pageSuggestions'][number] & {
    review?: { state: 'unreviewed' | 'approved' | 'rejected'; ownedUrl: string | null; competitorUrl: string | null; reviewedAt: string | null };
  }>;
};

function storedManifest(): LandscapeReportManifest & {
  opportunities: Array<LandscapeReportManifest['opportunities'][number] & { acceptedActionId?: string | null }>;
  pageSuggestions: Array<LandscapeReportManifest['pageSuggestions'][number] & {
    review?: { state: 'unreviewed' | 'approved' | 'rejected'; ownedUrl: string | null; competitorUrl: string | null; reviewedAt: string | null };
  }>;
} {
  return {
    reportVersion: 1,
    schemaVersion: 'competitor-landscape/1',
    taxonomyVersion: '2026-08-08.1',
    ownedDomain: 'owned.test',
    locale: 'en',
    market: { locationCode: 2840, languageCode: 'en', source: 'default', eligibleTrackedKeywords: 0 },
    competitors: [
      { profileId: profileA, domain: 'alpha.test' },
      { profileId: profileB, domain: 'beta.test' },
      { profileId: profileC, domain: 'gamma.test' },
    ],
    coverage: {
      requestedCompetitors: 3,
      usableCompetitors: 2,
      requestedLegs: 9,
      succeededLegs: 6,
      failedLegs: 3,
      truncatedLegs: 1,
      unclassifiedSharedRows: 0,
      rowsByClass: { missing: 2, owned_only: 1, shared_behind: 1, shared_ahead: 1, shared_even: 1 },
    },
    provenance: [
      { provider: 'dataforseo', operation: 'domain_intersection_live', leg: 'shared', intersections: true, targetOrder: 'owned_competitor', itemTypes: ['organic'], limit: 100, cache: 'hit', status: 'success', capturedAt: '2026-08-07T00:00:00.000Z', returnedRows: 2, truncated: false },
      { provider: 'dataforseo', operation: 'domain_intersection_live', leg: 'owned_only', intersections: false, targetOrder: 'owned_competitor', itemTypes: ['organic'], limit: 100, cache: 'miss', status: 'timeout', capturedAt: null, returnedRows: 0, truncated: false },
      { provider: 'dataforseo', operation: 'domain_intersection_live', leg: 'competitor_only', intersections: false, targetOrder: 'competitor_owned', itemTypes: ['organic'], limit: 100, cache: 'miss', status: 'success', capturedAt: '2026-08-08T00:00:00.000Z', returnedRows: 1, truncated: true },
      { provider: 'dataforseo', operation: 'domain_intersection_live', leg: 'shared', intersections: true, targetOrder: 'owned_competitor', itemTypes: ['organic'], limit: 100, cache: 'miss', status: 'failed', capturedAt: '2026-08-06T00:00:00.000Z', returnedRows: 0, truncated: false },
    ],
    warnings: [
      { code: 'LEG_TIMEOUT', competitorProfileId: profileB, leg: 'shared', count: 1 },
      { code: 'LEG_TIMEOUT', competitorProfileId: profileA, leg: 'owned_only', count: 1 },
      { code: 'LEG_FAILED', competitorProfileId: null, leg: null, count: 1 },
    ],
    errors: [
      { code: 'Z_ERROR', competitorProfileId: profileB, leg: 'shared', retryable: true },
      { code: 'A_ERROR', competitorProfileId: profileA, leg: null, retryable: false },
      { code: 'GLOBAL', competitorProfileId: null, leg: null, retryable: false },
    ],
    pageSuggestions: [
      { id: 'suggestion-b', competitorProfileId: profileB, ownedUrl: 'https://owned.test/b', competitorUrl: 'https://beta.test/b', keywordKeys: ['beta-key'], reasonCode: 'same_keyword', confidence: 'medium', rubricVersion: '2026-08-08.1' },
      {
        id: 'suggestion-a', competitorProfileId: profileA, ownedUrl: 'https://owned.test/a', competitorUrl: 'https://alpha.test/a', keywordKeys: ['alpha-key', 'alpha-key'], reasonCode: 'closest_rank', confidence: 'high', rubricVersion: '2026-08-08.1',
        review: { state: 'approved', ownedUrl: 'https://owned.test/reviewed', competitorUrl: 'https://alpha.test/reviewed', reviewedAt: '2026-08-09T00:00:00.000Z' },
      },
      { id: 'suggestion-c', competitorProfileId: profileC, ownedUrl: 'https://owned.test/c', competitorUrl: 'https://gamma.test/c', keywordKeys: ['gamma-key'], reasonCode: 'highest_coverage', confidence: 'low', rubricVersion: '2026-08-08.1' },
    ],
    opportunities: [
      { id: 'op-z', kind: 'missing_keyword', titleKey: 'competitors.landscape.opportunities.missingTitle', titleVars: { count: 1 }, recommendationKey: 'competitors.landscape.opportunities.missingRecommendation', recommendationVars: { count: 1 }, competitorProfileIds: [profileA], keywordKeys: ['alpha-key'], evidenceRowIds: ['alpha-key'], confidence: 'low', labels: { evidence: 'observed', conclusion: 'derived', prose: 'generated' }, acceptedActionId: 'action-z' },
      { id: 'op-a', kind: 'missing_keyword', titleKey: 'competitors.landscape.opportunities.missingTitle', titleVars: { count: 1 }, recommendationKey: 'competitors.landscape.opportunities.missingRecommendation', recommendationVars: { count: 1 }, competitorProfileIds: [profileB], keywordKeys: ['beta-key'], evidenceRowIds: ['beta-key'], confidence: 'high', labels: { evidence: 'observed', conclusion: 'derived', prose: 'generated' }, acceptedActionId: null },
      { id: 'op-b', kind: 'ranking_deficit', titleKey: 'competitors.landscape.opportunities.behindTitle', titleVars: { count: 1 }, recommendationKey: 'competitors.landscape.opportunities.behindRecommendation', recommendationVars: { count: 1, url: 'https://owned.test/page' }, competitorProfileIds: [profileA, profileB], keywordKeys: ['behind-key'], evidenceRowIds: ['behind-key'], confidence: 'medium', labels: { evidence: 'observed', conclusion: 'derived', prose: 'generated' } },
    ],
    sourceDates: [
      { competitorProfileId: profileA, leg: 'shared', capturedAt: '2026-08-07T00:00:00.000Z' },
      { competitorProfileId: profileB, leg: 'owned_only', capturedAt: null },
      { competitorProfileId: profileC, leg: 'competitor_only', capturedAt: '2026-08-08T00:00:00.000Z' },
    ],
    pageCount: 1,
    rowCount: 6,
    completedAt,
  };
}

function manifest(): TestManifest {
  return localizeLandscapeManifest(storedManifest(), 'en', defaultRows()) as TestManifest;
}

function detail(input: { manifest?: ReturnType<typeof manifest> | null; rows?: LandscapeReportRow[] } = {}): Awaited<ReturnType<typeof getLandscapeRun>> {
  return {
    run: {
      id: runId,
      siteId,
      state: 'partial',
      ownedDomain: 'owned.test',
      locale: 'en',
      market: { locationCode: 2840, languageCode: 'en', source: 'default' },
      competitors: [{ profileId: profileA, domain: 'alpha.test' }],
      progress: { completedLegs: 6, totalLegs: 9, stage: 'partial' },
      reportVersion: 1,
      schemaVersion: 'competitor-landscape/1',
      taxonomyVersion: '2026-08-08.1',
      createdAt: '2026-08-01T00:00:00.000Z',
      startedAt: '2026-08-01T00:01:00.000Z',
      completedAt,
    },
    manifest: input.manifest === undefined ? manifest() : input.manifest,
    rows: input.rows ?? defaultRows(),
    nextCursor: null,
  };
}

function access(
  purpose: 'create' | 'persist' = 'create',
  locale: 'en' | 'ar' = 'en',
) {
  return {
    accountId,
    actorUserId,
    purpose,
    target: { scope: 'site_resource' as const, siteId, resourceId: runId },
    format: 'json' as const,
    locale,
  };
}

type LandscapeSelection = {
  accepted: 'accepted' | 'unaccepted' | 'all';
  class?: LandscapeReportRow['class'][];
  competitor?: string[];
  query?: string;
  opportunity?: string[];
};

function compose(selection: LandscapeSelection, format: 'pdf' | 'csv' | 'json' = 'json') {
  return { ...access(), format, selection, branding };
}

beforeAll(startMemoryMongo);
afterAll(stopMemoryMongo);

beforeEach(async () => {
  await clearCollections();
  await Site.create({
    _id: siteId,
    accountId,
    url: 'https://owned.test',
    domain: 'owned.test',
    displayName: 'Owned',
  });
  vi.mocked(getLandscapeRun).mockReset();
  vi.mocked(getLandscapeRun).mockResolvedValue(detail());
});

describe('competitor landscape report-export helpers', () => {
  it('deduplicates, bounds, and compares nullable values and canonical rows', () => {
    expect(internals.uniqueSorted(['beta', 'alpha', 'alpha'])).toEqual(['alpha', 'beta']);
    expect(internals.boundedList(['beta', 'alpha'])).toBe('alpha, beta');
    expect(internals.boundedList(['x'.repeat(901), 'a'])).toMatch(/^2; landscape-selection:/u);
    expect(internals.compareNullableDescending(null, null)).toBe(0);
    expect(internals.compareNullableDescending(null, 1)).toBe(1);
    expect(internals.compareNullableDescending(1, null)).toBe(-1);
    expect(internals.compareNullableDescending(2, 1)).toBe(-1);

    const base = row({ id: 'base', class: 'missing', competitorProfileId: profileA, competitorDomain: 'alpha.test' });
    expect(internals.compareRows(base, { ...base, class: 'owned_only' })).toBeLessThan(0);
    expect(internals.compareRows({ ...base, competitorCoverage: 2 }, base)).toBeLessThan(0);
    expect(internals.compareRows({ ...base, searchVolume: 200 }, base)).toBeLessThan(0);
    expect(internals.compareRows({ ...base, positionDelta: 8 }, base)).toBeLessThan(0);
    expect(internals.compareRows(base, { ...base, normalizedKeyword: 'zeta' })).toBeLessThan(0);
  });

  it('reads acceptance/review overlays and confidence/action summaries', () => {
    const value = manifest();
    expect(internals.acceptedActionId(value.opportunities[0]!)).toBe('action-z');
    expect(internals.acceptedActionId(value.opportunities[1]!)).toBeNull();
    expect(internals.suggestionReview(value.pageSuggestions[0]!)).toEqual({ state: 'unreviewed', ownedUrl: null, competitorUrl: null, reviewedAt: null });
    expect(internals.suggestionReview(value.pageSuggestions[1]!)).toMatchObject({ state: 'approved' });
    expect(internals.highestConfidence([])).toBeNull();
    expect(internals.highestConfidence(value.opportunities)).toBe('high');
    expect(internals.highestConfidence([value.opportunities[1]!, value.opportunities[0]!])).toBe('high');
    expect(internals.actionState([])).toBe('not_applicable');
    expect(internals.actionState([value.opportunities[1]!])).toBe('unaccepted');
    expect(internals.actionState([value.opportunities[0]!])).toBe('accepted');
  });

  it('selects and orders requested, accepted, and unaccepted opportunities', () => {
    const value = manifest();
    expect(internals.selectedOpportunities(value, { accepted: 'all' }).map((item) => item.id)).toEqual(['op-a', 'op-z', 'op-b']);
    expect(internals.selectedOpportunities(value, { accepted: 'accepted' }).map((item) => item.id)).toEqual(['op-z']);
    expect(internals.selectedOpportunities(value, { accepted: 'unaccepted' }).map((item) => item.id)).toEqual(['op-a', 'op-b']);
    expect(internals.selectedOpportunities(value, { accepted: 'all', opportunity: ['op-b'] }).map((item) => item.id)).toEqual(['op-b']);
  });

  it('applies every canonical tie-breaker for opportunities, suggestions, and warnings', () => {
    const value = manifest();
    const opportunity = value.opportunities[0]!;
    expect(internals.compareOpportunities(opportunity, { ...opportunity, kind: 'ranking_deficit' })).not.toBe(0);
    expect(internals.compareOpportunities(opportunity, { ...opportunity, title: 'Another title' })).toBe(0);
    expect(internals.compareOpportunities(opportunity, { ...opportunity, id: 'another-id' })).not.toBe(0);
    expect(internals.compareOpportunities(opportunity, opportunity)).toBe(0);

    const suggestion = value.pageSuggestions[0]!;
    expect(internals.compareSuggestions(value, suggestion, value.pageSuggestions[1]!)).not.toBe(0);
    expect(internals.compareSuggestions(value, suggestion, { ...suggestion, competitorUrl: 'https://beta.test/another' })).not.toBe(0);
    expect(internals.compareSuggestions(value, suggestion, { ...suggestion, ownedUrl: 'https://owned.test/another' })).not.toBe(0);
    expect(internals.compareSuggestions(value, suggestion, suggestion)).toBe(0);

    const warning = value.warnings[0]!;
    expect(internals.compareWarnings(value, warning, { ...warning, code: 'LEG_MALFORMED' })).not.toBe(0);
    expect(internals.compareWarnings(value, warning, { ...warning, leg: 'owned_only' })).not.toBe(0);
    expect(internals.compareWarnings(value, warning, { ...warning, competitorProfileId: profileA })).not.toBe(0);
    expect(internals.compareWarnings(value, warning, warning)).toBe(0);
  });

  it('filters rows over every class/profile/domain/query/opportunity dimension', () => {
    const source = detail();
    const value = source.manifest!;
    expect(internals.filterRows(source, value, { accepted: 'all' }, value.opportunities)).toHaveLength(6);
    expect(internals.filterRows(source, value, { accepted: 'all', class: ['missing'] }, value.opportunities)).toHaveLength(2);
    expect(internals.filterRows(source, value, { accepted: 'all', competitor: [profileA] }, value.opportunities).every((item) => item.competitorProfileId === profileA)).toBe(true);
    expect(internals.filterRows(source, value, { accepted: 'all', competitor: ['beta.test'] }, value.opportunities).every((item) => item.competitorProfileId === profileB)).toBe(true);
    expect(internals.filterRows(source, value, { accepted: 'all', query: 'ALPHA' }, value.opportunities).map((item) => item.id)).toEqual(['alpha-key']);
    expect(internals.filterRows(source, value, { accepted: 'all', query: 'key' }, value.opportunities)).toHaveLength(6);
    expect(internals.filterRows(source, value, { accepted: 'all', opportunity: ['op-b'] }, [value.opportunities[2]!]).map((item) => item.id)).toEqual(['behind-key']);
    expect(internals.filterRows(source, value, { accepted: 'accepted' }, [value.opportunities[0]!]).map((item) => item.id)).toEqual(['alpha-key']);
  });

  it('resolves provenance, observation, and competitor fallbacks', () => {
    const value = manifest();
    expect(internals.sourceDateId(0, value)).toBe('landscape-observation-1');
    expect(internals.sourceDateId(1, value)).toBe('landscape-derived');
    expect(internals.sourceDateId(-1, value)).toBe('landscape-derived');
    expect(internals.observedAt(row({ id: 'observed', class: 'missing', competitorProfileId: profileA, competitorDomain: 'alpha.test', provenanceIndexes: [99, 0] }), value)).toBe('2026-08-07T00:00:00.000Z');
    expect(internals.observedAt(row({ id: 'none', class: 'missing', competitorProfileId: profileA, competitorDomain: 'alpha.test', provenanceIndexes: [99] }), value)).toBeNull();
    expect(internals.competitorDomain(value, null)).toBe('');
    expect(internals.competitorDomain(value, profileA)).toBe('alpha.test');
    expect(internals.competitorDomain(value, '44444444-4444-4444-8444-444444444444')).toBe('');
  });

  it('builds all row projections, source dates, and localized table columns', () => {
    const source = detail();
    const value = source.manifest!;
    const records = internals.landscapeRows({ manifest: value, rows: source.rows, opportunities: value.opportunities, selection: { accepted: 'all' } });
    expect(records.length).toBeGreaterThan(source.rows.length + 5);
    expect(JSON.stringify(records)).toContain('page_suggestion');
    expect(JSON.stringify(records)).toContain('partial_failure');
    expect(JSON.stringify(records)).toContain('provenance');
    expect(internals.landscapeRows({ manifest: value, rows: source.rows.filter((item) => item.competitorProfileId === profileA), opportunities: [], selection: { accepted: 'all', competitor: [profileA], query: 'alpha' } }).length).toBeGreaterThan(0);
    const dates = internals.sourceDates('en', value);
    expect(dates).toHaveLength(5);
    expect(dates.map((item) => item.freshness)).toEqual(expect.arrayContaining(['cached', 'fresh']));
    expect(internals.table('en', records)).toMatchObject({ type: 'table', columns: expect.any(Array) });
  });
});

describe('competitor landscape report-export adapter', () => {
  it('loads owned source, site label, and immutable version', async () => {
    const adapter = createCompetitorLandscapeReportExportAdapter(database);
    const source = await internals.loadSource(database, access());
    expect(source.siteLabel).toBe('Owned');
    expect(internals.sourceVersion(source)).toMatch(/^competitors\.landscape_run:/u);
    expect(vi.mocked(getLandscapeRun)).toHaveBeenCalledWith(expect.objectContaining({ pageLimit: 30, pageCursor: 0 }));
    await expect(adapter.assertAccess({ ...access('persist'), sourceVersion: 'stale' })).rejects.toMatchObject({ status: 409 });
    await expect(adapter.assertAccess(access())).resolves.toBeUndefined();
    await expect(adapter.assertAccess({ ...access(), target: { scope: 'site' as const, siteId } })).rejects.toMatchObject({ status: 404 });
    await Site.updateOne({ _id: siteId }, { $set: { displayName: '' } });
    expect((await internals.loadSource(database, access())).siteLabel).toBe('owned.test');
  });

  it('refuses missing manifests and oversized PDF row selections', async () => {
    const adapter = createCompetitorLandscapeReportExportAdapter(database);
    vi.mocked(getLandscapeRun).mockResolvedValue(detail({ manifest: null }));
    await expect(adapter.compose(compose({ accepted: 'all' }))).rejects.toMatchObject({ status: 404 });

    const template = detail().rows[0]!;
    const rows = Array.from({ length: 1_001 }, (_, index) => ({ ...template, id: `row-${index}`, keyword: `row ${index}`, normalizedKeyword: `row ${index}` }));
    vi.mocked(getLandscapeRun).mockResolvedValue(detail({ rows }));
    await expect(adapter.compose(compose({ accepted: 'all' }, 'pdf'))).rejects.toMatchObject({ status: 422, details: expect.objectContaining({ selectedKeywordRows: 1_001 }) });
    await expect(adapter.compose(compose({ accepted: 'all' }, 'csv'))).resolves.toMatchObject({ document: { completeness: { selectedItems: 1_001 } } });
  });

  it('composes filtered evidence and renders every advertised format', async () => {
    const adapter = createCompetitorLandscapeReportExportAdapter(database);
    const selection = adapter.selectionSchema.parse({ competitor: [profileA], accepted: 'all', class: ['missing', 'shared_behind'], query: 'key' });
    const result = await adapter.compose(compose(selection));
    expect(result.document.subject).toEqual(expect.arrayContaining([expect.objectContaining({ value: 'alpha.test' })]));
    expect(result.document.completeness.selectedItems).toBe(2);
    expect(result.document.blocks[0]).toMatchObject({ type: 'heading' });
    expect(JSON.stringify(result.document.blocks)).toContain('Warnings');
    for (const format of adapter.supportedFormats) {
      await expect(adapter.render({ document: result.document, format, snapshotCreatedAt: completedAt })).resolves.toMatchObject({ format });
    }
    expect(adapter.selectionSchema.parse({})).toEqual({ accepted: 'all' });
    expect(adapter.selectionSchema.safeParse({ accepted: 'bad' }).success).toBe(false);
  });

  it('reconstructs opportunity copy in the frozen artifact locale', async () => {
    vi.mocked(getLandscapeRun).mockImplementation(async (input) => detail({
      manifest: localizeLandscapeManifest(
        storedManifest(),
        input.locale ?? 'en',
        defaultRows(),
      ) as TestManifest,
    }));
    const adapter = createCompetitorLandscapeReportExportAdapter(database);
    const context = {
      ...compose({ accepted: 'all' }),
      locale: 'ar' as const,
    };
    const result = await adapter.compose(context);
    const serialized = JSON.stringify(result.document);

    expect(result.document.locale).toBe('ar');
    expect(serialized).toContain('أنشئ محتوى');
    expect(serialized).not.toContain('competitors.landscape.opportunities.');
    expect(getLandscapeRun).toHaveBeenCalledWith(expect.objectContaining({ locale: 'ar' }));
  });

  it('omits the coverage warning for a fully successful manifest', async () => {
    const successful = manifest();
    successful.coverage.failedLegs = 0;
    vi.mocked(getLandscapeRun).mockResolvedValue(detail({ manifest: successful }));
    const adapter = createCompetitorLandscapeReportExportAdapter(database);
    const result = await adapter.compose(compose({ accepted: 'all' }));
    expect(result.document.blocks.filter((block) => block.type === 'source_note').every((block) => block.coverageWarning === undefined)).toBe(true);
  });
});
