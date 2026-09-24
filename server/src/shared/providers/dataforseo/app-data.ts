import { z } from "zod";
import { appBulkMetricsInputSchema, appChartInputSchema, appInfoInputSchema, appIntersectionInputSchema, appReviewsInputSchema, appRowsInputSchema, appSearchInputSchema, type AppBulkMetricsRow, type AppChartPage, type AppCompetitorRow, type AppDataProvider, type AppInfo, type AppInstallRange, type AppIntersectionRow, type AppKeywordRow, type AppPrice, type AppRankingMetrics, type AppReview, type AppReviewPage, type AppSearchResult, type AppStoreKind, type AppSummary, } from "../app-data.js";
import { buildObservationMeta, marketFromDataForSeo, observationMetaSchema, } from "../../observations/observations.js";
import { VendorMalformedError, VendorUnavailableError } from "../errors.js";
import type { ProviderMarket } from "../types.js";
import { dataForSeoRequest, type DataForSeoConfig, type DataForSeoTaskOutcome, } from "../http.js";
export const APP_SEARCH_DEPTH_PLAY = 30;
export const APP_SEARCH_DEPTH_APPLE = 100;
export const APP_REVIEWS_MAX_DEPTH = 300;
export const LABS_ROW_LIMIT = 100;
export const BULK_METRICS_MAX_APPS = 50;
export const INTERSECTION_MAX_APPS = 20;
export const INTERSECTION_LOCATION = 2840;
export const APP_DATA_STANDARD_PRIORITY = 1;
export const APP_CHART_MAX_DEPTH = 200;
const DEFAULT_MAX_POLL_ATTEMPTS = 20;
const DEFAULT_POLL_INTERVAL_MS = 1000;
const MAX_POLL_ATTEMPTS = 20;
const MAX_POLL_INTERVAL_MS = 60000;
const APP_LOCATION_RESPONSE_MAX_BYTES = 128 * 1024 * 1024;
export const APP_DATA_STORE_PATHS: Record<AppStoreKind, "google" | "apple"> = {
    google_play: "google",
    app_store: "apple",
};
const appLocationResultSchema = z.array(z.object({
    location_code: z.number().int().positive(),
    country_iso_code: z.string(),
    location_type: z.string(),
}));
const appLanguageResultSchema = z.array(z
    .object({
    language_code: z.string(),
})
    .passthrough());
export function normalizeAppMarkets(locations: z.infer<typeof appLocationResultSchema>, languages: z.infer<typeof appLanguageResultSchema>): ProviderMarket[] {
    const languageCodes = [
        ...new Set(languages
            .map((row) => row.language_code.trim().toLowerCase())
            .filter((languageCode) => /^[a-z]{2}$/.test(languageCode))),
    ];
    const markets = new Map<string, ProviderMarket>();
    for (const row of locations) {
        const countryCode = row.country_iso_code.trim().toUpperCase();
        if (row.location_type !== "Country" || !/^[A-Z]{2}$/.test(countryCode))
            continue;
        markets.set(`${countryCode}:${row.location_code}`, {
            countryCode,
            locationCode: row.location_code,
            languageCodes: [...languageCodes],
        });
    }
    return [...markets.values()];
}
const rawRatingSchema = z
    .object({
    value: z.number().min(0).max(5).nullable().optional(),
})
    .passthrough();
const rawHttpUrlSchema = z
    .string()
    .url()
    .max(4096)
    .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
});
const rawPriceSchema = z
    .object({
    current: z.number().nonnegative().nullable().optional(),
    currency: z.string().min(1).max(12).nullable().optional(),
    displayed_price: z.string().max(100).nullable().optional(),
})
    .passthrough();
const rawSearchItemSchema = z
    .object({
    type: z.enum(["google_play_search_organic", "app_store_search_organic"]),
    rank_group: z.number().int().positive(),
    rank_absolute: z.number().int().positive(),
    app_id: z.string().min(1).max(256),
    title: z.string().min(1).max(700),
    url: rawHttpUrlSchema.nullable().optional(),
    icon: rawHttpUrlSchema.nullable().optional(),
    reviews_count: z.number().int().nonnegative().nullable().optional(),
    rating: rawRatingSchema.nullable().optional(),
    is_free: z.boolean().nullable().optional(),
    price: rawPriceSchema.nullable().optional(),
    developer: z.string().max(700).nullable().optional(),
    installs: z.string().max(100).nullable().optional(),
})
    .passthrough();
const rawSearchBucketSchema = z
    .object({
    keyword: z.string().nullable().optional(),
    location_code: z.number().int().positive().nullable().optional(),
    language_code: z.string().nullable().optional(),
    datetime: z.string().nullable().optional(),
    se_results_count: z.number().int().nonnegative().nullable().optional(),
    items: z.array(z.unknown()),
})
    .passthrough();
const rawSearchResultSchema = z.array(rawSearchBucketSchema);
const rawAppReferenceSchema = z
    .object({
    app_id: z.string().min(1).max(256),
    title: z.string().min(1).max(700),
    url: rawHttpUrlSchema.nullable().optional(),
})
    .passthrough();
const rawInfoItemSchema = z
    .object({
    type: z.enum(['google_play_info_organic', 'app_store_info_organic']),
    app_id: z.string().min(1).max(256),
    title: z.string().min(1).max(700),
    url: rawHttpUrlSchema.nullable().optional(),
    icon: rawHttpUrlSchema.nullable().optional(),
    description: z.string().max(20000).nullable().optional(),
    reviews_count: z.number().int().nonnegative().nullable().optional(),
    rating: rawRatingSchema.nullable().optional(),
    price: rawPriceSchema.nullable().optional(),
    is_free: z.boolean().nullable().optional(),
    main_category: z.string().max(700).nullable().optional(),
    categories: z.array(z.unknown()).nullable().optional(),
    installs: z.string().max(100).nullable().optional(),
    developer: z.string().max(700).nullable().optional(),
    developer_url: rawHttpUrlSchema.nullable().optional(),
    developer_website: rawHttpUrlSchema.nullable().optional(),
    version: z.string().max(700).nullable().optional(),
    minimum_os_version: z.string().max(700).nullable().optional(),
    size: z.string().max(700).nullable().optional(),
    released_date: z.string().max(100).nullable().optional(),
    last_update_date: z.string().max(100).nullable().optional(),
    update_notes: z.string().max(20000).nullable().optional(),
    images: z.array(z.unknown()).nullable().optional(),
    videos: z.array(z.unknown()).nullable().optional(),
    languages: z.array(z.unknown()).nullable().optional(),
    advisories: z.array(z.unknown()).nullable().optional(),
    genres: z.array(z.unknown()).nullable().optional(),
    tags: z.array(z.unknown()).nullable().optional(),
    similar_apps: z.array(z.unknown()).nullable().optional(),
    more_apps_by_developer: z.array(z.unknown()).nullable().optional(),
})
    .passthrough();
const rawInfoBucketSchema = z
    .object({
    app_id: z.string().nullable().optional(),
    location_code: z.number().int().positive().nullable().optional(),
    language_code: z.string().nullable().optional(),
    datetime: z.string().nullable().optional(),
    items: z.array(z.unknown()),
})
    .passthrough();
const rawInfoResultSchema = z.array(rawInfoBucketSchema);
const rawReviewItemSchema = z
    .object({
    type: z.enum(["google_play_reviews_search", "app_store_reviews_search"]),
    id: z.string().min(1).max(512),
    rating: rawRatingSchema,
    title: z.string().max(700).nullable().optional(),
    review_text: z.string().max(20000),
    timestamp: z.string().max(100).nullable().optional(),
    user_profile: z
        .object({
        profile_name: z.unknown().optional(),
    })
        .passthrough()
        .nullable()
        .optional(),
})
    .passthrough();
const rawReviewsBucketSchema = z
    .object({
    app_id: z.string().nullable().optional(),
    location_code: z.number().int().positive().nullable().optional(),
    language_code: z.string().nullable().optional(),
    datetime: z.string().nullable().optional(),
    title: z.string().max(700).nullable().optional(),
    rating: rawRatingSchema.nullable().optional(),
    reviews_count: z.number().int().nonnegative().nullable().optional(),
    items: z.array(z.unknown()).nullable().optional(),
})
    .passthrough();
const rawReviewsResultSchema = z.array(rawReviewsBucketSchema);
const rawRankingMetricsSchema = z
    .object({
    pos_1: z.number().int().nonnegative(),
    pos_2_3: z.number().int().nonnegative(),
    pos_4_10: z.number().int().nonnegative(),
    pos_11_100: z.number().int().nonnegative(),
    count: z.number().int().nonnegative(),
    search_volume: z.number().int().nonnegative(),
})
    .passthrough();
const rawMetricsContainerSchema = z
    .object({
    google_play_search_organic: rawRankingMetricsSchema.optional(),
    app_store_search_organic: rawRankingMetricsSchema.optional(),
})
    .passthrough();
const rawKeywordInfoSchema = z
    .object({
    search_volume: z.number().int().nonnegative().nullable().optional(),
    last_updated_time: z.string().max(100).nullable().optional(),
})
    .passthrough();
const rawSerpInfoSchema = z
    .object({
    last_updated_time: z.string().max(100).nullable().optional(),
})
    .passthrough();
const rawKeywordDataSchema = z
    .object({
    keyword: z.string().trim().min(1).max(700),
    keyword_info: rawKeywordInfoSchema,
    serp_info: rawSerpInfoSchema.nullable().optional(),
})
    .passthrough();
const rawLabsRankSchema = z
    .object({
    rank_group: z.number().int().positive().nullable().optional(),
    rank_absolute: z.number().int().positive().nullable().optional(),
})
    .passthrough();
const rawRankedSerpElementSchema = z
    .object({
    serp_item: rawLabsRankSchema,
    last_updated_time: z.string().max(100).nullable().optional(),
})
    .passthrough();
const rawLabsKeywordItemSchema = z
    .object({
    keyword_data: rawKeywordDataSchema,
    ranked_serp_element: rawRankedSerpElementSchema,
})
    .passthrough();
const rawLabsKeywordsBucketSchema = z
    .object({
    items: z.array(rawLabsKeywordItemSchema).nullable().optional(),
})
    .passthrough();
const rawLabsKeywordsResultSchema = z.array(rawLabsKeywordsBucketSchema);
const rawCompetitorItemSchema = z
    .object({
    app_id: z.string().min(1).max(256),
    avg_position: z.number().nonnegative().nullable().optional(),
    sum_position: z.number().int().nonnegative().nullable().optional(),
    intersections: z.number().int().nonnegative(),
    competitor_metrics: rawMetricsContainerSchema,
    full_metrics: rawMetricsContainerSchema,
})
    .passthrough();
const rawCompetitorsBucketSchema = z
    .object({
    items: z.array(rawCompetitorItemSchema).nullable().optional(),
})
    .passthrough();
const rawCompetitorsResultSchema = z.array(rawCompetitorsBucketSchema);
const rawIntersectionItemSchema = z
    .object({
    keyword_data: rawKeywordDataSchema,
    intersection_result: z.record(rawLabsRankSchema),
})
    .passthrough();
const rawIntersectionBucketSchema = z
    .object({
    items: z.array(rawIntersectionItemSchema).nullable().optional(),
})
    .passthrough();
const rawIntersectionResultSchema = z.array(rawIntersectionBucketSchema);
const rawBulkMetricsItemSchema = z
    .object({
    app_id: z.string().min(1).max(256),
    metrics: rawMetricsContainerSchema,
})
    .passthrough();
const rawBulkMetricsBucketSchema = z
    .object({
    items: z.array(rawBulkMetricsItemSchema).nullable().optional(),
})
    .passthrough();
const rawBulkMetricsResultSchema = z.array(rawBulkMetricsBucketSchema);
export interface DataForSeoAppDataProviderConfig extends DataForSeoConfig {
    /** Injectable polling seams. Tests use <=100ms deadlines and zero-delay waits. */
    wait?: (milliseconds: number) => Promise<void>;
    maxPollAttempts?: number;
    pollIntervalMs?: number;
    now?: () => Date;
}
function providerMalformed(operation: string, message: string, cause?: unknown): never {
    throw new VendorMalformedError(message, {
        provider: "dataforseo",
        operation,
        ...(cause === undefined ? {} : { cause }),
    });
}
function isPendingTaskGetError(error: unknown): boolean {
    return error instanceof VendorMalformedError &&
        /^unrecognized vendor status 4040[12]:/.test(error.message);
}
function parseInput<TSchema extends z.ZodTypeAny>(schema: TSchema, value: unknown, operation: string): z.output<TSchema> {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
        return providerMalformed(operation, `invalid app data input: ${parsed.error.message}`, parsed.error);
    }
    return parsed.data;
}
function requireOutcome<T>(outcomes: DataForSeoTaskOutcome<T>[], operation: string, stage: "task_post" | "task_get" | "live"): DataForSeoTaskOutcome<T> {
    const outcome = outcomes[0];
    if (!outcome) {
        return providerMalformed(operation, `${stage} returned no tasks`);
    }
    return outcome;
}
function taskPaths(store: AppStoreKind, endpoint: string) {
    const namespace = APP_DATA_STORE_PATHS[store];
    return {
        post: `/app_data/${namespace}/${endpoint}/task_post`,
        get: (taskId: string) => `/app_data/${namespace}/${endpoint}/task_get/advanced/${encodeURIComponent(taskId)}`,
    };
}
function labsPath(store: AppStoreKind, endpoint: string): string {
    const namespace = APP_DATA_STORE_PATHS[store];
    return `/dataforseo_labs/${namespace}/${endpoint}/live`;
}
function normalizeVendorTimestamp(value: string | null | undefined): string | null {
    if (!value)
        return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
function appObservationMeta(input: {
    locationCode: number;
    languageCode: string;
    observedAt: string;
    sampleCount?: number;
}): z.infer<typeof observationMetaSchema> {
    return observationMetaSchema.parse(buildObservationMeta({
        sourceKind: "provider_observation",
        sourceLabel: "dataforseo",
        observedAt: input.observedAt,
        market: marketFromDataForSeo({
            locationCode: input.locationCode,
            languageCode: input.languageCode,
            device: "all",
        }),
        sampleCount: input.sampleCount ?? 1,
    }));
}
function normalizeRankingMetrics(store: AppStoreKind, container: z.infer<typeof rawMetricsContainerSchema>, operation: string): AppRankingMetrics {
    const metrics = store === "google_play"
        ? container.google_play_search_organic
        : container.app_store_search_organic;
    if (!metrics) {
        return providerMalformed(operation, `missing ${store} organic ranking metrics`);
    }
    return {
        firstPositionCount: metrics.pos_1,
        secondToThirdPositionCount: metrics.pos_2_3,
        fourthToTenthPositionCount: metrics.pos_4_10,
        eleventhToHundredthPositionCount: metrics.pos_11_100,
        rankedKeywordCount: metrics.count,
        rankingKeywordSearchVolume: metrics.search_volume,
    };
}
const EMAIL_SHAPED_VALUE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
function normalizeAuthorDisplayName(value: unknown): string | null {
    if (typeof value !== "string")
        return null;
    const normalized = value.trim();
    if (normalized.length === 0 ||
        normalized.length > 300 ||
        EMAIL_SHAPED_VALUE.test(normalized)) {
        return null;
    }
    return normalized;
}
/** Parse only a store-displayed numeric range. Abbreviations stay unknown. */
export function normalizeInstallRange(value: unknown): AppInstallRange | null {
    if (typeof value !== "string")
        return null;
    const raw = value.trim();
    if (raw.length === 0)
        return null;
    const match = raw.match(/^(\d[\d,.\s]*)\+?$/);
    if (!match?.[1])
        return { raw, lowerBound: null };
    const digits = match[1].replace(/[,.\s]/g, "");
    const parsed = Number(digits);
    return {
        raw,
        lowerBound: Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null,
    };
}
function normalizePrice(price: z.infer<typeof rawPriceSchema> | null | undefined): AppPrice | null {
    if (!price)
        return null;
    return {
        amount: price.current ?? null,
        currency: price.currency ?? null,
        displayed: price.displayed_price ?? null,
    };
}
export function extractAppSearchRows(store: AppStoreKind, result: z.infer<typeof rawSearchResultSchema>, depth: number): AppSummary[] {
    const expectedType = store === "google_play"
        ? "google_play_search_organic"
        : "app_store_search_organic";
    const rows: AppSummary[] = [];
    for (const bucket of result) {
        for (const item of bucket.items) {
            if (typeof item !== "object" ||
                item === null ||
                !("type" in item) ||
                item.type !== expectedType) {
                continue;
            }
            const parsed = rawSearchItemSchema.safeParse(item);
            if (!parsed.success)
                continue;
            const row = parsed.data;
            rows.push({
                position: row.rank_group,
                absolutePosition: row.rank_absolute,
                appId: row.app_id,
                title: row.title,
                url: row.url ?? null,
                iconUrl: row.icon ?? null,
                rating: row.rating?.value ?? null,
                reviewCount: row.reviews_count ?? null,
                isFree: row.is_free ?? null,
                price: normalizePrice(row.price),
                developerName: row.developer ?? null,
                installs: store === "google_play" ? normalizeInstallRange(row.installs) : null,
            });
            if (rows.length >= depth)
                return rows;
        }
    }
    return rows;
}
function normalizeStringList(value: unknown[] | null | undefined): string[] {
    if (!value)
        return [];
    const seen = new Set<string>();
    const rows: string[] = [];
    for (const entry of value) {
        if (typeof entry !== "string")
            continue;
        const normalized = entry.trim();
        if (normalized.length === 0 ||
            normalized.length > 500 ||
            seen.has(normalized)) {
            continue;
        }
        seen.add(normalized);
        rows.push(normalized);
        if (rows.length >= 100)
            break;
    }
    return rows;
}
function normalizeUrlList(value: unknown[] | null | undefined): string[] {
    if (!value)
        return [];
    const seen = new Set<string>();
    const rows: string[] = [];
    for (const entry of value) {
        const parsed = rawHttpUrlSchema.safeParse(entry);
        if (!parsed.success || seen.has(parsed.data))
            continue;
        seen.add(parsed.data);
        rows.push(parsed.data);
        if (rows.length >= 100)
            break;
    }
    return rows;
}
function normalizeReferences(value: unknown[] | null | undefined) {
    if (!value)
        return [];
    const rows: Array<{
        appId: string;
        title: string;
        url: string | null;
    }> = [];
    for (const entry of value) {
        const parsed = rawAppReferenceSchema.safeParse(entry);
        if (!parsed.success)
            continue;
        rows.push({
            appId: parsed.data.app_id,
            title: parsed.data.title,
            url: parsed.data.url ?? null,
        });
        if (rows.length >= 100)
            break;
    }
    return rows;
}
export function extractAppInfo(input: {
    store: AppStoreKind;
    appId: string;
    locationCode: number;
    languageCode: string;
    result: z.infer<typeof rawInfoResultSchema>;
    fallbackObservedAt: Date;
}): AppInfo {
    const operation = "app-data-info";
    const expectedType = input.store === "google_play"
        ? "google_play_info_organic"
        : "app_store_info_organic";
    for (const bucket of input.result) {
        for (const item of bucket.items) {
            if (typeof item !== "object" ||
                item === null ||
                !("type" in item) ||
                item.type !== expectedType) {
                continue;
            }
            const parsed = rawInfoItemSchema.safeParse(item);
            if (!parsed.success)
                continue;
            const row = parsed.data;
            const isPlay = input.store === "google_play";
            const storeCategories = normalizeStringList(isPlay ? row.genres : row.categories);
            const categories = row.main_category
                ? [
                    row.main_category,
                    ...storeCategories.filter((value) => value !== row.main_category),
                ]
                : storeCategories;
            const observedAt = normalizeVendorTimestamp(bucket.datetime) ??
                input.fallbackObservedAt.toISOString();
            return {
                store: input.store,
                appId: row.app_id,
                title: row.title,
                url: row.url ?? null,
                iconUrl: row.icon ?? null,
                description: row.description ?? null,
                rating: row.rating?.value ?? null,
                reviewCount: row.reviews_count ?? null,
                isFree: row.is_free ?? null,
                price: normalizePrice(row.price),
                mainCategory: row.main_category ?? null,
                categories: categories.slice(0, 100),
                installs: isPlay ? normalizeInstallRange(row.installs) : null,
                developerName: row.developer ?? null,
                developerUrl: row.developer_url ?? null,
                developerWebsite: isPlay ? (row.developer_website ?? null) : null,
                version: row.version ?? null,
                minimumOsVersion: row.minimum_os_version ?? null,
                size: row.size ?? null,
                releasedAt: isPlay
                    ? normalizeVendorTimestamp(row.released_date)
                    : null,
                updatedAt: normalizeVendorTimestamp(row.last_update_date),
                updateNotes: row.update_notes ?? null,
                imageUrls: normalizeUrlList(row.images),
                videoUrls: isPlay ? normalizeUrlList(row.videos) : null,
                languages: isPlay ? null : normalizeStringList(row.languages),
                advisories: isPlay ? null : normalizeStringList(row.advisories),
                tags: isPlay ? normalizeStringList(row.tags) : null,
                similarApps: normalizeReferences(row.similar_apps),
                moreByDeveloper: normalizeReferences(row.more_apps_by_developer),
                locationCode: input.locationCode,
                languageCode: input.languageCode,
                observationMeta: appObservationMeta({
                    locationCode: input.locationCode,
                    languageCode: input.languageCode,
                    observedAt,
                    sampleCount: 1,
                }),
            };
        }
    }
    return providerMalformed(operation, `app info returned no valid item for ${input.appId}`);
}
export function extractAppReviewPage(input: {
    store: AppStoreKind;
    appId: string;
    locationCode: number;
    languageCode: string;
    depth: number;
    result: z.infer<typeof rawReviewsResultSchema>;
    fallbackObservedAt: Date;
}): AppReviewPage {
    const expectedType = input.store === "google_play"
        ? "google_play_reviews_search"
        : "app_store_reviews_search";
    const first = input.result[0];
    const rows: AppReview[] = [];
    for (const bucket of input.result) {
        for (const item of bucket.items ?? []) {
            if (typeof item !== "object" ||
                item === null ||
                !("type" in item) ||
                item.type !== expectedType) {
                continue;
            }
            const parsed = rawReviewItemSchema.safeParse(item);
            if (!parsed.success)
                continue;
            const review = parsed.data;
            const rating = review.rating.value;
            if (rating == null)
                continue;
            rows.push({
                reviewId: review.id,
                rating,
                title: review.title ?? null,
                text: review.review_text,
                authorDisplayName: normalizeAuthorDisplayName(review.user_profile?.profile_name),
                reviewedAt: normalizeVendorTimestamp(review.timestamp),
            });
            if (rows.length >= input.depth)
                break;
        }
        if (rows.length >= input.depth)
            break;
    }
    const observedAt = normalizeVendorTimestamp(first?.datetime) ??
        input.fallbackObservedAt.toISOString();
    return {
        store: input.store,
        appId: input.appId,
        title: first?.title ?? null,
        rating: first?.rating?.value ?? null,
        reviewCount: first?.reviews_count ?? null,
        rows,
        locationCode: input.locationCode,
        languageCode: input.languageCode,
        observationMeta: appObservationMeta({
            locationCode: input.locationCode,
            languageCode: input.languageCode,
            observedAt,
            sampleCount: Math.max(1, rows.length),
        }),
    };
}
function extractKeywordRows(input: {
    store: AppStoreKind;
    appId: string;
    locationCode: number;
    languageCode: string;
    limit: number;
    result: z.infer<typeof rawLabsKeywordsResultSchema>;
    fallbackObservedAt: Date;
}): AppKeywordRow[] {
    const rows: AppKeywordRow[] = [];
    for (const bucket of input.result) {
        for (const item of bucket.items ?? []) {
            const lastUpdatedAt = normalizeVendorTimestamp(item.ranked_serp_element.last_updated_time) ??
                normalizeVendorTimestamp(item.keyword_data.keyword_info.last_updated_time);
            const observedAt = lastUpdatedAt ?? input.fallbackObservedAt.toISOString();
            rows.push({
                store: input.store,
                appId: input.appId,
                keyword: item.keyword_data.keyword,
                searchVolume: item.keyword_data.keyword_info.search_volume ?? null,
                rank: item.ranked_serp_element.serp_item.rank_group ?? null,
                absoluteRank: item.ranked_serp_element.serp_item.rank_absolute ?? null,
                lastUpdatedAt,
                observationMeta: appObservationMeta({
                    locationCode: input.locationCode,
                    languageCode: input.languageCode,
                    observedAt,
                }),
            });
            if (rows.length >= input.limit)
                return rows;
        }
    }
    return rows;
}
function extractCompetitorRows(input: {
    store: AppStoreKind;
    locationCode: number;
    languageCode: string;
    limit: number;
    result: z.infer<typeof rawCompetitorsResultSchema>;
    observedAt: Date;
    operation: string;
}): AppCompetitorRow[] {
    const rows: AppCompetitorRow[] = [];
    for (const bucket of input.result) {
        for (const item of bucket.items ?? []) {
            rows.push({
                store: input.store,
                appId: item.app_id,
                averagePosition: item.avg_position ?? null,
                summedPosition: item.sum_position ?? null,
                sharedKeywordCount: item.intersections,
                sharedKeywordMetrics: normalizeRankingMetrics(input.store, item.competitor_metrics, input.operation),
                allKeywordMetrics: normalizeRankingMetrics(input.store, item.full_metrics, input.operation),
                observationMeta: appObservationMeta({
                    locationCode: input.locationCode,
                    languageCode: input.languageCode,
                    observedAt: input.observedAt.toISOString(),
                }),
            });
            if (rows.length >= input.limit)
                return rows;
        }
    }
    return rows;
}
function extractIntersectionRows(input: {
    store: AppStoreKind;
    appIds: string[];
    locationCode: number;
    languageCode: string;
    limit: number;
    result: z.infer<typeof rawIntersectionResultSchema>;
    fallbackObservedAt: Date;
}): AppIntersectionRow[] {
    const rows: AppIntersectionRow[] = [];
    for (const bucket of input.result) {
        for (const item of bucket.items ?? []) {
            const ranksByAppId: AppIntersectionRow["ranksByAppId"] = {};
            input.appIds.forEach((appId, index) => {
                const rank = item.intersection_result[String(index + 1)];
                ranksByAppId[appId] = {
                    rank: rank?.rank_group ?? null,
                    absoluteRank: rank?.rank_absolute ?? null,
                };
            });
            const lastUpdatedAt = normalizeVendorTimestamp(item.keyword_data.serp_info?.last_updated_time) ??
                normalizeVendorTimestamp(item.keyword_data.keyword_info.last_updated_time);
            const observedAt = lastUpdatedAt ?? input.fallbackObservedAt.toISOString();
            rows.push({
                store: input.store,
                keyword: item.keyword_data.keyword,
                searchVolume: item.keyword_data.keyword_info.search_volume ?? null,
                ranksByAppId,
                lastUpdatedAt,
                observationMeta: appObservationMeta({
                    locationCode: input.locationCode,
                    languageCode: input.languageCode,
                    observedAt,
                }),
            });
            if (rows.length >= input.limit)
                return rows;
        }
    }
    return rows;
}
function extractBulkMetricsRows(input: {
    store: AppStoreKind;
    locationCode: number;
    languageCode: string;
    result: z.infer<typeof rawBulkMetricsResultSchema>;
    observedAt: Date;
    operation: string;
}): AppBulkMetricsRow[] {
    const rows: AppBulkMetricsRow[] = [];
    for (const bucket of input.result) {
        for (const item of bucket.items ?? []) {
            rows.push({
                store: input.store,
                appId: item.app_id,
                metrics: normalizeRankingMetrics(input.store, item.metrics, input.operation),
                observationMeta: appObservationMeta({
                    locationCode: input.locationCode,
                    languageCode: input.languageCode,
                    observedAt: input.observedAt.toISOString(),
                }),
            });
            if (rows.length >= BULK_METRICS_MAX_APPS)
                return rows;
        }
    }
    return rows;
}
/**
 * DataForSEO App Data adapter. Task-backed operations keep task ids internal;
 * their bounded polling loop is injectable for worker/contract tests.
 */
export function createDataForSeoAppDataProvider(config: DataForSeoAppDataProviderConfig): AppDataProvider {
    const maxPollAttempts = Math.max(1, Math.min(config.maxPollAttempts ?? DEFAULT_MAX_POLL_ATTEMPTS, MAX_POLL_ATTEMPTS));
    const pollIntervalMs = Math.max(0, Math.min(config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS, MAX_POLL_INTERVAL_MS));
    const wait = config.wait ??
        ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
    const now = config.now ?? (() => new Date());
    async function listMarkets(store: AppStoreKind): Promise<ProviderMarket[]> {
        const vendorStore = APP_DATA_STORE_PATHS[store];
        const [locationOutcomes, languageOutcomes] = await Promise.all([
            dataForSeoRequest(config, `/app_data/${vendorStore}/locations`, [], appLocationResultSchema, {
                operation: `app-data-${vendorStore}-market-catalog`,
                method: "GET",
                timeoutMs: 120000,
                maxResponseBytes: APP_LOCATION_RESPONSE_MAX_BYTES,
            }),
            dataForSeoRequest(config, `/app_data/${vendorStore}/languages`, [], appLanguageResultSchema, { operation: `app-data-${vendorStore}-language-catalog`, method: "GET" }),
        ]);
        const locations = locationOutcomes[0];
        const languages = languageOutcomes[0];
        if (!locations || locations.status !== "ok" || !languages || languages.status !== "ok") {
            throw new VendorMalformedError(`app_data/${vendorStore} catalog returned no ok tasks`, { provider: "dataforseo", operation: `app-data-${vendorStore}-market-catalog` });
        }
        return normalizeAppMarkets(locations.result, languages.result);
    }
    async function runTask<TSchema extends z.ZodTypeAny>(input: {
        store: AppStoreKind;
        endpoint: string;
        operation: string;
        body: unknown;
        resultSchema: TSchema;
    }): Promise<z.output<TSchema>> {
        const paths = taskPaths(input.store, input.endpoint);
        const posted = await dataForSeoRequest(config, paths.post, [input.body], input.resultSchema, {
            operation: `${input.operation}-post`,
        });
        const postOutcome = requireOutcome(posted, input.operation, "task_post");
        if (postOutcome.status === "ok")
            return postOutcome.result;
        if (postOutcome.status === "in_queue") {
            throw new VendorUnavailableError("task_post unexpectedly reported in_queue", {
                provider: "dataforseo",
                operation: input.operation,
            });
        }
        if (!postOutcome.taskId) {
            return providerMalformed(input.operation, "task_post missing task id");
        }
        for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
            let fetched: DataForSeoTaskOutcome<z.output<TSchema>>[];
            try {
                fetched = await dataForSeoRequest(config, paths.get(postOutcome.taskId), [], input.resultSchema, { operation: `${input.operation}-get`, method: "GET" });
            }
            catch (error) {
                // DataForSEO can briefly answer 40401/40402 before a newly accepted
                // task is visible to task_get. The same id then appears in tasks_ready.
                if (!isPendingTaskGetError(error))
                    throw error;
                if (attempt < maxPollAttempts - 1) {
                    await wait(pollIntervalMs);
                    continue;
                }
                break;
            }
            const fetchOutcome = requireOutcome(fetched, input.operation, "task_get");
            if (fetchOutcome.status === "ok")
                return fetchOutcome.result;
            if (fetchOutcome.status === "created") {
                return providerMalformed(input.operation, "task_get returned task-created status");
            }
            if (attempt < maxPollAttempts - 1)
                await wait(pollIntervalMs);
        }
        throw new VendorUnavailableError(`task_get remained in queue after ${maxPollAttempts} polls`, { provider: "dataforseo", operation: input.operation });
    }
    async function runLive<TSchema extends z.ZodTypeAny>(input: {
        store: AppStoreKind;
        endpoint: string;
        operation: string;
        body: unknown;
        resultSchema: TSchema;
    }): Promise<z.output<TSchema>> {
        const outcomes = await dataForSeoRequest(config, labsPath(input.store, input.endpoint), [input.body], input.resultSchema, { operation: input.operation });
        const outcome = requireOutcome(outcomes, input.operation, "live");
        if (outcome.status === "ok")
            return outcome.result;
        if (outcome.status === "created") {
            return providerMalformed(input.operation, "live endpoint returned task-created status");
        }
        throw new VendorUnavailableError("live endpoint unexpectedly reported in_queue", { provider: "dataforseo", operation: input.operation });
    }
    return {
        listMarkets,
        async searchApps(rawInput): Promise<AppSearchResult> {
            const operation = "app-data-search-apps";
            const input = parseInput(appSearchInputSchema, rawInput, operation);
            const maxDepth = input.store === "google_play"
                ? APP_SEARCH_DEPTH_PLAY
                : APP_SEARCH_DEPTH_APPLE;
            const depth = Math.min(input.depth ?? maxDepth, maxDepth);
            const result = await runTask({
                store: input.store,
                endpoint: "app_searches",
                operation,
                body: {
                    keyword: input.keyword,
                    location_code: input.locationCode,
                    language_code: input.languageCode,
                    depth,
                    priority: APP_DATA_STANDARD_PRIORITY,
                },
                resultSchema: rawSearchResultSchema,
            });
            const rows = extractAppSearchRows(input.store, result, depth);
            const first = result[0];
            const observedAt = normalizeVendorTimestamp(first?.datetime) ?? now().toISOString();
            return {
                store: input.store,
                keyword: input.keyword,
                locationCode: input.locationCode,
                languageCode: input.languageCode,
                totalCount: first?.se_results_count ?? null,
                rows,
                observationMeta: appObservationMeta({
                    locationCode: input.locationCode,
                    languageCode: input.languageCode,
                    observedAt,
                    sampleCount: Math.max(1, rows.length),
                }),
            };
        },
        async getAppInfo(rawInput): Promise<AppInfo> {
            const operation = "app-data-info";
            const input = parseInput(appInfoInputSchema, rawInput, operation);
            const result = await runTask({
                store: input.store,
                endpoint: "app_info",
                operation,
                body: {
                    app_id: input.appId,
                    location_code: input.locationCode,
                    language_code: input.languageCode,
                    priority: APP_DATA_STANDARD_PRIORITY,
                },
                resultSchema: rawInfoResultSchema,
            });
            return extractAppInfo({
                ...input,
                result,
                fallbackObservedAt: now(),
            });
        },
        async getAppReviews(rawInput): Promise<AppReviewPage> {
            const operation = "app-data-reviews";
            const input = parseInput(appReviewsInputSchema, rawInput, operation);
            const depth = Math.min(input.depth ?? APP_REVIEWS_MAX_DEPTH, APP_REVIEWS_MAX_DEPTH);
            const result = await runTask({
                store: input.store,
                endpoint: "app_reviews",
                operation,
                body: {
                    app_id: input.appId,
                    location_code: input.locationCode,
                    language_code: input.languageCode,
                    depth,
                    priority: APP_DATA_STANDARD_PRIORITY,
                },
                resultSchema: rawReviewsResultSchema,
            });
            return extractAppReviewPage({
                ...input,
                depth,
                result,
                fallbackObservedAt: now(),
            });
        },
        async getTopChart(rawInput): Promise<AppChartPage> {
            const operation = "app-data-top-chart";
            const input = parseInput(appChartInputSchema, rawInput, operation);
            const depth = Math.min(input.depth ?? APP_CHART_MAX_DEPTH, APP_CHART_MAX_DEPTH);
            const result = await runTask({
                store: input.store,
                endpoint: "app_list",
                operation,
                body: {
                    app_collection: input.chartId,
                    ...(input.categoryId == null
                        ? {}
                        : { app_category: input.categoryId }),
                    location_code: input.locationCode,
                    language_code: input.languageCode,
                    depth,
                    priority: APP_DATA_STANDARD_PRIORITY,
                },
                resultSchema: rawSearchResultSchema,
            });
            const rows = extractAppSearchRows(input.store, result, depth);
            const observedAt = normalizeVendorTimestamp(result[0]?.datetime) ?? now().toISOString();
            return {
                store: input.store,
                chartId: input.chartId,
                categoryId: input.categoryId ?? null,
                rows,
                locationCode: input.locationCode,
                languageCode: input.languageCode,
                observationMeta: appObservationMeta({
                    locationCode: input.locationCode,
                    languageCode: input.languageCode,
                    observedAt,
                    sampleCount: Math.max(1, rows.length),
                }),
            };
        },
        async keywordsForApp(rawInput): Promise<AppKeywordRow[]> {
            const operation = "app-data-keywords-for-app";
            const input = parseInput(appRowsInputSchema, rawInput, operation);
            const limit = Math.min(input.limit ?? LABS_ROW_LIMIT, LABS_ROW_LIMIT);
            const result = await runLive({
                store: input.store,
                endpoint: "keywords_for_app",
                operation,
                body: {
                    app_id: input.appId,
                    location_code: input.locationCode,
                    language_code: input.languageCode,
                    limit,
                },
                resultSchema: rawLabsKeywordsResultSchema,
            });
            return extractKeywordRows({
                ...input,
                limit,
                result,
                fallbackObservedAt: now(),
            });
        },
        async appCompetitors(rawInput): Promise<AppCompetitorRow[]> {
            const operation = "app-data-competitors";
            const input = parseInput(appRowsInputSchema, rawInput, operation);
            const limit = Math.min(input.limit ?? LABS_ROW_LIMIT, LABS_ROW_LIMIT);
            const result = await runLive({
                store: input.store,
                endpoint: "app_competitors",
                operation,
                body: {
                    app_id: input.appId,
                    location_code: input.locationCode,
                    language_code: input.languageCode,
                    limit,
                },
                resultSchema: rawCompetitorsResultSchema,
            });
            return extractCompetitorRows({
                store: input.store,
                locationCode: input.locationCode,
                languageCode: input.languageCode,
                limit,
                result,
                observedAt: now(),
                operation,
            });
        },
        async appIntersection(rawInput): Promise<AppIntersectionRow[]> {
            const operation = "app-data-intersection";
            const input = parseInput(appIntersectionInputSchema, rawInput, operation);
            if (input.locationCode !== INTERSECTION_LOCATION ||
                input.languageCode !== "en") {
                return providerMalformed(operation, "app intersection supports only location 2840 and language en");
            }
            const appIds = input.appIds.slice(0, INTERSECTION_MAX_APPS);
            const limit = Math.min(input.limit ?? LABS_ROW_LIMIT, LABS_ROW_LIMIT);
            const result = await runLive({
                store: input.store,
                endpoint: "app_intersection",
                operation,
                body: {
                    app_ids: Object.fromEntries(appIds.map((appId, index) => [String(index + 1), appId])),
                    location_code: input.locationCode,
                    language_code: input.languageCode,
                    limit,
                },
                resultSchema: rawIntersectionResultSchema,
            });
            return extractIntersectionRows({
                ...input,
                appIds,
                limit,
                result,
                fallbackObservedAt: now(),
            });
        },
        async bulkAppMetrics(rawInput): Promise<AppBulkMetricsRow[]> {
            const operation = "app-data-bulk-metrics";
            const input = parseInput(appBulkMetricsInputSchema, rawInput, operation);
            const appIds = input.appIds.slice(0, BULK_METRICS_MAX_APPS);
            const result = await runLive({
                store: input.store,
                endpoint: "bulk_app_metrics",
                operation,
                body: {
                    app_ids: appIds,
                    location_code: input.locationCode,
                    language_code: input.languageCode,
                },
                resultSchema: rawBulkMetricsResultSchema,
            });
            return extractBulkMetricsRows({
                store: input.store,
                locationCode: input.locationCode,
                languageCode: input.languageCode,
                result,
                observedAt: now(),
                operation,
            });
        },
    };
}
