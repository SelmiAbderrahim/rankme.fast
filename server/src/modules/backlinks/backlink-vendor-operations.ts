import type { BacklinkPullType } from './backlink-runs.model.js';
/**
 * Canonical archive/cache operation slugs for the five backlink
 * provider methods. These deliberately match the provider boundary context
 * names so `vendor_responses` can be grouped without translating module-local
 * run names such as `refDomains`.
 */
export const BACKLINK_VENDOR_OPERATIONS = {
    refDomains: 'backlinks-referring-domains',
    anchors: 'backlinks-anchors',
    history: 'backlinks-history',
    bulkRanks: 'backlinks-bulk-ranks',
    competitors: 'backlinks-competitors',
    bulkSpamScore: 'bulk_spam_score',
} as const;
export type BacklinkVendorOperation = (typeof BACKLINK_VENDOR_OPERATIONS)[keyof typeof BACKLINK_VENDOR_OPERATIONS];
export function deepVendorOperation(type: BacklinkPullType): BacklinkVendorOperation {
    return BACKLINK_VENDOR_OPERATIONS[type];
}
export function deepVendorCacheParams(input: {
    type: BacklinkPullType;
    domain: string;
    limit?: number | null;
    domains?: readonly string[];
}): Record<string, unknown> {
    return input.type === 'bulkRanks'
        ? { domains: [...(input.domains ?? [])] }
        : { domain: input.domain, limit: input.limit };
}
export function backlinkCompetitorsCacheParams(domain: string, limit: number): Record<string, unknown> {
    return { domain, limit };
}
export function backlinkBulkRanksCacheParams(domains: readonly string[]): Record<string, unknown> {
    return { domains: [...domains] };
}
export function backlinkBulkSpamScoreCacheParams(domains: readonly string[]): Record<string, unknown> {
    return { targets: [...domains] };
}
