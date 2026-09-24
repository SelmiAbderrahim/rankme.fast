import { describe, expect, it } from 'vitest';
import {
  aggregateLandscape,
  classifyLandscapeRow,
  compareLandscapeObservations,
  normalizeLandscapeKeyword,
  normalizeLandscapeLegRows,
  type LandscapeAggregationCheckpoint,
} from './landscape.aggregate.js';
import type {
  LandscapeLeg,
  NormalizedLandscapeRow,
} from './landscape.schemas.js';

const PROFILE_A = '11111111-1111-4111-8111-111111111111';
const PROFILE_B = '22222222-2222-4222-8222-222222222222';
const CAPTURED_AT = '2026-08-09T10:00:00.000Z';

function row(
  keyword: string,
  overrides: Partial<NormalizedLandscapeRow> = {},
): NormalizedLandscapeRow {
  return {
    keyword,
    normalizedKeyword: normalizeLandscapeKeyword(keyword),
    ownedPosition: 8,
    competitorPosition: 3,
    ownedRankAbsolute: 9,
    competitorRankAbsolute: 4,
    ownedUrl: 'https://owned.example/page',
    competitorUrl: 'https://rival.example/page',
    searchVolume: 500,
    keywordDifficulty: 40,
    intent: 'commercial',
    ...overrides,
  };
}

function checkpoint(
  competitorProfileId: string,
  leg: LandscapeLeg,
  rows: NormalizedLandscapeRow[],
  state: 'succeeded' | 'failed' = 'succeeded',
): LandscapeAggregationCheckpoint {
  return {
    competitorProfileId,
    leg,
    state,
    safeErrorCode: state === 'failed' ? 'TIMEOUT' : null,
    provenance:
      state === 'failed'
        ? null
        : {
            provider: 'dataforseo',
            operation: 'domain_intersection_live',
            leg,
            intersections: leg === 'shared',
            targetOrder:
              leg === 'competitor_only'
                ? 'competitor_owned'
                : 'owned_competitor',
            itemTypes: ['organic'],
            limit: 100,
            cache: 'miss',
            status: 'success',
            capturedAt: CAPTURED_AT,
            returnedRows: rows.length,
            truncated: false,
          },
    rows,
  };
}

function aggregate(checkpoints: LandscapeAggregationCheckpoint[]) {
  return aggregateLandscape({
    ownedDomain: 'owned.example',
    locale: 'en',
    market: {
      locationCode: 2840,
      languageCode: 'en',
      source: 'default',
      eligibleTrackedKeywords: 0,
    },
    competitors: [
      { profileId: PROFILE_B, domain: 'second.example' },
      { profileId: PROFILE_A, domain: 'rival.example' },
    ],
    checkpoints,
    completedAt: new Date('2026-08-09T11:00:00.000Z'),
  });
}

describe('landscape taxonomy and aggregation', () => {
  it('classifies the exact five public classes and excludes unknown shared positions', () => {
    expect(classifyLandscapeRow(row('missing', { ownedPosition: null }), 'competitor_only')).toBe('missing');
    expect(classifyLandscapeRow(row('owned', { competitorPosition: null }), 'owned_only')).toBe('owned_only');
    expect(classifyLandscapeRow(row('behind'), 'shared')).toBe('shared_behind');
    expect(classifyLandscapeRow(row('ahead', { ownedPosition: 2, competitorPosition: 8 }), 'shared')).toBe('shared_ahead');
    expect(classifyLandscapeRow(row('tie', { ownedPosition: 4, competitorPosition: 4 }), 'shared')).toBe('shared_even');
    expect(classifyLandscapeRow(row('unknown', { ownedPosition: null }), 'shared')).toBeNull();
  });

  it('normalizes case/spacing variants and picks one whole deterministic duplicate', () => {
    const normalized = normalizeLandscapeLegRows(
      [
        row('  SEO   Audit ', { ownedPosition: 9, searchVolume: 999 }),
        row('seo audit', { ownedPosition: 2, searchVolume: null }),
      ],
      'shared',
    );
    expect(normalized.duplicateKeys).toBe(1);
    expect(normalized.rows).toHaveLength(1);
    expect(normalized.rows[0]).toMatchObject({
      normalizedKeyword: 'seo audit',
      keyword: '  SEO   Audit ',
      ownedPosition: 2,
      searchVolume: null,
    });
  });

  it('exhausts the duplicate comparator null and tie-break rubric', () => {
    const base = row('same');
    const comparisons: Array<[NormalizedLandscapeRow, NormalizedLandscapeRow, LandscapeLeg]> = [
      [row('a', { competitorPosition: null }), row('b', { competitorPosition: null }), 'competitor_only'],
      [row('a', { competitorPosition: null }), base, 'competitor_only'],
      [base, row('a', { competitorPosition: null }), 'competitor_only'],
      [row('a', { competitorUrl: null }), row('b', { competitorUrl: null }), 'competitor_only'],
      [row('a', { competitorUrl: null }), base, 'competitor_only'],
      [base, row('a', { competitorUrl: null }), 'competitor_only'],
      [row('a', { searchVolume: null }), row('b', { searchVolume: null }), 'shared'],
      [row('a', { searchVolume: null }), base, 'shared'],
      [base, row('a', { searchVolume: null }), 'shared'],
      [row('a', { keywordDifficulty: null }), row('b', { keywordDifficulty: null }), 'shared'],
      [row('a', { keywordDifficulty: null }), base, 'shared'],
      [base, row('a', { keywordDifficulty: null }), 'shared'],
      [row('a', { intent: null }), row('b', { intent: null }), 'shared'],
      [row('a', { intent: null }), base, 'shared'],
      [base, row('a', { intent: null }), 'shared'],
      [row('a'), row('b'), 'shared'],
      [base, base, 'shared'],
      [row('a', { ownedUrl: null }), row('b', { ownedUrl: null }), 'owned_only'],
    ];
    for (const [left, right, leg] of comparisons) {
      expect(Number.isFinite(compareLandscapeObservations(left, right, leg))).toBe(true);
    }
    expect(normalizeLandscapeLegRows([
      row(' '),
      row('x'.repeat(201)),
      row('z'),
      row('a'),
    ], 'competitor_only').rows.map((item) => item.keyword)).toEqual(['a', 'z']);
    expect(classifyLandscapeRow(row('invalid'), 'competitor_only')).toBeNull();
    expect(classifyLandscapeRow(row('invalid'), 'owned_only')).toBeNull();
    expect(classifyLandscapeRow(row('unknown', { competitorPosition: null }), 'shared')).toBeNull();
  });

  it('orders every class stably, computes portfolio coverage, and preserves nulls', () => {
    const result = aggregate([
      checkpoint(PROFILE_A, 'shared', [
        row('behind'),
        row('even', { ownedPosition: 4, competitorPosition: 4, searchVolume: null }),
        row('ahead', { ownedPosition: 2, competitorPosition: 8 }),
        row('unknown shared', { ownedPosition: null }),
      ]),
      checkpoint(PROFILE_A, 'owned_only', [
        row('owned', { competitorPosition: null, competitorUrl: null }),
        row('behind', { competitorPosition: null, competitorUrl: null }),
      ]),
      checkpoint(PROFILE_A, 'competitor_only', [
        row('missing', { ownedPosition: null, ownedUrl: null, searchVolume: null }),
      ]),
      checkpoint(PROFILE_B, 'shared', [row('behind', { searchVolume: 100 })]),
      checkpoint(PROFILE_B, 'owned_only', []),
      checkpoint(PROFILE_B, 'competitor_only', [
        row('missing', {
          ownedPosition: null,
          ownedUrl: null,
          competitorUrl: null,
          searchVolume: null,
          keywordDifficulty: null,
          intent: null,
        }),
      ]),
    ]);

    expect(result.rows.map((item) => item.class)).toEqual([
      'missing',
      'missing',
      'shared_behind',
      'shared_behind',
      'shared_even',
      'shared_ahead',
      'owned_only',
    ]);
    expect(result.rows.filter((item) => item.normalizedKeyword === 'behind'))
      .toHaveLength(2);
    expect(result.rows.find((item) => item.normalizedKeyword === 'behind'))
      .toMatchObject({ competitorCoverage: 2 });
    expect(result.manifest.coverage.unclassifiedSharedRows).toBe(1);
    expect(result.manifest.warnings).toContainEqual({
      code: 'SHARED_POSITION_MISSING',
      competitorProfileId: null,
      leg: 'shared',
      count: 1,
    });
    const nullRow = result.rows.find(
      (item) => item.class === 'missing' && item.competitorProfileId === PROFILE_B,
    );
    expect(nullRow).toMatchObject({
      ownedUrl: null,
      competitorUrl: null,
      searchVolume: null,
      keywordDifficulty: null,
      intent: null,
    });
  });

  it('builds only evidence-backed page matches and bounded missing/behind actions', () => {
    const result = aggregate([
      checkpoint(PROFILE_A, 'shared', [
        row('behind one'),
        row('behind two', { searchVolume: 1_000 }),
        row('ahead strength', { ownedPosition: 1, competitorPosition: 9 }),
      ]),
      checkpoint(PROFILE_A, 'owned_only', [
        row('owned strength', { competitorPosition: null, competitorUrl: null }),
      ]),
      checkpoint(PROFILE_A, 'competitor_only', [
        row('missing no page', { ownedPosition: null, ownedUrl: null, competitorUrl: null }),
        row('missing page', {
          ownedPosition: null,
          ownedUrl: null,
          competitorUrl: 'https://rival.example/missing',
        }),
      ]),
      checkpoint(PROFILE_B, 'shared', []),
      checkpoint(PROFILE_B, 'owned_only', []),
      checkpoint(PROFILE_B, 'competitor_only', []),
    ]);

    expect(result.manifest.pageSuggestions).toHaveLength(1);
    expect(result.manifest.pageSuggestions[0]).toMatchObject({
      ownedUrl: 'https://owned.example/page',
      competitorUrl: 'https://rival.example/page',
      confidence: 'high',
    });
    expect(result.manifest.pageSuggestions.every((item) => item.ownedUrl !== 'https://owned.example/')).toBe(true);
    expect(result.manifest.opportunities.map((item) => item.kind).sort()).toEqual([
      'missing_keyword',
      'ranking_deficit',
    ]);
    expect(result.manifest.opportunities.flatMap((item) => item.evidenceRowIds).length).toBeGreaterThan(0);
    expect(result.manifest.opportunities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          titleKey: 'competitors.landscape.opportunities.missingTitle',
          recommendationKey: 'competitors.landscape.opportunities.missingRecommendation',
        }),
        expect.objectContaining({
          titleKey: 'competitors.landscape.opportunities.behindTitle',
          recommendationKey: 'competitors.landscape.opportunities.behindRecommendation',
        }),
      ]),
    );
    expect(
      result.manifest.opportunities.every(
        (item) => !('title' in item) && !('recommendation' in item),
      ),
    ).toBe(true);
  });

  it('retains useful partial output and is byte-stable across reruns', () => {
    const checkpoints = [
      checkpoint(PROFILE_A, 'shared', [row('behind')]),
      checkpoint(PROFILE_A, 'owned_only', [], 'failed'),
      checkpoint(PROFILE_A, 'competitor_only', []),
      checkpoint(PROFILE_B, 'shared', [], 'failed'),
      checkpoint(PROFILE_B, 'owned_only', [], 'failed'),
      checkpoint(PROFILE_B, 'competitor_only', [], 'failed'),
    ];
    const first = aggregate(checkpoints);
    const second = aggregate([...checkpoints].reverse());
    expect(first.hasFailures).toBe(true);
    expect(first.usableCompetitors).toBe(1);
    expect(first.rows).toHaveLength(1);
    expect(second).toEqual(first);
  });

  it('labels every failure/truncation variant and enforces suggestion/action caps', () => {
    const cappedRows = Array.from({ length: 12 }, (_, index) =>
      row(`cap ${String(index).padStart(2, '0')}`, {
        ownedPosition: index === 0 ? 5 : 20,
        competitorPosition: 3,
        ownedUrl: index === 2 ? null : `https://owned.example/${index}`,
        competitorUrl: `https://rival.example/${index}`,
        searchVolume: index === 1 ? null : 100,
        intent: null,
      }),
    );
    const truncated = checkpoint(PROFILE_A, 'shared', [cappedRows[0]!, { ...cappedRows[0]!, keyword: 'CAP 00' }]);
    truncated.provenance = { ...truncated.provenance!, truncated: true };
    const failure = (
      leg: LandscapeLeg,
      safeErrorCode: string | null,
      provenance: LandscapeAggregationCheckpoint['provenance'] = null,
    ): LandscapeAggregationCheckpoint => ({
      competitorProfileId: PROFILE_B,
      leg,
      state: 'failed',
      safeErrorCode,
      provenance,
      rows: [],
    });
    const result = aggregate([
      checkpoint(PROFILE_A, 'shared', cappedRows),
      truncated,
      checkpoint(PROFILE_A, 'owned_only', [
        row('wrong owned leg'),
        row('owned fallback', { competitorPosition: null, competitorUrl: null }),
      ]),
      checkpoint(PROFILE_A, 'competitor_only', [
        row('wrong competitor leg'),
        row('missing fallback', { ownedPosition: null, ownedUrl: null }),
      ]),
      failure('shared', 'MALFORMED_PAYLOAD'),
      failure('owned_only', 'QUOTA_LIMIT'),
      failure('competitor_only', null),
      failure('owned_only', ''),
      failure('shared', 'bad-code!', {
        provider: 'competitor',
        operation: 'domain_intersection_live',
        leg: 'shared',
        intersections: true,
        targetOrder: 'owned_competitor',
        itemTypes: ['organic'],
        limit: 100,
        cache: 'miss',
        status: 'failed',
        capturedAt: null,
        returnedRows: 0,
        truncated: false,
      }),
      {
        ...checkpoint(PROFILE_B, 'owned_only', []),
        provenance: null,
      },
      checkpoint('33333333-3333-4333-8333-333333333333', 'shared', [row('orphan')]),
    ]);
    expect(result.manifest.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining([
        'LEG_MALFORMED',
        'LEG_QUOTA',
        'LEG_FAILED',
        'LEG_TRUNCATED',
        'DUPLICATE_LEG_CONFLICT',
        'PARTIAL_COMPETITOR',
      ]),
    );
    expect(result.manifest.provenance.some((entry) => entry.status === 'failed')).toBe(true);
    expect(result.manifest.pageSuggestions).toHaveLength(10);
    expect(result.manifest.pageSuggestions.map((suggestion) => suggestion.reasonCode)).toEqual(
      expect.arrayContaining(['closest_rank', 'same_keyword']),
    );
    expect(result.manifest.opportunities).toHaveLength(10);
    expect(result.manifest.opportunities.map((opportunity) => opportunity.confidence)).toEqual(
      expect.arrayContaining(['medium']),
    );
    const lowConfidence = aggregate([
      checkpoint(PROFILE_A, 'shared', []),
      checkpoint(PROFILE_A, 'owned_only', []),
      checkpoint(PROFILE_A, 'competitor_only', [
        row('unique null demand', {
          ownedPosition: null,
          ownedUrl: null,
          searchVolume: null,
          intent: null,
        }),
      ]),
    ]);
    expect(lowConfidence.manifest.opportunities[0]).toMatchObject({ confidence: 'low' });
  });
});
