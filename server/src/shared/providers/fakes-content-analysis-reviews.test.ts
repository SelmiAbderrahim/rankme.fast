/**
 * Fake scenario-injection tests for the two
 * capability seams. Every documented scenario key is exercised so downstream
 * features can rely on the fake behaviour.
 */
import { describe, expect, it } from 'vitest';
import {
  VendorMalformedError,
  VendorQuotaError,
  VendorTimeoutError,
} from './errors.js';
import { FAKE_BRAND_DIGEST_FABRICATE_MARKER } from './ai-generation-fake.js';
import {
  CONTENT_ANALYSIS_SCENARIO_PREFIX,
  createFakeContentAnalysisProvider,
  createFakeReviewsProvider,
  FAKE_CONTENT_ANALYSIS_HOSTILE_MENTIONS,
  FAKE_CONTENT_ANALYSIS_HOSTILE_SUMMARY,
  FAKE_CONTENT_ANALYSIS_MENTIONS,
  FAKE_CONTENT_ANALYSIS_NODIGEST_MENTIONS,
  FAKE_CONTENT_ANALYSIS_SUMMARY,
  resolveContentAnalysisScenarioFromQuery,
  FAKE_HOSTILE_REVIEWS,
  FAKE_MIXED_LANGUAGE_REVIEWS,
  FAKE_REVIEWS_ROWS,
  REVIEWS_SCENARIO_PREFIX,
  resolveReviewsScenarioFromTarget,
} from './fakes.js';
import type {
  ContentAnalysisProvider,
  ReviewsProvider,
  ReviewsSource,
} from './types.js';

const _typeCheck = {
  contentAnalysis: createFakeContentAnalysisProvider(),
  reviews: createFakeReviewsProvider(),
} satisfies {
  contentAnalysis: ContentAnalysisProvider;
  reviews: ReviewsProvider;
};

const QUERY = { query: 'rankmefast', limit: 10 };
const REVIEW_INPUT = {
  source: 'google' as const,
  target: 'place_id:example',
  depth: 10,
};

describe('createFakeContentAnalysisProvider — scenarios', () => {
  it('rich (default) returns the canned mention rows + summary', async () => {
    const p = createFakeContentAnalysisProvider();
    await expect(p.searchMentions(QUERY)).resolves.toEqual(FAKE_CONTENT_ANALYSIS_MENTIONS);
    await expect(p.getMentionSummary(QUERY)).resolves.toEqual(FAKE_CONTENT_ANALYSIS_SUMMARY);
  });

  it('empty returns zero rows + zeroed summary', async () => {
    const p = createFakeContentAnalysisProvider({ scenario: 'empty' });
    await expect(p.searchMentions(QUERY)).resolves.toEqual([]);
    const summary = await p.getMentionSummary(QUERY);
    expect(summary.totalMentions).toBe(0);
    expect(summary.topDomains).toEqual([]);
  });

  it('malformed rejects every method with VendorMalformedError', async () => {
    const p = createFakeContentAnalysisProvider({ scenario: 'malformed' });
    await expect(p.searchMentions(QUERY)).rejects.toBeInstanceOf(VendorMalformedError);
    await expect(p.getMentionSummary(QUERY)).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('quota rejects every method with VendorQuotaError', async () => {
    const p = createFakeContentAnalysisProvider({ scenario: 'quota' });
    await expect(p.searchMentions(QUERY)).rejects.toBeInstanceOf(VendorQuotaError);
    await expect(p.getMentionSummary(QUERY)).rejects.toBeInstanceOf(VendorQuotaError);
  });

  it('timeout rejects every method with VendorTimeoutError', async () => {
    const p = createFakeContentAnalysisProvider({ scenario: 'timeout' });
    await expect(p.searchMentions(QUERY)).rejects.toBeInstanceOf(VendorTimeoutError);
    await expect(p.getMentionSummary(QUERY)).rejects.toBeInstanceOf(VendorTimeoutError);
  });

  it('per-call overrides win over scenario defaults', async () => {
    const p = createFakeContentAnalysisProvider({
      mentions: [],
      summary: {
        totalMentions: 0,
        distribution: { positive: 0, neutral: 0, negative: 0 },
        topDomains: [],
      },
    });
    await expect(p.searchMentions(QUERY)).resolves.toEqual([]);
    await expect(p.getMentionSummary(QUERY)).resolves.toMatchObject({ totalMentions: 0 });
  });

  it('hostile returns the payload bank the export/encoding contracts need', async () => {
    const p = createFakeContentAnalysisProvider({ scenario: 'hostile' });
    await expect(p.searchMentions(QUERY)).resolves.toEqual(
      FAKE_CONTENT_ANALYSIS_HOSTILE_MENTIONS,
    );
    await expect(p.getMentionSummary(QUERY)).resolves.toEqual(
      FAKE_CONTENT_ANALYSIS_HOSTILE_SUMMARY,
    );
  });

  it('nodigest returns rows carrying the fake-AI fabrication marker', async () => {
    const p = createFakeContentAnalysisProvider({ scenario: 'nodigest' });
    const rows = await p.searchMentions(QUERY);
    expect(rows).toEqual(FAKE_CONTENT_ANALYSIS_NODIGEST_MENTIONS);
    expect(
      rows.some(
        (row) =>
          (row.title ?? '').includes(FAKE_BRAND_DIGEST_FABRICATE_MARKER) ||
          (row.snippet ?? '').includes(FAKE_BRAND_DIGEST_FABRICATE_MARKER),
      ),
    ).toBe(true);
    await expect(p.getMentionSummary(QUERY)).resolves.toMatchObject({ totalMentions: 2 });
  });

  it('summary-failure keeps search working and loses only the summary stage', async () => {
    const p = createFakeContentAnalysisProvider({ scenario: 'summary-failure' });
    await expect(p.searchMentions(QUERY)).resolves.toEqual(FAKE_CONTENT_ANALYSIS_MENTIONS);
    await expect(p.getMentionSummary(QUERY)).rejects.toBeInstanceOf(VendorTimeoutError);
  });
});

describe('resolveContentAnalysisScenarioFromQuery', () => {
  it('resolves every allowed label from the brand-query sentinel', () => {
    for (const label of [
      'rich',
      'empty',
      'hostile',
      'nodigest',
      'summary-failure',
      'malformed',
      'quota',
      'timeout',
    ] as const) {
      expect(
        resolveContentAnalysisScenarioFromQuery(
          `${CONTENT_ANALYSIS_SCENARIO_PREFIX}${label.toUpperCase()} `,
        ),
      ).toBe(label);
    }
  });

  it('returns undefined for a non-string, an unprefixed query and an unknown label', () => {
    expect(resolveContentAnalysisScenarioFromQuery(42)).toBeUndefined();
    expect(resolveContentAnalysisScenarioFromQuery('rankmefast')).toBeUndefined();
    expect(
      resolveContentAnalysisScenarioFromQuery(`${CONTENT_ANALYSIS_SCENARIO_PREFIX}nope`),
    ).toBeUndefined();
  });

  it('lets the brand query drive the fake when no option is configured', async () => {
    const p = createFakeContentAnalysisProvider();
    await expect(
      p.searchMentions({ ...QUERY, query: `${CONTENT_ANALYSIS_SCENARIO_PREFIX}empty` }),
    ).resolves.toEqual([]);
    await expect(
      p.getMentionSummary({
        ...QUERY,
        query: `${CONTENT_ANALYSIS_SCENARIO_PREFIX}summary-failure`,
      }),
    ).rejects.toBeInstanceOf(VendorTimeoutError);
    // An unrelated query keeps the canned rich bank.
    await expect(p.searchMentions(QUERY)).resolves.toEqual(FAKE_CONTENT_ANALYSIS_MENTIONS);
  });

  it('a configured scenario still beats the query sentinel', async () => {
    const p = createFakeContentAnalysisProvider({ scenario: 'rich' });
    await expect(
      p.searchMentions({ ...QUERY, query: `${CONTENT_ANALYSIS_SCENARIO_PREFIX}empty` }),
    ).resolves.toEqual(FAKE_CONTENT_ANALYSIS_MENTIONS);
  });
});

describe('createFakeReviewsProvider — scenarios', () => {
  it('rich (default) returns per-source canned rows', async () => {
    const p = createFakeReviewsProvider();
    for (const source of ['google', 'trustpilot', 'tripadvisor'] as const) {
      const result = await p.getReviews({ ...REVIEW_INPUT, source });
      expect(result.source).toBe(source);
      expect(result.rows.length).toBeGreaterThan(0);
      expect(result.rows).toEqual(FAKE_REVIEWS_ROWS[source].slice(0, REVIEW_INPUT.depth));
    }
  });

  it('mixed-language scenario returns non-English rows', async () => {
    const p = createFakeReviewsProvider({ scenarios: { google: 'mixed-language' } });
    const result = await p.getReviews({ ...REVIEW_INPUT, source: 'google' });
    expect(result.rows).toEqual(FAKE_MIXED_LANGUAGE_REVIEWS);
  });

  it('empty scenario returns zero rows', async () => {
    const p = createFakeReviewsProvider({ scenarios: { google: 'empty' } });
    const result = await p.getReviews({ ...REVIEW_INPUT, source: 'google' });
    expect(result.rows).toEqual([]);
  });

  it.each([
    ['malformed', VendorMalformedError],
    ['quota', VendorQuotaError],
    ['timeout', VendorTimeoutError],
  ] as const)('%s scenario rejects with the matching error', async (scenario, ErrorCtor) => {
    const p = createFakeReviewsProvider({ scenarios: { google: scenario } });
    await expect(p.getReviews({ ...REVIEW_INPUT, source: 'google' })).rejects.toBeInstanceOf(
      ErrorCtor,
    );
  });

  it('scenarios can differ per source', async () => {
    const p = createFakeReviewsProvider({
      scenarios: { google: 'empty', trustpilot: 'rich' },
    });
    const g = await p.getReviews({ ...REVIEW_INPUT, source: 'google' });
    const t = await p.getReviews({ ...REVIEW_INPUT, source: 'trustpilot' });
    expect(g.rows).toEqual([]);
    expect(t.rows.length).toBeGreaterThan(0);
  });

  it('perSource overrides win over the default rows', async () => {
    const custom = [
      {
        rating: 3,
        title: 'custom',
        text: 'custom body',
        authorDisplayName: 'Custom',
        language: 'en',
        reviewedAt: null,
        sourceReviewId: 'c-1',
      },
    ];
    const p = createFakeReviewsProvider({ perSource: { google: custom } });
    const result = await p.getReviews({ ...REVIEW_INPUT, source: 'google' });
    expect(result.rows).toEqual(custom);
  });

  it('depth clamps how many rows are returned', async () => {
    const p = createFakeReviewsProvider();
    const result = await p.getReviews({ ...REVIEW_INPUT, depth: 1 });
    expect(result.rows.length).toBeLessThanOrEqual(1);
  });

  it('fetchedAt is injectable via now()', async () => {
    const fixed = new Date('2030-06-15T12:00:00.000Z');
    const p = createFakeReviewsProvider({ now: () => fixed });
    const result = await p.getReviews({ ...REVIEW_INPUT });
    expect(result.fetchedAt).toBe(fixed.toISOString());
  });

  it('hostile scenario returns formula / markup / RTL-override rows', async () => {
    const p = createFakeReviewsProvider({ scenarios: { google: 'hostile' } });
    const result = await p.getReviews({ ...REVIEW_INPUT, source: 'google' });
    expect(result.rows).toEqual(FAKE_HOSTILE_REVIEWS);
  });

  it('every supported source can be queried', async () => {
    const p = createFakeReviewsProvider();
    const sources: ReviewsSource[] = ['google', 'trustpilot', 'tripadvisor'];
    for (const source of sources) {
      const result = await p.getReviews({ ...REVIEW_INPUT, source });
      expect(result.source).toBe(source);
    }
  });
});

/**
 * The composed E2E stack constructs the fake through the registry
 * with no options, so the ONLY way a browser journey can drive a per-source
 * vendor failure or a hostile payload is the configured target sentinel.
 */
describe('resolveReviewsScenarioFromTarget — target sentinel', () => {
  it('returns undefined for a non-string target', () => {
    expect(resolveReviewsScenarioFromTarget(undefined)).toBeUndefined();
    expect(resolveReviewsScenarioFromTarget(42)).toBeUndefined();
  });

  it('returns undefined for a real target with no sentinel prefix', () => {
    expect(resolveReviewsScenarioFromTarget('ChIJrealplaceid')).toBeUndefined();
  });

  it('returns undefined for an unknown sentinel label', () => {
    expect(resolveReviewsScenarioFromTarget(`${REVIEWS_SCENARIO_PREFIX}nonsense`)).toBeUndefined();
  });

  it.each([
    'rich',
    'mixed-language',
    'hostile',
    'empty',
    'malformed',
    'quota',
    'timeout',
  ] as const)('resolves the %s label case-insensitively', (label) => {
    expect(resolveReviewsScenarioFromTarget(`${REVIEWS_SCENARIO_PREFIX}${label.toUpperCase()}`)).toBe(
      label,
    );
  });

  it('drives a per-source terminal failure through a configured target', async () => {
    const p = createFakeReviewsProvider();
    await expect(
      p.getReviews({ ...REVIEW_INPUT, target: `${REVIEWS_SCENARIO_PREFIX}timeout` }),
    ).rejects.toBeInstanceOf(VendorTimeoutError);
  });

  it('drives hostile rows through a configured target', async () => {
    const p = createFakeReviewsProvider();
    const result = await p.getReviews({
      ...REVIEW_INPUT,
      source: 'tripadvisor',
      target: `${REVIEWS_SCENARIO_PREFIX}hostile`,
    });
    expect(result.rows).toEqual(FAKE_HOSTILE_REVIEWS);
  });

  it('an explicit scenarios option still wins over the target sentinel', async () => {
    const p = createFakeReviewsProvider({ scenarios: { google: 'empty' } });
    const result = await p.getReviews({
      ...REVIEW_INPUT,
      target: `${REVIEWS_SCENARIO_PREFIX}hostile`,
    });
    expect(result.rows).toEqual([]);
  });
});
