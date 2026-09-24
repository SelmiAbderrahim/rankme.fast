/**
 * Runtime for the shared observation contracts.
 *
 * - Pure constructors validate/normalize at the trust boundary.
 * - Freshness is derived from observedAt/freshUntil unless the caller
 *   passes an explicit degraded status.
 * - The DataForSEO location-code → ISO map is authoritative on the server;
 *   the client picker parity test asserts every supported code round-trips.
 */
import { z } from 'zod';
import type { CoverageNoteKey, Freshness, ObservationMeta, ObservationMetaInput, SiteMarket, SiteMarketInput, SourceKind, } from './types.js';
export const SOURCE_KINDS = [
    'first_party',
    'provider_observation',
    'estimate',
    'ai_interpretation',
] as const satisfies readonly SourceKind[];
export const FRESHNESS_STATES = [
    'fresh',
    'stale',
    'partial',
    'blocked',
    'failed',
    'unknown',
] as const satisfies readonly Freshness[];
export const DEVICE_STATES = ['desktop', 'mobile', 'all'] as const;
/**
 * Allowlisted public provider/surface labels. Server code passes one of
 * these strings; anything else is rejected at the schema boundary. Never
 * echo a vendor request/config value here.
 */
export const SOURCE_LABELS = [
    'dataforseo',
    'firecrawl',
    'google_search_console',
    'google_analytics_4',
    'google_pagespeed',
    'google_crux',
    'ai_visibility',
    'internal_crawl',
    'rankme_rules',
    'rankme_ai',
] as const;
/**
 * Closed set of coverage note keys used across the six evidence surfaces.
 * The client resolves each key against the `observations` i18n namespace;
 * server code never sends translated prose.
 */
export const COVERAGE_NOTE_KEYS = [
    'observations.coverage.freshCache',
    'observations.coverage.staleCache',
    'observations.coverage.legacyLocation',
    'observations.coverage.unknownMarket',
    'observations.coverage.unsupportedAiMarket',
    'observations.coverage.unsupportedAiEngine',
    'observations.coverage.providerTimeout',
    'observations.coverage.providerQuota',
    'observations.coverage.providerMalformed',
    'observations.coverage.providerUnavailable',
    'observations.coverage.partialResult',
    'observations.coverage.blockedByRobots',
    'observations.coverage.blockedByZdr',
    'observations.coverage.blockedByAuth',
    'observations.coverage.firstPartyUnavailable',
    'observations.coverage.gscDisconnected',
    'observations.coverage.ga4Disconnected',
    'observations.coverage.aiInterpretation',
    'observations.coverage.estimateOnly',
    'observations.coverage.neverObserved',
    // An ordinal inside the provider's returned
    // product/result index, NOT a live shelf position. Every Amazon alt-engine
    // observation carries this note so no surface can present the number as
    // what a shopper sees right now.
    'observations.coverage.providerIndexRanking',
] as const;
/** Regex helpers for validation at the trust boundary. */
const COUNTRY_RE = /^[A-Z]{2}$/;
const LANGUAGE_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const REGION_MAX = 80;
const CITY_MAX = 80;
/**
 * Authoritative DataForSEO location-code → ISO alpha-2 map. Keep in sync
 * with the client picker; the parity test asserts equivalence.
 */
export const DATAFORSEO_LOCATION_ISO: Readonly<Record<number, string>> = Object.freeze({
    2840: 'US',
    2784: 'AE',
    2032: 'AR',
    2040: 'AT',
    2036: 'AU',
    2056: 'BE',
    2854: 'BF',
    2048: 'BH',
    2068: 'BO',
    2124: 'CA',
    2756: 'CH',
    2384: 'CI',
    2152: 'CL',
    2120: 'CM',
    2170: 'CO',
    2188: 'CR',
    2196: 'CY',
    2276: 'DE',
    2012: 'DZ',
    2218: 'EC',
    2818: 'EG',
    2724: 'ES',
    2250: 'FR',
    2826: 'GB',
    2288: 'GH',
    2300: 'GR',
    2320: 'GT',
    2360: 'ID',
    2372: 'IE',
    2376: 'IL',
    2356: 'IN',
    2400: 'JO',
    2404: 'KE',
    2116: 'KH',
    2398: 'KZ',
    2144: 'LK',
    2504: 'MA',
    2492: 'MC',
    2104: 'MM',
    2470: 'MT',
    2484: 'MX',
    2458: 'MY',
    2566: 'NG',
    2558: 'NI',
    2554: 'NZ',
    2591: 'PA',
    2604: 'PE',
    2608: 'PH',
    2586: 'PK',
    2600: 'PY',
    2682: 'SA',
    2702: 'SG',
    2686: 'SN',
    2222: 'SV',
    2788: 'TN',
    2804: 'UA',
    2858: 'UY',
    2862: 'VE',
    2704: 'VN',
    2710: 'ZA',
});
/**
 * Reverse index for tests and construction from ISO country.
 */
export const ISO_TO_DATAFORSEO_LOCATION: Readonly<Record<string, number>> = Object.freeze(Object.fromEntries(Object.entries(DATAFORSEO_LOCATION_ISO).map(([code, iso]) => [
    iso,
    Number(code),
])));
/** Legacy/unknown market marker. */
export const UNKNOWN_COUNTRY = 'ZZ' as const;
/**
 * Zod schemas. Kept in the same module as the constructors so drift is
 * impossible: every constructor validates through the same shape a
 * downstream consumer would validate against.
 */
export const siteMarketSchema = z
    .object({
    country: z
        .string()
        .transform((v) => v.toUpperCase())
        .refine((v) => COUNTRY_RE.test(v), 'country must be ISO 3166-1 alpha-2'),
    region: z.string().min(1).max(REGION_MAX).nullable().default(null),
    city: z.string().min(1).max(CITY_MAX).nullable().default(null),
    language: z
        .string()
        .transform((v) => v.toLowerCase())
        .refine((v) => LANGUAGE_RE.test(v), 'language must be BCP-47-compatible'),
    device: z.enum(DEVICE_STATES),
})
    .strict();
const sourceKindSchema = z.enum(SOURCE_KINDS);
const freshnessSchema = z.enum(FRESHNESS_STATES);
const sourceLabelSchema = z
    .enum(SOURCE_LABELS)
    .nullable()
    .default(null);
const coverageNoteSchema = z
    .enum(COVERAGE_NOTE_KEYS)
    .nullable()
    .default(null);
const isoDateSchema = z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), 'observedAt must be ISO 8601');
export const observationMetaSchema = z
    .object({
    sourceKind: sourceKindSchema,
    sourceLabel: sourceLabelSchema,
    observedAt: isoDateSchema,
    freshUntil: isoDateSchema.nullable().default(null),
    freshness: freshnessSchema,
    market: siteMarketSchema.nullable().default(null),
    sampleCount: z.number().int().positive(),
    coverageNoteKey: coverageNoteSchema,
})
    .strict();
/**
 * Construct a validated SiteMarket. Callers pass their existing storage
 * shape (country string + language + optional device).
 */
export function buildSiteMarket(input: SiteMarketInput): SiteMarket {
    return siteMarketSchema.parse({
        country: input.country,
        region: input.region ?? null,
        city: input.city ?? null,
        language: input.language,
        device: input.device ?? 'all',
    });
}
/**
 * Build a SiteMarket from a DataForSEO location code + language. Unknown
 * numeric codes map to the `ZZ` sentinel and callers should stamp
 * `observations.coverage.unknownMarket` on their meta.
 */
export function marketFromDataForSeo(input: {
    locationCode: number;
    languageCode: string;
    device?: 'desktop' | 'mobile' | 'all';
}): SiteMarket {
    const iso = DATAFORSEO_LOCATION_ISO[input.locationCode] ?? UNKNOWN_COUNTRY;
    return buildSiteMarket({
        country: iso,
        language: input.languageCode,
        device: input.device,
    });
}
/**
 * Derive freshness from observedAt / freshUntil. Callers may override with
 * an explicit degraded status (`partial`, `blocked`, `failed`, `unknown`).
 */
export function deriveFreshness(input: {
    observedAt: Date;
    freshUntil: Date | null;
    now: Date;
    status?: Extract<Freshness, 'partial' | 'blocked' | 'failed' | 'unknown'>;
}): Freshness {
    if (input.status)
        return input.status;
    if (input.freshUntil === null)
        return 'fresh';
    return input.now.getTime() <= input.freshUntil.getTime() ? 'fresh' : 'stale';
}
function toDate(value: Date | string): Date {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) {
        throw new Error(`invalid date value: ${String(value)}`);
    }
    return d;
}
/**
 * Construct a validated ObservationMeta. Callers pick the sourceKind and
 * optionally a status; freshness is otherwise derived from the timestamps.
 */
export function buildObservationMeta(input: ObservationMetaInput): ObservationMeta {
    const observedAt = toDate(input.observedAt);
    const freshUntil = input.freshUntil === undefined || input.freshUntil === null
        ? null
        : toDate(input.freshUntil);
    const now = input.now ?? new Date();
    const freshness = deriveFreshness({
        observedAt,
        freshUntil,
        now,
        status: input.status,
    });
    const sampleCount = input.sampleCount ?? 1;
    return observationMetaSchema.parse({
        sourceKind: input.sourceKind,
        sourceLabel: input.sourceLabel ?? null,
        observedAt: observedAt.toISOString(),
        freshUntil: freshUntil === null ? null : freshUntil.toISOString(),
        freshness,
        market: input.market ?? null,
        sampleCount,
        coverageNoteKey: input.coverageNoteKey ?? null,
    });
}
/**
 * Type-narrowing helper for downstream tests and DTOs.
 */
export function isCoverageNoteKey(value: unknown): value is CoverageNoteKey {
    return (typeof value === 'string' &&
        (COVERAGE_NOTE_KEYS as readonly string[]).includes(value));
}
/**
 * Safe wire serializer. Guarantees the returned object round-trips through
 * `observationMetaSchema` — useful when a caller assembled fields by hand.
 */
export function serializeObservationMeta(meta: ObservationMeta): ObservationMeta {
    return observationMetaSchema.parse(meta);
}
