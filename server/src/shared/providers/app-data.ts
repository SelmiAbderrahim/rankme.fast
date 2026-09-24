import { z } from "zod";
import { observationMetaSchema } from "../observations/observations.js";
import type { ProviderMarket } from "./types.js";
export const APP_STORE_KINDS = ["google_play", "app_store"] as const;
export const appStoreKindSchema = z.enum(APP_STORE_KINDS);
export type AppStoreKind = z.infer<typeof appStoreKindSchema>;
const appIdSchema = z.string().trim().min(1).max(256);
const keywordSchema = z.string().trim().min(1).max(700);
const languageCodeSchema = z.string().trim().min(2).max(16).default("en");
const locationCodeSchema = z.number().int().positive().default(2840);
const requestedDepthSchema = z.number().int().positive().max(10000).optional();
const requestedLimitSchema = z.number().int().positive().max(10000).optional();
const nullableTextSchema = z.string().max(20000).nullable();
const nullableShortTextSchema = z.string().max(700).nullable();
const nullableUrlSchema = z.string().url().max(4096).nullable();
const nullableObservedAtSchema = z
    .string()
    .datetime({ offset: true })
    .nullable();
const nullableCountSchema = z.number().int().nonnegative().nullable();
const nullableRatingSchema = z.number().min(0).max(5).nullable();
const marketInputFields = {
    store: appStoreKindSchema,
    locationCode: locationCodeSchema,
    languageCode: languageCodeSchema,
};
export const appSearchInputSchema = z
    .object({
    ...marketInputFields,
    keyword: keywordSchema,
    depth: requestedDepthSchema,
})
    .strict();
export const appInfoInputSchema = z
    .object({
    ...marketInputFields,
    appId: appIdSchema,
})
    .strict();
export const appReviewsInputSchema = z
    .object({
    ...marketInputFields,
    appId: appIdSchema,
    depth: requestedDepthSchema,
})
    .strict();
export const appChartInputSchema = z
    .object({
    ...marketInputFields,
    /** Vendor-neutral chart identifier; adapters map it to their collection field. */
    chartId: z.string().trim().min(1).max(100),
    /** Store category identifier. `null` requests an unfiltered chart. */
    categoryId: z.string().trim().min(1).max(100).nullable().optional(),
    depth: requestedDepthSchema,
})
    .strict();
export const appRowsInputSchema = z
    .object({
    ...marketInputFields,
    appId: appIdSchema,
    limit: requestedLimitSchema,
})
    .strict();
export const appIntersectionInputSchema = z
    .object({
    ...marketInputFields,
    appIds: z.array(appIdSchema).min(2).max(1000),
    limit: requestedLimitSchema,
})
    .strict();
export const appBulkMetricsInputSchema = z
    .object({
    ...marketInputFields,
    appIds: z.array(appIdSchema).min(1).max(1000),
})
    .strict();
export type AppSearchInput = z.input<typeof appSearchInputSchema>;
export type AppInfoInput = z.input<typeof appInfoInputSchema>;
export type AppReviewsInput = z.input<typeof appReviewsInputSchema>;
export type AppChartInput = z.input<typeof appChartInputSchema>;
export type AppRowsInput = z.input<typeof appRowsInputSchema>;
export type AppIntersectionInput = z.input<typeof appIntersectionInputSchema>;
export type AppBulkMetricsInput = z.input<typeof appBulkMetricsInputSchema>;
export const appInstallRangeSchema = z
    .object({
    /** Store-displayed install range (for example, `1,000,000+`). */
    raw: z.string().min(1).max(100),
    /** Parsed lower edge of `raw`; `null` when the display string is not parseable. */
    lowerBound: z.number().int().nonnegative().nullable(),
})
    .strict();
export type AppInstallRange = z.infer<typeof appInstallRangeSchema>;
export const appPriceSchema = z
    .object({
    amount: z.number().nonnegative().nullable(),
    currency: z.string().min(3).max(12).nullable(),
    displayed: z.string().max(100).nullable(),
})
    .strict();
export type AppPrice = z.infer<typeof appPriceSchema>;
export const appSummarySchema = z
    .object({
    position: z.number().int().positive(),
    absolutePosition: z.number().int().positive(),
    appId: appIdSchema,
    title: z.string().min(1).max(700),
    url: nullableUrlSchema,
    iconUrl: nullableUrlSchema,
    rating: nullableRatingSchema,
    reviewCount: nullableCountSchema,
    isFree: z.boolean().nullable(),
    price: appPriceSchema.nullable(),
    developerName: nullableShortTextSchema,
    /** Google Play exposes a range; App Store results use `null`. */
    installs: appInstallRangeSchema.nullable(),
})
    .strict();
export type AppSummary = z.infer<typeof appSummarySchema>;
export const appSearchResultSchema = z
    .object({
    store: appStoreKindSchema,
    keyword: keywordSchema,
    locationCode: z.number().int().positive(),
    languageCode: z.string().min(2).max(16),
    totalCount: nullableCountSchema,
    rows: z.array(appSummarySchema).max(100),
    observationMeta: observationMetaSchema,
})
    .strict();
export type AppSearchResult = z.infer<typeof appSearchResultSchema>;
export const appReferenceSchema = z
    .object({
    appId: appIdSchema,
    title: z.string().min(1).max(700),
    url: nullableUrlSchema,
})
    .strict();
export const appInfoSchema = z
    .object({
    store: appStoreKindSchema,
    appId: appIdSchema,
    title: z.string().min(1).max(700),
    url: nullableUrlSchema,
    iconUrl: nullableUrlSchema,
    description: nullableTextSchema,
    rating: nullableRatingSchema,
    reviewCount: nullableCountSchema,
    isFree: z.boolean().nullable(),
    price: appPriceSchema.nullable(),
    mainCategory: nullableShortTextSchema,
    categories: z.array(z.string().min(1).max(200)).max(100),
    /** Google Play exposes a range; App Store uses `null` and is never estimated. */
    installs: appInstallRangeSchema.nullable(),
    developerName: nullableShortTextSchema,
    developerUrl: nullableUrlSchema,
    /** Google-only page field; App Store uses `null`. */
    developerWebsite: nullableUrlSchema,
    version: nullableShortTextSchema,
    minimumOsVersion: nullableShortTextSchema,
    size: nullableShortTextSchema,
    /** App Store currently does not publish this through the selected JSON surface. */
    releasedAt: nullableObservedAtSchema,
    updatedAt: nullableObservedAtSchema,
    updateNotes: nullableTextSchema,
    imageUrls: z.array(z.string().url().max(4096)).max(100),
    /** App Store has no video field on the selected JSON surface, so it uses `null`. */
    videoUrls: z.array(z.string().url().max(4096)).max(100).nullable(),
    /** App Store-only language list; Google Play uses `null`. */
    languages: z.array(z.string().min(1).max(100)).max(100).nullable(),
    /** App Store-only content advisories; Google Play uses `null`. */
    advisories: z.array(z.string().min(1).max(500)).max(100).nullable(),
    /** Google-only page tags; App Store uses `null`. */
    tags: z.array(z.string().min(1).max(200)).max(100).nullable(),
    similarApps: z.array(appReferenceSchema).max(100),
    moreByDeveloper: z.array(appReferenceSchema).max(100),
    locationCode: z.number().int().positive(),
    languageCode: z.string().min(2).max(16),
    observationMeta: observationMetaSchema,
})
    .strict();
export type AppInfo = z.infer<typeof appInfoSchema>;
export const appReviewSchema = z
    .object({
    reviewId: z.string().min(1).max(512),
    rating: z.number().min(0).max(5),
    title: nullableShortTextSchema,
    text: z.string().max(20000),
    /** Public display name only; adapters drop profile ids, URLs, and email-shaped values. */
    authorDisplayName: z.string().min(1).max(300).nullable(),
    reviewedAt: nullableObservedAtSchema,
})
    .strict();
export type AppReview = z.infer<typeof appReviewSchema>;
export const appReviewPageSchema = z
    .object({
    store: appStoreKindSchema,
    appId: appIdSchema,
    title: nullableShortTextSchema,
    rating: nullableRatingSchema,
    reviewCount: nullableCountSchema,
    rows: z.array(appReviewSchema).max(300),
    locationCode: z.number().int().positive(),
    languageCode: z.string().min(2).max(16),
    observationMeta: observationMetaSchema,
})
    .strict();
export type AppReviewPage = z.infer<typeof appReviewPageSchema>;
export const appChartPageSchema = z
    .object({
    store: appStoreKindSchema,
    chartId: z.string().min(1).max(100),
    categoryId: z.string().min(1).max(100).nullable(),
    rows: z.array(appSummarySchema).max(200),
    locationCode: z.number().int().positive(),
    languageCode: z.string().min(2).max(16),
    observationMeta: observationMetaSchema,
})
    .strict();
export type AppChartPage = z.infer<typeof appChartPageSchema>;
export const appRankingMetricsSchema = z
    .object({
    firstPositionCount: z.number().int().nonnegative(),
    secondToThirdPositionCount: z.number().int().nonnegative(),
    fourthToTenthPositionCount: z.number().int().nonnegative(),
    eleventhToHundredthPositionCount: z.number().int().nonnegative(),
    rankedKeywordCount: z.number().int().nonnegative(),
    rankingKeywordSearchVolume: z.number().int().nonnegative(),
})
    .strict();
export type AppRankingMetrics = z.infer<typeof appRankingMetricsSchema>;
export const appKeywordRowSchema = z
    .object({
    store: appStoreKindSchema,
    appId: appIdSchema,
    keyword: keywordSchema,
    searchVolume: nullableCountSchema,
    rank: z.number().int().positive().nullable(),
    absoluteRank: z.number().int().positive().nullable(),
    lastUpdatedAt: nullableObservedAtSchema,
    observationMeta: observationMetaSchema,
})
    .strict();
export type AppKeywordRow = z.infer<typeof appKeywordRowSchema>;
export const appCompetitorRowSchema = z
    .object({
    store: appStoreKindSchema,
    appId: appIdSchema,
    averagePosition: z.number().nonnegative().nullable(),
    summedPosition: z.number().int().nonnegative().nullable(),
    sharedKeywordCount: z.number().int().nonnegative(),
    sharedKeywordMetrics: appRankingMetricsSchema,
    allKeywordMetrics: appRankingMetricsSchema,
    observationMeta: observationMetaSchema,
})
    .strict();
export type AppCompetitorRow = z.infer<typeof appCompetitorRowSchema>;
export const appIntersectionRankSchema = z
    .object({
    rank: z.number().int().positive().nullable(),
    absoluteRank: z.number().int().positive().nullable(),
})
    .strict();
export const appIntersectionRowSchema = z
    .object({
    store: appStoreKindSchema,
    keyword: keywordSchema,
    searchVolume: nullableCountSchema,
    ranksByAppId: z.record(appIntersectionRankSchema),
    lastUpdatedAt: nullableObservedAtSchema,
    observationMeta: observationMetaSchema,
})
    .strict();
export type AppIntersectionRow = z.infer<typeof appIntersectionRowSchema>;
export const appBulkMetricsRowSchema = z
    .object({
    store: appStoreKindSchema,
    appId: appIdSchema,
    metrics: appRankingMetricsSchema,
    observationMeta: observationMetaSchema,
})
    .strict();
export type AppBulkMetricsRow = z.infer<typeof appBulkMetricsRowSchema>;
/**
 * Vendor-neutral mobile-store research capability.
 *
 * Task-backed methods own a bounded standard-priority POST -> GET polling loop.
 * Poll timing is injectable at the concrete-adapter factory for tests, but task
 * ids and task envelopes never cross this interface. Every operation receives
 * `store`; Google Play and App Store are not separate capabilities.
 *
 * | Operation | Required input | Adapter bound | Billed unit / execution |
 * | --- | --- | --- | --- |
 * | `searchApps` | store, keyword | Play <=30; Apple <=100 | one App Data search page; task + poll |
 * | `getAppInfo` | store, app id | one app | one App Data task + poll |
 * | `getAppReviews` | store, app id | <=300 reviews | Play bills 150-row blocks; Apple bills 25-row blocks; task + poll |
 * | `getTopChart` | store, chart id, optional category id | <=200 chart rows | one bounded App Data list task + poll |
 * | `keywordsForApp` | store, app id | <=100 rows | one Labs live request |
 * | `appCompetitors` | store, app id | <=100 rows | one Labs live request |
 * | `appIntersection` | store, 2..20 app ids | US (2840) / English only; <=100 rows | one Labs live request |
 * | `bulkAppMetrics` | store, 1..50 app ids | <=50 apps | one Labs live request |
 *
 * Location/language default to country-level US/English (`2840`/`en`). Inputs
 * may request a larger positive depth/limit so adapters can clamp before spend;
 * output schemas enforce the shipped bounds. App Store fields that its selected
 * JSON surface does not expose are represented by `null`, never synthesized.
 */
export interface AppDataProvider {
    /** Zero-cost country and language catalog for the selected store. */
    listMarkets?(store: AppStoreKind): Promise<ProviderMarket[]>;
    searchApps(input: AppSearchInput): Promise<AppSearchResult>;
    getAppInfo(input: AppInfoInput): Promise<AppInfo>;
    getAppReviews(input: AppReviewsInput): Promise<AppReviewPage>;
    getTopChart(input: AppChartInput): Promise<AppChartPage>;
    keywordsForApp(input: AppRowsInput): Promise<AppKeywordRow[]>;
    appCompetitors(input: AppRowsInput): Promise<AppCompetitorRow[]>;
    appIntersection(input: AppIntersectionInput): Promise<AppIntersectionRow[]>;
    bulkAppMetrics(input: AppBulkMetricsInput): Promise<AppBulkMetricsRow[]>;
}
