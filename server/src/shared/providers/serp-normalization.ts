import type { RankCheckResult } from './types.js';
/** Maximum observed questions retained from a single SERP snapshot. */
export const MAX_PAA_QUESTIONS = 10;
/** Maximum organic results retained from a single SERP snapshot. */
export const MAX_STORED_TOP_RESULTS = 100;
/** Vendor-neutral organic result used by rank processing and cache replay. */
export interface SerpItem {
    domain: string;
    url: string;
    rankGroup: number;
    rankAbsolute: number;
}
/** Vendor-neutral AI Overview evidence associated with one SERP. */
export interface SerpAiOverview {
    present: boolean;
    references: Array<{
        domain: string;
        url: string | null;
        title: string | null;
    }>;
}
/** Strip scheme, `www.`, and trailing slashes for deterministic host matching. */
export function normalizeSerpDomain(domain: string): string {
    return domain
        .replace(/^https?:\/\//i, '')
        .replace(/^www\./i, '')
        .replace(/\/+$/, '')
        .toLowerCase();
}
/** Apply the same normalization to a URL or host from a provider-neutral row. */
export function extractItemHost(url: string | null | undefined): string | null {
    if (!url)
        return null;
    try {
        return normalizeSerpDomain(new URL(url).hostname);
    }
    catch {
        return normalizeSerpDomain(url);
    }
}
/** Derive the account-domain view over a provider-neutral AI Overview block. */
export function matchDomainInAiOverview(overview: SerpAiOverview | null, domain: string): {
    present: boolean;
    cited: boolean;
    citedUrl?: string;
} | null {
    if (overview === null)
        return null;
    if (!overview.present)
        return { present: false, cited: false };
    const target = normalizeSerpDomain(domain);
    const hit = overview.references.find((ref) => ref.domain === target);
    if (!hit)
        return { present: true, cited: false };
    return { present: true, cited: true, ...(hit.url ? { citedUrl: hit.url } : {}) };
}
/** Match a domain against normalized organic rows without vendor-specific data. */
export function matchDomainInSerp(items: SerpItem[], domain: string, checkedAt: Date): RankCheckResult {
    const target = normalizeSerpDomain(domain);
    let hit: SerpItem | null = null;
    const topUrls: string[] = [];
    for (const item of items) {
        if (topUrls.length < 10)
            topUrls.push(item.url);
        if (item.domain === target && (hit === null || item.rankGroup < hit.rankGroup)) {
            hit = item;
        }
    }
    if (hit === null)
        return { position: null, checkedAt, serpTopUrls: topUrls };
    return {
        position: hit.rankGroup,
        foundUrl: hit.url,
        serpTopUrls: topUrls,
        checkedAt,
    };
}
