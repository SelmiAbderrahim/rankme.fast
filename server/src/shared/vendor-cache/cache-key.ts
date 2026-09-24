/**
 * Deterministic cache keys for the generic vendor layer.
 *
 * `stableStringify` sorts object keys recursively so two callers building
 * params in different property order land on the same key. Arrays keep
 * their order — order is meaningful there (e.g. intersection targets are
 * normalized by the caller, not here).
 */
import { createHash } from 'node:crypto';
import type { VendorCapability } from '../../db/schema/index.js';
export interface VendorCallDescriptor {
    capability: VendorCapability;
    operation: string;
    params: Record<string, unknown>;
}
export function stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableStringify(item)).join(',')}]`;
    }
    // Keys of one object are unique, so default lexicographic sort suffices.
    const entries = Object.keys(value as Record<string, unknown>)
        .sort()
        .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
        .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`);
    return `{${entries.join(',')}}`;
}
export function computeVendorCacheKey(descriptor: VendorCallDescriptor): string {
    const canonical = `${descriptor.capability}|${descriptor.operation}|${stableStringify(descriptor.params)}`;
    return createHash('sha256').update(canonical).digest('hex');
}
