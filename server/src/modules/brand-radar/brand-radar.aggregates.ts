/**
 * Brand Radar — deterministic aggregates.
 *
 * Every number a Brand Radar scan reports is computed HERE, from the stored,
 * normalized mention rows. The `brand_digest` AI pass may describe what the
 * mentions say; it never sets a count, a distribution, a domain ranking, or a
 * trend. That split is the whole reason these are pure functions in their own
 * file: they are unit-testable without Mongo, without a provider, and without
 * an AI runner, so a drift in the reported numbers cannot hide behind a
 * generation.
 *
 * Bounds (frozen):
 *   - top domains ≤ 50, sorted by count desc then domain asc.
 *   - sentiment distribution keys `positive | neutral | negative | unknown`,
 *     reported as whole percentages that sum to exactly 100 whenever at least
 *     one row exists.
 *   - trend is the current count minus the prior scan's count for the same
 *     normalized query; with no prior scan it is ABSENT, never zero.
 */
/** A scan never reports more than fifty domains. */
export const BRAND_RADAR_TOP_DOMAINS_LIMIT = 50;
export const BRAND_RADAR_SENTIMENT_KEYS = [
    'positive',
    'neutral',
    'negative',
    'unknown',
] as const;
export type BrandRadarSentimentKey = (typeof BRAND_RADAR_SENTIMENT_KEYS)[number];
export type BrandRadarSentimentDistribution = Record<BrandRadarSentimentKey, number>;
/**
 * The only shape the aggregates need. Both the stored Mongo document and the
 * normalized provider row satisfy it structurally, so neither has to be
 * adapted at the call site.
 */
export interface BrandRadarAggregateRow {
    domain: string;
    /** Absent, null, or an unrecognized value all land in the `unknown` bucket. */
    polarity?: string | null;
}
export interface BrandRadarTopDomain {
    domain: string;
    count: number;
}
export type BrandRadarTrendDirection = 'up' | 'down' | 'flat';
export interface BrandRadarTrendDelta {
    delta: number;
    direction: BrandRadarTrendDirection;
}
/** Absence sentinel — the first scan of a series has nothing to compare to. */
export interface BrandRadarTrendAbsent {
    absent: true;
}
export type BrandRadarTrend = BrandRadarTrendDelta | BrandRadarTrendAbsent;
/** A prior scan only ever contributes its own stored mention count. */
export interface BrandRadarPriorScan {
    mentionCount: number;
}
/** Mention count = the number of rows actually retained for the scan. */
export function computeMentionCount(rows: readonly BrandRadarAggregateRow[]): number {
    return rows.length;
}
function bucketOf(row: BrandRadarAggregateRow): BrandRadarSentimentKey {
    const polarity = row.polarity;
    return polarity === 'positive' || polarity === 'neutral' || polarity === 'negative'
        ? polarity
        : 'unknown';
}
/**
 * Whole-percentage sentiment split over the stored rows.
 *
 * Largest-remainder apportionment: floor every share, then hand the residual
 * points to the largest fractional parts (ties broken by the fixed key order).
 * The result therefore sums to EXACTLY 100 whenever a row exists — comfortably
 * inside the spec's ±1 tolerance — and is fully deterministic for a given row
 * set. With zero rows every bucket is zero; there is no percentage of nothing.
 */
export function computeSentimentDistribution(rows: readonly BrandRadarAggregateRow[]): BrandRadarSentimentDistribution {
    const counts: BrandRadarSentimentDistribution = {
        positive: 0,
        neutral: 0,
        negative: 0,
        unknown: 0,
    };
    for (const row of rows)
        counts[bucketOf(row)] += 1;
    if (rows.length === 0)
        return counts;
    const shares = BRAND_RADAR_SENTIMENT_KEYS.map((key) => {
        const exact = (counts[key] * 100) / rows.length;
        const whole = Math.floor(exact);
        return { key, whole, fraction: exact - whole };
    });
    let residual = 100 - shares.reduce((sum, share) => sum + share.whole, 0);
    const byFraction = [...shares.entries()].sort((a, b) => b[1].fraction - a[1].fraction || a[0] - b[0]);
    for (const [, share] of byFraction) {
        if (residual === 0)
            break;
        share.whole += 1;
        residual -= 1;
    }
    return Object.fromEntries(shares.map((share) => [share.key, share.whole])) as BrandRadarSentimentDistribution;
}
/**
 * Domain frequency, highest first. Ties break lexicographically on the domain
 * so two runs over the same rows always produce the same ordering — a stable
 * table is what makes a week-over-week comparison readable.
 */
export function computeTopDomains(rows: readonly BrandRadarAggregateRow[], limit: number = BRAND_RADAR_TOP_DOMAINS_LIMIT): BrandRadarTopDomain[] {
    const counts = new Map<string, number>();
    for (const row of rows) {
        counts.set(row.domain, (counts.get(row.domain) ?? 0) + 1);
    }
    return [...counts.entries()]
        .map(([domain, count]) => ({ domain, count }))
        .sort((a, b) => b.count - a.count || (a.domain < b.domain ? -1 : 1))
        .slice(0, Math.min(Math.max(0, limit), BRAND_RADAR_TOP_DOMAINS_LIMIT));
}
/**
 * Trend against the previous settled scan of the same normalized query.
 *
 * With no prior scan the answer is the absence sentinel, NOT a zero delta —
 * "we have never looked before" and "nothing changed" are different facts and
 * the surface must be able to tell them apart.
 */
export function computeTrendVsPrevious(currentCount: number, priorScan: BrandRadarPriorScan | null): BrandRadarTrend {
    if (priorScan === null)
        return { absent: true };
    const delta = currentCount - priorScan.mentionCount;
    const direction: BrandRadarTrendDirection = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
    return { delta, direction };
}
/** Narrowing helper so callers do not re-test the sentinel shape by hand. */
export function isTrendAbsent(trend: BrandRadarTrend): trend is BrandRadarTrendAbsent {
    return 'absent' in trend;
}
export interface BrandRadarAggregates {
    mentionCount: number;
    sentimentDistribution: BrandRadarSentimentDistribution;
    topDomains: BrandRadarTopDomain[];
}
/** The three row-derived aggregates in one pass, for pipeline settlement. */
export function computeBrandRadarAggregates(rows: readonly BrandRadarAggregateRow[]): BrandRadarAggregates {
    return {
        mentionCount: computeMentionCount(rows),
        sentimentDistribution: computeSentimentDistribution(rows),
        topDomains: computeTopDomains(rows),
    };
}
