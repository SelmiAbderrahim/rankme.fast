import { describe, expect, it } from "vitest";
import { buildObservationMeta } from "../observations/observations.js";
import {
  appBulkMetricsInputSchema,
  appBulkMetricsRowSchema,
  appChartInputSchema,
  appChartPageSchema,
  appCompetitorRowSchema,
  appInfoInputSchema,
  appInfoSchema,
  appIntersectionInputSchema,
  appIntersectionRowSchema,
  appKeywordRowSchema,
  appReviewPageSchema,
  appReviewsInputSchema,
  appSearchInputSchema,
  appSearchResultSchema,
  appStoreKindSchema,
} from "./app-data.js";

const observationMeta = buildObservationMeta({
  sourceKind: "provider_observation",
  sourceLabel: "dataforseo",
  observedAt: "2026-08-08T00:00:00.000Z",
});

const summary = {
  position: 1,
  absolutePosition: 1,
  appId: "com.example.app",
  title: "Example App",
  url: "https://example.test/app",
  iconUrl: null,
  rating: 4.5,
  reviewCount: 10,
  isFree: true,
  price: { amount: 0, currency: "USD", displayed: "Free" },
  developerName: "Example Studio",
  installs: { raw: "1,000+", lowerBound: 1_000 },
};

const metrics = {
  firstPositionCount: 1,
  secondToThirdPositionCount: 2,
  fourthToTenthPositionCount: 3,
  eleventhToHundredthPositionCount: 4,
  rankedKeywordCount: 10,
  rankingKeywordSearchVolume: 1_000,
};

describe("app data provider contract schemas", () => {
  it("accepts only the two store inputs and applies market defaults", () => {
    expect(appStoreKindSchema.options).toEqual(["google_play", "app_store"]);
    expect(appStoreKindSchema.safeParse("google").success).toBe(false);
    expect(
      appSearchInputSchema.parse({ store: "google_play", keyword: " seo " }),
    ).toEqual({
      store: "google_play",
      keyword: "seo",
      locationCode: 2840,
      languageCode: "en",
    });
    expect(
      appInfoInputSchema.parse({ store: "app_store", appId: " 123 " }),
    ).toMatchObject({
      appId: "123",
      locationCode: 2840,
      languageCode: "en",
    });
  });

  it("keeps oversized spend inputs parseable for adapter-side clamping", () => {
    expect(
      appReviewsInputSchema.parse({
        store: "google_play",
        appId: "a",
        depth: 999,
      }).depth,
    ).toBe(999);
    expect(
      appChartInputSchema.parse({
        store: "app_store",
        chartId: "top_free_ios",
        categoryId: null,
        depth: 999,
      }).depth,
    ).toBe(999);
    expect(
      appIntersectionInputSchema.parse({
        store: "app_store",
        appIds: Array.from({ length: 25 }, (_, index) => String(index + 1)),
        limit: 999,
      }).appIds,
    ).toHaveLength(25);
    expect(
      appBulkMetricsInputSchema.parse({
        store: "google_play",
        appIds: Array.from({ length: 55 }, (_, index) => `app.${index}`),
      }).appIds,
    ).toHaveLength(55);
  });

  it("validates task-backed normalized outputs without vendor envelopes", () => {
    expect(
      appSearchResultSchema.parse({
        store: "google_play",
        keyword: "seo",
        locationCode: 2840,
        languageCode: "en",
        totalCount: 1,
        rows: [summary],
        observationMeta,
      }).rows,
    ).toHaveLength(1);

    expect(
      appInfoSchema.parse({
        store: "app_store",
        appId: "123",
        title: "Example App",
        url: null,
        iconUrl: null,
        description: null,
        rating: null,
        reviewCount: null,
        isFree: null,
        price: null,
        mainCategory: null,
        categories: [],
        installs: null,
        developerName: null,
        developerUrl: null,
        developerWebsite: null,
        version: null,
        minimumOsVersion: null,
        size: null,
        releasedAt: null,
        updatedAt: null,
        updateNotes: null,
        imageUrls: [],
        videoUrls: null,
        languages: [],
        advisories: [],
        tags: null,
        similarApps: [],
        moreByDeveloper: [],
        locationCode: 2840,
        languageCode: "en",
        observationMeta,
      }).installs,
    ).toBeNull();

    expect(
      appReviewPageSchema.parse({
        store: "google_play",
        appId: "a",
        title: null,
        rating: null,
        reviewCount: null,
        rows: [],
        locationCode: 2840,
        languageCode: "en",
        observationMeta,
      }).rows,
    ).toEqual([]);

    expect(
      appChartPageSchema.parse({
        store: "app_store",
        chartId: "top_free_ios",
        categoryId: null,
        rows: [],
        locationCode: 2840,
        languageCode: "en",
        observationMeta,
      }).rows,
    ).toEqual([]);
  });

  it("validates all four Labs row shapes", () => {
    expect(
      appKeywordRowSchema.parse({
        store: "google_play",
        appId: "app",
        keyword: "seo",
        searchVolume: 100,
        rank: 2,
        absoluteRank: 2,
        lastUpdatedAt: null,
        observationMeta,
      }).rank,
    ).toBe(2);
    expect(
      appCompetitorRowSchema.parse({
        store: "app_store",
        appId: "2",
        averagePosition: 3.5,
        summedPosition: 7,
        sharedKeywordCount: 2,
        sharedKeywordMetrics: metrics,
        allKeywordMetrics: metrics,
        observationMeta,
      }).sharedKeywordCount,
    ).toBe(2);
    expect(
      appIntersectionRowSchema.parse({
        store: "app_store",
        keyword: "rank tracker",
        searchVolume: null,
        ranksByAppId: { "1": { rank: 2, absoluteRank: 3 } },
        lastUpdatedAt: null,
        observationMeta,
      }).ranksByAppId["1"],
    ).toEqual({ rank: 2, absoluteRank: 3 });
    expect(
      appBulkMetricsRowSchema.parse({
        store: "google_play",
        appId: "app",
        metrics,
        observationMeta,
      }).metrics.rankedKeywordCount,
    ).toBe(10);
  });

  it("rejects leaked vendor fields and fabricated negative counts", () => {
    expect(
      appSearchResultSchema.safeParse({
        store: "google_play",
        keyword: "seo",
        locationCode: 2840,
        languageCode: "en",
        totalCount: 1,
        rows: [{ ...summary, se_result: [] }],
        observationMeta,
      }).success,
    ).toBe(false);
    expect(
      appBulkMetricsRowSchema.safeParse({
        store: "google_play",
        appId: "app",
        metrics: { ...metrics, rankedKeywordCount: -1 },
        observationMeta,
      }).success,
    ).toBe(false);
  });
});
