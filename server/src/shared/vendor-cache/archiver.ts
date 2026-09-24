/**
 * Archive-only entry point for capabilities that must NEVER be served
 * cross-user (gsc, summary, audit crawls — per-account private data).
 * Appends the normalized provider output to `vendor_responses` with the
 * owning accountId; no `vendor_cache` row is ever written here.
 */
import type { VendorCapability } from '../../db/schema/index.js';
import { computeVendorCacheKey } from './cache-key.js';
import type { VendorCacheRepo } from './vendor-cache.repo.js';
export interface VendorArchiveInput {
    capability: VendorCapability;
    operation: string;
    params: Record<string, unknown>;
    payload: unknown;
    accountId?: string | null;
    siteId?: string | null;
    /** Actual vendor spend in micro-dollars; null/absent = not reported. */
    costMicros?: bigint | null;
    fetchedAt: Date;
}
export type VendorArchiver = (input: VendorArchiveInput) => Promise<void>;
export function createVendorArchiver(repo: VendorCacheRepo): VendorArchiver {
    return async (input) => {
        await repo.appendResponse({
            capability: input.capability,
            operation: input.operation,
            cacheKey: computeVendorCacheKey({
                capability: input.capability,
                operation: input.operation,
                params: input.params,
            }),
            params: input.params,
            payload: input.payload,
            accountId: input.accountId ?? null,
            siteId: input.siteId ?? null,
            costMicros: input.costMicros ?? null,
            fetchedAt: input.fetchedAt,
        });
    };
}
