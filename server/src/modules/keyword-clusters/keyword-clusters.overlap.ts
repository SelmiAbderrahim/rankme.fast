/**
 * Deterministic SERP-overlap clustering.
 *
 * Pure, total, no clock, no I/O, no vendor call. Given the same stored
 * observations the output is byte-identical, in any input order.
 *
 * Grouping is PIVOT-based, not single-linkage. Single-linkage union-find was
 * rejected because it chains: `A~B` and `B~C` merge even when A and C share
 * nothing, producing a cluster whose members carry no common evidence. Every
 * membership decision here is made against the cluster's pivot, so every
 * grouped member provably shares at least `minSharedUrls` URLs with it — the
 * machine-checkable honesty invariant the DTO schema also enforces.
 */
import { normalizeUrlKey } from '../content-intelligence/index.js';
import { KEYWORD_CLUSTER_MAX_KEYWORDS_PER_RUN, KEYWORD_CLUSTER_MAX_SHARED_URLS_STORED, KEYWORD_CLUSTER_MIN_SHARED_URLS, KEYWORD_CLUSTER_TOP_URLS, type KeywordCluster, type KeywordClusterMember, } from './keyword-clusters.schemas.js';
export interface ClusterInputKeyword {
    keywordId: string;
    phrase: string;
    /** ISO 8601 of the `serp_observations.checked_at` that fed this keyword. */
    observedAt: string;
    /** Raw stored organic URLs, ordered by rank. Normalized and clamped here. */
    topUrls: readonly string[];
}
export interface ClusterKeywordsInput {
    keywords: readonly ClusterInputKeyword[];
    /** Defaults to the shipped constant; every run freezes its own value. */
    minSharedUrls?: number;
    topUrlWindow?: number;
}
interface PreparedKeyword extends ClusterInputKeyword {
    window: readonly string[];
    windowSet: ReadonlySet<string>;
}
/**
 * Normalize, de-duplicate, then truncate — in that order, so a SERP whose two
 * URLs collapse to the same key does not spend two of the ten comparison slots.
 */
export function prepareComparisonWindow(urls: readonly string[], windowSize: number): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const url of urls) {
        const key = normalizeUrlKey(url);
        if (key.length === 0 || seen.has(key))
            continue;
        seen.add(key);
        out.push(key);
        if (out.length === windowSize)
            break;
    }
    return out;
}
/** Sorted intersection of two comparison windows. Symmetric by construction. */
export function sharedUrls(left: ReadonlySet<string>, right: readonly string[]): string[] {
    return right.filter((url) => left.has(url)).sort();
}
function compareKeywords(a: ClusterInputKeyword, b: ClusterInputKeyword): number {
    if (a.phrase !== b.phrase)
        return a.phrase < b.phrase ? -1 : 1;
    return a.keywordId < b.keywordId ? -1 : 1;
}
/**
 * URLs present in the pivot's window AND in every grouped member's window.
 * For a two-member cluster this equals the pair overlap; for a wider cluster it
 * is the common core and may be shorter than the threshold (each member still
 * carries its own pivot overlap).
 */
function commonCore(pivot: PreparedKeyword, others: readonly PreparedKeyword[]): string[] {
    return pivot.window
        .filter((url) => others.every((member) => member.windowSet.has(url)))
        .slice(0, KEYWORD_CLUSTER_MAX_SHARED_URLS_STORED)
        .sort();
}
/**
 * Group tracked keywords whose stored top-N organic URLs overlap.
 *
 * Every accepted input keyword appears in exactly one returned cluster; a
 * keyword that matches no pivot becomes its own single-member cluster, which is
 * honest output rather than an error. The input is clamped to
 * `KEYWORD_CLUSTER_MAX_KEYWORDS_PER_RUN` (SEC-BOUND), so the cluster count is
 * structurally bounded without a loop guard.
 */
export function clusterKeywordsBySerpOverlap(input: ClusterKeywordsInput): KeywordCluster[] {
    const minShared = input.minSharedUrls ?? KEYWORD_CLUSTER_MIN_SHARED_URLS;
    const windowSize = input.topUrlWindow ?? KEYWORD_CLUSTER_TOP_URLS;
    const prepared: PreparedKeyword[] = [...input.keywords]
        .sort(compareKeywords)
        .slice(0, KEYWORD_CLUSTER_MAX_KEYWORDS_PER_RUN)
        .map((keyword) => {
        const window = prepareComparisonWindow(keyword.topUrls, windowSize);
        return { ...keyword, window, windowSet: new Set(window) };
    });
    const assigned = new Set<string>();
    const clusters: KeywordCluster[] = [];
    for (const pivot of prepared) {
        if (assigned.has(pivot.keywordId))
            continue;
        assigned.add(pivot.keywordId);
        const others: PreparedKeyword[] = [];
        const members: KeywordClusterMember[] = [
            {
                keywordId: pivot.keywordId,
                phrase: pivot.phrase,
                observedAt: pivot.observedAt,
                isPivot: true,
                sharedUrls: pivot.window.slice(0, KEYWORD_CLUSTER_MAX_SHARED_URLS_STORED),
                sharedUrlCount: pivot.window.length,
            },
        ];
        for (const candidate of prepared) {
            if (assigned.has(candidate.keywordId))
                continue;
            const shared = sharedUrls(pivot.windowSet, candidate.window);
            if (shared.length < minShared)
                continue;
            assigned.add(candidate.keywordId);
            others.push(candidate);
            members.push({
                keywordId: candidate.keywordId,
                phrase: candidate.phrase,
                observedAt: candidate.observedAt,
                isPivot: false,
                sharedUrls: shared.slice(0, KEYWORD_CLUSTER_MAX_SHARED_URLS_STORED),
                sharedUrlCount: shared.length,
            });
        }
        clusters.push({
            id: `cluster-${clusters.length + 1}`,
            size: members.length,
            pivotKeywordId: pivot.keywordId,
            sharedUrls: commonCore(pivot, others),
            members,
            label: null,
            labelSource: null,
        });
    }
    return clusters;
}
