import { describe, expect, it } from 'vitest';
import {
  appBulkMetricsRowSchema,
  appChartPageSchema,
  appCompetitorRowSchema,
  appInfoSchema,
  appIntersectionRowSchema,
  appKeywordRowSchema,
  appReviewPageSchema,
  appSearchResultSchema,
  type AppDataProvider,
} from './app-data.js';
import { VendorMalformedError, VendorQuotaError } from './errors.js';
import { createFakeAppDataProvider } from './fakes.js';

const provider: AppDataProvider = createFakeAppDataProvider();

describe('createFakeAppDataProvider', () => {
  it('is deterministic per store and keyword while varying different inputs', async () => {
    const input = { store: 'google_play' as const, keyword: 'seo audit' };
    const first = await provider.searchApps(input);
    const repeated = await provider.searchApps(input);
    const different = await provider.searchApps({
      store: 'google_play',
      keyword: 'rank tracker',
    });
    const apple = await provider.searchApps({
      store: 'app_store',
      keyword: 'seo audit',
    });

    expect(repeated).toEqual(first);
    expect(different.rows[0]?.appId).not.toBe(first.rows[0]?.appId);
    expect(first.rows[0]?.installs).not.toBeNull();
    expect(apple.rows[0]?.installs).toBeNull();
    expect(appSearchResultSchema.parse(first)).toEqual(first);
    expect(appSearchResultSchema.parse(apple)).toEqual(apple);
  });

  it('keeps App Store-absent info fields null and Play-only fields populated', async () => {
    const play = await provider.getAppInfo({
      store: 'google_play',
      appId: 'com.example.audit',
    });
    const apple = await provider.getAppInfo({
      store: 'app_store',
      appId: '686449807',
    });

    expect(play).toMatchObject({
      store: 'google_play',
      languages: null,
      advisories: null,
    });
    expect(play.installs).not.toBeNull();
    expect(play.developerWebsite).not.toBeNull();
    expect(play.releasedAt).not.toBeNull();
    expect(play.videoUrls).not.toBeNull();
    expect(apple).toMatchObject({
      store: 'app_store',
      installs: null,
      developerWebsite: null,
      releasedAt: null,
      videoUrls: null,
      tags: null,
    });
    expect(appInfoSchema.parse(play)).toEqual(play);
    expect(appInfoSchema.parse(apple)).toEqual(apple);
  });

  it('emits bounded deterministic reviews without PII-shaped authors', async () => {
    const input = {
      store: 'google_play' as const,
      appId: 'com.example.audit',
      depth: 999,
    };
    const first = await provider.getAppReviews(input);
    const repeated = await provider.getAppReviews(input);

    expect(repeated).toEqual(first);
    expect(first.rows).toHaveLength(12);
    expect(first.rows.every((row) => row.authorDisplayName === null)).toBe(true);
    expect(JSON.stringify(first)).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    expect(appReviewPageSchema.parse(first)).toEqual(first);
  });

  it('uses default review and Labs limits for App Store inputs', async () => {
    const reviews = await provider.getAppReviews({
      store: 'app_store',
      appId: '686449807',
    });
    const keywords = await provider.keywordsForApp({
      store: 'app_store',
      appId: '686449807',
    });
    const competitors = await provider.appCompetitors({
      store: 'app_store',
      appId: '686449807',
    });
    const intersection = await provider.appIntersection({
      store: 'app_store',
      appIds: ['686449807', '382617920'],
    });

    expect(reviews.title).toContain('App Store');
    expect(reviews.rows).toHaveLength(12);
    expect(keywords).toHaveLength(5);
    expect(competitors).toHaveLength(3);
    expect(intersection).toHaveLength(3);
  });

  it('offers a deterministic thin-evidence review fixture without changing provider routing', async () => {
    const reviews = await provider.getAppReviews({
      store: 'google_play',
      appId: 'com.rankme.thin.evidence',
    });

    expect(reviews.rows).toHaveLength(3);
    expect(reviews.rows.every((row) => row.authorDisplayName === null)).toBe(true);
  });

  it('seeds chart rows from chart and category identifiers', async () => {
    const first = await provider.getTopChart({
      store: 'app_store',
      chartId: 'top_free_ios',
      categoryId: 'utilities',
    });
    const repeated = await provider.getTopChart({
      store: 'app_store',
      chartId: 'top_free_ios',
      categoryId: 'utilities',
    });
    const unfiltered = await provider.getTopChart({
      store: 'app_store',
      chartId: 'top_free_ios',
    });

    expect(repeated).toEqual(first);
    expect(unfiltered.rows[0]?.appId).not.toBe(first.rows[0]?.appId);
    expect(appChartPageSchema.parse(first)).toEqual(first);
  });

  it('returns deterministic bounded Labs rows for every operation', async () => {
    const keywords = await provider.keywordsForApp({
      store: 'google_play',
      appId: 'com.example.audit',
      limit: 999,
    });
    const competitors = await provider.appCompetitors({
      store: 'app_store',
      appId: '686449807',
      limit: 999,
    });
    const appIds = Array.from({ length: 25 }, (_, index) => `app.${index + 1}`);
    const intersection = await provider.appIntersection({
      store: 'google_play',
      appIds,
      limit: 999,
    });
    const bulk = await provider.bulkAppMetrics({
      store: 'app_store',
      appIds: Array.from({ length: 55 }, (_, index) => String(100_000_000 + index)),
    });

    expect(keywords).toHaveLength(5);
    expect(competitors).toHaveLength(3);
    expect(intersection).toHaveLength(3);
    expect(Object.keys(intersection[0]?.ranksByAppId ?? {})).toHaveLength(20);
    expect(bulk).toHaveLength(50);
    keywords.forEach((row) => expect(appKeywordRowSchema.parse(row)).toEqual(row));
    competitors.forEach((row) =>
      expect(appCompetitorRowSchema.parse(row)).toEqual(row),
    );
    intersection.forEach((row) =>
      expect(appIntersectionRowSchema.parse(row)).toEqual(row),
    );
    bulk.forEach((row) =>
      expect(appBulkMetricsRowSchema.parse(row)).toEqual(row),
    );
    await expect(
      provider.bulkAppMetrics({ store: 'app_store', appIds: bulk.map((row) => row.appId) }),
    ).resolves.toEqual(bulk);
  });

  it('rejects unsupported intersection markets with provider taxonomy', async () => {
    await expect(
      provider.appIntersection({
        store: 'google_play',
        appIds: ['app.one', 'app.two'],
        locationCode: 2826,
      }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it.each([
    ['searchApps', (fake: AppDataProvider) => fake.searchApps({ store: 'google_play', keyword: 'seo' })],
    ['getAppInfo', (fake: AppDataProvider) => fake.getAppInfo({ store: 'google_play', appId: 'app.one' })],
    ['getAppReviews', (fake: AppDataProvider) => fake.getAppReviews({ store: 'google_play', appId: 'app.one' })],
    ['getTopChart', (fake: AppDataProvider) => fake.getTopChart({ store: 'google_play', chartId: 'top' })],
    ['keywordsForApp', (fake: AppDataProvider) => fake.keywordsForApp({ store: 'google_play', appId: 'app.one' })],
    ['appCompetitors', (fake: AppDataProvider) => fake.appCompetitors({ store: 'google_play', appId: 'app.one' })],
    ['appIntersection', (fake: AppDataProvider) => fake.appIntersection({ store: 'google_play', appIds: ['app.one', 'app.two'] })],
    ['bulkAppMetrics', (fake: AppDataProvider) => fake.bulkAppMetrics({ store: 'google_play', appIds: ['app.one'] })],
  ] as const)('propagates the injected failure from %s', async (_operation, invoke) => {
    const failure = new VendorQuotaError('injected app-data quota', {
      provider: 'fake',
      operation: 'app-data',
    });
    const failing = createFakeAppDataProvider({ failure });

    await expect(invoke(failing)).rejects.toBe(failure);
  });
});
