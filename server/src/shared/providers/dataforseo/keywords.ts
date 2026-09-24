/**
 * DataForSEO Keywords Data + Labs adapter.
 *
 * Implements the vendor-neutral KeywordProvider over three live
 * DataForSEO v3 endpoints (no task queue — Keywords Data / Labs live are the
 * shipping mode):
 *
 *   getMetrics → POST /keywords_data/google_ads/search_volume/live
 *                    (up to 1000 keywords, flat billing per request)
 *              + POST /dataforseo_labs/google/bulk_keyword_difficulty/live
 *                    (up to 1000 keywords → keyword_difficulty)
 *   getRelated → POST /dataforseo_labs/google/related_keywords/live
 *                    (single seed keyword, `limit` caps returned rows —
 *                    Labs bills per RETURNED ROW so always set a limit)
 *   classifyIntent → POST /dataforseo_labs/google/search_intent/live
 *                    (up to 1000 keywords; Labs SEARCH INTENT tier:
 *                    $0.0012/task + $0.00012/keyword — pricing rows 86-87.
 *                    Language-only endpoint: no location_code param. Response
 *                    item shape `{ keyword, keyword_intent: { label,
 *                    probability } }` verified against DataForSEO live docs,
 *                    July 2026; labels informational|commercial|transactional|
 *                    navigational.)
 *   getIdeas → POST /dataforseo_labs/google/keyword_ideas/live
 *                    (seed keyword → wider ideas corpus; Labs ALL OTHER
 *                    ENDPOINTS tier: $0.012/task + $0.00012/item — pricing rows
 *                    88-89. `limit` caps returned rows, billed per row. Response
 *                    item is FLAT — `{ keyword, keyword_info, keyword_properties }`
 *                    with NO `keyword_data` wrapper, unlike related_keywords —
 *                    verified against DataForSEO live docs, July 2026.)
 *   getLongTailSuggestions → POST
 *                    /dataforseo_labs/google/keyword_suggestions/live
 *                    (seed-containing suggestions; flat item shape matching
 *                    keyword_ideas, with a bounded returned-row limit.)
 *
 * Fallback note: SEMrush Standard API implements the same interface if
 * ever needed — not built.
 *
 * MERGE POLICY: search_volume is authoritative for volume/cpc/monthly_searches
 * (those endpoints are the only ones that expose them); bulk_keyword_difficulty
 * layers difficulty in. A keyword missing from either side is reported with
 * that field as `null` — the caller must handle "insufficient data" verdicts.
 */
import type { Logger } from 'pino';
import { z } from 'zod';
import { dataForSeoRequest, type DataForSeoConfig } from '../http.js';
import { VendorMalformedError } from '../errors.js';
import type { IntentResult, KeywordHistoricalVolume, KeywordMetrics, KeywordOverview, KeywordProvider, MonthlySearchVolume, ProviderMarket, SearchIntent, SiteKeywordCandidate, SiteKeywordProvider, } from '../types.js';
import { normalizeSerpDomain } from './serp.js';
// SERP-feature normalization lives in the ONE shared authority
// (`shared/providers/serp-features.ts`). The
// alias table + `mapSerpFeature` were promoted out of this file; the
// re-export below keeps the historical `dataforseo/keywords.js` import path
// (contract tests use it) working unmodified.
import { normalizeVendorSerpFeatures } from '../serp-features.js';
export { mapSerpFeature } from '../serp-features.js';
// ---------------------------------------------------------------------------
// Vendor payload schemas — validated at the boundary, feature code only reads
// zod-parsed fields.
// ---------------------------------------------------------------------------
const monthlySearchesSchema = z
    .array(z
    .object({
    year: z.number().int(),
    month: z.number().int(),
    search_volume: z.number().nullable().optional(),
})
    .passthrough())
    .nullable()
    .optional();
const labsMarketResultSchema = z.array(z
    .object({
    location_code: z.number().int().positive(),
    country_iso_code: z.string(),
    location_type: z.string(),
    available_languages: z.array(z
        .object({
        available_sources: z.array(z.string()),
        language_code: z.string(),
    })
        .passthrough()),
})
    .passthrough());
/** Normalize only country-level Google markets from the Labs catalog. */
export function normalizeLabsMarkets(rows: z.infer<typeof labsMarketResultSchema>): ProviderMarket[] {
    const markets = new Map<string, ProviderMarket>();
    for (const row of rows) {
        const countryCode = row.country_iso_code.trim().toUpperCase();
        if (row.location_type !== 'Country' || !/^[A-Z]{2}$/.test(countryCode))
            continue;
        const languageCodes = [
            ...new Set(row.available_languages
                .filter((language) => language.available_sources.includes('google'))
                .map((language) => language.language_code.trim().toLowerCase())
                .filter((language) => /^[a-z]{2}$/.test(language))),
        ];
        if (languageCodes.length === 0)
            continue;
        markets.set(`${countryCode}:${row.location_code}`, {
            countryCode,
            locationCode: row.location_code,
            languageCodes,
        });
    }
    return [...markets.values()];
}
const searchVolumeItemSchema = z
    .object({
    keyword: z.string(),
    search_volume: z.number().nullable().optional(),
    cpc: z.number().nullable().optional(),
    competition: z.string().nullable().optional(),
    competition_index: z.number().nullable().optional(),
    monthly_searches: monthlySearchesSchema,
})
    .passthrough();
const searchVolumeResultSchema = z.array(searchVolumeItemSchema).nullable();
const bulkDifficultyItemSchema = z
    .object({
    keyword: z.string(),
    keyword_difficulty: z.number().nullable().optional(),
})
    .passthrough();
const bulkDifficultyResultSchema = z
    .array(z
    .object({
    items: z.array(bulkDifficultyItemSchema).nullable().optional(),
})
    .passthrough())
    .min(1);
const relatedKeywordDataSchema = z
    .object({
    keyword_info: z
        .object({
        search_volume: z.number().nullable().optional(),
        cpc: z.number().nullable().optional(),
        monthly_searches: monthlySearchesSchema,
    })
        .passthrough()
        .nullable()
        .optional(),
    keyword_properties: z
        .object({
        keyword_difficulty: z.number().nullable().optional(),
    })
        .passthrough()
        .nullable()
        .optional(),
})
    .passthrough();
const relatedResultSchema = z
    .array(z
    .object({
    items: z
        .array(z
        .object({
        keyword_data: z
            .object({
            keyword: z.string(),
        })
            .merge(relatedKeywordDataSchema)
            .passthrough(),
    })
        .passthrough())
        .nullable()
        .optional(),
})
    .passthrough())
    .min(1);
// Search Intent — `keyword_intent.{label,probability}` per keyword. We read
// only the primary intent; `secondary_keyword_intents` is ignored (kept out of
// the normalized shape on purpose — the rule/UI only surfaces one label).
const searchIntentItemSchema = z
    .object({
    keyword: z.string(),
    keyword_intent: z
        .object({
        label: z.string().nullable().optional(),
        probability: z.number().nullable().optional(),
    })
        .passthrough()
        .nullable()
        .optional(),
})
    .passthrough();
const searchIntentResultSchema = z
    .array(z
    .object({
    items: z.array(searchIntentItemSchema).nullable().optional(),
})
    .passthrough())
    .min(1);
// Keyword Ideas — FLAT item (no `keyword_data` wrapper), unlike related.
const ideasItemSchema = z
    .object({
    keyword: z.string(),
    keyword_info: z
        .object({
        search_volume: z.number().nullable().optional(),
        cpc: z.number().nullable().optional(),
        monthly_searches: monthlySearchesSchema,
    })
        .passthrough()
        .nullable()
        .optional(),
    keyword_properties: z
        .object({
        keyword_difficulty: z.number().nullable().optional(),
    })
        .passthrough()
        .nullable()
        .optional(),
})
    .passthrough();
const ideasResultSchema = z
    .array(z
    .object({
    items: z.array(ideasItemSchema).nullable().optional(),
})
    .passthrough())
    .min(1);
// Keyword Suggestions uses the same flat item shape as Keyword Ideas.
const longTailSuggestionsResultSchema = ideasResultSchema;
// Keyword Overview — Labs endpoint aggregating volume + difficulty + intent +
// SERP-feature signals per keyword in one call. Primary docs verified 2026-07-18
// against DataForSEO Labs `keyword_overview/live`: fields nest as
// `items[].keyword_info.{search_volume,cpc,last_updated_time}`,
// `items[].keyword_properties.keyword_difficulty`,
// `items[].search_intent_info.main_intent`,
// `items[].serp_info.{serp_item_types,se_results_count}`.
const overviewItemSchema = z
    .object({
    keyword: z.string(),
    keyword_info: z
        .object({
        search_volume: z.number().nullable().optional(),
        cpc: z.number().nullable().optional(),
        last_updated_time: z.string().nullable().optional(),
    })
        .passthrough()
        .nullable()
        .optional(),
    keyword_properties: z
        .object({
        keyword_difficulty: z.number().nullable().optional(),
    })
        .passthrough()
        .nullable()
        .optional(),
    search_intent_info: z
        .object({
        main_intent: z.string().nullable().optional(),
    })
        .passthrough()
        .nullable()
        .optional(),
    serp_info: z
        .object({
        serp_item_types: z.array(z.string()).nullable().optional(),
        se_results_count: z.number().nullable().optional(),
    })
        .passthrough()
        .nullable()
        .optional(),
})
    .passthrough();
const overviewResultSchema = z
    .array(z
    .object({
    items: z.array(overviewItemSchema).nullable().optional(),
})
    .passthrough())
    .min(1);
// Historical Search Volume — Labs endpoint returning a multi-year monthly
// series per keyword. Primary docs verified 2026-07-18:
// `items[].keyword` + `items[].keyword_info.monthly_searches[]` shaped
// `{year, month, search_volume}`.
const historicalVolumeItemSchema = z
    .object({
    keyword: z.string(),
    keyword_info: z
        .object({
        monthly_searches: monthlySearchesSchema,
    })
        .passthrough()
        .nullable()
        .optional(),
})
    .passthrough();
const historicalVolumeResultSchema = z
    .array(z
    .object({
    items: z.array(historicalVolumeItemSchema).nullable().optional(),
})
    .passthrough())
    .min(1);
const rankedSiteItemSchema = z
    .object({
    keyword_data: z
        .object({
        keyword: z.string(),
        keyword_info: z
            .object({ search_volume: z.number().nullable().optional() })
            .passthrough()
            .nullable()
            .optional(),
        keyword_properties: z
            .object({ keyword_difficulty: z.number().nullable().optional() })
            .passthrough()
            .nullable()
            .optional(),
    })
        .passthrough(),
    ranked_serp_element: z
        .object({
        serp_item: z
            .object({
            rank_group: z.number().nullable().optional(),
            etv: z.number().nullable().optional(),
            url: z.string().nullable().optional(),
        })
            .passthrough(),
    })
        .passthrough(),
})
    .passthrough();
const rankedSiteResultSchema = z
    .array(z
    .object({ items: z.array(rankedSiteItemSchema).nullable().optional() })
    .passthrough())
    .min(1);
/** Closed set of Labs primary-intent labels — anything else normalizes to null. */
const VALID_INTENTS = new Set<SearchIntent>([
    'informational',
    'commercial',
    'transactional',
    'navigational',
]);
// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
export interface DataForSeoKeywordProviderConfig extends DataForSeoConfig {
    logger?: Logger;
}
/** Max keywords the search_volume endpoint accepts per request (vendor limit). */
export const KEYWORDS_PER_BATCH = 1000;
/** Default `limit` for related-keyword calls — Labs bills per returned row. */
export const DEFAULT_RELATED_LIMIT = 25;
/** Hard ceiling the provider will honour for related-keyword limit. */
export const MAX_RELATED_LIMIT = 1000;
/** Spend ceiling for both site-discovery operations. */
export const MAX_SITE_KEYWORD_LIMIT = 100;
/** Grounded site discovery sends only a small, deterministic evidence set. */
export const MAX_SITE_KEYWORD_SEEDS = 20;
/** Labs is over-fetched before local grounding, but remains spend-bounded. */
export const MAX_SITE_KEYWORD_IDEA_VENDOR_LIMIT = 300;
const CTX_METRICS = { provider: 'dataforseo', operation: 'keywords-metrics' };
const CTX_RELATED = { provider: 'dataforseo', operation: 'keywords-related' };
const CTX_INTENT = { provider: 'dataforseo', operation: 'keywords-search-intent' };
const CTX_IDEAS = { provider: 'dataforseo', operation: 'keywords-ideas' };
const CTX_LONG_TAIL = { provider: 'dataforseo', operation: 'keywords-long-tail' };
const CTX_OVERVIEW = { provider: 'dataforseo', operation: 'keywords-overview' };
const CTX_HISTORICAL = { provider: 'dataforseo', operation: 'keywords-historical-volume' };
const CTX_RANKED_SITE = { provider: 'dataforseo', operation: 'site-ranked-keywords' };
const CTX_SITE_IDEAS = { provider: 'dataforseo', operation: 'site-keyword-ideas' };
/** Most-recent monthly rows returned by getHistoricalVolume. */
export const MAX_MONTHLY_HISTORY = 48;
// ---------------------------------------------------------------------------
// Pure helpers — exported for direct unit coverage
// ---------------------------------------------------------------------------
/** Lowercase, trim, collapse whitespace — matches server keyword normalization. */
export function normalizeKeyword(keyword: string): string {
    return keyword.trim().toLowerCase().replace(/\s+/g, ' ');
}
/** Split a keyword list into vendor-sized batches (max 1000 per request). */
export function batchKeywords(keywords: string[], size = KEYWORDS_PER_BATCH): string[][] {
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const kw of keywords) {
        const normalized = normalizeKeyword(kw);
        if (normalized.length === 0)
            continue;
        if (seen.has(normalized))
            continue;
        seen.add(normalized);
        deduped.push(normalized);
    }
    const batches: string[][] = [];
    for (let i = 0; i < deduped.length; i += size) {
        batches.push(deduped.slice(i, i + size));
    }
    return batches;
}
function toMonthly(raw: z.infer<typeof monthlySearchesSchema> | null | undefined): MonthlySearchVolume[] {
    if (!raw)
        return [];
    const out: MonthlySearchVolume[] = [];
    for (const entry of raw) {
        if (typeof entry.search_volume !== 'number')
            continue;
        out.push({
            year: entry.year,
            month: entry.month,
            searchVolume: entry.search_volume,
        });
    }
    return out;
}
/**
 * Normalize one vendor intent item. A recognized label maps to the enum;
 * anything else (missing/unknown label) → `intent: null`. Confidence carries
 * the reported probability when numeric, else null.
 */
function toIntentResult(item: z.infer<typeof searchIntentItemSchema>): IntentResult {
    const label = item.keyword_intent?.label;
    const intent = typeof label === 'string' && VALID_INTENTS.has(label as SearchIntent)
        ? (label as SearchIntent)
        : null;
    const probability = item.keyword_intent?.probability;
    return {
        keyword: normalizeKeyword(item.keyword),
        intent,
        confidence: typeof probability === 'number' ? probability : null,
    };
}
/**
 * Parse the vendor `last_updated_time` string into a Date, or null when the
 * string is missing / invalid. Vendor reports ISO-like strings (with or
 * without a `Z`).
 */
function toObservedAt(raw: string | null | undefined): Date | null {
    if (!raw)
        return null;
    const ms = Date.parse(raw);
    if (!Number.isFinite(ms))
        return null;
    return new Date(ms);
}
/**
 * Sort monthly rows ascending by (year, month) and bound to the most recent
 * `MAX_MONTHLY_HISTORY` entries, dropping rows with a non-numeric
 * `search_volume` (they carry no signal).
 */
function toBoundedMonthly(raw: z.infer<typeof monthlySearchesSchema> | null | undefined): MonthlySearchVolume[] {
    const parsed = toMonthly(raw);
    parsed.sort((a, b) => (a.year === b.year ? a.month - b.month : a.year - b.year));
    return parsed.length > MAX_MONTHLY_HISTORY
        ? parsed.slice(parsed.length - MAX_MONTHLY_HISTORY)
        : parsed;
}
function mergeVolumeAndDifficulty(keywords: string[], volumeByKeyword: Map<string, z.infer<typeof searchVolumeItemSchema>>, difficultyByKeyword: Map<string, number | null>): KeywordMetrics[] {
    return keywords.map((kw) => {
        const volume = volumeByKeyword.get(kw);
        const difficulty = difficultyByKeyword.get(kw);
        return {
            keyword: kw,
            searchVolume: volume?.search_volume ?? null,
            difficulty: difficulty ?? null,
            cpc: volume?.cpc ?? null,
            monthlySearches: toMonthly(volume?.monthly_searches),
        };
    });
}
// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------
export function createDataForSeoKeywordProvider(cfg: DataForSeoKeywordProviderConfig): KeywordProvider & SiteKeywordProvider {
    async function listMarkets(): Promise<ProviderMarket[]> {
        const outcomes = await dataForSeoRequest(cfg, '/dataforseo_labs/locations_and_languages', [], labsMarketResultSchema, { operation: 'keyword-market-catalog', method: 'GET' });
        const outcome = outcomes[0];
        if (!outcome || outcome.status !== 'ok') {
            throw new VendorMalformedError('dataforseo_labs/locations_and_languages returned no ok tasks', { provider: 'dataforseo', operation: 'keyword-market-catalog' });
        }
        return normalizeLabsMarkets(outcome.result);
    }
    async function callSearchVolume(batch: string[], locationCode: number, languageCode: string): Promise<z.infer<typeof searchVolumeItemSchema>[]> {
        const body = {
            keywords: batch,
            location_code: locationCode,
            language_code: languageCode,
        };
        const outcomes = await dataForSeoRequest(cfg, '/keywords_data/google_ads/search_volume/live', [body], searchVolumeResultSchema, { operation: 'keywords-search-volume' });
        const outcome = outcomes[0];
        if (!outcome || outcome.status !== 'ok') {
            throw new VendorMalformedError('keywords_data/search_volume returned no ok tasks', { ...CTX_METRICS, operation: 'keywords-search-volume' });
        }
        return outcome.result ?? [];
    }
    async function callBulkDifficulty(batch: string[], locationCode: number, languageCode: string): Promise<z.infer<typeof bulkDifficultyItemSchema>[]> {
        const body = {
            keywords: batch,
            location_code: locationCode,
            language_code: languageCode,
        };
        const outcomes = await dataForSeoRequest(cfg, '/dataforseo_labs/google/bulk_keyword_difficulty/live', [body], bulkDifficultyResultSchema, { operation: 'keywords-bulk-difficulty' });
        const outcome = outcomes[0];
        if (!outcome || outcome.status !== 'ok') {
            throw new VendorMalformedError('dataforseo_labs/bulk_keyword_difficulty returned no ok tasks', { ...CTX_METRICS, operation: 'keywords-bulk-difficulty' });
        }
        const items = outcome.result[0]?.items ?? [];
        return items;
    }
    async function getMetrics(keywords: string[], locationCode: number, languageCode: string): Promise<KeywordMetrics[]> {
        const batches = batchKeywords(keywords);
        if (batches.length === 0)
            return [];
        const language = languageCode.toLowerCase();
        const volumeByKeyword = new Map<string, z.infer<typeof searchVolumeItemSchema>>();
        const difficultyByKeyword = new Map<string, number | null>();
        for (const batch of batches) {
            const [volumeItems, difficultyItems] = await Promise.all([
                callSearchVolume(batch, locationCode, language),
                callBulkDifficulty(batch, locationCode, language),
            ]);
            for (const item of volumeItems) {
                volumeByKeyword.set(normalizeKeyword(item.keyword), item);
            }
            for (const item of difficultyItems) {
                difficultyByKeyword.set(normalizeKeyword(item.keyword), typeof item.keyword_difficulty === 'number'
                    ? item.keyword_difficulty
                    : null);
            }
        }
        const dedupedInputs: string[] = [];
        const seen = new Set<string>();
        for (const raw of keywords) {
            const kw = normalizeKeyword(raw);
            if (kw.length === 0 || seen.has(kw))
                continue;
            seen.add(kw);
            dedupedInputs.push(kw);
        }
        return mergeVolumeAndDifficulty(dedupedInputs, volumeByKeyword, difficultyByKeyword);
    }
    async function getRelated(keyword: string, locationCode: number, languageCode: string, limit: number): Promise<KeywordMetrics[]> {
        const normalized = normalizeKeyword(keyword);
        if (normalized.length === 0) {
            throw new VendorMalformedError('related-keywords requires a non-empty seed keyword', CTX_RELATED);
        }
        const clampedLimit = Math.max(1, Math.min(limit, MAX_RELATED_LIMIT));
        const body = {
            keyword: normalized,
            location_code: locationCode,
            language_code: languageCode.toLowerCase(),
            limit: clampedLimit,
            depth: 1,
        };
        const outcomes = await dataForSeoRequest(cfg, '/dataforseo_labs/google/related_keywords/live', [body], relatedResultSchema, { operation: 'keywords-related' });
        const outcome = outcomes[0];
        if (!outcome || outcome.status !== 'ok') {
            throw new VendorMalformedError('dataforseo_labs/related_keywords returned no ok tasks', CTX_RELATED);
        }
        const items = outcome.result[0]?.items ?? [];
        return items.map((item) => {
            const data = item.keyword_data;
            const info = data.keyword_info;
            const props = data.keyword_properties;
            return {
                keyword: data.keyword,
                searchVolume: info?.search_volume ?? null,
                difficulty: props?.keyword_difficulty ?? null,
                cpc: info?.cpc ?? null,
                monthlySearches: toMonthly(info?.monthly_searches),
            };
        });
    }
    async function classifyIntent(keywords: string[], 
    // Search Intent is a language-only endpoint — location is accepted for
    // interface parity (and cache-key parity in the service) but never sent to
    // the vendor.
    _locationCode: number, languageCode: string): Promise<IntentResult[]> {
        const batches = batchKeywords(keywords);
        if (batches.length === 0)
            return [];
        const language = languageCode.toLowerCase();
        const intentByKeyword = new Map<string, IntentResult>();
        for (const batch of batches) {
            const body = { keywords: batch, language_code: language };
            const outcomes = await dataForSeoRequest(cfg, '/dataforseo_labs/google/search_intent/live', [body], searchIntentResultSchema, { operation: 'keywords-search-intent' });
            const outcome = outcomes[0];
            if (!outcome || outcome.status !== 'ok') {
                throw new VendorMalformedError('dataforseo_labs/search_intent returned no ok tasks', CTX_INTENT);
            }
            const items = outcome.result[0]?.items ?? [];
            for (const item of items) {
                const result = toIntentResult(item);
                intentByKeyword.set(result.keyword, result);
            }
        }
        // One row per DEDUPED input keyword; a keyword the vendor omitted is
        // reported as fully null (never dropped) — same discipline as getMetrics.
        const dedupedInputs: string[] = [];
        const seen = new Set<string>();
        for (const raw of keywords) {
            const kw = normalizeKeyword(raw);
            if (kw.length === 0 || seen.has(kw))
                continue;
            seen.add(kw);
            dedupedInputs.push(kw);
        }
        return dedupedInputs.map((kw) => intentByKeyword.get(kw) ?? { keyword: kw, intent: null, confidence: null });
    }
    async function getIdeas(seed: string, locationCode: number, languageCode: string, limit: number): Promise<KeywordMetrics[]> {
        const normalized = normalizeKeyword(seed);
        if (normalized.length === 0) {
            throw new VendorMalformedError('keyword-ideas requires a non-empty seed keyword', CTX_IDEAS);
        }
        const clampedLimit = Math.max(1, Math.min(limit, MAX_RELATED_LIMIT));
        const body = {
            keywords: [normalized],
            location_code: locationCode,
            language_code: languageCode.toLowerCase(),
            limit: clampedLimit,
        };
        const outcomes = await dataForSeoRequest(cfg, '/dataforseo_labs/google/keyword_ideas/live', [body], ideasResultSchema, { operation: 'keywords-ideas' });
        const outcome = outcomes[0];
        if (!outcome || outcome.status !== 'ok') {
            throw new VendorMalformedError('dataforseo_labs/keyword_ideas returned no ok tasks', CTX_IDEAS);
        }
        const items = outcome.result[0]?.items ?? [];
        return items.map((item) => {
            const info = item.keyword_info;
            const props = item.keyword_properties;
            return {
                keyword: item.keyword,
                searchVolume: info?.search_volume ?? null,
                difficulty: props?.keyword_difficulty ?? null,
                cpc: info?.cpc ?? null,
                monthlySearches: toMonthly(info?.monthly_searches),
            };
        });
    }
    async function getLongTailSuggestions(seed: string, locationCode: number, languageCode: string, limit: number): Promise<KeywordMetrics[]> {
        const normalized = normalizeKeyword(seed);
        if (normalized.length === 0) {
            throw new VendorMalformedError('keyword-suggestions requires a non-empty seed keyword', CTX_LONG_TAIL);
        }
        const clampedLimit = Math.max(1, Math.min(limit, MAX_RELATED_LIMIT));
        const outcomes = await dataForSeoRequest(cfg, '/dataforseo_labs/google/keyword_suggestions/live', [{
                keyword: normalized,
                location_code: locationCode,
                language_code: languageCode.toLowerCase(),
                limit: clampedLimit,
            }], longTailSuggestionsResultSchema, { operation: 'keywords-long-tail' });
        const outcome = outcomes[0];
        if (!outcome || outcome.status !== 'ok') {
            throw new VendorMalformedError('dataforseo_labs/keyword_suggestions returned no ok tasks', CTX_LONG_TAIL);
        }
        return (outcome.result[0]?.items ?? []).map((item) => ({
            keyword: item.keyword,
            searchVolume: item.keyword_info?.search_volume ?? null,
            difficulty: item.keyword_properties?.keyword_difficulty ?? null,
            cpc: item.keyword_info?.cpc ?? null,
            monthlySearches: toMonthly(item.keyword_info?.monthly_searches),
        }));
    }
    async function getOverview(keywords: string[], locationCode: number, languageCode: string): Promise<KeywordOverview[]> {
        const batches = batchKeywords(keywords);
        if (batches.length === 0)
            return [];
        const language = languageCode.toLowerCase();
        const overviewByKeyword = new Map<string, KeywordOverview>();
        for (const batch of batches) {
            const body = {
                keywords: batch,
                location_code: locationCode,
                language_code: language,
            };
            const outcomes = await dataForSeoRequest(cfg, '/dataforseo_labs/google/keyword_overview/live', [body], overviewResultSchema, { operation: 'keywords-overview' });
            const outcome = outcomes[0];
            if (!outcome || outcome.status !== 'ok') {
                throw new VendorMalformedError('dataforseo_labs/keyword_overview returned no ok tasks', CTX_OVERVIEW);
            }
            const items = outcome.result[0]?.items ?? [];
            for (const item of items) {
                const keyword = normalizeKeyword(item.keyword);
                const info = item.keyword_info;
                const props = item.keyword_properties;
                const intentLabel = item.search_intent_info?.main_intent;
                const intent = typeof intentLabel === 'string' && VALID_INTENTS.has(intentLabel as SearchIntent)
                    ? (intentLabel as SearchIntent)
                    : null;
                overviewByKeyword.set(keyword, {
                    keyword,
                    searchVolume: info?.search_volume ?? null,
                    difficulty: props?.keyword_difficulty ?? null,
                    cpc: info?.cpc ?? null,
                    intent,
                    serpFeatures: normalizeVendorSerpFeatures(item.serp_info?.serp_item_types),
                    observedAt: toObservedAt(info?.last_updated_time),
                    resultsCount: item.serp_info?.se_results_count ?? null,
                });
            }
        }
        const dedupedInputs: string[] = [];
        const seen = new Set<string>();
        for (const raw of keywords) {
            const kw = normalizeKeyword(raw);
            if (kw.length === 0 || seen.has(kw))
                continue;
            seen.add(kw);
            dedupedInputs.push(kw);
        }
        return dedupedInputs.map((kw) => overviewByKeyword.get(kw) ?? {
            keyword: kw,
            searchVolume: null,
            difficulty: null,
            cpc: null,
            intent: null,
            serpFeatures: [],
            observedAt: null,
            resultsCount: null,
        });
    }
    async function getHistoricalVolume(keywords: string[], locationCode: number, languageCode: string): Promise<KeywordHistoricalVolume[]> {
        const batches = batchKeywords(keywords);
        if (batches.length === 0)
            return [];
        const language = languageCode.toLowerCase();
        const seriesByKeyword = new Map<string, MonthlySearchVolume[]>();
        for (const batch of batches) {
            const body = {
                keywords: batch,
                location_code: locationCode,
                language_code: language,
            };
            const outcomes = await dataForSeoRequest(cfg, '/dataforseo_labs/google/historical_search_volume/live', [body], historicalVolumeResultSchema, { operation: 'keywords-historical-volume' });
            const outcome = outcomes[0];
            if (!outcome || outcome.status !== 'ok') {
                throw new VendorMalformedError('dataforseo_labs/historical_search_volume returned no ok tasks', CTX_HISTORICAL);
            }
            const items = outcome.result[0]?.items ?? [];
            for (const item of items) {
                const keyword = normalizeKeyword(item.keyword);
                seriesByKeyword.set(keyword, toBoundedMonthly(item.keyword_info?.monthly_searches));
            }
        }
        const dedupedInputs: string[] = [];
        const seen = new Set<string>();
        for (const raw of keywords) {
            const kw = normalizeKeyword(raw);
            if (kw.length === 0 || seen.has(kw))
                continue;
            seen.add(kw);
            dedupedInputs.push(kw);
        }
        return dedupedInputs.map((kw) => ({
            keyword: kw,
            monthlySearches: seriesByKeyword.get(kw) ?? [],
        }));
    }
    async function getRankedKeywordsForSite(domain: string, locationCode: number, languageCode: string, limit: number): Promise<SiteKeywordCandidate[]> {
        const target = normalizeSerpDomain(domain.trim());
        if (target.length === 0) {
            throw new VendorMalformedError('ranked-keywords requires a domain', CTX_RANKED_SITE);
        }
        const clampedLimit = Math.max(1, Math.min(limit, MAX_SITE_KEYWORD_LIMIT));
        const outcomes = await dataForSeoRequest(cfg, '/dataforseo_labs/google/ranked_keywords/live', [{
                target,
                location_code: locationCode,
                language_code: languageCode.toLowerCase(),
                item_types: ['organic'],
                historical_serp_mode: 'live',
                // Variants are separately trackable keywords, so collapsing them costs
                // the caller real suggestions — measured 2 of 4 rows dropped on a live
                // domain. The volume filter stays: a zero-volume keyword is not worth
                // suggesting.
                ignore_synonyms: false,
                filters: [['keyword_data.keyword_info.search_volume', '>', 0]],
                order_by: [
                    'ranked_serp_element.serp_item.etv,desc',
                    'keyword_data.keyword_info.search_volume,desc',
                ],
                limit: clampedLimit,
            }], rankedSiteResultSchema, { operation: 'site-ranked-keywords' });
        const outcome = outcomes[0];
        if (!outcome || outcome.status !== 'ok') {
            throw new VendorMalformedError('dataforseo_labs/ranked_keywords returned no ok tasks', CTX_RANKED_SITE);
        }
        return (outcome.result[0]!.items ?? []).slice(0, clampedLimit).map((item) => ({
            keyword: item.keyword_data.keyword,
            searchVolume: item.keyword_data.keyword_info?.search_volume ?? null,
            difficulty: item.keyword_data.keyword_properties?.keyword_difficulty ?? null,
            currentPosition: item.ranked_serp_element.serp_item.rank_group ?? null,
            estimatedTraffic: item.ranked_serp_element.serp_item.etv ?? null,
            rankingUrl: item.ranked_serp_element.serp_item.url ?? null,
        }));
    }
    async function getKeywordIdeasForSite(seeds: string[], locationCode: number, languageCode: string, limit: number): Promise<SiteKeywordCandidate[]> {
        const normalizedSeeds = batchKeywords(seeds)
            .flat()
            .slice(0, MAX_SITE_KEYWORD_SEEDS);
        if (normalizedSeeds.length === 0) {
            throw new VendorMalformedError('site-keyword-ideas requires seed keywords', CTX_SITE_IDEAS);
        }
        const clampedLimit = Math.max(1, Math.min(limit, MAX_SITE_KEYWORD_LIMIT));
        const vendorLimit = Math.min(clampedLimit * 3, MAX_SITE_KEYWORD_IDEA_VENDOR_LIMIT);
        const outcomes = await dataForSeoRequest(cfg, '/dataforseo_labs/google/keyword_ideas/live', [{
                keywords: normalizedSeeds,
                location_code: locationCode,
                language_code: languageCode.toLowerCase(),
                closely_variants: false,
                ignore_synonyms: true,
                filters: [['keyword_info.search_volume', '>', 0]],
                order_by: [
                    'relevance,desc',
                    'keyword_info.search_volume,desc',
                ],
                limit: vendorLimit,
            }], ideasResultSchema, { operation: 'site-keyword-ideas' });
        const outcome = outcomes[0];
        if (!outcome || outcome.status !== 'ok') {
            throw new VendorMalformedError('dataforseo_labs/keyword_ideas returned no ok tasks', CTX_SITE_IDEAS);
        }
        return (outcome.result[0]?.items ?? []).slice(0, vendorLimit).map((item) => ({
            keyword: item.keyword,
            searchVolume: item.keyword_info?.search_volume ?? null,
            difficulty: item.keyword_properties?.keyword_difficulty ?? null,
            currentPosition: null,
            estimatedTraffic: null,
            rankingUrl: null,
        }));
    }
    return {
        listMarkets,
        getMetrics,
        getRelated,
        classifyIntent,
        getIdeas,
        getLongTailSuggestions,
        getOverview,
        getHistoricalVolume,
        getRankedKeywordsForSite,
        getKeywordIdeasForSite,
    };
}
