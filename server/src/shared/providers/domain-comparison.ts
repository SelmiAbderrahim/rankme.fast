import type { DomainComparisonResult, DomainComparisonRow, } from './types.js';
/** One landscape always uses exactly these three paid domain-intersection legs. */
export const DOMAIN_COMPARISON_LEG_COUNT = 3;
/** Deliberately below the vendor's 1,000-row limit to preserve unit economics. */
export const DOMAIN_COMPARISON_MAX_ROWS = 100;
export type DomainComparisonLeg = 'shared' | 'ownedOnly' | 'competitorOnly';
/** Unicode-stable keyword key shared by live and fake adapters. */
export function normalizeDomainComparisonKeyword(keyword: string): string {
    return keyword.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase();
}
function compareCodePoints(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}
function compareNullableNumberAscending(left: number | null, right: number | null): number {
    if (left === null)
        return right === null ? 0 : 1;
    if (right === null)
        return -1;
    return left - right;
}
function compareNullableNumberDescending(left: number | null, right: number | null): number {
    if (left === null)
        return right === null ? 0 : 1;
    if (right === null)
        return -1;
    return right - left;
}
function compareNullableStringAscending(left: string | null, right: string | null): number {
    if (left === null)
        return right === null ? 0 : 1;
    if (right === null)
        return -1;
    return compareCodePoints(left, right);
}
function primaryPosition(row: DomainComparisonRow, leg: DomainComparisonLeg): number | null {
    return leg === 'competitorOnly' ? row.competitorPosition : row.ownedPosition;
}
function primaryUrl(row: DomainComparisonRow, leg: DomainComparisonLeg): string | null {
    return leg === 'competitorOnly' ? row.competitorUrl : row.ownedUrl;
}
/**
 * Pick one whole observation for a duplicate key. Fields are never blended
 * across rows: best primary rank, then URL, volume, difficulty, intent, and
 * original spelling provide a deterministic winner.
 */
export function compareDomainComparisonRows(left: DomainComparisonRow, right: DomainComparisonRow, leg: DomainComparisonLeg): number {
    return (compareNullableNumberAscending(primaryPosition(left, leg), primaryPosition(right, leg)) ||
        compareNullableStringAscending(primaryUrl(left, leg), primaryUrl(right, leg)) ||
        compareNullableNumberDescending(left.searchVolume, right.searchVolume) ||
        compareNullableNumberDescending(left.keywordDifficulty, right.keywordDifficulty) ||
        compareNullableStringAscending(left.intent, right.intent) ||
        compareCodePoints(left.keyword, right.keyword));
}
/** De-duplicate, canonically order, and hard-cap one comparison class. */
export function normalizeDomainComparisonRows(rows: readonly DomainComparisonRow[], leg: DomainComparisonLeg): DomainComparisonRow[] {
    const winners = new Map<string, DomainComparisonRow>();
    for (const row of rows) {
        const normalizedKeyword = normalizeDomainComparisonKeyword(row.keyword);
        if (normalizedKeyword.length === 0)
            continue;
        const candidate = { ...row, normalizedKeyword };
        const current = winners.get(normalizedKeyword);
        if (!current || compareDomainComparisonRows(candidate, current, leg) < 0) {
            winners.set(normalizedKeyword, candidate);
        }
    }
    return [...winners.values()]
        // Map keys are unique, so a secondary comparison can never be reached.
        .sort((left, right) => compareCodePoints(left.normalizedKeyword, right.normalizedKeyword))
        .slice(0, DOMAIN_COMPARISON_MAX_ROWS);
}
/** Apply the same first-class contract normalization to any implementation. */
export function normalizeDomainComparisonResult(result: DomainComparisonResult): DomainComparisonResult {
    return {
        shared: normalizeDomainComparisonRows(result.shared, 'shared'),
        ownedOnly: normalizeDomainComparisonRows(result.ownedOnly, 'ownedOnly'),
        competitorOnly: normalizeDomainComparisonRows(result.competitorOnly, 'competitorOnly'),
    };
}
export const domainComparisonTestables = Object.freeze({
    compareNullableNumberAscending,
    compareNullableNumberDescending,
    compareNullableStringAscending,
    primaryPosition,
    primaryUrl,
});
