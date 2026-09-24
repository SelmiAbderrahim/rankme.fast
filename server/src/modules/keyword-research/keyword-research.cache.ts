/**
 * Cross-user keyword-metrics cache — the per-lookup cost lever.
 *
 * Cache key: `sha256(phrase|locationCode|languageCode)` — DOMAIN-INDEPENDENT
 * and NOT account-scoped. One entry serves every user researching that
 * phrase.
 *
 * Storage is the generic vendor layer (`shared/vendor-cache`): entries live
 * in `vendor_cache` under capability='keyword' with distinct operations —
 * `metrics` (volume/difficulty/cpc), `related` (related-keyword lists),
 * `intent` (search-intent classification), `ideas` (broad seed expansion),
 * and `long_tail` (seed-containing suggestions) — and every fresh fetch lands an append-only
 * `vendor_responses` archive row. The operations are independent keys:
 * writing one never clobbers or refreshes another. A cached payload that
 * fails schema parsing reads as a miss and is overwritten by the next fresh
 * fetch.
 *
 * TTL: `KEYWORD_CACHE_TTL_DAYS` (default 30). Volume/difficulty data updates
 * monthly at the vendor, so 30 days is safe — daily TTL would burn API cost
 * for no fresh signal, weekly for the same reason.
 */
import { createHash } from 'node:crypto';
import { and, eq, gt, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../../db/client.js';
import { vendorCache } from '../../db/schema/index.js';
import { createVendorCacheRepo } from '../../shared/vendor-cache/index.js';
import type { DomainIntersectionRow, SearchIntent, SerpFeatureType, } from '../../shared/providers/index.js';
export interface CachedMonthlySearchVolume {
    year: number;
    month: number;
    searchVolume: number;
}
export interface CachedRelatedKeyword {
    keyword: string;
    searchVolume: number | null;
    difficulty: number | null;
    cpcMicros: number | null;
    monthlySearches: CachedMonthlySearchVolume[];
}
/** Kept exportable so tests + the docs page share the default value. */
export const DEFAULT_KEYWORD_CACHE_TTL_DAYS = 30;
export function normalizeCachePhrase(phrase: string): string {
    return phrase.trim().toLowerCase().replace(/\s+/g, ' ');
}
export interface KeywordCacheKeyInput {
    phrase: string;
    locationCode: number;
    languageCode: string;
}
export function computeKeywordCacheKey(input: KeywordCacheKeyInput): string {
    const canonical = [
        normalizeCachePhrase(input.phrase),
        input.locationCode,
        input.languageCode.toLowerCase(),
    ].join('|');
    return createHash('sha256').update(canonical).digest('hex');
}
/** 1 USD = 1_000_000 micros (money convention, integer-only in DB). */
export const CPC_MICROS_PER_USD = 1000000;
export function cpcToMicros(cpc: number | null): number | null {
    if (cpc === null || cpc === undefined)
        return null;
    return Math.round(cpc * CPC_MICROS_PER_USD);
}
/** Fixed-precision decimal string in dollars — how the API serializes cpc. */
export function cpcMicrosToDecimalString(micros: number | null): string | null {
    if (micros === null || micros === undefined)
        return null;
    const abs = Math.abs(micros);
    const whole = Math.floor(abs / CPC_MICROS_PER_USD);
    const fraction = abs % CPC_MICROS_PER_USD;
    const sign = micros < 0 ? '-' : '';
    return `${sign}${whole}.${fraction.toString().padStart(6, '0')}`;
}
export interface CachedMetricsRow {
    phrase: string;
    searchVolume: number | null;
    difficulty: number | null;
    cpcMicros: number | null;
    cpc: string | null;
    monthlySearches: CachedMonthlySearchVolume[];
    relatedKeywords: CachedRelatedKeyword[] | null;
    fetchedAt: Date;
    expiresAt: Date;
}
export interface WriteMetricsInput {
    cacheKey: string;
    phrase: string;
    locationCode: number;
    languageCode: string;
    searchVolume: number | null;
    difficulty: number | null;
    cpc: number | null;
    monthlySearches: CachedMonthlySearchVolume[];
    /** This row's allocated share of the batch's vendor spend (micro-dollars). */
    costMicros?: bigint | null;
    fetchedAt: Date;
    expiresAt: Date;
}
/**
 * Cached search-intent row. Intent lives in the SAME vendor_cache table under a
 * DISTINCT `intent` operation (exactly how `related` is independent of
 * `metrics`) — one cache, one TTL (`KEYWORD_CACHE_TTL_DAYS`), never a parallel
 * table. A distinct operation (rather than folding intent into the metrics row)
 * is required because the metrics and intent endpoints fetch independently and
 * a shared row would clobber each other's write. Intent rarely changes for a
 * given keyword+locale, so it reuses the volume/difficulty cache lifecycle.
 */
export interface CachedIntentRow {
    phrase: string;
    intent: SearchIntent | null;
    confidence: number | null;
    fetchedAt: Date;
    expiresAt: Date;
}
export interface WriteIntentInput {
    cacheKey: string;
    phrase: string;
    locationCode: number;
    languageCode: string;
    intent: SearchIntent | null;
    confidence: number | null;
    /** This row's allocated share of the batch's vendor spend (micro-dollars). */
    costMicros?: bigint | null;
    fetchedAt: Date;
    expiresAt: Date;
}
/** Cached ideas row — seed phrase plus the suggestion corpus it expanded to. */
export interface CachedIdeasRow {
    phrase: string;
    ideas: CachedRelatedKeyword[];
    fetchedAt: Date;
    expiresAt: Date;
}
export interface CachedLongTailRow {
    phrase: string;
    suggestions: CachedRelatedKeyword[];
    fetchedAt: Date;
    expiresAt: Date;
}
/**
 * Normalize a domain for cache keying: lowercase + strip a single trailing
 * dot (FQDN convention). Preserves internationalised chars — the vendor is
 * responsible for punycode.
 */
export function normalizeCacheDomain(domain: string): string {
    return domain.trim().toLowerCase().replace(/\.$/, '');
}
export interface KeywordGapCacheKeyInput {
    ownDomain: string;
    competitorDomain: string;
    locationCode: number;
    languageCode: string;
}
/** Per-pair sha256 cache key. */
export function computeGapCacheKey(input: KeywordGapCacheKeyInput): string {
    const canonical = [
        'competitor-only-v2',
        normalizeCacheDomain(input.ownDomain),
        normalizeCacheDomain(input.competitorDomain),
        input.locationCode,
        input.languageCode.toLowerCase(),
    ].join('|');
    return createHash('sha256').update(canonical).digest('hex');
}
/** Persistent overview row — one per (phrase, loc, lang). */
export interface CachedOverviewRow {
    phrase: string;
    searchVolume: number | null;
    difficulty: number | null;
    cpcMicros: number | null;
    intent: SearchIntent | null;
    serpFeatures: SerpFeatureType[];
    observedAt: Date | null;
    resultsCount: number | null;
    fetchedAt: Date;
    expiresAt: Date;
}
export interface WriteOverviewInput {
    cacheKey: string;
    phrase: string;
    locationCode: number;
    languageCode: string;
    searchVolume: number | null;
    difficulty: number | null;
    cpc: number | null;
    intent: SearchIntent | null;
    serpFeatures: SerpFeatureType[];
    observedAt: Date | null;
    resultsCount: number | null;
    costMicros?: bigint | null;
    fetchedAt: Date;
    expiresAt: Date;
}
/** Persistent trends row — one per (phrase, loc, lang). */
export interface CachedTrendsRow {
    phrase: string;
    monthlySearches: CachedMonthlySearchVolume[];
    fetchedAt: Date;
    expiresAt: Date;
}
export interface WriteTrendsInput {
    cacheKey: string;
    phrase: string;
    locationCode: number;
    languageCode: string;
    monthlySearches: CachedMonthlySearchVolume[];
    costMicros?: bigint | null;
    fetchedAt: Date;
    expiresAt: Date;
}
/** Persistent gap row — one per (ownDomain, competitorDomain, loc, lang). */
export interface CachedGapRow {
    ownDomain: string;
    competitorDomain: string;
    rows: DomainIntersectionRow[];
    fetchedAt: Date;
    expiresAt: Date;
}
export interface WriteGapInput {
    cacheKey: string;
    ownDomain: string;
    competitorDomain: string;
    locationCode: number;
    languageCode: string;
    rows: DomainIntersectionRow[];
    costMicros?: bigint | null;
    fetchedAt: Date;
    expiresAt: Date;
}
export interface KeywordCacheRepo {
    readMetrics(cacheKey: string, now: Date): Promise<CachedMetricsRow | null>;
    /**
     * Batched read — ONE `IN` select over every cacheKey, expiry filtered at
     * read time. Returns a map keyed by cacheKey so the
     * caller can preserve input order without a second scan.
     */
    readMetricsMany(cacheKeys: readonly string[], now: Date): Promise<Map<string, CachedMetricsRow>>;
    readRelated(cacheKey: string, now: Date): Promise<CachedMetricsRow | null>;
    /**
     * Batched intent read — mirrors `readMetricsMany` (one `IN` select, expiry
     * filtered at read time). Keyed by cacheKey so callers keep input order.
     */
    readIntentMany(cacheKeys: readonly string[], now: Date): Promise<Map<string, CachedIntentRow>>;
    writeMetrics(input: WriteMetricsInput): Promise<void>;
    writeIntent(input: WriteIntentInput): Promise<void>;
    writeRelated(input: {
        cacheKey: string;
        phrase: string;
        locationCode: number;
        languageCode: string;
        related: CachedRelatedKeyword[];
        /** Actual vendor spend for the related-keywords call (micro-dollars). */
        costMicros?: bigint | null;
        fetchedAt: Date;
        expiresAt: Date;
    }): Promise<void>;
    readIdeas(cacheKey: string, now: Date): Promise<CachedIdeasRow | null>;
    writeIdeas(input: {
        cacheKey: string;
        phrase: string;
        locationCode: number;
        languageCode: string;
        ideas: CachedRelatedKeyword[];
        /** Actual vendor spend for the ideas call (micro-dollars). */
        costMicros?: bigint | null;
        fetchedAt: Date;
        expiresAt: Date;
    }): Promise<void>;
    readLongTail(cacheKey: string, now: Date): Promise<CachedLongTailRow | null>;
    writeLongTail(input: {
        cacheKey: string;
        phrase: string;
        locationCode: number;
        languageCode: string;
        suggestions: CachedRelatedKeyword[];
        costMicros?: bigint | null;
        fetchedAt: Date;
        expiresAt: Date;
    }): Promise<void>;
    /**
     * Batched overview read — mirrors `readMetricsMany` (one `IN` select scoped
     * to operation='overview', expiry filtered in-query).
     */
    readOverviewMany(cacheKeys: readonly string[], now: Date): Promise<Map<string, CachedOverviewRow>>;
    writeOverview(input: WriteOverviewInput): Promise<void>;
    /**
     * Batched trends read — mirrors `readMetricsMany` (one `IN` select scoped
     * to operation='trends', expiry filtered in-query).
     */
    readTrendsMany(cacheKeys: readonly string[], now: Date): Promise<Map<string, CachedTrendsRow>>;
    writeTrends(input: WriteTrendsInput): Promise<void>;
    /**
     * Batched gap read — mirrors `readMetricsMany` (one `IN` select scoped to
     * operation='gap', expiry filtered in-query).
     */
    readGapMany(cacheKeys: readonly string[], now: Date): Promise<Map<string, CachedGapRow>>;
    writeGap(input: WriteGapInput): Promise<void>;
}
const monthlySearchSchema = z.object({
    year: z.number(),
    month: z.number(),
    searchVolume: z.number(),
});
const metricsPayloadSchema = z.object({
    phrase: z.string(),
    searchVolume: z.number().nullable(),
    difficulty: z.number().nullable(),
    cpcMicros: z.number().nullable(),
    monthlySearches: z.array(monthlySearchSchema),
});
const cachedSuggestionSchema = z.object({
    keyword: z.string(),
    searchVolume: z.number().nullable(),
    difficulty: z.number().nullable(),
    cpcMicros: z.number().nullable(),
    monthlySearches: z.array(monthlySearchSchema),
});
const relatedPayloadSchema = z.object({
    phrase: z.string(),
    related: z.array(cachedSuggestionSchema),
});
const ideasPayloadSchema = z.object({
    phrase: z.string(),
    ideas: z.array(cachedSuggestionSchema),
});
const longTailPayloadSchema = z.object({
    phrase: z.string(),
    suggestions: z.array(cachedSuggestionSchema),
});
const intentPayloadSchema = z.object({
    phrase: z.string(),
    intent: z
        .enum(['informational', 'commercial', 'transactional', 'navigational'])
        .nullable(),
    confidence: z.number().nullable(),
});
/** Closed SERP-feature enum. Kept aligned with the type union. */
const serpFeatureSchema = z.enum([
    'ai_overview',
    'featured_snippet',
    'people_also_ask',
    'local_pack',
    'video',
    'images',
    'shopping',
    'knowledge_graph',
    'other',
]);
const overviewPayloadSchema = z.object({
    phrase: z.string(),
    searchVolume: z.number().nullable(),
    difficulty: z.number().nullable(),
    cpcMicros: z.number().nullable(),
    intent: intentPayloadSchema.shape.intent,
    serpFeatures: z.array(serpFeatureSchema),
    observedAtIso: z.string().nullable(),
    resultsCount: z.number().nullable(),
});
const trendsPayloadSchema = z.object({
    phrase: z.string(),
    monthlySearches: z.array(monthlySearchSchema),
});
const gapRowSchema = z.object({
    keyword: z.string(),
    target1Position: z.number().nullable(),
    target2Position: z.number().nullable(),
    searchVolume: z.number().nullable(),
    class: z.literal('missing').optional(),
    target1Url: z.string().url().nullable().optional(),
    target2Url: z.string().url().nullable().optional(),
    provenance: z
        .object({
        provider: z.string().min(1).max(64),
        operation: z.literal('domain_intersection_live'),
        leg: z.literal('competitor_only'),
        intersections: z.literal(false),
        targetOrder: z.literal('competitor_owned'),
        itemTypes: z.tuple([z.literal('organic')]),
        limit: z.literal(100),
        cache: z.enum(['hit', 'miss']),
        status: z.literal('success'),
        capturedAt: z.string().datetime().nullable(),
        returnedRows: z.number().int().min(0).max(100),
        truncated: z.boolean(),
    })
        .optional(),
});
const gapPayloadSchema = z.object({
    ownDomain: z.string(),
    competitorDomain: z.string(),
    rows: z.array(gapRowSchema),
});
export function createKeywordCacheRepo(db: Db): KeywordCacheRepo {
    const vendor = createVendorCacheRepo(db);
    const address = (operation: 'metrics' | 'related' | 'intent' | 'ideas' | 'long_tail' | 'overview' | 'trends' | 'gap', cacheKey: string) => ({ capability: 'keyword', operation, cacheKey }) as const;
    return {
        async readMetrics(cacheKey, now) {
            const hit = await vendor.read(address('metrics', cacheKey), now);
            if (!hit)
                return null;
            const parsed = metricsPayloadSchema.safeParse(hit.payload);
            // Stale-shape entries read as a miss; the next fresh fetch overwrites.
            if (!parsed.success)
                return null;
            return {
                phrase: parsed.data.phrase,
                searchVolume: parsed.data.searchVolume,
                difficulty: parsed.data.difficulty,
                cpcMicros: parsed.data.cpcMicros,
                cpc: cpcMicrosToDecimalString(parsed.data.cpcMicros),
                monthlySearches: parsed.data.monthlySearches,
                relatedKeywords: null,
                fetchedAt: hit.fetchedAt,
                expiresAt: hit.expiresAt,
            };
        },
        async readMetricsMany(cacheKeys, now) {
            // One `IN` select over every cacheKey vs. the
            // per-phrase round trip. Expiry filter is inlined into the query so the
            // driver never rehydrates stale rows.
            const out = new Map<string, CachedMetricsRow>();
            if (cacheKeys.length === 0)
                return out;
            const rows = await db
                .select({
                cacheKey: vendorCache.cacheKey,
                payload: vendorCache.payload,
                fetchedAt: vendorCache.fetchedAt,
                expiresAt: vendorCache.expiresAt,
            })
                .from(vendorCache)
                .where(and(eq(vendorCache.capability, 'keyword'), eq(vendorCache.operation, 'metrics'), inArray(vendorCache.cacheKey, [...cacheKeys]), gt(vendorCache.expiresAt, now)));
            for (const row of rows) {
                const parsed = metricsPayloadSchema.safeParse(row.payload);
                // Stale-shape entries read as a miss (same policy as readMetrics).
                if (!parsed.success)
                    continue;
                out.set(row.cacheKey, {
                    phrase: parsed.data.phrase,
                    searchVolume: parsed.data.searchVolume,
                    difficulty: parsed.data.difficulty,
                    cpcMicros: parsed.data.cpcMicros,
                    cpc: cpcMicrosToDecimalString(parsed.data.cpcMicros),
                    monthlySearches: parsed.data.monthlySearches,
                    relatedKeywords: null,
                    fetchedAt: row.fetchedAt,
                    expiresAt: row.expiresAt,
                });
            }
            return out;
        },
        async readIntentMany(cacheKeys, now) {
            // Mirrors readMetricsMany — one `IN` select scoped to operation='intent',
            // expiry filtered in-query so stale rows never rehydrate.
            const out = new Map<string, CachedIntentRow>();
            if (cacheKeys.length === 0)
                return out;
            const rows = await db
                .select({
                cacheKey: vendorCache.cacheKey,
                payload: vendorCache.payload,
                fetchedAt: vendorCache.fetchedAt,
                expiresAt: vendorCache.expiresAt,
            })
                .from(vendorCache)
                .where(and(eq(vendorCache.capability, 'keyword'), eq(vendorCache.operation, 'intent'), inArray(vendorCache.cacheKey, [...cacheKeys]), gt(vendorCache.expiresAt, now)));
            for (const row of rows) {
                const parsed = intentPayloadSchema.safeParse(row.payload);
                // Stale-shape entries read as a miss (same policy as readMetricsMany).
                if (!parsed.success)
                    continue;
                out.set(row.cacheKey, {
                    phrase: parsed.data.phrase,
                    intent: parsed.data.intent,
                    confidence: parsed.data.confidence,
                    fetchedAt: row.fetchedAt,
                    expiresAt: row.expiresAt,
                });
            }
            return out;
        },
        async readRelated(cacheKey, now) {
            const hit = await vendor.read(address('related', cacheKey), now);
            if (!hit)
                return null;
            const parsed = relatedPayloadSchema.safeParse(hit.payload);
            if (!parsed.success)
                return null;
            return {
                phrase: parsed.data.phrase,
                searchVolume: null,
                difficulty: null,
                cpcMicros: null,
                cpc: null,
                monthlySearches: [],
                relatedKeywords: parsed.data.related,
                fetchedAt: hit.fetchedAt,
                expiresAt: hit.expiresAt,
            };
        },
        async writeMetrics(input) {
            const params = {
                phrase: input.phrase,
                locationCode: input.locationCode,
                languageCode: input.languageCode.toLowerCase(),
            };
            const payload = {
                phrase: input.phrase,
                searchVolume: input.searchVolume,
                difficulty: input.difficulty,
                cpcMicros: cpcToMicros(input.cpc),
                monthlySearches: input.monthlySearches,
            };
            await vendor.appendResponse({
                ...address('metrics', input.cacheKey),
                params,
                payload,
                costMicros: input.costMicros ?? null,
                fetchedAt: input.fetchedAt,
            });
            await vendor.upsert({
                ...address('metrics', input.cacheKey),
                params,
                payload,
                fetchedAt: input.fetchedAt,
                expiresAt: input.expiresAt,
            });
        },
        async writeIntent(input) {
            const params = {
                phrase: input.phrase,
                locationCode: input.locationCode,
                languageCode: input.languageCode.toLowerCase(),
            };
            const payload = {
                phrase: input.phrase,
                intent: input.intent,
                confidence: input.confidence,
            };
            await vendor.appendResponse({
                ...address('intent', input.cacheKey),
                params,
                payload,
                costMicros: input.costMicros ?? null,
                fetchedAt: input.fetchedAt,
            });
            await vendor.upsert({
                ...address('intent', input.cacheKey),
                params,
                payload,
                fetchedAt: input.fetchedAt,
                expiresAt: input.expiresAt,
            });
        },
        async writeRelated(input) {
            const params = {
                phrase: input.phrase,
                locationCode: input.locationCode,
                languageCode: input.languageCode.toLowerCase(),
            };
            const payload = { phrase: input.phrase, related: input.related };
            await vendor.appendResponse({
                ...address('related', input.cacheKey),
                params,
                payload,
                costMicros: input.costMicros ?? null,
                fetchedAt: input.fetchedAt,
            });
            await vendor.upsert({
                ...address('related', input.cacheKey),
                params,
                payload,
                fetchedAt: input.fetchedAt,
                expiresAt: input.expiresAt,
            });
        },
        async readIdeas(cacheKey, now) {
            const hit = await vendor.read(address('ideas', cacheKey), now);
            if (!hit)
                return null;
            const parsed = ideasPayloadSchema.safeParse(hit.payload);
            // Stale-shape entries read as a miss (same policy as readRelated).
            if (!parsed.success)
                return null;
            return {
                phrase: parsed.data.phrase,
                ideas: parsed.data.ideas,
                fetchedAt: hit.fetchedAt,
                expiresAt: hit.expiresAt,
            };
        },
        async writeIdeas(input) {
            const params = {
                phrase: input.phrase,
                locationCode: input.locationCode,
                languageCode: input.languageCode.toLowerCase(),
            };
            const payload = { phrase: input.phrase, ideas: input.ideas };
            await vendor.appendResponse({
                ...address('ideas', input.cacheKey),
                params,
                payload,
                costMicros: input.costMicros ?? null,
                fetchedAt: input.fetchedAt,
            });
            await vendor.upsert({
                ...address('ideas', input.cacheKey),
                params,
                payload,
                fetchedAt: input.fetchedAt,
                expiresAt: input.expiresAt,
            });
        },
        async readLongTail(cacheKey, now) {
            const hit = await vendor.read(address('long_tail', cacheKey), now);
            if (!hit)
                return null;
            const parsed = longTailPayloadSchema.safeParse(hit.payload);
            if (!parsed.success)
                return null;
            return {
                phrase: parsed.data.phrase,
                suggestions: parsed.data.suggestions,
                fetchedAt: hit.fetchedAt,
                expiresAt: hit.expiresAt,
            };
        },
        async writeLongTail(input) {
            const params = {
                phrase: input.phrase,
                locationCode: input.locationCode,
                languageCode: input.languageCode.toLowerCase(),
            };
            const payload = { phrase: input.phrase, suggestions: input.suggestions };
            await vendor.appendResponse({
                ...address('long_tail', input.cacheKey),
                params,
                payload,
                costMicros: input.costMicros ?? null,
                fetchedAt: input.fetchedAt,
            });
            await vendor.upsert({
                ...address('long_tail', input.cacheKey),
                params,
                payload,
                fetchedAt: input.fetchedAt,
                expiresAt: input.expiresAt,
            });
        },
        async readOverviewMany(cacheKeys, now) {
            const out = new Map<string, CachedOverviewRow>();
            if (cacheKeys.length === 0)
                return out;
            const rows = await db
                .select({
                cacheKey: vendorCache.cacheKey,
                payload: vendorCache.payload,
                fetchedAt: vendorCache.fetchedAt,
                expiresAt: vendorCache.expiresAt,
            })
                .from(vendorCache)
                .where(and(eq(vendorCache.capability, 'keyword'), eq(vendorCache.operation, 'overview'), inArray(vendorCache.cacheKey, [...cacheKeys]), gt(vendorCache.expiresAt, now)));
            for (const row of rows) {
                const parsed = overviewPayloadSchema.safeParse(row.payload);
                // Stale-shape entries read as a miss (same policy as readMetricsMany).
                if (!parsed.success)
                    continue;
                out.set(row.cacheKey, {
                    phrase: parsed.data.phrase,
                    searchVolume: parsed.data.searchVolume,
                    difficulty: parsed.data.difficulty,
                    cpcMicros: parsed.data.cpcMicros,
                    intent: parsed.data.intent,
                    serpFeatures: parsed.data.serpFeatures,
                    observedAt: parsed.data.observedAtIso
                        ? new Date(parsed.data.observedAtIso)
                        : null,
                    resultsCount: parsed.data.resultsCount,
                    fetchedAt: row.fetchedAt,
                    expiresAt: row.expiresAt,
                });
            }
            return out;
        },
        async writeOverview(input) {
            const params = {
                phrase: input.phrase,
                locationCode: input.locationCode,
                languageCode: input.languageCode.toLowerCase(),
            };
            const payload = {
                phrase: input.phrase,
                searchVolume: input.searchVolume,
                difficulty: input.difficulty,
                cpcMicros: cpcToMicros(input.cpc),
                intent: input.intent,
                serpFeatures: input.serpFeatures,
                observedAtIso: input.observedAt ? input.observedAt.toISOString() : null,
                resultsCount: input.resultsCount,
            };
            await vendor.appendResponse({
                ...address('overview', input.cacheKey),
                params,
                payload,
                costMicros: input.costMicros ?? null,
                fetchedAt: input.fetchedAt,
            });
            await vendor.upsert({
                ...address('overview', input.cacheKey),
                params,
                payload,
                fetchedAt: input.fetchedAt,
                expiresAt: input.expiresAt,
            });
        },
        async readTrendsMany(cacheKeys, now) {
            const out = new Map<string, CachedTrendsRow>();
            if (cacheKeys.length === 0)
                return out;
            const rows = await db
                .select({
                cacheKey: vendorCache.cacheKey,
                payload: vendorCache.payload,
                fetchedAt: vendorCache.fetchedAt,
                expiresAt: vendorCache.expiresAt,
            })
                .from(vendorCache)
                .where(and(eq(vendorCache.capability, 'keyword'), eq(vendorCache.operation, 'trends'), inArray(vendorCache.cacheKey, [...cacheKeys]), gt(vendorCache.expiresAt, now)));
            for (const row of rows) {
                const parsed = trendsPayloadSchema.safeParse(row.payload);
                // Stale-shape entries read as a miss (same policy as readMetricsMany).
                if (!parsed.success)
                    continue;
                out.set(row.cacheKey, {
                    phrase: parsed.data.phrase,
                    monthlySearches: parsed.data.monthlySearches,
                    fetchedAt: row.fetchedAt,
                    expiresAt: row.expiresAt,
                });
            }
            return out;
        },
        async writeTrends(input) {
            const params = {
                phrase: input.phrase,
                locationCode: input.locationCode,
                languageCode: input.languageCode.toLowerCase(),
            };
            const payload = {
                phrase: input.phrase,
                monthlySearches: input.monthlySearches,
            };
            await vendor.appendResponse({
                ...address('trends', input.cacheKey),
                params,
                payload,
                costMicros: input.costMicros ?? null,
                fetchedAt: input.fetchedAt,
            });
            await vendor.upsert({
                ...address('trends', input.cacheKey),
                params,
                payload,
                fetchedAt: input.fetchedAt,
                expiresAt: input.expiresAt,
            });
        },
        async readGapMany(cacheKeys, now) {
            const out = new Map<string, CachedGapRow>();
            if (cacheKeys.length === 0)
                return out;
            const rows = await db
                .select({
                cacheKey: vendorCache.cacheKey,
                payload: vendorCache.payload,
                fetchedAt: vendorCache.fetchedAt,
                expiresAt: vendorCache.expiresAt,
            })
                .from(vendorCache)
                .where(and(eq(vendorCache.capability, 'keyword'), eq(vendorCache.operation, 'gap'), inArray(vendorCache.cacheKey, [...cacheKeys]), gt(vendorCache.expiresAt, now)));
            for (const row of rows) {
                const parsed = gapPayloadSchema.safeParse(row.payload);
                // Stale-shape entries read as a miss (same policy as readMetricsMany).
                if (!parsed.success)
                    continue;
                out.set(row.cacheKey, {
                    ownDomain: parsed.data.ownDomain,
                    competitorDomain: parsed.data.competitorDomain,
                    rows: parsed.data.rows,
                    fetchedAt: row.fetchedAt,
                    expiresAt: row.expiresAt,
                });
            }
            return out;
        },
        async writeGap(input) {
            const params = {
                ownDomain: input.ownDomain,
                competitorDomain: input.competitorDomain,
                locationCode: input.locationCode,
                languageCode: input.languageCode.toLowerCase(),
            };
            const payload = {
                ownDomain: input.ownDomain,
                competitorDomain: input.competitorDomain,
                rows: input.rows,
            };
            await vendor.appendResponse({
                ...address('gap', input.cacheKey),
                params,
                payload,
                costMicros: input.costMicros ?? null,
                fetchedAt: input.fetchedAt,
            });
            await vendor.upsert({
                ...address('gap', input.cacheKey),
                params,
                payload,
                fetchedAt: input.fetchedAt,
                expiresAt: input.expiresAt,
            });
        },
    };
}
