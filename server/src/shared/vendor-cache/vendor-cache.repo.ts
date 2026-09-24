/**
 * Repository over the two generic vendor-data tables:
 *
 *   - `vendor_cache`     — cross-user read-through cache (upsert by key)
 *   - `vendor_responses` — append-only archive of normalized provider
 *                          output, kept forever
 *
 * Expiry is enforced at read time; expired rows are overwritten in place by
 * the next fresh fetch, never deleted.
 */
import { and, eq, sql } from 'drizzle-orm';
import { vendorCache, vendorResponses, type VendorCapability } from '../../db/schema/index.js';
import type { ApplicationDb } from '../types/application-db.js';
export interface VendorCacheAddress {
    capability: VendorCapability;
    operation: string;
    cacheKey: string;
}
export interface VendorCacheHit {
    params: unknown;
    payload: unknown;
    fetchedAt: Date;
    expiresAt: Date;
}
export interface VendorCacheUpsertInput extends VendorCacheAddress {
    accountId?: string | null;
    siteId?: string | null;
    params: unknown;
    payload: unknown;
    fetchedAt: Date;
    expiresAt: Date;
}
export interface VendorResponseAppendInput extends VendorCacheAddress {
    params: unknown;
    payload: unknown;
    accountId?: string | null;
    siteId?: string | null;
    /** Actual vendor spend in micro-dollars; null/absent = not reported. */
    costMicros?: bigint | null;
    fetchedAt: Date;
}
export interface VendorCacheRepo {
    read(address: VendorCacheAddress, now: Date): Promise<VendorCacheHit | null>;
    upsert(input: VendorCacheUpsertInput): Promise<void>;
    appendResponse(input: VendorResponseAppendInput): Promise<void>;
    /**
     * Delete every cache row for (capability, operation) whose `params` jsonb
     * contains `match` (`@>` containment). Used by manual refresh to drop
     * entries whose cacheKey can't be recomputed because it embeds params the
     * caller doesn't know (e.g. the list first-page key embeds `limit`).
     * Archive rows in `vendor_responses` are never touched.
     */
    invalidateByParams(address: Pick<VendorCacheAddress, 'capability' | 'operation'>, match: Record<string, unknown>): Promise<void>;
}
export function createVendorCacheRepo(db: ApplicationDb): VendorCacheRepo {
    return {
        async read(address, now) {
            const rows = await db
                .select({
                params: vendorCache.params,
                payload: vendorCache.payload,
                fetchedAt: vendorCache.fetchedAt,
                expiresAt: vendorCache.expiresAt,
            })
                .from(vendorCache)
                .where(and(eq(vendorCache.capability, address.capability), eq(vendorCache.operation, address.operation), eq(vendorCache.cacheKey, address.cacheKey)))
                .limit(1);
            const row = rows[0];
            if (!row)
                return null;
            if (row.expiresAt.getTime() <= now.getTime())
                return null;
            return {
                params: row.params,
                payload: row.payload,
                fetchedAt: row.fetchedAt,
                expiresAt: row.expiresAt,
            };
        },
        async upsert(input) {
            await db
                .insert(vendorCache)
                .values({
                capability: input.capability,
                operation: input.operation,
                cacheKey: input.cacheKey,
                accountId: input.accountId ?? null,
                siteId: input.siteId ?? null,
                params: input.params,
                payload: input.payload,
                fetchedAt: input.fetchedAt,
                expiresAt: input.expiresAt,
                updatedAt: input.fetchedAt,
            })
                .onConflictDoUpdate({
                target: [vendorCache.capability, vendorCache.operation, vendorCache.cacheKey],
                set: {
                    params: input.params,
                    payload: input.payload,
                    accountId: input.accountId ?? null,
                    siteId: input.siteId ?? null,
                    fetchedAt: input.fetchedAt,
                    expiresAt: input.expiresAt,
                    updatedAt: input.fetchedAt,
                },
            });
        },
        async invalidateByParams(address, match) {
            await db
                .delete(vendorCache)
                .where(and(eq(vendorCache.capability, address.capability), eq(vendorCache.operation, address.operation), sql `${vendorCache.params} @> ${JSON.stringify(match)}::jsonb`));
        },
        async appendResponse(input) {
            await db.insert(vendorResponses).values({
                capability: input.capability,
                operation: input.operation,
                cacheKey: input.cacheKey,
                params: input.params,
                payload: input.payload,
                accountId: input.accountId ?? null,
                siteId: input.siteId ?? null,
                costMicros: input.costMicros ?? null,
                fetchedAt: input.fetchedAt,
            });
        },
    };
}
