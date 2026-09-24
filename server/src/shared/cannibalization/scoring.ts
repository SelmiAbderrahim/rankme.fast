/**
 * The single cannibalization scoring authority.
 *
 * Promoted verbatim from `modules/content-intelligence/inventory.analysis.ts`
 * so the content inventory and the cannibalization report grade the same
 * evidence the same way. Pure + deterministic: identical input always yields
 * an identical, identically ordered result.
 */
import type { CannibalizationCandidate } from './schemas.js';
import type { CannibalizationGroup, CannibalizationPageMetrics, PrimaryPageRecommendation, } from './types.js';
/** Confidence ladder for cannibalization (and, historically, gap) findings. */
export const CANNIBALIZATION_CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;
export type CannibalizationConfidence = (typeof CANNIBALIZATION_CONFIDENCE_LEVELS)[number];
/**
 * Grade one query group.
 *
 * - `high`   — two or more owned pages drew Search Console impressions for the
 *              query. That is two pages actually splitting the same demand.
 * - `medium` — some performance evidence exists (one GSC page, or a tracked
 *              rank landed on an owned page) but not both pages in GSC.
 * - `low`    — the pages only share a target query; nothing observed yet.
 */
export function gradeCannibalizationConfidence(group: CannibalizationGroup): CannibalizationConfidence {
    if (group.gscUrls.size >= 2)
        return 'high';
    if (group.gscUrls.size >= 1 || group.rankUrls.size >= 1)
        return 'medium';
    return 'low';
}
/**
 * Turn a query → group map into ordered candidates. Queries with fewer than
 * two competing pages are not candidates. Ordering is query-lexicographic so
 * ids (`cannibal-<n>`) are stable across runs on identical evidence.
 */
export function buildCannibalizationCandidates(byQuery: ReadonlyMap<string, CannibalizationGroup>): CannibalizationCandidate[] {
    const candidates: CannibalizationCandidate[] = [];
    let seq = 0;
    for (const [query, entry] of [...byQuery].sort((a, b) => a[0].localeCompare(b[0]))) {
        if (entry.urls.size < 2)
            continue;
        const evidenceSourceIds: string[] = [];
        for (const u of [...entry.gscUrls].sort())
            evidenceSourceIds.push(`gsc:${u}`);
        for (const u of [...entry.rankUrls].sort())
            evidenceSourceIds.push(`rank:${u}`);
        const confidence = gradeCannibalizationConfidence(entry);
        if (confidence === 'low') {
            for (const u of [...entry.urls].sort())
                evidenceSourceIds.push(`query:${u}`);
        }
        candidates.push({
            id: `cannibal-${seq}`,
            query,
            urls: [...entry.urls].sort(),
            confidence,
            evidenceSourceIds,
            hasGscEvidence: entry.gscUrls.size > 0,
        });
        seq += 1;
    }
    return candidates;
}
/**
 * Deterministic primary-page recommendation for one query.
 *
 * The page that already earns the clicks is the one to keep; only when clicks
 * tie does position break it, and only when BOTH tie does the URL order decide
 * — so the answer never changes between two identical reports.
 *
 * Callers pass at least one page (a candidate always carries two or more).
 */
export function recommendPrimaryPage(pages: readonly CannibalizationPageMetrics[]): PrimaryPageRecommendation {
    const sorted = [...pages].sort((a, b) => b.clicks - a.clicks || a.position - b.position || a.url.localeCompare(b.url));
    // A candidate always has pages; the caller guarantees a non-empty list.
    const winner = sorted[0]!;
    const runnerUp = sorted[1];
    if (runnerUp === undefined || winner.clicks > runnerUp.clicks) {
        return { url: winner.url, reason: 'most_clicks' };
    }
    if (winner.position < runnerUp.position) {
        return { url: winner.url, reason: 'best_position' };
    }
    return { url: winner.url, reason: 'stable_order' };
}
