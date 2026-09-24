import type { ListingFinding, NormalizedListingInput } from './types.js';
function normalizedWords(value: string): string[] {
    return [...new Set(value.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean))].sort();
}
function overlap(left: readonly string[], right: readonly string[]): number {
    const union = new Set([...left, ...right]);
    if (union.size === 0)
        return 1;
    const rightSet = new Set(right);
    return left.filter((value) => rightSet.has(value)).length / union.size;
}
function parityFinding(id: string, severity: ListingFinding['severity'], status: ListingFinding['status'], params: ListingFinding['params']): ListingFinding {
    return {
        id,
        scope: 'parity',
        severity,
        status,
        copyKey: `appSeo.listing.findings.${id}`,
        params,
        provenance: 'user-paired',
    };
}
export function evaluateParityRules(googlePlay: NormalizedListingInput | null, appStore: NormalizedListingInput | null): ListingFinding[] {
    if (!googlePlay || !appStore) {
        return [
            parityFinding('stores-diverge', 'watch', 'notEvaluated', { similarity: 0 }),
            parityFinding('ratings-diverge', 'advisory', 'notEvaluated', { difference: 0 }),
            parityFinding('categories-diverge', 'advisory', 'notEvaluated', { similarity: 0 }),
        ];
    }
    const titleSimilarity = overlap(normalizedWords(googlePlay.title), normalizedWords(appStore.title));
    const categorySimilarity = overlap(googlePlay.categories, appStore.categories);
    const ratingDifference = googlePlay.rating === null || appStore.rating === null
        ? null
        : Math.abs(googlePlay.rating - appStore.rating);
    return [
        parityFinding('stores-diverge', 'watch', titleSimilarity < 0.5 ? 'finding' : 'passed', { similarity: Math.round(titleSimilarity * 100) }),
        parityFinding('ratings-diverge', 'advisory', ratingDifference === null ? 'notEvaluated' : ratingDifference >= 0.5 ? 'finding' : 'passed', { difference: ratingDifference === null ? 0 : Number(ratingDifference.toFixed(2)) }),
        parityFinding('categories-diverge', 'advisory', googlePlay.categories.length === 0 || appStore.categories.length === 0
            ? 'notEvaluated'
            : categorySimilarity === 0
                ? 'finding'
                : 'passed', { similarity: Math.round(categorySimilarity * 100) }),
    ];
}
