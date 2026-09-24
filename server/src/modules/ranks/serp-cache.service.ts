/**
 * Cross-user SERP cache — the 20–40% margin lever.
 *
 * Cache key is DOMAIN-INDEPENDENT:
 *   sha256(phrase | locationCode | languageCode | device)
 * so one recorded SERP serves every user tracking that keyword; each user's
 * position is derived by scanning `topResults` for their domain host.
 *
 * Storage is the generic vendor layer (`shared/vendor-cache`): rows live in
 * `vendor_cache` under (capability='rank', operation='serp') and every fresh
 * fetch also lands an append-only `vendor_responses` archive row. A cached
 * payload that fails schema parsing reads as a miss and is overwritten by
 * the next fresh fetch.
 *
 * TTL policy: `SERP_CACHE_TTL_HOURS` (default 24h). A daily-cadence fetch
 * can serve weekly users; weekly checks accept cache ≤ TTL hours old.
 *
 * `rankings.source` records whether a check was served `fresh` or from
 * `cache`, so vendor spend stays observable per stored observation.
 *
 * SINGLE-FLIGHT: concurrent misses on the same cacheKey share one in-process
 * Promise (`shared/vendor-cache` single-flight); cross-process safety is the
 * ON CONFLICT DO UPDATE contract on the cache upsert. The advisory-lock id
 * helper below is kept for a future distributed-lock upgrade.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { SerpAiOverview, SerpTopResult } from '../../db/schema/keywords.js';
import { SERP_FEATURE_TYPES } from '../../shared/providers/serp-features.js';
import type { SerpFeatureSnapshot } from '../../shared/providers/types.js';
import type { Db } from '../../db/client.js';
import { createSingleFlight, createVendorCacheRepo } from '../../shared/vendor-cache/index.js';
import { observationMetaSchema } from '../../shared/observations/observations.js';
import type { ObservationMeta } from '../../shared/observations/types.js';
export interface SerpCacheKeyInput {
    phrase: string;
    locationCode: number;
    languageCode: string;
    device: string;
    /**
     * The engine the SERP was recorded on.
     * OMITTED or `'google'` produces the original canonical string verbatim,
     * so every Google cache row keeps its exact stored key. Any other engine
     * prefixes the engine, which cannot collide with a Google key because the
     * Google form never begins with an engine token.
     */
    engine?: string;
}
export function normalizePhrase(phrase: string): string {
    return phrase.trim().toLowerCase().replace(/\s+/g, ' ');
}
export function computeSerpCacheKey(input: SerpCacheKeyInput): string {
    const parts = [
        normalizePhrase(input.phrase),
        input.locationCode,
        input.languageCode.toLowerCase(),
        input.device.toLowerCase(),
    ];
    // Google keeps the ORIGINAL canonical string byte-for-byte — the digest of
    // an existing Google row is unchanged. Only an alt engine widens
    // the tuple.
    const engine = input.engine ?? 'google';
    const canonical = (engine === 'google' ? parts : [engine, ...parts]).join('|');
    return createHash('sha256').update(canonical).digest('hex');
}
/** 63-bit signed integer (Postgres bigint) derived from the cache key. */
export function cacheKeyToAdvisoryLockId(cacheKey: string): bigint {
    // First 16 hex chars → 64-bit unsigned. Postgres advisory-lock parameters
    // accept a signed bigint; mask off the sign bit to guarantee positivity.
    // Non-hex cache keys (only reachable via direct tests / misuse) fall back
    // to an FNV-1a hash of the whole string so the caller never crashes.
    const hexish = cacheKey.slice(0, 16);
    const isHex = /^[0-9a-f]{1,16}$/i.test(hexish);
    let raw: bigint;
    if (isHex) {
        raw = BigInt(`0x${hexish}`);
    }
    else {
        let hash = 0xcbf29ce484222325n;
        const prime = 0x100000001b3n;
        for (let i = 0; i < cacheKey.length; i += 1) {
            hash ^= BigInt(cacheKey.charCodeAt(i));
            hash = (hash * prime) & 0xffffffffffffffffn;
        }
        raw = hash;
    }
    const mask = (1n << 63n) - 1n;
    return raw & mask;
}
export interface CachedSerp {
    topResults: SerpTopResult[];
    /** `null` = row recorded before the AI Overview feature — no signal. */
    aiOverview: SerpAiOverview | null;
    /**
     * Normalized SERP features from the same
     * recorded payload. Domain-independent, so a cache hit serves feature
     * capture to every user tracking the phrase without a second vendor call.
     * `null` = row recorded BEFORE the feature shipped (the payload key is
     * optional, so a legacy row still parses as a HIT) — no signal, never
     * "no features on Google".
     */
    features: SerpFeatureSnapshot | null;
    /** Alt-engine provider provenance; absent on legacy and every Google row. */
    observationMeta?: ObservationMeta;
    fetchedAt: Date;
    expiresAt: Date;
}
/**
 * Cache rows are partitioned by vendor-cache `operation` as well as
 * by key: Google keeps the shipped `'serp'` operation, and each alt engine
 * gets its own `'serp-<engine>'` slot. Belt-and-braces on top of the
 * engine-qualified key: an alt payload can never be read as a Google row.
 */
export function serpCacheOperation(engine: string | undefined): string {
    return engine === undefined || engine === 'google' ? 'serp' : `serp-${engine}`;
}
export interface SerpCacheRepo {
    read(cacheKey: string, now: Date, engine?: string): Promise<CachedSerp | null>;
    write(input: {
        cacheKey: string;
        topResults: SerpTopResult[];
        aiOverview: SerpAiOverview | null;
        /** Omitted/`null` records "no feature signal" for this row. */
        features?: SerpFeatureSnapshot | null;
        fetchedAt: Date;
        expiresAt: Date;
        /** Key inputs, stored on the jsonb params column for debuggability. */
        params?: SerpCacheKeyInput;
        /** Actual vendor spend in micro-dollars; null/absent = not reported. */
        costMicros?: bigint | null;
        /** Omitted/`'google'` writes into the shipped `'serp'` slot. */
        engine?: string;
        /** Omitted for Google so its archived/cache payload stays byte-identical. */
        observationMeta?: ObservationMeta;
    }): Promise<void>;
    withSingleFlightLock<T>(cacheKey: string, task: () => Promise<T>): Promise<T>;
    /**
     * Domain-independent rank callers need to know whether they executed the
     * task or joined another caller. A join avoids a second vendor call and is
     * therefore persisted with cache provenance even though both callers were
     * initial read misses.
     */
    withSingleFlightLockLeaderAware<T>(cacheKey: string, task: () => Promise<T>): Promise<{
        value: T;
        joined: boolean;
    }>;
}
export interface CreateSerpCacheRepoOptions {
    db: Db;
    ttlHours?: number;
}
export const DEFAULT_SERP_CACHE_TTL_HOURS = 24;
const serpPayloadSchema = z.object({
    topResults: z.array(z.object({
        domain: z.string(),
        url: z.string(),
        rankGroup: z.number(),
        rankAbsolute: z.number(),
        // Alt-engine exact-match token. OPTIONAL so every Google row
        // (which never carries one) keeps parsing as a HIT with an unchanged
        // serialized payload.
        matchToken: z.string().nullish(),
    })),
    aiOverview: z
        .object({
        present: z.boolean(),
        references: z.array(z.object({
            domain: z.string(),
            url: z.string().nullable(),
            title: z.string().nullable(),
        })),
    })
        .nullable(),
    // OPTIONAL on purpose: rows written before have
    // no `features` key and MUST keep reading as cache HITS. Cache key, TTL,
    // hit/miss semantics, single-flight, and archive writes are unchanged.
    features: z
        .object({
        features: z.array(z.object({
            type: z.enum(SERP_FEATURE_TYPES),
            rankAbsolute: z.number().nullable(),
        })),
        featuredSnippet: z
            .object({
            domain: z.string().nullable(),
            url: z.string().nullable(),
            title: z.string().nullable(),
        })
            .nullable(),
        paa: z.array(z.object({
            question: z.string(),
            answerDomain: z.string().nullable(),
            answerUrl: z.string().nullable(),
        })),
    })
        .nullish(),
    // Optional for legacy and Google rows. Amazon callers treat absence as a
    // cache miss so an unlabeled provider-index observation can never ship.
    observationMeta: observationMetaSchema.optional(),
});
export function createSerpCacheRepo(opts: CreateSerpCacheRepoOptions): SerpCacheRepo {
    const vendor = createVendorCacheRepo(opts.db);
    const singleFlight = createSingleFlight();
    const address = (cacheKey: string, engine?: string) => ({ capability: 'rank', operation: serpCacheOperation(engine), cacheKey }) as const;
    return {
        async read(cacheKey, now, engine) {
            const hit = await vendor.read(address(cacheKey, engine), now);
            if (!hit)
                return null;
            const parsed = serpPayloadSchema.safeParse(hit.payload);
            // Stale-shape rows (pre-migration or tampered) read as a miss and are
            // overwritten by the next fresh fetch.
            if (!parsed.success)
                return null;
            return {
                topResults: parsed.data.topResults,
                aiOverview: parsed.data.aiOverview,
                features: parsed.data.features ?? null,
                ...(parsed.data.observationMeta
                    ? { observationMeta: parsed.data.observationMeta }
                    : {}),
                fetchedAt: hit.fetchedAt,
                expiresAt: hit.expiresAt,
            };
        },
        async write(input) {
            const payload = {
                topResults: input.topResults,
                aiOverview: input.aiOverview,
                features: input.features ?? null,
                ...(input.observationMeta ? { observationMeta: input.observationMeta } : {}),
            };
            const params = input.params ?? {};
            await vendor.appendResponse({
                ...address(input.cacheKey, input.engine),
                params,
                payload,
                costMicros: input.costMicros ?? null,
                fetchedAt: input.fetchedAt,
            });
            await vendor.upsert({
                ...address(input.cacheKey, input.engine),
                params,
                payload,
                fetchedAt: input.fetchedAt,
                expiresAt: input.expiresAt,
            });
        },
        withSingleFlightLock(cacheKey, task) {
            return singleFlight.run(cacheKey, task);
        },
        withSingleFlightLockLeaderAware(cacheKey, task) {
            return singleFlight.runLeaderAware(cacheKey, task);
        },
    };
}
