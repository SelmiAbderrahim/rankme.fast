/**
 * Shared cannibalization contracts.
 *
 * Pure data shapes with NO runtime. The scoring loop and the zod schema live
 * in ./scoring.ts and ./schemas.ts respectively; both the content-inventory
 * pipeline and the cannibalization report module consume THIS one authority.
 */
/**
 * One query's competing owned pages, split by the evidence class that put the
 * page there. `urls` is the union; `gscUrls` are pages Search Console recorded
 * impressions for; `rankUrls` are pages a tracked rank check placed on the SERP.
 */
export interface CannibalizationGroup {
    urls: Set<string>;
    gscUrls: Set<string>;
    rankUrls: Set<string>;
}
/** Per-page Search Console metrics for one query, over one stored window. */
export interface CannibalizationPageMetrics {
    url: string;
    clicks: number;
    impressions: number;
    position: number;
}
/** Why a page was recommended as the query's primary destination. */
export type PrimaryPageReason = 'most_clicks' | 'best_position' | 'stable_order';
export interface PrimaryPageRecommendation {
    url: string;
    reason: PrimaryPageReason;
}
