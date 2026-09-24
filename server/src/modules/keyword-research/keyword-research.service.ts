/**
 * Keyword-research service.
 *
 * Cache-first: read every requested phrase from Postgres first; only the
 * misses flow to the provider in a single batched call. All provider errors
 * bubble as a localized `unavailable` HttpError — never blocks the audit or
 * rank runs because this module has zero shared state with those modules.
 */
import { z } from 'zod';
import type { HydratedDocument } from 'mongoose';
import type { CompetitorProvider, DomainComparisonRow, DomainIntersectionRow, IntentResult, KeywordHistoricalVolume, KeywordMetrics, KeywordOverview, KeywordProvider, SearchIntent, SerpFeatureType, TrendsExploreResult, TrendsProvider, } from '../../shared/providers/index.js';
import { ProviderError, captureVendorCost } from '../../shared/providers/index.js';
import { normalizeSerpFeatures } from '../../shared/providers/serp-features.js';
import { HttpError } from '../../shared/utils/http-error.js';
import type { Db } from '../../db/client.js';
import { createReadThrough } from '../../shared/vendor-cache/read-through.js';
import { createSingleFlight } from '../../shared/vendor-cache/single-flight.js';
import { createVendorCacheRepo } from '../../shared/vendor-cache/vendor-cache.repo.js';
import { computeVendorCacheKey } from '../../shared/vendor-cache/cache-key.js';
import { TrendsExplorationRun, type TrendsExplorationRunDoc, } from './trends-explorations.model.js';
import { Site } from '../sites/sites.model.js';
import { estimateEnvelope, momentum, seasonalityMonths, yearOverYear, type WeeklyPoint, } from './keyword-research.trends.js';
import { DEFAULT_KEYWORD_CACHE_TTL_DAYS, cpcMicrosToDecimalString, cpcToMicros, computeGapCacheKey, computeKeywordCacheKey, createKeywordCacheRepo, normalizeCacheDomain, normalizeCachePhrase, type CachedGapRow, type CachedMetricsRow, type CachedOverviewRow, type CachedRelatedKeyword, type CachedTrendsRow, type KeywordCacheRepo, } from './keyword-research.cache.js';
export interface KeywordResearchServiceDeps {
    db: Db;
    provider: KeywordProvider;
    ttlDays: number;
    now?: () => Date;
    /**
     * Optional competitor capability — required only by `getGapCached`. Wired
     * through the keyword-research holder so the module never imports from
     * the sibling competitors feature module.
     */
    competitorProvider?: CompetitorProvider;
}
/**
 * Archive rows are per-phrase but the vendor call is batched — spread the
 * captured spend evenly across the batch, parking the integer-division
 * remainder on the first row so the per-batch sum stays exact.
 */
export function allocateBatchCostMicros(total: bigint | null, count: number, index: number): bigint | null {
    if (total === null)
        return null;
    const n = BigInt(count);
    const base = total / n;
    return index === 0 ? base + (total % n) : base;
}
export interface KeywordMetricPayload {
    keyword: string;
    searchVolume: number | null;
    difficulty: number | null;
    cpc: string | null;
    monthlySearches: Array<{
        year: number;
        month: number;
        searchVolume: number;
    }>;
    cached: boolean;
    fetchedAt: string;
    expiresAt: string;
}
export interface RelatedKeywordPayload {
    keyword: string;
    searchVolume: number | null;
    difficulty: number | null;
    cpc: string | null;
    monthlySearches: Array<{
        year: number;
        month: number;
        searchVolume: number;
    }>;
}
export const LONG_TAIL_SUGGESTION_LIMIT = 25;
export interface IntentPayload {
    keyword: string;
    intent: SearchIntent | null;
    confidence: number | null;
    cached: boolean;
    fetchedAt: string;
    expiresAt: string;
}
function computeExpiry(now: Date, ttlDays: number): Date {
    return new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);
}
/**
 * Wrap any provider failure in a localized "unavailable" HTTP error. Never
 * lets a ProviderError escape unhandled — that would let a keyword-research
 * failure trigger a 500 on unrelated user surfaces.
 */
function wrapProviderError(err: unknown): never {
    if (err instanceof ProviderError) {
        throw new HttpError(503, { code: 'KEYWORD_RESEARCH_ERRORS_UNAVAILABLE', messageKey: 'keywordResearch.errors.unavailable' }, undefined, { cause: err });
    }
    throw err;
}
function toMetricPayload(cached: CachedMetricsRow, fromCache: boolean): KeywordMetricPayload {
    return {
        keyword: cached.phrase,
        searchVolume: cached.searchVolume,
        difficulty: cached.difficulty,
        cpc: cached.cpc,
        monthlySearches: cached.monthlySearches,
        cached: fromCache,
        fetchedAt: cached.fetchedAt.toISOString(),
        expiresAt: cached.expiresAt.toISOString(),
    };
}
function metricsToPayload(metrics: KeywordMetrics, fetchedAt: Date, expiresAt: Date, fromCache: boolean): KeywordMetricPayload {
    return {
        keyword: metrics.keyword,
        searchVolume: metrics.searchVolume,
        difficulty: metrics.difficulty,
        cpc: cpcMicrosToDecimalString(cpcToMicros(metrics.cpc)),
        monthlySearches: metrics.monthlySearches,
        cached: fromCache,
        fetchedAt: fetchedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
    };
}
/**
 * Normalize + dedupe the keyword list the way the metrics service will fetch
 * it. Exported so the controller logs the exact deduped phrase list in the
 * research history.
 */
export function dedupeKeywordPhrases(raw: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const phrase of raw.map(normalizeCachePhrase)) {
        if (phrase.length === 0 || seen.has(phrase))
            continue;
        seen.add(phrase);
        out.push(phrase);
    }
    return out;
}
export async function getMetricsCached(input: {
    keywords: string[];
    locationCode: number;
    languageCode: string;
}, deps: KeywordResearchServiceDeps): Promise<KeywordMetricPayload[]> {
    const nowFn = deps.now ?? (() => new Date());
    const repo = createKeywordCacheRepo(deps.db);
    const now = nowFn();
    const dedupedPhrases = dedupeKeywordPhrases(input.keywords);
    const results: (KeywordMetricPayload | null)[] = new Array(dedupedPhrases.length).fill(null);
    const misses: string[] = [];
    const missIndex = new Map<string, number>();
    // ONE cache read for the whole page. Compute the
    // per-phrase cache key once so the miss-write loop below reuses it.
    const keyByPhrase = new Map<string, string>();
    for (const phrase of dedupedPhrases) {
        keyByPhrase.set(phrase, computeKeywordCacheKey({
            phrase,
            locationCode: input.locationCode,
            languageCode: input.languageCode,
        }));
    }
    const hitsByKey = await repo.readMetricsMany(Array.from(keyByPhrase.values()), now);
    for (let i = 0; i < dedupedPhrases.length; i += 1) {
        const phrase = dedupedPhrases[i]!;
        const key = keyByPhrase.get(phrase)!;
        const hit = hitsByKey.get(key);
        if (hit) {
            results[i] = toMetricPayload(hit, true);
        }
        else {
            missIndex.set(phrase, i);
            misses.push(phrase);
        }
    }
    if (misses.length > 0) {
        let vendorMetrics: KeywordMetrics[];
        let batchCostMicros: bigint | null;
        try {
            const captured = await captureVendorCost(() => deps.provider.getMetrics(misses, input.locationCode, input.languageCode));
            vendorMetrics = captured.value;
            batchCostMicros = captured.costMicros;
        }
        catch (err) {
            wrapProviderError(err);
        }
        const fetchedAt = nowFn();
        const expiresAt = computeExpiry(fetchedAt, deps.ttlDays);
        const byKeyword = new Map<string, KeywordMetrics>();
        for (const m of vendorMetrics) {
            byKeyword.set(normalizeCachePhrase(m.keyword), m);
        }
        // Fan the miss-writes out in parallel so N phrases
        // take one round trip's worth of wall clock instead of N.
        await Promise.all(misses.map(async (phrase, missIdx) => {
            const metrics: KeywordMetrics = byKeyword.get(phrase) ?? {
                keyword: phrase,
                searchVolume: null,
                difficulty: null,
                cpc: null,
                monthlySearches: [],
            };
            const key = keyByPhrase.get(phrase)!;
            await repo.writeMetrics({
                cacheKey: key,
                phrase,
                locationCode: input.locationCode,
                languageCode: input.languageCode,
                searchVolume: metrics.searchVolume,
                difficulty: metrics.difficulty,
                cpc: metrics.cpc,
                monthlySearches: metrics.monthlySearches,
                costMicros: allocateBatchCostMicros(batchCostMicros, misses.length, missIdx),
                fetchedAt,
                expiresAt,
            });
            const idx = missIndex.get(phrase)!;
            results[idx] = metricsToPayload({ ...metrics, keyword: phrase }, fetchedAt, expiresAt, false);
        }));
    }
    return results.filter((r): r is KeywordMetricPayload => r !== null);
}
export async function getRelatedCached(input: {
    keyword: string;
    locationCode: number;
    languageCode: string;
    limit?: number;
}, deps: KeywordResearchServiceDeps): Promise<{
    keyword: string;
    related: RelatedKeywordPayload[];
    cached: boolean;
}> {
    const nowFn = deps.now ?? (() => new Date());
    const phrase = normalizeCachePhrase(input.keyword);
    const cacheKey = computeKeywordCacheKey({
        phrase,
        locationCode: input.locationCode,
        languageCode: input.languageCode,
    });
    const repo = createKeywordCacheRepo(deps.db);
    const now = nowFn();
    const hit = await repo.readRelated(cacheKey, now);
    if (hit && hit.relatedKeywords) {
        return {
            keyword: phrase,
            related: hit.relatedKeywords.map(cachedRelatedToPayload),
            cached: true,
        };
    }
    const limit = Math.max(1, Math.min(input.limit ?? 25, 1000));
    let vendorRows: KeywordMetrics[];
    let relatedCostMicros: bigint | null;
    try {
        const captured = await captureVendorCost(() => deps.provider.getRelated(phrase, input.locationCode, input.languageCode, limit));
        vendorRows = captured.value;
        relatedCostMicros = captured.costMicros;
    }
    catch (err) {
        wrapProviderError(err);
    }
    const fetchedAt = nowFn();
    const expiresAt = computeExpiry(fetchedAt, deps.ttlDays);
    const cachePayload: CachedRelatedKeyword[] = vendorRows.map((row) => ({
        keyword: row.keyword,
        searchVolume: row.searchVolume,
        difficulty: row.difficulty,
        cpcMicros: cpcToMicros(row.cpc),
        monthlySearches: row.monthlySearches,
    }));
    await repo.writeRelated({
        cacheKey,
        phrase,
        locationCode: input.locationCode,
        languageCode: input.languageCode,
        related: cachePayload,
        costMicros: relatedCostMicros,
        fetchedAt,
        expiresAt,
    });
    return {
        keyword: phrase,
        related: cachePayload.map(cachedRelatedToPayload),
        cached: false,
    };
}
function cachedRelatedToPayload(row: CachedRelatedKeyword): RelatedKeywordPayload {
    return {
        keyword: row.keyword,
        searchVolume: row.searchVolume,
        difficulty: row.difficulty,
        cpc: cpcMicrosToDecimalString(row.cpcMicros),
        monthlySearches: row.monthlySearches,
    };
}
/**
 * Cache-first intent classification. Structurally identical to
 * `getMetricsCached` (one batched cache read, misses to the provider, parallel
 * miss-writes) but against the SAME KeywordCacheRepo's independent `intent`
 * operation — one cache, one TTL. Intent rarely changes for a given
 * keyword+locale so it reuses the volume/difficulty cache lifecycle.
 */
export async function classifyIntentCached(input: {
    keywords: string[];
    locationCode: number;
    languageCode: string;
}, deps: KeywordResearchServiceDeps): Promise<IntentPayload[]> {
    const nowFn = deps.now ?? (() => new Date());
    const repo = createKeywordCacheRepo(deps.db);
    const now = nowFn();
    const dedupedPhrases = dedupeKeywordPhrases(input.keywords);
    const results: (IntentPayload | null)[] = new Array(dedupedPhrases.length).fill(null);
    const misses: string[] = [];
    const missIndex = new Map<string, number>();
    const keyByPhrase = new Map<string, string>();
    for (const phrase of dedupedPhrases) {
        keyByPhrase.set(phrase, computeKeywordCacheKey({
            phrase,
            locationCode: input.locationCode,
            languageCode: input.languageCode,
        }));
    }
    const hitsByKey = await repo.readIntentMany(Array.from(keyByPhrase.values()), now);
    for (let i = 0; i < dedupedPhrases.length; i += 1) {
        const phrase = dedupedPhrases[i]!;
        const key = keyByPhrase.get(phrase)!;
        const hit = hitsByKey.get(key);
        if (hit) {
            results[i] = {
                keyword: phrase,
                intent: hit.intent,
                confidence: hit.confidence,
                cached: true,
                fetchedAt: hit.fetchedAt.toISOString(),
                expiresAt: hit.expiresAt.toISOString(),
            };
        }
        else {
            missIndex.set(phrase, i);
            misses.push(phrase);
        }
    }
    if (misses.length > 0) {
        let vendorIntents: IntentResult[];
        let batchCostMicros: bigint | null;
        try {
            const captured = await captureVendorCost(() => deps.provider.classifyIntent(misses, input.locationCode, input.languageCode));
            vendorIntents = captured.value;
            batchCostMicros = captured.costMicros;
        }
        catch (err) {
            wrapProviderError(err);
        }
        const fetchedAt = nowFn();
        const expiresAt = computeExpiry(fetchedAt, deps.ttlDays);
        const byKeyword = new Map<string, IntentResult>();
        for (const r of vendorIntents) {
            byKeyword.set(normalizeCachePhrase(r.keyword), r);
        }
        await Promise.all(misses.map(async (phrase, missIdx) => {
            const r: IntentResult = byKeyword.get(phrase) ?? { keyword: phrase, intent: null, confidence: null };
            const key = keyByPhrase.get(phrase)!;
            await repo.writeIntent({
                cacheKey: key,
                phrase,
                locationCode: input.locationCode,
                languageCode: input.languageCode,
                intent: r.intent,
                confidence: r.confidence,
                costMicros: allocateBatchCostMicros(batchCostMicros, misses.length, missIdx),
                fetchedAt,
                expiresAt,
            });
            results[missIndex.get(phrase)!] = {
                keyword: phrase,
                intent: r.intent,
                confidence: r.confidence,
                cached: false,
                fetchedAt: fetchedAt.toISOString(),
                expiresAt: expiresAt.toISOString(),
            };
        }));
    }
    return results.filter((r): r is IntentPayload => r !== null);
}
/**
 * Cache-first keyword ideas — same lifecycle as getRelated (one seed, one
 * vendor call, one cache row under the independent `ideas` operation). Ideas
 * were originally uncached for freshness, but the vendor's suggestion corpus
 * updates on the same monthly cycle as volume/difficulty, so a cross-user
 * 30-day hit beats a duplicate vendor bill. `limit` is deliberately NOT part
 * of the cache key (same convention as getRelated) — the first fetch's corpus
 * serves every later limit.
 */
export async function getIdeasCached(input: {
    seed: string;
    locationCode: number;
    languageCode: string;
    limit?: number;
}, deps: KeywordResearchServiceDeps): Promise<{
    seed: string;
    ideas: RelatedKeywordPayload[];
    cached: boolean;
}> {
    const nowFn = deps.now ?? (() => new Date());
    const phrase = normalizeCachePhrase(input.seed);
    const cacheKey = computeKeywordCacheKey({
        phrase,
        locationCode: input.locationCode,
        languageCode: input.languageCode,
    });
    const repo = createKeywordCacheRepo(deps.db);
    const now = nowFn();
    const hit = await repo.readIdeas(cacheKey, now);
    if (hit) {
        return {
            seed: phrase,
            ideas: hit.ideas.map(cachedRelatedToPayload),
            cached: true,
        };
    }
    const limit = Math.max(1, Math.min(input.limit ?? 25, 1000));
    let vendorRows: KeywordMetrics[];
    let ideasCostMicros: bigint | null;
    try {
        const captured = await captureVendorCost(() => deps.provider.getIdeas(input.seed, input.locationCode, input.languageCode, limit));
        vendorRows = captured.value;
        ideasCostMicros = captured.costMicros;
    }
    catch (err) {
        wrapProviderError(err);
    }
    const fetchedAt = nowFn();
    const expiresAt = computeExpiry(fetchedAt, deps.ttlDays);
    const cachePayload: CachedRelatedKeyword[] = vendorRows.map((row) => ({
        keyword: row.keyword,
        searchVolume: row.searchVolume,
        difficulty: row.difficulty,
        cpcMicros: cpcToMicros(row.cpc),
        monthlySearches: row.monthlySearches,
    }));
    await repo.writeIdeas({
        cacheKey,
        phrase,
        locationCode: input.locationCode,
        languageCode: input.languageCode,
        ideas: cachePayload,
        costMicros: ideasCostMicros,
        fetchedAt,
        expiresAt,
    });
    return {
        seed: phrase,
        ideas: cachePayload.map(cachedRelatedToPayload),
        cached: false,
    };
}
export async function getLongTailSuggestionsCached(input: {
    seed: string;
    locationCode: number;
    languageCode: string;
}, deps: KeywordResearchServiceDeps): Promise<{
    seed: string;
    suggestions: RelatedKeywordPayload[];
    cached: boolean;
}> {
    const nowFn = deps.now ?? (() => new Date());
    const phrase = normalizeCachePhrase(input.seed);
    const cacheKey = computeKeywordCacheKey({
        phrase,
        locationCode: input.locationCode,
        languageCode: input.languageCode,
    });
    const repo = createKeywordCacheRepo(deps.db);
    const hit = await repo.readLongTail(cacheKey, nowFn());
    if (hit) {
        return {
            seed: phrase,
            suggestions: hit.suggestions.map(cachedRelatedToPayload),
            cached: true,
        };
    }
    let vendorRows: KeywordMetrics[];
    let costMicros: bigint | null;
    try {
        const captured = await captureVendorCost(() => deps.provider.getLongTailSuggestions(phrase, input.locationCode, input.languageCode, LONG_TAIL_SUGGESTION_LIMIT));
        vendorRows = captured.value;
        costMicros = captured.costMicros;
    }
    catch (err) {
        wrapProviderError(err);
    }
    const fetchedAt = nowFn();
    const expiresAt = computeExpiry(fetchedAt, deps.ttlDays);
    const suggestions: CachedRelatedKeyword[] = vendorRows
        .slice(0, LONG_TAIL_SUGGESTION_LIMIT)
        .map((row) => ({
        keyword: row.keyword,
        searchVolume: row.searchVolume,
        difficulty: row.difficulty,
        cpcMicros: cpcToMicros(row.cpc),
        monthlySearches: row.monthlySearches,
    }));
    await repo.writeLongTail({
        cacheKey,
        phrase,
        locationCode: input.locationCode,
        languageCode: input.languageCode,
        suggestions,
        costMicros,
        fetchedAt,
        expiresAt,
    });
    return {
        seed: phrase,
        suggestions: suggestions.map(cachedRelatedToPayload),
        cached: false,
    };
}
// ---------------------------------------------------------------------------
// Keyword gap / overview / trends
// ---------------------------------------------------------------------------
/**
 * Compact metadata attached to every row.
 *
 * `kind` distinguishes deterministic vendor observations (positions, SERP
 * features) from estimated aggregates (volume, difficulty, cpc, trend math)
 * and AI interpretations (not used at this seam). `market` mirrors the
 * request's `SiteMarket` shape; `observedAt` and `freshUntil` come from the
 * vendor-fetch time and the cache row's expiry respectively.
 */
export type ObservationKind = 'estimate' | 'provider_observation' | 'ai_interpretation';
export interface ObservationMeta {
    kind: ObservationKind;
    observedAt: string;
    freshUntil: string;
    market: {
        locationCode: number;
        languageCode: string;
    };
}
export interface KeywordOverviewPayload {
    keyword: string;
    searchVolume: number | null;
    difficulty: number | null;
    cpc: string | null;
    intent: SearchIntent | null;
    serpFeatures: SerpFeatureType[];
    resultsCount: number | null;
    observedAt: string | null;
    cached: boolean;
    fetchedAt: string;
    expiresAt: string;
    meta: ObservationMeta;
}
export interface KeywordTrendsSummary {
    yoyDelta: number | null;
    twelveMonthMomentum: number | null;
    seasonalityFlags: {
        peakMonth: number | null;
        troughMonth: number | null;
    };
}
export interface KeywordTrendsPayload {
    keyword: string;
    monthlySearches: Array<{
        year: number;
        month: number;
        searchVolume: number;
    }>;
    trends: KeywordTrendsSummary;
    cached: boolean;
    fetchedAt: string;
    expiresAt: string;
    meta: ObservationMeta;
}
export interface GapRowPayload {
    keyword: string;
    ownPosition: number | null;
    competitorPosition: number | null;
    searchVolume: number | null;
    class: 'missing';
    ownUrl: string | null;
    competitorUrl: string | null;
    provenance: NonNullable<DomainIntersectionRow['provenance']>;
}
export interface GapPairPayload {
    ownDomain: string;
    competitorDomain: string;
    cached: boolean;
    fetchedAt: string;
    expiresAt: string;
    rows: GapRowPayload[];
    meta: ObservationMeta;
}
/** Hard row ceiling per pair. */
export const GAP_LIMIT_PER_PAIR = 200;
/**
 * SERP-feature normalization moved to the ONE shared authority
 * (`shared/providers/serp-features.ts`). This
 * re-export keeps the historical import path — and every consumer/test that
 * uses it — working unmodified while a single module owns the implementation.
 */
export { normalizeSerpFeatures } from '../../shared/providers/serp-features.js';
function requireCompetitorProvider(deps: KeywordResearchServiceDeps): CompetitorProvider {
    if (!deps.competitorProvider) {
        throw new Error('keyword-research service: competitorProvider is required for getGapCached');
    }
    return deps.competitorProvider;
}
function metaForEstimate(observedAt: Date, expiresAt: Date, locationCode: number, languageCode: string): ObservationMeta {
    return {
        kind: 'estimate',
        observedAt: observedAt.toISOString(),
        freshUntil: expiresAt.toISOString(),
        market: { locationCode, languageCode: languageCode.toLowerCase() },
    };
}
function metaForObservation(observedAt: Date, expiresAt: Date, locationCode: number, languageCode: string): ObservationMeta {
    return {
        kind: 'provider_observation',
        observedAt: observedAt.toISOString(),
        freshUntil: expiresAt.toISOString(),
        market: { locationCode, languageCode: languageCode.toLowerCase() },
    };
}
function overviewFromCache(row: CachedOverviewRow, fromCache: boolean, locationCode: number, languageCode: string): KeywordOverviewPayload {
    return {
        keyword: row.phrase,
        searchVolume: row.searchVolume,
        difficulty: row.difficulty,
        cpc: cpcMicrosToDecimalString(row.cpcMicros),
        intent: row.intent,
        serpFeatures: row.serpFeatures,
        resultsCount: row.resultsCount,
        observedAt: row.observedAt ? row.observedAt.toISOString() : null,
        cached: fromCache,
        fetchedAt: row.fetchedAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
        // SERP-feature list + resultsCount are direct vendor observations; the
        // scalar aggregates on the same row are estimates. We tag the top-level
        // payload as `provider_observation` because the row includes at least
        // one observation field; downstream consumers that want the aggregate
        // slice can re-tag when they extract volume/difficulty/cpc.
        meta: metaForObservation(row.fetchedAt, row.expiresAt, locationCode, languageCode),
    };
}
function overviewFromVendor(vendor: KeywordOverview | null, phrase: string, fetchedAt: Date, expiresAt: Date, locationCode: number, languageCode: string): KeywordOverviewPayload {
    const searchVolume = vendor?.searchVolume ?? null;
    const difficulty = vendor?.difficulty ?? null;
    const cpc = vendor?.cpc ?? null;
    const intent = vendor?.intent ?? null;
    const serpFeatures = normalizeSerpFeatures(vendor?.serpFeatures);
    const resultsCount = vendor?.resultsCount ?? null;
    const observedAt = vendor?.observedAt ?? null;
    return {
        keyword: phrase,
        searchVolume,
        difficulty,
        cpc: cpcMicrosToDecimalString(cpcToMicros(cpc)),
        intent,
        serpFeatures,
        resultsCount,
        observedAt: observedAt ? observedAt.toISOString() : null,
        cached: false,
        fetchedAt: fetchedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        meta: metaForObservation(fetchedAt, expiresAt, locationCode, languageCode),
    };
}
/**
 * Cache-first SERP-feature overview per keyword. Deduped
 * misses go to the provider in ONE batched call; hits and misses are
 * returned in input order.
 */
export async function getOverviewCached(input: {
    keywords: string[];
    locationCode: number;
    languageCode: string;
}, deps: KeywordResearchServiceDeps): Promise<KeywordOverviewPayload[]> {
    const nowFn = deps.now ?? (() => new Date());
    const repo = createKeywordCacheRepo(deps.db);
    const now = nowFn();
    const dedupedPhrases = dedupeKeywordPhrases(input.keywords);
    const results: (KeywordOverviewPayload | null)[] = new Array(dedupedPhrases.length).fill(null);
    const misses: string[] = [];
    const missIndex = new Map<string, number>();
    const keyByPhrase = new Map<string, string>();
    for (const phrase of dedupedPhrases) {
        keyByPhrase.set(phrase, computeKeywordCacheKey({
            phrase,
            locationCode: input.locationCode,
            languageCode: input.languageCode,
        }));
    }
    const hitsByKey = await repo.readOverviewMany(Array.from(keyByPhrase.values()), now);
    for (let i = 0; i < dedupedPhrases.length; i += 1) {
        const phrase = dedupedPhrases[i]!;
        const key = keyByPhrase.get(phrase)!;
        const hit = hitsByKey.get(key);
        if (hit) {
            results[i] = overviewFromCache(hit, true, input.locationCode, input.languageCode);
        }
        else {
            missIndex.set(phrase, i);
            misses.push(phrase);
        }
    }
    if (misses.length > 0) {
        let vendorRows: KeywordOverview[];
        let batchCostMicros: bigint | null;
        try {
            const captured = await captureVendorCost(() => deps.provider.getOverview(misses, input.locationCode, input.languageCode));
            vendorRows = captured.value;
            batchCostMicros = captured.costMicros;
        }
        catch (err) {
            wrapProviderError(err);
        }
        const fetchedAt = nowFn();
        const expiresAt = computeExpiry(fetchedAt, deps.ttlDays);
        const byKeyword = new Map<string, KeywordOverview>();
        for (const row of vendorRows) {
            byKeyword.set(normalizeCachePhrase(row.keyword), row);
        }
        await Promise.all(misses.map(async (phrase, missIdx) => {
            const vendor = byKeyword.get(phrase) ?? null;
            const serpFeatures = normalizeSerpFeatures(vendor?.serpFeatures);
            const key = keyByPhrase.get(phrase)!;
            await repo.writeOverview({
                cacheKey: key,
                phrase,
                locationCode: input.locationCode,
                languageCode: input.languageCode,
                searchVolume: vendor?.searchVolume ?? null,
                difficulty: vendor?.difficulty ?? null,
                cpc: vendor?.cpc ?? null,
                intent: vendor?.intent ?? null,
                serpFeatures,
                observedAt: vendor?.observedAt ?? null,
                resultsCount: vendor?.resultsCount ?? null,
                costMicros: allocateBatchCostMicros(batchCostMicros, misses.length, missIdx),
                fetchedAt,
                expiresAt,
            });
            const idx = missIndex.get(phrase)!;
            results[idx] = overviewFromVendor(vendor, phrase, fetchedAt, expiresAt, input.locationCode, input.languageCode);
        }));
    }
    return results.filter((r): r is KeywordOverviewPayload => r !== null);
}
/**
 * Deterministic trend math. All computations are pure
 * arithmetic against the stored `monthlySearches` array — no AI involvement.
 *
 * @param series - ascending by (year, month); the caller is responsible for
 *                 the sort. Values already trimmed by the adapter to ≤48 rows.
 */
export function computeTrendSummary(series: readonly {
    year: number;
    month: number;
    searchVolume: number;
}[]): KeywordTrendsSummary {
    const n = series.length;
    if (n === 0) {
        return { yoyDelta: null, twelveMonthMomentum: null, seasonalityFlags: { peakMonth: null, troughMonth: null } };
    }
    // yoyDelta: series must have ≥13 rows so `latest` and `latest - 12` both exist.
    let yoyDelta: number | null = null;
    if (n >= 13) {
        const latest = series[n - 1]!.searchVolume;
        const twelveEarlier = series[n - 13]!.searchVolume;
        yoyDelta = twelveEarlier === 0 ? null : (latest - twelveEarlier) / twelveEarlier;
    }
    // twelveMonthMomentum: series must have ≥24 rows so both 12-month windows fit.
    let twelveMonthMomentum: number | null = null;
    if (n >= 24) {
        let trailing = 0;
        let prior = 0;
        for (let i = 0; i < 12; i += 1) {
            trailing += series[n - 1 - i]!.searchVolume;
            prior += series[n - 13 - i]!.searchVolume;
        }
        twelveMonthMomentum = prior === 0 ? null : (trailing - prior) / prior;
    }
    // seasonalityFlags: mean per calendar month across complete years, then
    // pick argmax/argmin. Requires ≥24 rows (same threshold as momentum).
    let peakMonth: number | null = null;
    let troughMonth: number | null = null;
    if (n >= 24) {
        const buckets = new Map<number, {
            sum: number;
            count: number;
        }>();
        for (const row of series) {
            const bucket = buckets.get(row.month) ?? { sum: 0, count: 0 };
            bucket.sum += row.searchVolume;
            bucket.count += 1;
            buckets.set(row.month, bucket);
        }
        // Only months with ≥2 samples (i.e. covered by at least two calendar
        // years) contribute — a single sample is not a "season".
        const eligible = Array.from(buckets.entries())
            .filter(([, v]) => v.count >= 2)
            .map(([month, v]) => ({ month, mean: v.sum / v.count }));
        if (eligible.length > 0) {
            let maxMonth = eligible[0]!.month;
            let maxMean = eligible[0]!.mean;
            let minMonth = eligible[0]!.month;
            let minMean = eligible[0]!.mean;
            for (const entry of eligible) {
                if (entry.mean > maxMean) {
                    maxMean = entry.mean;
                    maxMonth = entry.month;
                }
                if (entry.mean < minMean) {
                    minMean = entry.mean;
                    minMonth = entry.month;
                }
            }
            peakMonth = maxMonth;
            troughMonth = minMonth;
        }
    }
    return {
        yoyDelta,
        twelveMonthMomentum,
        seasonalityFlags: { peakMonth, troughMonth },
    };
}
function trendsFromCache(row: CachedTrendsRow, fromCache: boolean, locationCode: number, languageCode: string): KeywordTrendsPayload {
    return {
        keyword: row.phrase,
        monthlySearches: row.monthlySearches,
        trends: computeTrendSummary(row.monthlySearches),
        cached: fromCache,
        fetchedAt: row.fetchedAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
        meta: metaForEstimate(row.fetchedAt, row.expiresAt, locationCode, languageCode),
    };
}
function trendsFromVendor(vendor: KeywordHistoricalVolume | null, phrase: string, fetchedAt: Date, expiresAt: Date, locationCode: number, languageCode: string): KeywordTrendsPayload {
    const monthlySearches = vendor?.monthlySearches ?? [];
    return {
        keyword: phrase,
        monthlySearches,
        trends: computeTrendSummary(monthlySearches),
        cached: false,
        fetchedAt: fetchedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        meta: metaForEstimate(fetchedAt, expiresAt, locationCode, languageCode),
    };
}
/**
 * Cache-first multi-year monthly search-volume history + deterministic trend
 * summary.
 */
export async function getTrendsCached(input: {
    keywords: string[];
    locationCode: number;
    languageCode: string;
}, deps: KeywordResearchServiceDeps): Promise<KeywordTrendsPayload[]> {
    const nowFn = deps.now ?? (() => new Date());
    const repo = createKeywordCacheRepo(deps.db);
    const now = nowFn();
    const dedupedPhrases = dedupeKeywordPhrases(input.keywords);
    const results: (KeywordTrendsPayload | null)[] = new Array(dedupedPhrases.length).fill(null);
    const misses: string[] = [];
    const missIndex = new Map<string, number>();
    const keyByPhrase = new Map<string, string>();
    for (const phrase of dedupedPhrases) {
        keyByPhrase.set(phrase, computeKeywordCacheKey({
            phrase,
            locationCode: input.locationCode,
            languageCode: input.languageCode,
        }));
    }
    const hitsByKey = await repo.readTrendsMany(Array.from(keyByPhrase.values()), now);
    for (let i = 0; i < dedupedPhrases.length; i += 1) {
        const phrase = dedupedPhrases[i]!;
        const key = keyByPhrase.get(phrase)!;
        const hit = hitsByKey.get(key);
        if (hit) {
            results[i] = trendsFromCache(hit, true, input.locationCode, input.languageCode);
        }
        else {
            missIndex.set(phrase, i);
            misses.push(phrase);
        }
    }
    if (misses.length > 0) {
        let vendorRows: KeywordHistoricalVolume[];
        let batchCostMicros: bigint | null;
        try {
            const captured = await captureVendorCost(() => deps.provider.getHistoricalVolume(misses, input.locationCode, input.languageCode));
            vendorRows = captured.value;
            batchCostMicros = captured.costMicros;
        }
        catch (err) {
            wrapProviderError(err);
        }
        const fetchedAt = nowFn();
        const expiresAt = computeExpiry(fetchedAt, deps.ttlDays);
        const byKeyword = new Map<string, KeywordHistoricalVolume>();
        for (const row of vendorRows) {
            byKeyword.set(normalizeCachePhrase(row.keyword), row);
        }
        await Promise.all(misses.map(async (phrase, missIdx) => {
            const vendor = byKeyword.get(phrase) ?? null;
            const monthlySearches = vendor?.monthlySearches ?? [];
            const key = keyByPhrase.get(phrase)!;
            await repo.writeTrends({
                cacheKey: key,
                phrase,
                locationCode: input.locationCode,
                languageCode: input.languageCode,
                monthlySearches,
                costMicros: allocateBatchCostMicros(batchCostMicros, misses.length, missIdx),
                fetchedAt,
                expiresAt,
            });
            const idx = missIndex.get(phrase)!;
            results[idx] = trendsFromVendor(vendor, phrase, fetchedAt, expiresAt, input.locationCode, input.languageCode);
        }));
    }
    return results.filter((r): r is KeywordTrendsPayload => r !== null);
}
function compatibilityProvenance(row: DomainIntersectionRow, rows: readonly DomainIntersectionRow[], cache: 'hit' | 'miss'): NonNullable<DomainIntersectionRow['provenance']> {
    return row.provenance
        ? { ...row.provenance, cache }
        : {
            provider: 'dataforseo',
            operation: 'domain_intersection_live',
            leg: 'competitor_only',
            intersections: false,
            targetOrder: 'competitor_owned',
            itemTypes: ['organic'],
            limit: 100,
            cache,
            status: 'success',
            capturedAt: null,
            returnedRows: Math.min(rows.length, 100),
            truncated: rows.length > 100,
        };
}
function gapRowsToPayload(rows: readonly DomainIntersectionRow[], cache: 'hit' | 'miss'): GapRowPayload[] {
    return rows.slice(0, 100).map((r) => ({
        keyword: r.keyword,
        ownPosition: null,
        competitorPosition: r.target2Position,
        searchVolume: r.searchVolume,
        class: 'missing',
        ownUrl: null,
        competitorUrl: r.target2Url ?? null,
        provenance: compatibilityProvenance(r, rows, cache),
    }));
}
function comparisonRows(rows: readonly DomainComparisonRow[]): DomainIntersectionRow[] {
    const returnedRows = Math.min(rows.length, 100);
    return rows.slice(0, 100).map((row) => ({
        keyword: row.keyword,
        target1Position: null,
        target2Position: row.competitorPosition,
        searchVolume: row.searchVolume,
        class: 'missing',
        target1Url: null,
        target2Url: row.competitorUrl,
        provenance: {
            provider: row.observationMeta.sourceLabel ?? 'dataforseo',
            operation: 'domain_intersection_live',
            leg: 'competitor_only',
            intersections: false,
            targetOrder: 'competitor_owned',
            itemTypes: ['organic'],
            limit: 100,
            cache: 'miss',
            status: 'success',
            capturedAt: row.observationMeta.observedAt || null,
            returnedRows,
            truncated: rows.length > 100,
        },
    }));
}
function gapPairFromCache(hit: CachedGapRow, locationCode: number, languageCode: string): GapPairPayload {
    return {
        ownDomain: hit.ownDomain,
        competitorDomain: hit.competitorDomain,
        cached: true,
        fetchedAt: hit.fetchedAt.toISOString(),
        expiresAt: hit.expiresAt.toISOString(),
        rows: gapRowsToPayload(hit.rows, 'hit'),
        meta: metaForObservation(hit.fetchedAt, hit.expiresAt, locationCode, languageCode),
    };
}
/**
 * Cache-first keyword gap. One vendor call per own-vs-competitor
 * pair (each pair keyed independently in `vendor_cache/gap`), clamped to
 * `limitPerPair` rows (default + hard ceiling 200 per spec).
 */
export async function getGapCached(input: {
    ownDomain: string;
    competitors: string[];
    locationCode: number;
    languageCode: string;
    limitPerPair?: number;
}, deps: KeywordResearchServiceDeps): Promise<{
    pairs: GapPairPayload[];
}> {
    const competitorProvider = requireCompetitorProvider(deps);
    const nowFn = deps.now ?? (() => new Date());
    const repo = createKeywordCacheRepo(deps.db);
    const now = nowFn();
    const clampedLimit = Math.max(1, Math.min(input.limitPerPair ?? GAP_LIMIT_PER_PAIR, GAP_LIMIT_PER_PAIR));
    const own = normalizeCacheDomain(input.ownDomain);
    const normalizedCompetitors = input.competitors.map(normalizeCacheDomain);
    const keyByCompetitor = new Map<string, string>();
    for (const competitor of normalizedCompetitors) {
        keyByCompetitor.set(competitor, computeGapCacheKey({
            ownDomain: own,
            competitorDomain: competitor,
            locationCode: input.locationCode,
            languageCode: input.languageCode,
        }));
    }
    const hitsByKey = await repo.readGapMany(Array.from(keyByCompetitor.values()), now);
    const results: (GapPairPayload | null)[] = new Array(normalizedCompetitors.length).fill(null);
    const misses: {
        index: number;
        competitor: string;
        key: string;
    }[] = [];
    for (let i = 0; i < normalizedCompetitors.length; i += 1) {
        const competitor = normalizedCompetitors[i]!;
        const key = keyByCompetitor.get(competitor)!;
        const hit = hitsByKey.get(key);
        if (hit) {
            results[i] = gapPairFromCache(hit, input.locationCode, input.languageCode);
        }
        else {
            misses.push({ index: i, competitor, key });
        }
    }
    // Per-pair vendor call — the intersection endpoint takes exactly two
    // targets. Each pair's cost is captured independently so a spike on one
    // competitor is not billed to another.
    await Promise.all(misses.map(async ({ index, competitor, key }) => {
        let rows: DomainIntersectionRow[];
        let pairCostMicros: bigint | null;
        try {
            const captured = await captureVendorCost(() => competitorProvider.compareDomains
                ? competitorProvider
                    .compareDomains({
                    ownedDomain: own,
                    ownedOrigin: `https://${own}`,
                    competitorDomain: competitor,
                    competitorOrigin: `https://${competitor}`,
                    locationCode: input.locationCode,
                    languageCode: input.languageCode,
                })
                    .then((comparison) => comparisonRows(comparison.competitorOnly))
                : competitorProvider
                    .getDomainIntersection(competitor, own, {
                    locationCode: input.locationCode,
                    languageCode: input.languageCode,
                    limit: Math.min(clampedLimit, 100),
                })
                    .then((legacy) => legacy.map((row) => ({
                    keyword: row.keyword,
                    target1Position: null,
                    target2Position: row.target1Position,
                    searchVolume: row.searchVolume,
                }))));
            rows = captured.value;
            pairCostMicros = captured.costMicros;
        }
        catch (err) {
            wrapProviderError(err);
        }
        const bounded = rows.slice(0, clampedLimit);
        const fetchedAt = nowFn();
        const expiresAt = computeExpiry(fetchedAt, deps.ttlDays);
        await repo.writeGap({
            cacheKey: key,
            ownDomain: own,
            competitorDomain: competitor,
            locationCode: input.locationCode,
            languageCode: input.languageCode,
            rows: bounded,
            costMicros: pairCostMicros,
            fetchedAt,
            expiresAt,
        });
        results[index] = {
            ownDomain: own,
            competitorDomain: competitor,
            cached: false,
            fetchedAt: fetchedAt.toISOString(),
            expiresAt: expiresAt.toISOString(),
            rows: gapRowsToPayload(bounded, 'miss'),
            meta: metaForObservation(fetchedAt, expiresAt, input.locationCode, input.languageCode),
        };
    }));
    return {
        // Every slot filled in one of the two branches above; the filter is a
        // narrowing guard, not a hole.
        pairs: results.filter((p): p is GapPairPayload => p !== null),
    };
}
export { DEFAULT_KEYWORD_CACHE_TTL_DAYS };
export type { KeywordCacheRepo };
// ---------------------------------------------------------------------------
// Keyword Trends (live exploration)
// ---------------------------------------------------------------------------
// One shared single-flight for the trends read-through — same convention as
// backlinks / traffic-snapshots (process-scoped gate collapses concurrent
// misses on the same key into ONE vendor call).
const trendsSingleFlight = createSingleFlight();
/** Vendor-normalized schema for `keyword/trends_live`. Mirror of `TrendsExploreResult`. */
const trendsPayloadSchema = z.object({
    series: z.array(z.object({
        keyword: z.string(),
        points: z.array(z.object({
            year: z.number().int(),
            month: z.number().int(),
            value: z.number(),
        })),
    })),
    relatedQueries: z.array(z.object({
        query: z.string(),
        value: z.number(),
        kind: z.union([z.literal('rising'), z.literal('top')]),
    })),
    window: z.object({
        startDate: z.string().nullable(),
        endDate: z.string().nullable(),
    }),
    observedAt: z.string(),
    locationCode: z.number().nullable(),
    languageCode: z.string().nullable(),
});
/**
 * Related/rising query cap the DTO applies before returning to the client.
 * Vendor already clamps ≤ 50; we double-enforce so a shape drift never
 * ships an unbounded array. Individual `query` strings are ALSO length-
 * clamped (SEC-OUT / output-encoding) — 100 chars matches the provider
 * interface's contract.
 */
export const TRENDS_MAX_RELATED_QUERIES = 50;
export const TRENDS_MAX_QUERY_CHARS = 100;
function clampQueryString(s: string): string {
    return s.length > TRENDS_MAX_QUERY_CHARS ? s.slice(0, TRENDS_MAX_QUERY_CHARS) : s;
}
/**
 * Normalize the exploration inputs into the shape used both for the cache
 * key and the mongo run row: deduped, lowercased, sorted keywords + trimmed
 * lowercased geo + trimmed lowercased language.
 */
export function normalizeTrendsExploreInputs(input: {
    keywords: string[];
    geo?: string | undefined;
    language?: string | undefined;
}): {
    keywords: string[];
    geo: string | null;
    language: string | null;
} {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of input.keywords) {
        const lowered = raw.trim().toLowerCase();
        if (lowered.length === 0 || seen.has(lowered))
            continue;
        seen.add(lowered);
        out.push(lowered);
    }
    out.sort();
    const geo = typeof input.geo === 'string' && input.geo.trim().length > 0
        ? input.geo.trim().toLowerCase()
        : null;
    const language = typeof input.language === 'string' && input.language.trim().length > 0
        ? input.language.trim().toLowerCase()
        : null;
    return { keywords: out, geo, language };
}
/** Bounded market-code mapping shared by preview and paid exploration. */
export function trendsGeoToLocationCode(geo: string | null): number | undefined {
    switch (geo) {
        case 'gb':
            return 2826;
        case 'de':
            return 2276;
        case 'fr':
            return 2250;
        case 'us':
            return 2840;
        case null:
            return undefined;
        default:
            return undefined;
    }
}
/**
 * Convert vendor monthly points into `WeeklyPoint[]`, one entry per month.
 * The deterministic formulas in `keyword-research.trends.ts` are agnostic
 * to interval — they threshold on count only. Constructing `date` as the
 * first-of-month ISO calendar date keeps the seasonality UTC-month grouping
 * honest.
 */
function monthlyToWeekly(points: readonly {
    year: number;
    month: number;
    value: number;
}[]): WeeklyPoint[] {
    return points.map((p) => ({
        date: `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-01`,
        value: p.value,
    }));
}
export interface TrendsSeriesDto {
    keyword: string;
    points: Array<{
        year: number;
        month: number;
        value: number;
    }>;
    source: 'estimate';
    observationMeta: {
        searchInterestIndexKey: string;
    };
}
export interface TrendsRelatedQueryDto {
    query: string;
    value: number;
    kind: 'rising' | 'top';
}
export interface TrendsReadoutDto {
    yoy: {
        deltaFraction: number | null;
        reason?: 'insufficient_history';
        source: 'estimate';
        observationMeta: {
            searchInterestIndexKey: string;
        };
    };
    momentum: {
        direction: 'up' | 'down' | 'flat';
        slopePerWeek: number | null;
        reason?: 'insufficient_history';
        source: 'estimate';
        observationMeta: {
            searchInterestIndexKey: string;
        };
    };
    seasonality: {
        months: number[];
        reason?: 'insufficient_history';
        source: 'estimate';
        observationMeta: {
            searchInterestIndexKey: string;
        };
    };
}
export interface TrendsExplorationDto {
    runId: string;
    status: 'queued' | 'running' | 'succeeded' | 'failed';
    retained: boolean;
    errorCode: string | null;
    inputs: {
        keywords: string[];
        geo: string | null;
        language: string | null;
    };
    cached: boolean;
    fetchedAt: string | null;
    window: {
        startDate: string | null;
        endDate: string | null;
    };
    observedAt: string | null;
    locationCode: number | null;
    languageCode: string | null;
    series: TrendsSeriesDto[];
    seriesReadouts: Array<{
        keyword: string;
        readouts: TrendsReadoutDto;
    }>;
    relatedQueries: TrendsRelatedQueryDto[];
    createdAt: string;
    completedAt: string | null;
}
export interface ExploreTrendsInput {
    accountId: string;
    siteId?: string | null;
    keywords: string[];
    geo?: string | undefined;
    language?: string | undefined;
}
export interface ExploreTrendsDeps {
    db: Db;
    provider: TrendsProvider;
    ttlDays: number;
    now?: () => Date;
}
/**
 * Live Keyword Trends exploration:
 *
 *   1. Create a mongo run row (status=running) with normalized inputs.
 *   2. ReadThrough on capability=keyword/operation=trends_live keyed by
 *      normalized inputs; cache TTL from `KEYWORD_CACHE_TTL_DAYS` env.
 *   3. Success → shape DTO, persist run (retained=true, seriesCount,
 *      relatedQueryCount, completedAt), return.
 *   4. Vendor throw → mark run failed, persist errorCode; re-throw as a
 *      localized HttpError.
 */
export async function exploreTrendsLive(input: ExploreTrendsInput, deps: ExploreTrendsDeps): Promise<TrendsExplorationDto> {
    const nowFn = deps.now ?? (() => new Date());
    const normalized = normalizeTrendsExploreInputs(input);
    const run = await TrendsExplorationRun.create({
        accountId: input.accountId,
        siteId: input.siteId ?? null,
        inputs: {
            keywords: normalized.keywords,
            geo: normalized.geo,
            language: normalized.language,
        },
        status: 'running',
        retained: false,
        errorCode: null,
        completedAt: null,
        seriesCount: 0,
        relatedQueryCount: 0,
    });
    const repo = createVendorCacheRepo(deps.db);
    const readThrough = createReadThrough({ repo, singleFlight: trendsSingleFlight });
    const now = nowFn();
    const ttlMs = deps.ttlDays * 24 * 60 * 60 * 1000;
    try {
        const { value, cached, fetchedAt } = await readThrough({
            capability: 'keyword',
            operation: 'trends_live',
            params: {
                keywords: normalized.keywords,
                geo: normalized.geo,
                language: normalized.language,
            },
            accountId: input.accountId,
            ttlMs,
            payloadSchema: trendsPayloadSchema,
            now,
            clock: nowFn,
            fetch: () => {
                const locationCode = trendsGeoToLocationCode(normalized.geo);
                return deps.provider.explore({
                    keywords: normalized.keywords,
                    ...(locationCode !== undefined ? { locationCode } : {}),
                    ...(normalized.language !== null ? { languageCode: normalized.language } : {}),
                });
            },
        });
        // Audit-trail row per exploration. The read-through's own
        // archive covers the vendor-call path (uncached only) and records the
        // captured cost; this supplementary row is tagged with the runId +
        // `cached: true|false` so a caller can join every exploration back to
        // its `TrendsExplorationRun` regardless of cache state. A cached hit
        // records `costMicros: 0n` (no vendor task was attempted).
        try {
            await repo.appendResponse({
                capability: 'keyword',
                operation: 'trends_live',
                cacheKey: computeVendorCacheKey({
                    capability: 'keyword',
                    operation: 'trends_live',
                    params: {
                        keywords: normalized.keywords,
                        geo: normalized.geo,
                        language: normalized.language,
                    },
                }),
                params: {
                    keywords: normalized.keywords,
                    geo: normalized.geo,
                    language: normalized.language,
                    runId: String(run._id),
                    cached,
                    tag: 'exploration_audit',
                },
                payload: {
                    seriesCount: value.series.length,
                    relatedQueryCount: value.relatedQueries.length,
                },
                accountId: input.accountId,
                // Cached hits: no vendor task was attempted → 0 micros.
                // Uncached: readThrough's own archive already carries the vendor-
                // reported cost. We record 0 here to avoid double-counting.
                costMicros: 0n,
                fetchedAt,
            });
        }
        catch {
            // Never let audit-row bookkeeping fail the delivered exploration —
            // same "cache write failure is not fatal" contract used elsewhere.
        }
        const dto = buildDto(run, value, cached, fetchedAt);
        // Sparse and flat series are still a delivered result — retained=true
        // regardless of series count. Only a complete provider throw (see
        // catch block) marks the run failed.
        const seriesCount = value.series.length;
        const relatedQueryCount = value.relatedQueries.length;
        run.set('status', 'succeeded');
        run.set('retained', true);
        run.set('errorCode', null);
        run.set('completedAt', nowFn());
        run.set('seriesCount', seriesCount);
        run.set('relatedQueryCount', relatedQueryCount);
        await run.save();
        return dto;
    }
    catch (err) {
        const errorCode = extractProviderErrorCode(err);
        run.set('status', 'failed');
        run.set('retained', false);
        run.set('errorCode', errorCode);
        run.set('completedAt', nowFn());
        await run.save();
        // Re-wrap as a 503 localized error — mirrors `wrapProviderError` above
        // so a Vendor* error never bubbles as a raw 500.
        if (err instanceof ProviderError) {
            throw new HttpError(503, { code: 'KEYWORD_RESEARCH_TRENDS_ERRORS_PROVIDER_FAILED', messageKey: 'keywordResearch.trends.errors.providerFailed' }, { reason: 'provider_failed' }, { cause: err });
        }
        throw err;
    }
}
/** `ProviderError` extends `Error`, so one `instanceof Error` arm covers both
 *  vendor faults and any other throw that carries a constructor name. */
function extractProviderErrorCode(err: unknown): string {
    if (err instanceof Error)
        return err.name;
    return 'Unknown';
}
function buildDto(run: HydratedDocument<TrendsExplorationRunDoc>, vendor: TrendsExploreResult, cached: boolean, fetchedAt: Date): TrendsExplorationDto {
    const clampedRelated: TrendsRelatedQueryDto[] = vendor.relatedQueries
        .slice(0, TRENDS_MAX_RELATED_QUERIES)
        .map((r) => ({
        query: clampQueryString(r.query),
        value: r.value,
        kind: r.kind,
    }));
    const series: TrendsSeriesDto[] = vendor.series.map((s) => ({
        keyword: s.keyword,
        points: s.points.map((p) => ({ year: p.year, month: p.month, value: p.value })),
        ...estimateEnvelope(),
    }));
    const seriesReadouts = vendor.series.map((s) => {
        const weekly = monthlyToWeekly(s.points);
        const yoy = yearOverYear(weekly);
        const mom = momentum(weekly);
        const seasons = seasonalityMonths(weekly);
        const env = estimateEnvelope();
        const readouts: TrendsReadoutDto = {
            yoy: {
                deltaFraction: yoy.deltaFraction,
                ...(yoy.reason ? { reason: yoy.reason } : {}),
                ...env,
            },
            momentum: {
                direction: mom.direction,
                slopePerWeek: mom.slopePerWeek,
                ...(mom.reason ? { reason: mom.reason } : {}),
                ...env,
            },
            seasonality: {
                months: seasons.months,
                ...(seasons.reason ? { reason: seasons.reason } : {}),
                ...env,
            },
        };
        return { keyword: s.keyword, readouts };
    });
    return {
        runId: String(run._id),
        status: 'succeeded',
        retained: true,
        errorCode: null,
        inputs: readStoredInputs(run),
        cached,
        fetchedAt: fetchedAt.toISOString(),
        window: vendor.window,
        observedAt: vendor.observedAt,
        locationCode: vendor.locationCode,
        languageCode: vendor.languageCode,
        series,
        seriesReadouts,
        relatedQueries: clampedRelated,
        createdAt: (run.get('createdAt') as Date).toISOString(),
        completedAt: null,
    };
}
/**
 * Narrow the run's `inputs` subdocument to the DTO shape. `keywords` is
 * `required` and `geo` / `language` both default to `null` in
 * `trendsExplorationRunSchema`, so every field is always present — this
 * helper exists only to pin the type, because TypeScript's
 * `Document.get(string)` returns `any`.
 */
function readStoredInputs(run: HydratedDocument<TrendsExplorationRunDoc>): {
    keywords: string[];
    geo: string | null;
    language: string | null;
} {
    const raw = run.get('inputs') as {
        keywords: string[];
        geo: string | null;
        language: string | null;
    };
    return { keywords: raw.keywords, geo: raw.geo, language: raw.language };
}
/**
 * Read a stored exploration for the calling account. Cross-account access
 * returns null (controller maps to 404 with the localized `notFound` key).
 */
export async function findTrendsRun(input: {
    accountId: string;
    runId: string;
}): Promise<HydratedDocument<TrendsExplorationRunDoc> | null> {
    if (!/^[a-f0-9]{24}$/.test(input.runId))
        return null;
    const run = await TrendsExplorationRun.findOne({
        _id: input.runId,
        accountId: input.accountId,
    }).exec();
    if (!run?.siteId)
        return run;
    const liveSite = await Site.exists({
        _id: run.siteId,
        accountId: input.accountId,
        deletionStartedAt: null,
    });
    return liveSite ? run : null;
}
export async function resolveOwnedTrendsRunSiteId(accountId: string, runId: string): Promise<string | null> {
    if (!/^[a-f0-9]{24}$/.test(runId))
        return null;
    const run = await TrendsExplorationRun.findOne({ _id: runId, accountId }, { siteId: 1 }).lean();
    return run?.siteId ? String(run.siteId) : null;
}
export interface TrendsListPageInput {
    accountId: string;
    siteId?: string | null;
    allowedSiteIds?: readonly string[] | null;
    limit: number;
    cursor?: {
        createdAt: Date;
        id: string;
    } | null;
}
export interface TrendsListPageResult {
    runs: HydratedDocument<TrendsExplorationRunDoc>[];
    nextCursor: {
        createdAt: string;
        id: string;
    } | null;
}
export async function listTrendsRunsForAccount(input: TrendsListPageInput): Promise<TrendsListPageResult> {
    const liveSites = await Site.find({ accountId: input.accountId, deletionStartedAt: null }, { _id: 1 }).lean();
    const allowed = input.allowedSiteIds === undefined || input.allowedSiteIds === null
        ? null
        : new Set(input.allowedSiteIds);
    const liveSiteIds = liveSites
        .map((site) => String(site._id))
        .filter((siteId) => allowed === null || allowed.has(siteId));
    const filter: Record<string, unknown> = {
        accountId: input.accountId,
        siteId: { $in: allowed === null ? [null, ...liveSiteIds] : liveSiteIds },
    };
    if (input.siteId) {
        filter.siteId = liveSiteIds.includes(input.siteId)
            ? input.siteId
            : { $in: [] };
    }
    if (input.cursor) {
        filter.$or = [
            { createdAt: { $lt: input.cursor.createdAt } },
            { createdAt: input.cursor.createdAt, _id: { $lt: input.cursor.id } },
        ];
    }
    const runs = await TrendsExplorationRun.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .limit(input.limit + 1)
        .exec();
    let nextCursor: TrendsListPageResult['nextCursor'] = null;
    if (runs.length > input.limit) {
        const last = runs[input.limit - 1]!;
        nextCursor = {
            createdAt: (last.get('createdAt') as Date).toISOString(),
            id: String(last._id),
        };
        runs.length = input.limit;
    }
    return { runs, nextCursor };
}
/** DTO for the free stored-run read routes. Never re-invokes the provider. */
export function serializeStoredRun(run: HydratedDocument<TrendsExplorationRunDoc>): Record<string, unknown> {
    const env = estimateEnvelope();
    return {
        runId: String(run._id),
        status: run.get('status') as string,
        retained: run.get('retained') as boolean,
        errorCode: (run.get('errorCode') as string | null) ?? null,
        inputs: readStoredInputs(run),
        // `siteId`, `seriesCount` and `relatedQueryCount` all carry schema
        // defaults, so they are never undefined on a stored run.
        siteId: run.get('siteId') as string | null,
        seriesCount: Number(run.get('seriesCount')),
        relatedQueryCount: Number(run.get('relatedQueryCount')),
        createdAt: (run.get('createdAt') as Date).toISOString(),
        completedAt: run.get('completedAt')
            ? (run.get('completedAt') as Date).toISOString()
            : null,
        // Estimate labels persist across the stored-read shape so a client
        // reloading a historical run still receives the coverage-note key.
        source: env.source,
        observationMeta: env.observationMeta,
    };
}
