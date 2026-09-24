/**
 * Generic read-through: the single choke point every cacheable vendor call
 * flows through.
 *
 *   key → cache read → zod-parse payload → hit ⇒ serve from DB
 *   miss ⇒ single-flight → re-read (double-check) → fetch vendor
 *        → append archive row → upsert cache row → serve fresh
 *
 * A payload that fails schema parsing (stale shape after a deploy, manual
 * tampering) is treated as a MISS — logged, refetched, overwritten. Vendor
 * errors propagate untouched and write nothing. This helper never meters
 * usage.
 */
import type { ZodType } from 'zod';
import type { VendorCapability } from '../../db/schema/index.js';
import { captureVendorCost } from '../providers/cost-capture.js';
import { computeVendorCacheKey } from './cache-key.js';
import type { SingleFlight } from './single-flight.js';
import type { VendorCacheRepo } from './vendor-cache.repo.js';
export interface ReadThroughLogger {
    warn(context: Record<string, unknown>, message: string): void;
}
export interface ReadThroughDeps {
    repo: VendorCacheRepo;
    singleFlight: SingleFlight;
    logger?: ReadThroughLogger;
    /**
     * Wall-clock used to stamp `fetchedAt` on the fresh archive/cache rows
     * AFTER `input.fetch()` resolves — so a slow vendor call does not report
     * an in-the-past fetch time. Defaults to `() => new Date()`. `input.now`
     * still drives cache-expiry math (test seam for deterministic hit/miss).
     */
    clock?: () => Date;
}
export interface ReadThroughInput<T> {
    capability: VendorCapability;
    operation: string;
    params: Record<string, unknown>;
    /** Optional already-normalized public cache key (for domain-keyed bundles). */
    cacheKey?: string;
    ttlMs: number;
    payloadSchema: ZodType<T>;
    /** Stored on the archive row; null/absent on shared public-domain data. */
    accountId?: string | null;
    /**
     * Skip both cache reads and always hit the vendor (manual refresh). The
     * fresh payload still lands an archive row AND overwrites the cache row,
     * so the cross-user layer stays coherent with the forced fetch.
     */
    forceRefresh?: boolean;
    fetch: () => Promise<T>;
    now: Date;
    /**
     * Per-call override of `ReadThroughDeps.clock`. Useful for callers that
     * already carry an injected clock function (e.g. `deps.now` in the
     * competitors/backlinks services) — pass it through so `fetchedAt` follows
     * the same clock the rest of the request-scoped math uses.
     */
    clock?: () => Date;
}
export interface ReadThroughResult<T> {
    value: T;
    cached: boolean;
    fetchedAt: Date;
}
export type ReadThrough = <T>(input: ReadThroughInput<T>) => Promise<ReadThroughResult<T>>;
export interface ReadThroughProbeInput<T> {
    capability: VendorCapability;
    operation: string;
    params: Record<string, unknown>;
    cacheKey?: string;
    payloadSchema: ZodType<T>;
    now: Date;
}
export interface ReadThroughProbeResult<T> {
    cached: boolean;
    value: T | null;
    fetchedAt: Date | null;
}
/** Read-only cache probe used by paid previews/enqueues. Never calls a vendor. */
export async function probeReadThrough<T>(repo: VendorCacheRepo, input: ReadThroughProbeInput<T>): Promise<ReadThroughProbeResult<T>> {
    const cacheKey = input.cacheKey ??
        computeVendorCacheKey({
            capability: input.capability,
            operation: input.operation,
            params: input.params,
        });
    const hit = await repo.read({ capability: input.capability, operation: input.operation, cacheKey }, input.now);
    if (!hit)
        return { cached: false, value: null, fetchedAt: null };
    const parsed = input.payloadSchema.safeParse(hit.payload);
    if (!parsed.success)
        return { cached: false, value: null, fetchedAt: null };
    return { cached: true, value: parsed.data, fetchedAt: hit.fetchedAt };
}
export function createReadThrough(deps: ReadThroughDeps): ReadThrough {
    const parseHit = <T>(input: ReadThroughInput<T>, cacheKey: string, hit: {
        payload: unknown;
        fetchedAt: Date;
    } | null): ReadThroughResult<T> | null => {
        if (!hit)
            return null;
        const parsed = input.payloadSchema.safeParse(hit.payload);
        if (!parsed.success) {
            deps.logger?.warn({ capability: input.capability, operation: input.operation, cacheKey }, 'vendor-cache payload failed schema parse; treating as miss');
            return null;
        }
        return { value: parsed.data, cached: true, fetchedAt: hit.fetchedAt };
    };
    return async <T>(input: ReadThroughInput<T>): Promise<ReadThroughResult<T>> => {
        const address = {
            capability: input.capability,
            operation: input.operation,
            cacheKey: input.cacheKey ??
                computeVendorCacheKey({
                    capability: input.capability,
                    operation: input.operation,
                    params: input.params,
                }),
        };
        if (!input.forceRefresh) {
            const first = parseHit(input, address.cacheKey, await deps.repo.read(address, input.now));
            if (first)
                return first;
        }
        const leaderResult = await deps.singleFlight.runLeaderAware(address.cacheKey, async (): Promise<ReadThroughResult<T>> => {
            // Double-check: a concurrent flight may have populated the row while
            // we waited on the gate. A forced refresh skips it — it must re-fetch.
            if (!input.forceRefresh) {
                const second = parseHit(input, address.cacheKey, await deps.repo.read(address, input.now));
                if (second)
                    return second;
            }
            // Capture the vendor-reported spend of everything the fetch does —
            // DataForSEO envelopes record into the ambient scope; providers
            // that never report resolve costMicros null (estimate fallback).
            const { value, costMicros } = await captureVendorCost(input.fetch);
            // Stamp `fetchedAt` AFTER the vendor call resolves — a 30s PSI run
            // must not claim it fetched at request-arrival time. Per-call clock
            // wins over the process-wide dep default.
            const clock = input.clock ?? deps.clock ?? (() => new Date());
            const fetchedAt = clock();
            const expiresAt = new Date(fetchedAt.getTime() + input.ttlMs);
            // Never discard a paid vendor result because a cache write failed.
            // Archive + cache upserts are separately try/catch'd; the fresh
            // value is always returned.
            try {
                await deps.repo.appendResponse({
                    ...address,
                    params: input.params,
                    payload: value,
                    accountId: input.accountId ?? null,
                    costMicros,
                    fetchedAt,
                });
            }
            catch (err) {
                deps.logger?.warn({ capability: input.capability, operation: input.operation, err }, 'vendor-cache archive write failed; returning fresh value anyway');
            }
            try {
                await deps.repo.upsert({
                    ...address,
                    params: input.params,
                    payload: value,
                    fetchedAt,
                    expiresAt,
                });
            }
            catch (err) {
                deps.logger?.warn({ capability: input.capability, operation: input.operation, err }, 'vendor-cache upsert failed; returning fresh value anyway');
            }
            return { value, cached: false, fetchedAt };
        });
        // Joiners who awaited the leader's promise are cache-effective from their
        // point of view — nothing was fetched on their behalf.
        if (leaderResult.joined) {
            return { ...leaderResult.value, cached: true };
        }
        return leaderResult.value;
    };
}
