/**
 * DataForSEO Labs Competitors adapter.
 *
 * Implements the vendor-neutral CompetitorProvider over live
 * DataForSEO Labs v3 endpoints:
 *
 *   getCompetitors           → POST /dataforseo_labs/google/competitors_domain/live
 *                              (Labs bills per request + per returned row —
 *                              always pass `limit`; the module clamps it.)
 *
 *   getSerpCompetitors       → POST /dataforseo_labs/google/serp_competitors/live
 *                              Keyword-driven fallback: domains dominating the
 *                              SERPs for the site's TRACKED keywords. Used when
 *                              competitors_domain is structurally empty (target
 *                              has no ranked-keyword footprint in the Labs index).
 *
 *   getDomainIntersection    → one swapped organic competitor-only request,
 *                              normalized back to the legacy target1/target2
 *                              orientation.
 *
 *   compareDomains           → exactly three bounded organic intersection
 *                              requests: shared, owned-only, and swapped
 *                              competitor-only.
 */
import type { Logger } from 'pino';
import { z } from 'zod';
import { buildObservationMeta, marketFromDataForSeo, } from '../../observations/observations.js';
import { DOMAIN_COMPARISON_MAX_ROWS, normalizeDomainComparisonResult, } from '../domain-comparison.js';
import { dataForSeoRequest, type DataForSeoConfig } from '../http.js';
import { VendorMalformedError } from '../errors.js';
import type { CompetitorEntry, CompetitorProvider, DomainComparisonInput, DomainComparisonResult, DomainComparisonRow, DomainIntersectionOptions, DomainIntersectionRow, DomainRankOverviewRow, HistoricalRankOverviewPoint, HistoricalRankOverviewResult, SearchIntent, TechStackCategory, TechStackEntry, TrafficEstimationCountry, TrafficEstimationRow, } from '../types.js';
// ---------------------------------------------------------------------------
// Vendor payload schemas
// ---------------------------------------------------------------------------
const organicMetricsSchema = z
    .object({
    count: z.number().nullable().optional(),
    etv: z.number().nullable().optional(),
})
    .passthrough();
const competitorItemSchema = z
    .object({
    domain: z.string(),
    avg_position: z.number().nullable().optional(),
    intersections: z.number().nullable().optional(),
    metrics: z
        .object({ organic: organicMetricsSchema.nullable().optional() })
        .passthrough()
        .nullable()
        .optional(),
})
    .passthrough();
const competitorsResultSchema = z
    .array(z
    .object({
    items: z.array(competitorItemSchema).nullable().optional(),
})
    .passthrough())
    .min(1);
const serpCompetitorItemSchema = z
    .object({
    domain: z.string(),
    avg_position: z.number().nullable().optional(),
    keywords_count: z.number().nullable().optional(),
    etv: z.number().nullable().optional(),
})
    .passthrough();
const serpCompetitorsResultSchema = z
    .array(z
    .object({
    items: z.array(serpCompetitorItemSchema).nullable().optional(),
})
    .passthrough())
    .min(1);
const intersectionKeywordDataSchema = z
    .object({
    keyword: z.string().min(1).max(200),
    keyword_info: z
        .object({
        search_volume: z.number().int().nonnegative().nullable().optional(),
    })
        .passthrough()
        .nullable()
        .optional(),
    keyword_properties: z
        .object({
        keyword_difficulty: z.number().min(0).max(100).nullable().optional(),
    })
        .passthrough()
        .nullable()
        .optional(),
    search_intent_info: z
        .object({ main_intent: z.string().nullable().optional() })
        .passthrough()
        .nullable()
        .optional(),
})
    .passthrough();
const organicSerpItemSchema = z
    .object({
    type: z.string().nullable().optional(),
    rank_group: z.number().int().positive().nullable().optional(),
    rank_absolute: z.number().int().positive().nullable().optional(),
    url: z.string().nullable().optional(),
    relative_url: z.string().nullable().optional(),
})
    .passthrough();
const serpElementSchema = organicSerpItemSchema.extend({
    serp_item: organicSerpItemSchema.nullable().optional(),
});
const intersectionItemSchema = z
    .object({
    keyword_data: intersectionKeywordDataSchema,
    first_domain_serp_element: serpElementSchema.nullable().optional(),
    second_domain_serp_element: serpElementSchema.nullable().optional(),
})
    .passthrough();
const intersectionResultSchema = z
    .array(z
    .object({
    items: z.array(intersectionItemSchema).nullable().optional(),
})
    .passthrough())
    .min(1);
// Domain Analytics — Domain Technologies. ASSUMPTION (doc not reachable
// offline; modeled on the standard Domain Analytics envelope, flagged in the
// self-audit): `result[0].technologies` is a two-level map
// `group → category → technology-name[]`, e.g.
//   { "cms": { "cms": ["WordPress"] },
//     "analytics": { "analytics": ["Google Analytics"] },
//     "cdn": { "cdn": ["Cloudflare"] } }
// The GROUP key drives our closed `TechStackCategory` bucket; anything
// unrecognized falls to 'other'. `.passthrough()` tolerates the many extra
// domain-level fields (whois, rank, contacts) this endpoint also returns.
const technologiesGroupSchema = z.record(z.string(), z.array(z.string()));
const domainTechnologiesItemSchema = z
    .object({
    domain: z.string().nullable().optional(),
    technologies: z.record(z.string(), technologiesGroupSchema).nullable().optional(),
})
    .passthrough();
const technologiesResultSchema = z.array(domainTechnologiesItemSchema).min(1);
// ---------------------------------------------------------------------------
// Traffic-op payload schemas (child 01b-3)
// ---------------------------------------------------------------------------
const trafficCountryDistributionEntrySchema = z
    .object({
    etv: z.number().nullable().optional(),
    count: z.number().nullable().optional(),
})
    .passthrough();
const trafficEstimationItemSchema = z
    .object({
    target: z.string().nullable().optional(),
    metrics: z
        .object({
        organic: z
            .object({
            etv: z.number().nullable().optional(),
            count: z.number().nullable().optional(),
        })
            .passthrough()
            .nullable()
            .optional(),
    })
        .passthrough()
        .nullable()
        .optional(),
    country_distribution: z
        .record(z.string(), trafficCountryDistributionEntrySchema)
        .nullable()
        .optional(),
})
    .passthrough();
const trafficEstimationResultSchema = z
    .array(z
    .object({
    items: z.array(trafficEstimationItemSchema).nullable().optional(),
})
    .passthrough())
    .nullable();
const domainRankOverviewItemSchema = z
    .object({
    target: z.string().nullable().optional(),
    metrics: z
        .object({
        organic: z
            .object({
            count: z.number().nullable().optional(),
            etv: z.number().nullable().optional(),
            rank: z.number().nullable().optional(),
        })
            .passthrough()
            .nullable()
            .optional(),
    })
        .passthrough()
        .nullable()
        .optional(),
})
    .passthrough();
const domainRankOverviewResultSchema = z
    .array(z
    .object({
    items: z.array(domainRankOverviewItemSchema).nullable().optional(),
})
    .passthrough())
    .nullable();
const historicalRankOverviewPointSchema = z
    .object({
    year: z.number().nullable().optional(),
    month: z.number().nullable().optional(),
    metrics: z
        .object({
        organic: z
            .object({
            count: z.number().nullable().optional(),
            etv: z.number().nullable().optional(),
            rank: z.number().nullable().optional(),
        })
            .passthrough()
            .nullable()
            .optional(),
    })
        .passthrough()
        .nullable()
        .optional(),
})
    .passthrough();
const historicalRankOverviewItemSchema = z
    .object({
    target: z.string().nullable().optional(),
    items: z.array(historicalRankOverviewPointSchema).nullable().optional(),
})
    .passthrough();
const historicalRankOverviewResultSchema = z
    .array(z
    .object({
    items: z.array(historicalRankOverviewItemSchema).nullable().optional(),
})
    .passthrough())
    .nullable();
// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
export interface DataForSeoCompetitorProviderConfig extends DataForSeoConfig {
    logger?: Logger;
    /** Capture clock for comparison observation metadata. */
    now?: () => Date;
}
// Labs bills $0.012/task + $0.00012/item, so the request `limit` is a spend
// ceiling. 100 is the enforced bound the `competitor_lookups` unit cost in
// `shared/billing/vendor-costs.ts` budgets for ($0.012 + 100 × $0.00012 =
// $0.024/lookup) — raising it past 100 breaks the margin model.
export const COMPETITORS_MAX_LIMIT = 100;
export const COMPETITORS_DEFAULT_LIMIT = 20;
export const INTERSECTION_MAX_LIMIT = 100;
export const INTERSECTION_DEFAULT_LIMIT = 100;
/** Pinned Labs Domain Intersection Live unit economics (micro-dollars). */
export const DOMAIN_INTERSECTION_TASK_COST_MICROS = 12000n;
export const DOMAIN_INTERSECTION_ROW_COST_MICROS = 120n;
// serp_competitors accepts up to 200 keywords per task (vendor doc limit);
// we cap at 100 — keyword count does not change the task price, but a
// bounded list keeps the cache key stable and the request body small.
export const SERP_COMPETITORS_MAX_KEYWORDS = 100;
/** Bulk traffic estimation input ceiling (child 01b-3). */
export const TRAFFIC_ESTIMATION_MAX_DOMAINS = 30;
/** Top-country rows per traffic estimation row. */
export const TRAFFIC_ESTIMATION_TOP_COUNTRIES = 10;
/** Historical rank overview point ceiling. */
export const HISTORICAL_RANK_MAX_POINTS = 24;
/** Positive `locationCode` bound at the boundary (Prompt 00 spec). */
export const LOCATION_CODE_MIN = 1;
/** ISO 639-1 language codes are exactly two ASCII letters. */
const LANGUAGE_CODE_RE = /^[A-Za-z]{2}$/;
const CTX_COMPETITORS = { provider: 'dataforseo', operation: 'competitors-domain' };
const CTX_SERP_COMPETITORS = { provider: 'dataforseo', operation: 'serp-competitors' };
const CTX_INTERSECTION = { provider: 'dataforseo', operation: 'domain-intersection' };
const CTX_COMPARISON = { provider: 'dataforseo', operation: 'domain-comparison' };
const CTX_TECHNOLOGIES = { provider: 'dataforseo', operation: 'domain-technologies' };
const CTX_TRAFFIC_ESTIMATION = {
    provider: 'dataforseo',
    operation: 'labs-competitors-traffic-estimation',
};
const CTX_DOMAIN_RANK_OVERVIEW = {
    provider: 'dataforseo',
    operation: 'labs-competitors-domain-rank-overview',
};
const CTX_HISTORICAL_RANK_OVERVIEW = {
    provider: 'dataforseo',
    operation: 'labs-competitors-historical-rank-overview',
};
// ---------------------------------------------------------------------------
// Pure helpers — exported for direct unit coverage.
// ---------------------------------------------------------------------------
export function normalizeCompetitorDomain(domain: string): string {
    const trimmed = domain.trim();
    const withoutScheme = trimmed.replace(/^https?:\/\//i, '');
    return withoutScheme.replace(/\/+$/, '').toLowerCase();
}
/**
 * `serp_competitors` reports domains as they appear in the SERP
 * (`www.site24x7.com`) while `competitors_domain` reports bare registrable
 * domains — strip the `www.` prefix so both sources agree in the snapshot
 * table and the gap-analysis click-through. Applied to RESULT domains only;
 * request targets keep the exact user-provided host.
 */
export function stripWwwPrefix(domain: string): string {
    return domain.replace(/^www\./i, '');
}
/**
 * Canonicalize a tracked-keyword list for the serp_competitors request AND
 * the cross-user cache key: trim, drop empties, de-duplicate, sort
 * lexicographically (stable key for identical sets), cap at
 * `SERP_COMPETITORS_MAX_KEYWORDS`.
 */
export function normalizeSerpKeywords(keywords: string[]): string[] {
    const seen = new Set<string>();
    for (const keyword of keywords) {
        const trimmed = keyword.trim();
        if (trimmed.length === 0)
            continue;
        seen.add(trimmed.toLowerCase());
    }
    return [...seen].sort().slice(0, SERP_COMPETITORS_MAX_KEYWORDS);
}
export function clampCompetitorLimit(limit: number | undefined): number {
    if (typeof limit !== 'number' || !Number.isFinite(limit)) {
        return COMPETITORS_DEFAULT_LIMIT;
    }
    return Math.max(1, Math.min(Math.floor(limit), COMPETITORS_MAX_LIMIT));
}
export function clampIntersectionLimit(limit: number | undefined): number {
    if (typeof limit !== 'number' || !Number.isFinite(limit)) {
        return INTERSECTION_DEFAULT_LIMIT;
    }
    return Math.max(1, Math.min(Math.floor(limit), INTERSECTION_MAX_LIMIT));
}
function normalizeComparisonTarget(raw: string): string {
    const target = stripWwwPrefix(normalizeCompetitorDomain(raw));
    if (target.length === 0 ||
        target.length > 253 ||
        target.includes('/') ||
        target.includes('?') ||
        target.includes('#') ||
        target.includes('@') ||
        target.includes(':')) {
        throw new VendorMalformedError('domain comparison requires canonical bare target domains', CTX_COMPARISON);
    }
    return target;
}
function hostnameMatchesTarget(hostname: string, expectedTarget: string): boolean {
    const host = hostname.toLowerCase().replace(/\.$/u, '');
    return host === expectedTarget || host.endsWith(`.${expectedTarget}`);
}
/**
 * Validate and canonicalize a frozen profile origin. The path is discarded:
 * relative ranking paths resolve from the origin root, never from a profile
 * URL's current pathname.
 */
export function normalizeComparisonOrigin(raw: string, expectedTarget: string): string {
    try {
        const parsed = new URL(raw);
        if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
            parsed.username.length > 0 ||
            parsed.password.length > 0 ||
            !hostnameMatchesTarget(parsed.hostname, expectedTarget)) {
            throw new Error('origin mismatch');
        }
        return parsed.origin;
    }
    catch (cause) {
        throw new VendorMalformedError('domain comparison origin must be HTTP(S) on its frozen target domain', { ...CTX_COMPARISON, cause });
    }
}
function canonicalAbsoluteRankingUrl(raw: string, expectedTarget: string): string | null {
    if (raw.length === 0 || raw.length > 2048)
        return null;
    try {
        const parsed = new URL(raw);
        if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
            parsed.username.length > 0 ||
            parsed.password.length > 0 ||
            !hostnameMatchesTarget(parsed.hostname, expectedTarget)) {
            return null;
        }
        parsed.hash = '';
        const normalized = parsed.toString();
        return normalized.length <= 2048 ? normalized : null;
    }
    catch {
        return null;
    }
}
/**
 * Prefer a valid absolute observed URL, then resolve a leading-slash relative
 * URL against the frozen matching origin. Missing/invalid values stay null;
 * this helper never substitutes `/` or another homepage.
 */
export function normalizeRankingUrl(absoluteUrl: string | null | undefined, relativeUrl: string | null | undefined, expectedTarget: string, origin: string): string | null {
    if (typeof absoluteUrl === 'string') {
        const absolute = canonicalAbsoluteRankingUrl(absoluteUrl.trim(), expectedTarget);
        if (absolute !== null)
            return absolute;
    }
    if (typeof relativeUrl !== 'string' ||
        !relativeUrl.startsWith('/') ||
        relativeUrl.startsWith('//') ||
        relativeUrl.length > 2048) {
        return null;
    }
    try {
        return canonicalAbsoluteRankingUrl(new URL(relativeUrl, origin).toString(), expectedTarget);
    }
    catch {
        return null;
    }
}
type IntersectionItem = z.infer<typeof intersectionItemSchema>;
type SerpElement = z.infer<typeof serpElementSchema>;
function organicSerpItem(element: SerpElement | null | undefined) {
    if (!element)
        return null;
    const item = element.serp_item ?? element;
    const type = item.type ?? element.type;
    if (type !== null && type !== undefined && type !== 'organic') {
        throw new VendorMalformedError(`domain intersection returned unexpected SERP item type: ${type}`, CTX_COMPARISON);
    }
    return item;
}
function mapSearchIntent(raw: string | null | undefined): SearchIntent | null {
    switch (raw?.toLowerCase()) {
        case 'informational':
        case 'commercial':
        case 'transactional':
        case 'navigational':
            return raw.toLowerCase() as SearchIntent;
        default:
            return null;
    }
}
/**
 * Map a vendor technology-group key onto our closed `TechStackCategory`
 * union. Unknown groups fall to `'other'` — the signal is kept, never
 * dropped. Exported for direct unit coverage of the normalization branch.
 */
export function mapVendorTechCategory(group: string): TechStackCategory {
    switch (group.trim().toLowerCase()) {
        case 'cms':
        case 'blogs':
            return 'cms';
        case 'analytics':
        case 'tag_managers':
            return 'analytics';
        case 'ecommerce':
        case 'e-commerce':
            return 'ecommerce';
        case 'cdn':
        case 'hosting':
        case 'web_servers':
        case 'servers':
        case 'paas':
        case 'iaas':
        case 'dns':
            return 'hosting';
        default:
            return 'other';
    }
}
/**
 * Flatten the vendor's `group → category → name[]` technologies map into
 * normalized `TechStackEntry[]`, de-duplicated by (category, name). Absent /
 * null technologies → `[]` (a valid "nothing detected" state). Exported for
 * direct coverage of the empty + unrecognized-category branches.
 */
export function normalizeTechnologies(technologies: Record<string, Record<string, string[]>> | null | undefined): TechStackEntry[] {
    if (!technologies)
        return [];
    const seen = new Set<string>();
    const entries: TechStackEntry[] = [];
    for (const [group, categories] of Object.entries(technologies)) {
        const category = mapVendorTechCategory(group);
        for (const names of Object.values(categories)) {
            for (const name of names) {
                const key = `${category} ${name}`;
                if (seen.has(key))
                    continue;
                seen.add(key);
                entries.push({ category, name });
            }
        }
    }
    return entries;
}
/**
 * Normalize a domain string for OUTPUT rows: lowercased, scheme + `www.` +
 * trailing slash stripped. Empty input returns `''` so the caller can drop
 * the row.
 */
export function normalizeTrafficOutputDomain(raw: string): string {
    const trimmed = raw.trim();
    const withoutScheme = trimmed.replace(/^https?:\/\//i, '');
    const withoutWww = withoutScheme.replace(/^www\./i, '');
    return withoutWww.replace(/\/+$/, '').toLowerCase();
}
/**
 * Normalize + dedupe the caller's `domains` for `getTrafficEstimation`.
 * Result is 1..30 unique lowercased hostnames in first-seen order; boundary
 * throws when the caller passed none/all-empty/negative-shaped input.
 */
export function normalizeTrafficDomains(domains: readonly string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of domains) {
        if (typeof raw !== 'string')
            continue;
        const norm = normalizeTrafficOutputDomain(raw);
        if (norm.length === 0)
            continue;
        if (seen.has(norm))
            continue;
        seen.add(norm);
        out.push(norm);
        if (out.length >= TRAFFIC_ESTIMATION_MAX_DOMAINS)
            break;
    }
    return out;
}
/** Clamp historical rank overview `limit` to [1, HISTORICAL_RANK_MAX_POINTS]. */
export function clampHistoricalRankLimit(limit: number | undefined): number {
    if (typeof limit !== 'number' || !Number.isFinite(limit)) {
        return HISTORICAL_RANK_MAX_POINTS;
    }
    return Math.max(1, Math.min(Math.floor(limit), HISTORICAL_RANK_MAX_POINTS));
}
/**
 * Enforce Prompt 00 bounds on `locationCode` (positive integer) and
 * `languageCode` (ISO 639-1) before the request leaves the adapter. Throws
 * `VendorMalformedError` — the caller passed garbage config, not a vendor
 * fault.
 */
function assertLocationAndLanguage(locationCode: number, languageCode: string, ctx: {
    provider: string;
    operation: string;
}): {
    locationCode: number;
    languageCode: string;
} {
    if (typeof locationCode !== 'number' ||
        !Number.isInteger(locationCode) ||
        locationCode < LOCATION_CODE_MIN) {
        throw new VendorMalformedError(`${ctx.operation} requires a positive integer locationCode`, ctx);
    }
    if (typeof languageCode !== 'string' || !LANGUAGE_CODE_RE.test(languageCode)) {
        throw new VendorMalformedError(`${ctx.operation} requires an ISO 639-1 languageCode`, ctx);
    }
    return { locationCode, languageCode: languageCode.toLowerCase() };
}
/**
 * Fold the vendor `country_distribution` map into ordered top-country rows.
 * Uses `etv` as the primary sort key (higher first) and clips to
 * `TRAFFIC_ESTIMATION_TOP_COUNTRIES`. Non-numeric etv rows drop.
 */
export function normalizeTrafficCountries(distribution: Record<string, {
    etv?: number | null;
    count?: number | null;
}> | null | undefined): TrafficEstimationCountry[] {
    if (!distribution)
        return [];
    const rows: TrafficEstimationCountry[] = [];
    for (const [code, entry] of Object.entries(distribution)) {
        const trimmed = code.trim();
        if (trimmed.length === 0)
            continue;
        const visits = typeof entry.etv === 'number' && entry.etv >= 0 ? Math.round(entry.etv) : 0;
        rows.push({ countryCode: trimmed.toUpperCase(), visits });
    }
    rows.sort((a, b) => b.visits - a.visits);
    return rows.slice(0, TRAFFIC_ESTIMATION_TOP_COUNTRIES);
}
// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------
export function createDataForSeoCompetitorProvider(cfg: DataForSeoCompetitorProviderConfig): Required<CompetitorProvider> {
    async function requestDomainIntersection(input: {
        target1: string;
        target2: string;
        locationCode: number;
        languageCode: string;
        intersections: boolean;
        limit: number;
        context: typeof CTX_INTERSECTION | typeof CTX_COMPARISON;
    }): Promise<IntersectionItem[]> {
        const outcomes = await dataForSeoRequest(cfg, '/dataforseo_labs/google/domain_intersection/live', [
            {
                target1: input.target1,
                target2: input.target2,
                location_code: input.locationCode,
                language_code: input.languageCode,
                intersections: input.intersections,
                item_types: ['organic'],
                limit: input.limit,
            },
        ], intersectionResultSchema, { operation: input.context.operation });
        const outcome = outcomes[0];
        if (!outcome || outcome.status !== 'ok') {
            throw new VendorMalformedError('domain_intersection returned no ok tasks', input.context);
        }
        return outcome.result[0]?.items ?? [];
    }
    function comparisonRow(item: IntersectionItem, input: DomainComparisonInput, origins: {
        owned: string;
        competitor: string;
    }, firstSide: 'owned' | 'competitor', observedAt: Date): DomainComparisonRow {
        const first = organicSerpItem(item.first_domain_serp_element);
        const second = organicSerpItem(item.second_domain_serp_element);
        const owned = firstSide === 'owned' ? first : second;
        const competitor = firstSide === 'competitor' ? first : second;
        const data = item.keyword_data;
        return {
            keyword: data.keyword,
            normalizedKeyword: '',
            ownedPosition: owned?.rank_group ?? null,
            competitorPosition: competitor?.rank_group ?? null,
            ownedRankAbsolute: owned?.rank_absolute ?? null,
            competitorRankAbsolute: competitor?.rank_absolute ?? null,
            ownedUrl: normalizeRankingUrl(owned?.url, owned?.relative_url, input.ownedDomain, origins.owned),
            competitorUrl: normalizeRankingUrl(competitor?.url, competitor?.relative_url, input.competitorDomain, origins.competitor),
            searchVolume: data.keyword_info?.search_volume ?? null,
            keywordDifficulty: data.keyword_properties?.keyword_difficulty ?? null,
            intent: mapSearchIntent(data.search_intent_info?.main_intent),
            observationMeta: buildObservationMeta({
                sourceKind: 'provider_observation',
                sourceLabel: 'dataforseo',
                observedAt,
                market: marketFromDataForSeo({
                    locationCode: input.locationCode,
                    languageCode: input.languageCode,
                }),
                sampleCount: 1,
                now: observedAt,
            }),
        };
    }
    async function getCompetitors(domain: string, locationCode: number, languageCode: string, limit: number): Promise<CompetitorEntry[]> {
        const target = normalizeCompetitorDomain(domain);
        if (target.length === 0) {
            throw new VendorMalformedError('competitors_domain requires a non-empty target', CTX_COMPETITORS);
        }
        const clamped = clampCompetitorLimit(limit);
        const body = {
            target,
            location_code: locationCode,
            language_code: languageCode.toLowerCase(),
            limit: clamped,
            exclude_top_domains: true,
        };
        const outcomes = await dataForSeoRequest(cfg, '/dataforseo_labs/google/competitors_domain/live', [body], competitorsResultSchema, { operation: 'competitors-domain' });
        const outcome = outcomes[0];
        if (!outcome || outcome.status !== 'ok') {
            throw new VendorMalformedError('competitors_domain returned no ok tasks', CTX_COMPETITORS);
        }
        const items = outcome.result[0]?.items ?? [];
        return items.map((item) => ({
            domain: item.domain,
            avgPosition: typeof item.avg_position === 'number' ? item.avg_position : null,
            intersections: typeof item.intersections === 'number' ? item.intersections : 0,
            estimatedTraffic: typeof item.metrics?.organic?.etv === 'number' ? item.metrics.organic.etv : null,
        }));
    }
    async function getSerpCompetitors(keywordList: string[], locationCode: number, languageCode: string, limit: number): Promise<CompetitorEntry[]> {
        const phrases = normalizeSerpKeywords(keywordList);
        if (phrases.length === 0) {
            throw new VendorMalformedError('serp_competitors requires at least one keyword', CTX_SERP_COMPETITORS);
        }
        const body = {
            keywords: phrases,
            location_code: locationCode,
            language_code: languageCode.toLowerCase(),
            limit: clampCompetitorLimit(limit),
            // The vendor default is organic + paid; pin organic for parity with
            // competitors_domain (paid ads are not organic competitors).
            item_types: ['organic'],
        };
        const outcomes = await dataForSeoRequest(cfg, '/dataforseo_labs/google/serp_competitors/live', [body], serpCompetitorsResultSchema, { operation: 'serp-competitors' });
        const outcome = outcomes[0];
        if (!outcome || outcome.status !== 'ok') {
            throw new VendorMalformedError('serp_competitors returned no ok tasks', CTX_SERP_COMPETITORS);
        }
        const items = outcome.result[0]?.items ?? [];
        const seen = new Set<string>();
        const entries: CompetitorEntry[] = [];
        for (const item of items) {
            // De-dupe post-strip keeping the first occurrence — the vendor orders
            // by rating desc, so the strongest variant of a host wins.
            const domain = stripWwwPrefix(normalizeCompetitorDomain(item.domain));
            if (domain.length === 0 || seen.has(domain))
                continue;
            seen.add(domain);
            entries.push({
                domain,
                avgPosition: typeof item.avg_position === 'number' ? item.avg_position : null,
                intersections: typeof item.keywords_count === 'number' ? item.keywords_count : 0,
                estimatedTraffic: typeof item.etv === 'number' ? item.etv : null,
            });
        }
        return entries;
    }
    async function getDomainIntersection(target1: string, target2: string, opts: DomainIntersectionOptions): Promise<DomainIntersectionRow[]> {
        const t1 = normalizeCompetitorDomain(target1);
        const t2 = normalizeCompetitorDomain(target2);
        if (t1.length === 0 || t2.length === 0) {
            throw new VendorMalformedError('domain_intersection requires two non-empty targets', CTX_INTERSECTION);
        }
        const { locationCode, languageCode } = assertLocationAndLanguage(opts.locationCode, opts.languageCode, CTX_INTERSECTION);
        // Vendor semantics for intersections=false are "target1 ranks, target2
        // does not". Swap the request so this legacy facade keeps target1 as the
        // owned side and returns the competitor gap consumers always intended.
        const items = await requestDomainIntersection({
            target1: t2,
            target2: t1,
            locationCode,
            languageCode,
            intersections: false,
            limit: clampIntersectionLimit(opts.limit),
            context: CTX_INTERSECTION,
        });
        return items.map((item) => {
            const data = item.keyword_data;
            const info = data.keyword_info;
            const competitor = organicSerpItem(item.first_domain_serp_element);
            const owned = organicSerpItem(item.second_domain_serp_element);
            return {
                keyword: data.keyword,
                target1Position: owned?.rank_group ?? null,
                target2Position: competitor?.rank_group ?? null,
                searchVolume: typeof info?.search_volume === 'number' ? info.search_volume : null,
            };
        });
    }
    async function compareDomains(rawInput: DomainComparisonInput): Promise<DomainComparisonResult> {
        const { locationCode, languageCode } = assertLocationAndLanguage(rawInput.locationCode, rawInput.languageCode, CTX_COMPARISON);
        const ownedDomain = normalizeComparisonTarget(rawInput.ownedDomain);
        const competitorDomain = normalizeComparisonTarget(rawInput.competitorDomain);
        if (ownedDomain === competitorDomain) {
            throw new VendorMalformedError('domain comparison targets must be different', CTX_COMPARISON);
        }
        const input: DomainComparisonInput = {
            ...rawInput,
            ownedDomain,
            competitorDomain,
            locationCode,
            languageCode,
        };
        const origins = {
            owned: normalizeComparisonOrigin(rawInput.ownedOrigin, ownedDomain),
            competitor: normalizeComparisonOrigin(rawInput.competitorOrigin, competitorDomain),
        };
        const now = cfg.now ?? (() => new Date());
        const sharedItems = await requestDomainIntersection({
            target1: ownedDomain,
            target2: competitorDomain,
            locationCode,
            languageCode,
            intersections: true,
            limit: DOMAIN_COMPARISON_MAX_ROWS,
            context: CTX_COMPARISON,
        });
        const sharedAt = now();
        const ownedOnlyItems = await requestDomainIntersection({
            target1: ownedDomain,
            target2: competitorDomain,
            locationCode,
            languageCode,
            intersections: false,
            limit: DOMAIN_COMPARISON_MAX_ROWS,
            context: CTX_COMPARISON,
        });
        const ownedOnlyAt = now();
        const competitorOnlyItems = await requestDomainIntersection({
            target1: competitorDomain,
            target2: ownedDomain,
            locationCode,
            languageCode,
            intersections: false,
            limit: DOMAIN_COMPARISON_MAX_ROWS,
            context: CTX_COMPARISON,
        });
        const competitorOnlyAt = now();
        return normalizeDomainComparisonResult({
            shared: sharedItems.map((item) => comparisonRow(item, input, origins, 'owned', sharedAt)),
            ownedOnly: ownedOnlyItems.map((item) => comparisonRow(item, input, origins, 'owned', ownedOnlyAt)),
            competitorOnly: competitorOnlyItems.map((item) => comparisonRow(item, input, origins, 'competitor', competitorOnlyAt)),
        });
    }
    async function getTechnologies(domain: string): Promise<TechStackEntry[]> {
        const target = normalizeCompetitorDomain(domain);
        if (target.length === 0) {
            throw new VendorMalformedError('domain_technologies requires a non-empty target', CTX_TECHNOLOGIES);
        }
        const outcomes = await dataForSeoRequest(cfg, '/domain_analytics/technologies/domain_technologies/live', [{ target }], technologiesResultSchema, { operation: 'domain-technologies' });
        const outcome = outcomes[0];
        if (!outcome || outcome.status !== 'ok') {
            throw new VendorMalformedError('domain_technologies returned no ok tasks', CTX_TECHNOLOGIES);
        }
        return normalizeTechnologies(outcome.result[0]?.technologies);
    }
    async function getTrafficEstimation(domains: string[], opts: {
        locationCode: number;
        languageCode: string;
    }): Promise<TrafficEstimationRow[]> {
        const { locationCode, languageCode } = assertLocationAndLanguage(opts.locationCode, opts.languageCode, CTX_TRAFFIC_ESTIMATION);
        const targets = normalizeTrafficDomains(domains);
        if (targets.length === 0) {
            throw new VendorMalformedError('bulk_traffic_estimation requires at least one target after normalization', CTX_TRAFFIC_ESTIMATION);
        }
        const body = {
            targets,
            location_code: locationCode,
            language_code: languageCode,
        };
        const outcomes = await dataForSeoRequest(cfg, '/dataforseo_labs/google/bulk_traffic_estimation/live', [body], trafficEstimationResultSchema, { operation: CTX_TRAFFIC_ESTIMATION.operation });
        const outcome = outcomes[0];
        if (!outcome || outcome.status !== 'ok') {
            throw new VendorMalformedError('bulk_traffic_estimation returned no ok tasks', CTX_TRAFFIC_ESTIMATION);
        }
        const items = outcome.result?.[0]?.items ?? [];
        const rows: TrafficEstimationRow[] = [];
        for (const item of items) {
            const norm = normalizeTrafficOutputDomain(typeof item.target === 'string' ? item.target : '');
            if (norm.length === 0)
                continue;
            const etv = item.metrics?.organic?.etv;
            const monthlyOrganicVisits = typeof etv === 'number' && etv >= 0 ? Math.max(0, Math.round(etv)) : 0;
            rows.push({
                domain: norm,
                monthlyOrganicVisits,
                topCountries: normalizeTrafficCountries(item.country_distribution),
            });
        }
        return rows;
    }
    async function getDomainRankOverview(domain: string, opts: {
        locationCode: number;
        languageCode: string;
    }): Promise<DomainRankOverviewRow> {
        const { locationCode, languageCode } = assertLocationAndLanguage(opts.locationCode, opts.languageCode, CTX_DOMAIN_RANK_OVERVIEW);
        const target = normalizeCompetitorDomain(domain);
        if (target.length === 0) {
            throw new VendorMalformedError('domain_rank_overview requires a non-empty target', CTX_DOMAIN_RANK_OVERVIEW);
        }
        const body = {
            target,
            location_code: locationCode,
            language_code: languageCode,
        };
        const outcomes = await dataForSeoRequest(cfg, '/dataforseo_labs/google/domain_rank_overview/live', [body], domainRankOverviewResultSchema, { operation: CTX_DOMAIN_RANK_OVERVIEW.operation });
        const outcome = outcomes[0];
        if (!outcome || outcome.status !== 'ok') {
            throw new VendorMalformedError('domain_rank_overview returned no ok tasks', CTX_DOMAIN_RANK_OVERVIEW);
        }
        const item = outcome.result?.[0]?.items?.[0];
        if (!item) {
            return {
                domain: normalizeTrafficOutputDomain(target),
                rank: null,
                keywordsCount: 0,
                estimatedMonthlyOrganicVisits: 0,
            };
        }
        const outputDomain = normalizeTrafficOutputDomain(typeof item.target === 'string' && item.target.length > 0 ? item.target : target);
        const organic = item.metrics?.organic;
        const rank = typeof organic?.rank === 'number' ? organic.rank : null;
        const keywordsCount = typeof organic?.count === 'number' && organic.count >= 0
            ? Math.max(0, Math.round(organic.count))
            : 0;
        const etv = organic?.etv;
        const estimatedMonthlyOrganicVisits = typeof etv === 'number' && etv >= 0 ? Math.max(0, Math.round(etv)) : 0;
        return {
            domain: outputDomain,
            rank,
            keywordsCount,
            estimatedMonthlyOrganicVisits,
        };
    }
    async function getHistoricalRankOverview(domain: string, opts: {
        locationCode: number;
        languageCode: string;
        limit: number;
    }): Promise<HistoricalRankOverviewResult> {
        const { locationCode, languageCode } = assertLocationAndLanguage(opts.locationCode, opts.languageCode, CTX_HISTORICAL_RANK_OVERVIEW);
        const target = normalizeCompetitorDomain(domain);
        if (target.length === 0) {
            throw new VendorMalformedError('historical_rank_overview requires a non-empty target', CTX_HISTORICAL_RANK_OVERVIEW);
        }
        const limit = clampHistoricalRankLimit(opts.limit);
        const body = {
            target,
            location_code: locationCode,
            language_code: languageCode,
        };
        const outcomes = await dataForSeoRequest(cfg, '/dataforseo_labs/google/historical_rank_overview/live', [body], historicalRankOverviewResultSchema, { operation: CTX_HISTORICAL_RANK_OVERVIEW.operation });
        const outcome = outcomes[0];
        if (!outcome || outcome.status !== 'ok') {
            throw new VendorMalformedError('historical_rank_overview returned no ok tasks', CTX_HISTORICAL_RANK_OVERVIEW);
        }
        const first = outcome.result?.[0]?.items?.[0];
        const outputDomain = normalizeTrafficOutputDomain(typeof first?.target === 'string' && first.target.length > 0 ? first.target : target);
        const raw = first?.items ?? [];
        const points: HistoricalRankOverviewPoint[] = [];
        for (const p of raw) {
            const y = typeof p.year === 'number' ? Math.trunc(p.year) : null;
            const m = typeof p.month === 'number' ? Math.trunc(p.month) : null;
            if (!Number.isInteger(y) || !Number.isInteger(m) || (m as number) < 1 || (m as number) > 12) {
                continue;
            }
            const organic = p.metrics?.organic;
            const rank = typeof organic?.rank === 'number' ? organic.rank : null;
            const organicKeywords = typeof organic?.count === 'number' && organic.count >= 0
                ? Math.max(0, Math.round(organic.count))
                : 0;
            const etv = organic?.etv;
            const organicEtv = typeof etv === 'number' && etv >= 0 ? Math.max(0, Math.round(etv)) : 0;
            points.push({ year: y as number, month: m as number, rank, organicKeywords, organicEtv });
        }
        // Ascending by (year, month); newest `limit` points win — trim from head.
        points.sort((a, b) => (a.year - b.year) * 12 + (a.month - b.month));
        const trimmed = points.length > limit ? points.slice(points.length - limit) : points;
        return { domain: outputDomain, points: trimmed };
    }
    return {
        getCompetitors,
        getSerpCompetitors,
        getDomainIntersection,
        compareDomains,
        getTechnologies,
        getTrafficEstimation,
        getDomainRankOverview,
        getHistoricalRankOverview,
    };
}
