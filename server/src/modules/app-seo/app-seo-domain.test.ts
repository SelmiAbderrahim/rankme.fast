import { describe, expect, it } from 'vitest';
import type { AppInfo, AppReview } from '../../shared/providers/app-data.js';
import {
  appSeoCompareTestables,
  buildAppSeoComparison,
  type AppSeoCompareRows,
} from './compare.service.js';
import { evaluateAppListing } from './listing-rules/engine.js';
import { evaluateEngagementRules } from './listing-rules/engagement.js';
import { evaluateFreshnessRules } from './listing-rules/freshness.js';
import { evaluateMetadataRules } from './listing-rules/metadata.js';
import { evaluateParityRules } from './listing-rules/parity.js';
import {
  APP_STORE_DESCRIPTION_MAX_CHARS,
  APP_STORE_NAME_MAX_CHARS,
  GOOGLE_PLAY_DESCRIPTION_MAX_CHARS,
  GOOGLE_PLAY_SHORT_DESCRIPTION_MAX_CHARS,
  GOOGLE_PLAY_TITLE_MAX_CHARS,
  LOW_RATING_THRESHOLD,
  MIN_RECOMMENDED_SCREENSHOTS,
  STALE_UPDATE_DAYS,
  normalizeAppInfoForListingRules,
} from './listing-rules/store-limits.js';
import {
  computeAppReviewStats,
  enforceAppReviewClusters,
  normalizeAppReviews,
} from './reviews.processor.js';

const observedAt = new Date('2026-08-12T12:00:00.000Z');
const observation: AppInfo['observationMeta'] = {
  sourceKind: 'provider_observation',
  sourceLabel: 'dataforseo',
  observedAt: observedAt.toISOString(),
  freshUntil: null,
  freshness: 'fresh',
  market: {
    country: 'US',
    region: null,
    city: null,
    language: 'en',
    device: 'all',
  },
  sampleCount: 1,
  coverageNoteKey: null,
};

function listing(store: AppInfo['store'], over: Partial<AppInfo> = {}): AppInfo {
  return {
    store,
    appId: store === 'google_play' ? 'fast.rankme' : '123456789',
    title: 'Rank Me Fast',
    url: null,
    iconUrl: null,
    description: 'Track keyword visibility with clear evidence.',
    rating: 4.4,
    reviewCount: 42,
    isFree: true,
    price: null,
    mainCategory: 'Business',
    categories: ['Business', 'Tools'],
    installs: store === 'google_play'
      ? { raw: '1,000+', lowerBound: 1_000 }
      : null,
    developerName: 'Rank Me Fast',
    developerUrl: null,
    developerWebsite: null,
    version: '1.0.0',
    minimumOsVersion: null,
    size: null,
    releasedAt: null,
    updatedAt: '2026-08-01T00:00:00.000Z',
    updateNotes: null,
    imageUrls: store === 'google_play'
      ? ['https://example.test/1.png', 'https://example.test/2.png']
      : [],
    videoUrls: store === 'google_play' ? [] : null,
    languages: store === 'app_store' ? ['en'] : null,
    advisories: store === 'app_store' ? [] : null,
    tags: store === 'google_play' ? [] : null,
    similarApps: [],
    moreByDeveloper: [],
    locationCode: 2840,
    languageCode: 'en',
    observationMeta: observation,
    ...over,
  };
}

function rows(over: Partial<AppSeoCompareRows> = {}): AppSeoCompareRows {
  return {
    profile: {
      id: 'profile-1',
      paired: true,
      playPackageId: 'fast.rankme',
      appStoreId: '123456789',
    },
    keywords: [],
    rankSnapshots: [],
    listingSnapshots: [],
    chartSnapshots: [],
    ...over,
  };
}

describe('App SEO cross-store projection', () => {
  it('covers deterministic comparison guards and tie-breaking policies', () => {
    expect(appSeoCompareTestables.canonicalChartId('google_play', 'topselling_free'))
      .toBe('topFree');
    expect(appSeoCompareTestables.canonicalChartId('app_store', 'top_free_ios'))
      .toBe('topFree');
    expect(appSeoCompareTestables.canonicalChartId('google_play', 'unknown-chart'))
      .toBe('unknown-chart');
    expect(appSeoCompareTestables.canonicalCategoryId('google_play', 'game'))
      .toBe('categories.games');
    expect(appSeoCompareTestables.canonicalCategoryId('app_store', 'games'))
      .toBe('categories.games');
    expect(appSeoCompareTestables.canonicalCategoryId('app_store', 'unknown-category'))
      .toBe('unknown-category');
    expect(appSeoCompareTestables.canonicalCategoryId('google_play', null)).toBeNull();
    expect(appSeoCompareTestables.compareRawValue(4, 4)).toBe(true);
    expect(appSeoCompareTestables.compareRawValue(4, 5)).toBe(false);

    const validFinding = {
      id: 'valid',
      scope: 'parity',
      status: 'finding',
      severity: 'watch',
      copyKey: 'appSeo.listing.findings.valid',
      params: {},
      provenance: 'user-paired',
    };
    for (const invalid of [
      null,
      'finding',
      {},
      { ...validFinding, scope: 'google_play' },
      { ...validFinding, status: 'unknown' },
      { ...validFinding, severity: 'unknown' },
      { ...validFinding, copyKey: 4 },
      { ...validFinding, copyKey: 'unsafe' },
      { ...validFinding, params: null },
      { ...validFinding, params: 'unsafe' },
      { ...validFinding, provenance: 'provider' },
    ]) {
      expect(appSeoCompareTestables.isParityFinding(invalid)).toBe(false);
    }
    expect(appSeoCompareTestables.isParityFinding(validFinding)).toBe(true);

    const current = { id: 'middle', at: new Date('2026-08-02T00:00:00.000Z') };
    expect(appSeoCompareTestables.later(current, undefined, current.at)).toBe(true);
    expect(appSeoCompareTestables.later(
      { id: 'old', at: new Date('2026-08-01T00:00:00.000Z') },
      current,
      new Date('2026-08-01T00:00:00.000Z'),
      current.at,
    )).toBe(false);
    expect(appSeoCompareTestables.later(
      { id: 'z', at: current.at },
      current,
      current.at,
      current.at,
    )).toBe(true);
    expect(appSeoCompareTestables.later(
      { id: 'a', at: current.at },
      current,
      current.at,
      current.at,
    )).toBe(false);
  });

  it('returns an honest empty projection for an unpaired profile', () => {
    const result = buildAppSeoComparison(rows({
      profile: {
        id: 'profile-1',
        paired: false,
        playPackageId: 'fast.rankme',
        appStoreId: null,
      },
      keywords: [{
        id: 'ignored',
        store: 'google_play',
        phrase: 'ignored',
        locationCode: 2840,
        languageCode: 'en',
      }],
    }));

    expect(result).toEqual({
      profile: {
        id: 'profile-1',
        paired: false,
        playPackageId: 'fast.rankme',
        appStoreId: null,
      },
      pairingProvenance: null,
      listings: { google_play: null, app_store: null },
      ratingDelta: null,
      reviewCountDelta: null,
      ranks: { shared: [], onlyGooglePlay: [], onlyAppStore: [] },
      listingParity: {
        findings: [],
        rawFields: expect.arrayContaining([
          expect.objectContaining({ field: 'title', matches: null }),
        ]),
      },
      charts: [],
    });
  });

  it('normalizes keywords, keeps latest deterministic evidence, and exposes null observations', () => {
    const older = new Date('2026-08-10T00:00:00.000Z');
    const latest = new Date('2026-08-11T00:00:00.000Z');
    const result = buildAppSeoComparison(rows({
      keywords: [
        { id: 'g2', store: 'google_play', phrase: 'Ｒank  Fast ', locationCode: 2840, languageCode: 'EN' },
        { id: 'g1', store: 'google_play', phrase: 'rank fast', locationCode: 2840, languageCode: 'en' },
        { id: 'a1', store: 'app_store', phrase: 'Rank Fast', locationCode: 2840, languageCode: 'en' },
        { id: 'g-only', store: 'google_play', phrase: 'play only', locationCode: 2840, languageCode: 'en' },
        { id: 'a-only', store: 'app_store', phrase: 'apple only', locationCode: 2840, languageCode: 'en' },
      ],
      rankSnapshots: [
        { id: 'old', keywordId: 'g1', position: 20, checkedAt: older },
        { id: 'tie-a', keywordId: 'g1', position: 9, checkedAt: latest },
        { id: 'tie-z', keywordId: 'g1', position: 8, checkedAt: latest },
        { id: 'apple', keywordId: 'a1', position: 11, checkedAt: latest },
        { id: 'only', keywordId: 'g-only', position: null, checkedAt: latest },
      ],
    }));

    expect(result.ranks.shared).toEqual([{
      phrase: 'rank fast',
      locationCode: 2840,
      languageCode: 'en',
      googlePlay: { position: 8, checkedAt: latest.toISOString() },
      appStore: { position: 11, checkedAt: latest.toISOString() },
      delta: 3,
    }]);
    expect(result.ranks.onlyGooglePlay).toEqual([{
      phrase: 'play only',
      locationCode: 2840,
      languageCode: 'en',
      position: null,
      checkedAt: latest.toISOString(),
    }]);
    expect(result.ranks.onlyAppStore).toEqual([{
      phrase: 'apple only',
      locationCode: 2840,
      languageCode: 'en',
      position: null,
      checkedAt: null,
    }]);
  });

  it('projects listing parity, deduplicated persisted findings, and chart deltas', () => {
    const earlier = new Date('2026-08-10T00:00:00.000Z');
    const later = new Date('2026-08-11T00:00:00.000Z');
    const validFinding = {
      id: 'stores-diverge',
      scope: 'parity',
      status: 'finding',
      severity: 'watch',
      copyKey: 'appSeo.listing.findings.stores-diverge',
      params: { similarity: 25 },
      provenance: 'user-paired',
    };
    const secondFinding = {
      ...validFinding,
      id: 'ratings-diverge',
      copyKey: 'appSeo.listing.findings.ratings-diverge',
    };
    const play = listing('google_play', {
      rating: 4.7,
      reviewCount: 100,
      categories: ['Tools', 'Business'],
    });
    const apple = listing('app_store', {
      title: ' rank me fast ',
      rating: 4.1,
      reviewCount: 80,
      categories: ['business', 'tools'],
    });
    const result = buildAppSeoComparison(rows({
      listingSnapshots: [
        {
          id: 'play-old', store: 'google_play', capturedAt: earlier,
          listing: { ...play, title: 'Old' }, findings: { findings: [] },
        },
        {
          id: 'play-new', store: 'google_play', capturedAt: later,
          listing: play, findings: { findings: [validFinding, secondFinding, { id: 'unsafe' }] },
        },
        {
          id: 'apple-new', store: 'app_store', capturedAt: later,
          listing: apple, findings: { findings: [{ ...validFinding, status: 'passed' }] },
        },
      ],
      chartSnapshots: [
        { id: 'g-old', store: 'google_play', chartId: 'topselling_free', categoryId: 'game', position: 8, checkedAt: earlier },
        { id: 'g-new', store: 'google_play', chartId: 'topselling_free', categoryId: 'game', position: 3, checkedAt: later },
        { id: 'a-new', store: 'app_store', chartId: 'top_free_ios', categoryId: 'games', position: 7, checkedAt: later },
        { id: 'a-only', store: 'app_store', chartId: 'new_ios', categoryId: 'games', position: null, checkedAt: later },
      ],
    }));

    expect(result.ratingDelta).toBe(0.6);
    expect(result.reviewCountDelta).toBe(20);
    expect(result.listingParity.findings).toEqual([
      expect.objectContaining(secondFinding),
      expect.objectContaining(validFinding),
    ]);
    expect(result.listingParity.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        titleKey: 'appSeo.listing.findings.stores-diverge.title',
        title: 'Align the store titles',
        messageVars: { similarity: 25 },
      }),
    ]));
    expect(result.listingParity.rawFields).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'title', matches: true }),
      expect.objectContaining({ field: 'categories', matches: true }),
    ]));
    expect(result.charts).toEqual([
      {
        chartId: 'new_ios', categoryId: 'games',
        googlePlay: { position: null, checkedAt: null },
        appStore: { position: null, checkedAt: later.toISOString() },
        delta: null,
      },
      {
        chartId: 'topselling_free', categoryId: 'game',
        googlePlay: { position: 3, checkedAt: later.toISOString() },
        appStore: { position: 7, checkedAt: later.toISOString() },
        delta: 4,
      },
    ]);
  });

  it('keeps first deterministic duplicates and handles missing comparison evidence', () => {
    const latest = new Date('2026-08-11T00:00:00.000Z');
    const older = new Date('2026-08-10T00:00:00.000Z');
    const play = listing('google_play', { rating: null, reviewCount: null });
    const apple = listing('app_store', { rating: 4, reviewCount: 5 });
    const result = buildAppSeoComparison(rows({
      keywords: [
        { id: 'g-first', store: 'google_play', phrase: 'same', locationCode: 2840, languageCode: 'en' },
        { id: 'g-later', store: 'google_play', phrase: 'same', locationCode: 2840, languageCode: 'en' },
        { id: 'a-first', store: 'app_store', phrase: 'same', locationCode: 2840, languageCode: 'en' },
      ],
      rankSnapshots: [
        { id: 'new-rank', keywordId: 'g-first', position: 2, checkedAt: latest },
        { id: 'old-rank', keywordId: 'g-first', position: 9, checkedAt: older },
      ],
      listingSnapshots: [
        { id: 'play-new', store: 'google_play', capturedAt: latest, listing: play, findings: { findings: 'not-an-array' } },
        { id: 'play-old', store: 'google_play', capturedAt: older, listing: play, findings: {} },
        { id: 'apple', store: 'app_store', capturedAt: latest, listing: apple, findings: {} },
      ],
      chartSnapshots: [
        { id: 'chart-new', store: 'google_play', chartId: 'top', categoryId: null, position: 2, checkedAt: latest },
        { id: 'chart-old', store: 'google_play', chartId: 'top', categoryId: null, position: 9, checkedAt: older },
      ],
    }));

    expect(result.ranks.shared[0]).toMatchObject({
      googlePlay: { position: 2 },
      appStore: { position: null, checkedAt: null },
      delta: null,
    });
    expect(result.ratingDelta).toBeNull();
    expect(result.reviewCountDelta).toBeNull();
    expect(result.listingParity.findings).toEqual([]);
    expect(result.charts[0]?.googlePlay.position).toBe(2);

    const appOnlySnapshot = buildAppSeoComparison(rows({
      keywords: [
        { id: 'g', store: 'google_play', phrase: 'apple observed', locationCode: 2840, languageCode: 'en' },
        { id: 'a', store: 'app_store', phrase: 'apple observed', locationCode: 2840, languageCode: 'en' },
      ],
      rankSnapshots: [
        { id: 'app-rank', keywordId: 'a', position: 6, checkedAt: latest },
      ],
    }));
    expect(appOnlySnapshot.ranks.shared[0]).toMatchObject({
      googlePlay: { position: null, checkedAt: null },
      appStore: { position: 6 },
      delta: null,
    });

    const appMissing = buildAppSeoComparison(rows({
      listingSnapshots: [
        { id: 'play', store: 'google_play', capturedAt: latest, listing: listing('google_play'), findings: {} },
        { id: 'apple', store: 'app_store', capturedAt: latest, listing: listing('app_store', { rating: null, reviewCount: null }), findings: {} },
      ],
    }));
    expect(appMissing.ratingDelta).toBeNull();
    expect(appMissing.reviewCountDelta).toBeNull();
  });
});

describe('App listing deterministic rules', () => {
  it('covers every direct rule outcome without inferred store evidence', () => {
    const play = normalizeAppInfoForListingRules(listing('google_play'));
    expect(evaluateEngagementRules({
      ...play,
      screenshotCount: MIN_RECOMMENDED_SCREENSHOTS,
      rating: LOW_RATING_THRESHOLD,
    }, []).map((finding) => finding.status)).toEqual(['passed', 'passed']);
    expect(evaluateFreshnessRules({ ...play, updatedAt: null }, [])[0]?.status)
      .toBe('notEvaluated');
    expect(evaluateFreshnessRules({ ...play, observedAt: 'invalid' }, [])[0]?.status)
      .toBe('notEvaluated');

    const missing = evaluateMetadataRules({
      ...play,
      shortDescription: 'x'.repeat(GOOGLE_PLAY_SHORT_DESCRIPTION_MAX_CHARS + 1),
      description: null,
    }, []);
    expect(missing).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'short-description-too-long', status: 'finding' }),
      expect.objectContaining({ id: 'description-missing', status: 'finding' }),
      expect.objectContaining({ id: 'description-too-long', status: 'notEvaluated' }),
      expect.objectContaining({ id: 'desc-missing-keywords', status: 'notEvaluated' }),
    ]));
    const overlong = evaluateMetadataRules({
      ...play,
      shortDescription: 'short',
      description: 'x'.repeat(GOOGLE_PLAY_DESCRIPTION_MAX_CHARS + 1),
    }, ['absent']);
    expect(overlong).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'short-description-too-long', status: 'passed' }),
      expect.objectContaining({ id: 'description-too-long', status: 'finding' }),
      expect.objectContaining({ id: 'desc-missing-keywords', status: 'finding' }),
    ]));
    const apple = normalizeAppInfoForListingRules(listing('app_store'));
    expect(evaluateMetadataRules({
      ...apple,
      subtitle: 'subtitle',
      description: 'Contains the tracked phrase.',
    }, ['tracked phrase'])).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'subtitle-too-long', status: 'passed' }),
      expect.objectContaining({ id: 'description-too-long', status: 'passed' }),
      expect.objectContaining({ id: 'desc-missing-keywords', status: 'passed' }),
    ]));

    const empty = { ...play, title: '', categories: [], rating: 4 };
    expect(evaluateParityRules(empty, { ...empty, store: 'app_store' }))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'stores-diverge', status: 'passed' }),
        expect.objectContaining({ id: 'ratings-diverge', status: 'passed' }),
        expect.objectContaining({ id: 'categories-diverge', status: 'notEvaluated' }),
      ]));
    expect(evaluateParityRules(
      { ...play, categories: ['tools'], rating: null },
      { ...play, store: 'app_store', categories: [], rating: 4 },
    )).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'ratings-diverge', status: 'notEvaluated' }),
      expect.objectContaining({ id: 'categories-diverge', status: 'notEvaluated' }),
    ]));
    expect(evaluateParityRules(
      { ...play, categories: ['tools'], rating: 4 },
      { ...play, store: 'app_store', categories: ['business'], rating: null },
    )).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'ratings-diverge', status: 'notEvaluated' }),
      expect.objectContaining({ id: 'categories-diverge', status: 'finding' }),
    ]));
    expect(evaluateParityRules(
      { ...play, categories: ['tools'], rating: 4 },
      { ...play, store: 'app_store', categories: ['tools'], rating: 5 },
    )).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'ratings-diverge', status: 'finding' }),
      expect.objectContaining({ id: 'categories-diverge', status: 'passed' }),
    ]));
  });

  it('normalizes provider evidence without inventing App Store observations', () => {
    expect(normalizeAppInfoForListingRules(listing('google_play', {
      title: '  Title  ',
      description: '  Body  ',
      categories: [' Tools ', 'Tools', ''],
    }))).toMatchObject({
      title: 'Title',
      description: 'Body',
      screenshotCount: 2,
      installLowerBound: 1_000,
      categories: ['Tools'],
    });
    expect(normalizeAppInfoForListingRules(listing('app_store'))).toMatchObject({
      screenshotCount: null,
      installLowerBound: null,
      shortDescription: null,
      subtitle: null,
    });
    expect(normalizeAppInfoForListingRules(listing('google_play', {
      description: '   ',
      installs: null,
    }))).toMatchObject({ description: null, installLowerBound: null });
  });

  it('covers findings, passes, not-evaluated evidence, ordering, and paired parity', () => {
    const staleDate = new Date(observedAt.getTime() - (STALE_UPDATE_DAYS + 1) * 86_400_000);
    const output = evaluateAppListing({
      profile: { paired: true, playPackageId: 'fast.rankme', appStoreId: '123456789' },
      byStore: {
        google_play: listing('google_play', {
          title: 'x'.repeat(GOOGLE_PLAY_TITLE_MAX_CHARS + 1),
          description: 'x'.repeat(GOOGLE_PLAY_DESCRIPTION_MAX_CHARS + 1),
          rating: 3.5,
          imageUrls: [],
          updatedAt: staleDate.toISOString(),
          categories: ['Tools'],
        }),
        app_store: listing('app_store', {
          title: 'y'.repeat(APP_STORE_NAME_MAX_CHARS + 1),
          description: 'y'.repeat(APP_STORE_DESCRIPTION_MAX_CHARS + 1),
          rating: null,
          categories: [],
          updatedAt: 'not-a-date',
        }),
      },
      trackedPhrases: ['missing phrase', ' ', 'missing phrase'],
    });

    expect(output.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'title-too-long', scope: 'google_play', status: 'finding' }),
      expect.objectContaining({ id: 'screenshots-few', scope: 'google_play', status: 'finding', params: { actual: 0, minimum: MIN_RECOMMENDED_SCREENSHOTS } }),
      expect.objectContaining({ id: 'rating-low', scope: 'app_store', status: 'notEvaluated' }),
      expect.objectContaining({ id: 'stale-update', scope: 'google_play', status: 'finding' }),
      expect.objectContaining({ id: 'stale-update', scope: 'app_store', status: 'notEvaluated' }),
      expect.objectContaining({ id: 'categories-diverge', scope: 'parity', status: 'notEvaluated' }),
    ]));
    expect(output.notObserved).toEqual([
      { store: 'app_store', field: 'installs', copyKey: 'appSeo.listing.notObserved.installs' },
      { store: 'app_store', field: 'screenshots', copyKey: 'appSeo.listing.notObserved.screenshots' },
      { store: 'app_store', field: 'subtitle', copyKey: 'appSeo.listing.notObserved.subtitle' },
      { store: 'google_play', field: 'shortDescription', copyKey: 'appSeo.listing.notObserved.shortDescription' },
    ]);
  });

  it('reports a registered store failure without evaluating invented evidence', () => {
    const output = evaluateAppListing({
      profile: { paired: true, playPackageId: 'fast.rankme', appStoreId: '123456789' },
      byStore: { google_play: null, app_store: listing('app_store') },
      trackedPhrases: [],
    });

    expect(output.notObserved).toContainEqual({
      store: 'google_play',
      field: 'listing',
      copyKey: 'appSeo.listing.notObserved.storeFailed',
    });
    expect(output.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'stores-diverge', status: 'notEvaluated' }),
      expect.objectContaining({ id: 'ratings-diverge', status: 'notEvaluated' }),
    ]));
  });
});

describe('App review deterministic evidence and AI citation boundary', () => {
  it('bounds hostile text, clamps ratings, and assigns opaque stable ids', () => {
    const rows: AppReview[] = [{
      reviewId: 'vendor-profile-id-must-not-survive',
      rating: 9,
      title: 't'.repeat(800),
      text: '<script>alert(1)</script>'.repeat(2_000),
      authorDisplayName: 'a'.repeat(400),
      reviewedAt: '2026-08-12T00:00:00.000Z',
    }, {
      reviewId: 'second',
      rating: -2,
      title: null,
      text: 'plain',
      authorDisplayName: null,
      reviewedAt: null,
    }];

    const normalized = normalizeAppReviews(rows);
    expect(normalized[0]).toMatchObject({ id: 'review-001', rating: 5 });
    expect(normalized[0]!.title).toHaveLength(700);
    expect(normalized[0]!.text).toHaveLength(20_000);
    expect(normalized[0]!.authorName).toHaveLength(300);
    expect(normalized[1]).toEqual({
      id: 'review-002', rating: 0, title: null, text: 'plain', authorName: null, at: null,
    });
    expect(JSON.stringify(normalized)).not.toContain('vendor-profile-id-must-not-survive');
  });

  it('computes rounded histogram, sentiment mix, and sorted bounded monthly trends', () => {
    const dated = Array.from({ length: 26 }, (_, index) => ({
      rating: index % 3 === 0 ? 4.5 : index % 3 === 1 ? 3 : 1.5,
      at: new Date(Date.UTC(2024 + Math.floor(index / 12), index % 12, 1)),
    }));
    const stats = computeAppReviewStats([
      ...dated,
      { rating: 5, at: new Date('invalid') },
    ]);

    expect(stats.total).toBe(27);
    expect(stats.histogram.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(27);
    expect(stats.ratingMix).toEqual({ positive: 10, neutral: 9, negative: 8 });
    expect(stats.averageRating).toBe(3.13);
    expect(stats.volumeTrend).toHaveLength(24);
    expect(stats.volumeTrend[0]!.period < stats.volumeTrend.at(-1)!.period).toBe(true);
    expect(computeAppReviewStats([])).toMatchObject({ total: 0, averageRating: null });
  });

  it('accepts only complete exact-substring citations and drops paraphrases or unknown ids', () => {
    const reviews = [
      { id: 'review-001', text: 'Fast setup and clear reports.' },
      { id: 'review-002', text: 'Clear reports helped the team.' },
      { id: 'review-003', text: 'Support was responsive.' },
    ];
    const clusters = enforceAppReviewClusters([
      {
        label: '  Clear reporting  ', sentiment: 'positive',
        citedReviewIds: ['review-001', 'review-002', 'review-001'],
        quotes: [
          { reviewId: 'review-001', quote: 'clear reports' },
          { reviewId: 'review-002', quote: 'Clear reports' },
          { reviewId: 'review-002', quote: 'ignored duplicate' },
        ],
      },
      {
        label: 'Paraphrase', sentiment: 'mixed',
        citedReviewIds: ['review-001', 'review-003'],
        quotes: [
          { reviewId: 'review-001', quote: 'easy setup' },
          { reviewId: 'review-003', quote: 'responsive' },
        ],
      },
      {
        label: 'Unknown', sentiment: 'negative',
        citedReviewIds: ['review-001', 'review-999'], quotes: [],
      },
      {
        label: 'Too thin', sentiment: 'neutral',
        citedReviewIds: ['review-001'], quotes: [{ reviewId: 'review-001', quote: 'Fast' }],
      },
      {
        label: '   ', sentiment: 'positive',
        citedReviewIds: ['review-001', 'review-002'],
        quotes: [
          { reviewId: 'review-001', quote: 'Fast' },
          { reviewId: 'review-002', quote: 'Clear' },
        ],
      },
    ], reviews, observation);

    expect(clusters).toEqual([{
      label: 'Clear reporting',
      sentiment: 'positive',
      citedReviewIds: ['review-001', 'review-002'],
      quotes: [
        { reviewId: 'review-001', quote: 'clear reports' },
        { reviewId: 'review-002', quote: 'Clear reports' },
      ],
      observationMeta: observation,
    }]);
  });
});
