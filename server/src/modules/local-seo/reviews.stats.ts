/**
 * Review Intelligence deterministic stats.
 *
 * Pure math over the STORED review rows. No AI touches these numbers, no
 * vendor call is made to produce them, and nothing here reads the clock —
 * every time-dependent function takes `now` from its caller so a frozen-clock
 * test and a production request follow the exact same code path.
 *
 * Month buckets are ISO `YYYY-MM` keys computed in UTC. Rows dated strictly
 * after `now` are a vendor artefact (clock skew, a mis-parsed relative date);
 * they are excluded from the time series but still counted in the histogram
 * and the source mix, because the review itself exists in the inventory.
 */
import type { ReviewSourceName } from './review-sync.model.js';
import { REVIEW_SOURCES } from './review-sync.model.js';
/** The only row fields the stats need — a projection, never the review text. */
export interface ReviewStatsRow {
    source: ReviewSourceName;
    rating: number | null;
    reviewedAt: Date | null;
}
export type ReviewPerSourceCounts = Record<ReviewSourceName, number>;
export type ReviewPerSourceAverages = Record<ReviewSourceName, number | null>;
export interface ReviewRatingHistogram {
    1: number;
    2: number;
    3: number;
    4: number;
    5: number;
    /** Rows with no usable star rating — never folded into a star bucket. */
    unrated: number;
}
export interface ReviewVelocityBucket {
    ymKey: string;
    total: number;
    perSource: ReviewPerSourceCounts;
}
export interface ReviewTrendBucket {
    ymKey: string;
    total: number | null;
    perSource: ReviewPerSourceAverages;
}
export interface ReviewSourceMix extends ReviewPerSourceCounts {
    total: number;
}
export interface ReviewStats {
    ratingHistogram: ReviewRatingHistogram;
    monthlyVelocity: ReviewVelocityBucket[];
    averageRatingTrend: ReviewTrendBucket[];
    sourceMix: ReviewSourceMix;
}
function zeroPerSource(): ReviewPerSourceCounts {
    return { google: 0, trustpilot: 0, tripadvisor: 0 };
}
/**
 * A star bucket, or `null` when the row carries no usable rating. Providers
 * occasionally hand back half stars; those round to the nearest star. Anything
 * that does not land in 1..5 (including a stored `0`) is `unrated` rather than
 * being squeezed into the one-star bucket.
 */
export function ratingBucketOf(rating: number | null): 1 | 2 | 3 | 4 | 5 | null {
    if (rating === null || !Number.isFinite(rating))
        return null;
    const rounded = Math.round(rating);
    return rounded >= 1 && rounded <= 5 ? (rounded as 1 | 2 | 3 | 4 | 5) : null;
}
/** UTC `YYYY-MM`. Never local time — a bucket must not move with the server TZ. */
export function monthKeyOf(date: Date): string {
    const month = date.getUTCMonth() + 1;
    return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}
function monthIndexOf(date: Date): number {
    return date.getUTCFullYear() * 12 + date.getUTCMonth();
}
function monthKeyOfIndex(index: number): string {
    const year = Math.floor(index / 12);
    const month = (index % 12) + 1;
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}
/** Two decimals — enough for a star average, stable across runs. */
function roundMean(sum: number, count: number): number {
    return Math.round((sum / count) * 100) / 100;
}
interface DatedRow extends ReviewStatsRow {
    reviewedAt: Date;
}
/**
 * Rows that belong on a time series: a real `reviewedAt` that is not in the
 * future relative to `now`. Everything else stays out of velocity and trend.
 */
function datedRows(rows: readonly ReviewStatsRow[], now: Date): DatedRow[] {
    const ceiling = now.getTime();
    const kept: DatedRow[] = [];
    for (const row of rows) {
        if (row.reviewedAt === null)
            continue;
        if (row.reviewedAt.getTime() > ceiling)
            continue;
        kept.push({ ...row, reviewedAt: row.reviewedAt });
    }
    return kept;
}
/** Contiguous month index span covering every dated row; `null` when empty. */
function monthSpanOf(rows: readonly DatedRow[]): {
    first: number;
    last: number;
} | null {
    let span: {
        first: number;
        last: number;
    } | null = null;
    for (const row of rows) {
        const index = monthIndexOf(row.reviewedAt);
        if (span === null) {
            span = { first: index, last: index };
            continue;
        }
        if (index < span.first)
            span.first = index;
        if (index > span.last)
            span.last = index;
    }
    return span;
}
/**
 * Star distribution over every stored row, plus the `unrated` remainder.
 * Time-independent: a future-dated review still exists in the inventory.
 */
export function computeRatingHistogram(rows: readonly ReviewStatsRow[]): ReviewRatingHistogram {
    const histogram: ReviewRatingHistogram = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, unrated: 0 };
    for (const row of rows) {
        const bucket = ratingBucketOf(row.rating);
        if (bucket === null)
            histogram.unrated += 1;
        else
            histogram[bucket] += 1;
    }
    return histogram;
}
/**
 * Reviews per calendar month, total and per source, ascending by `ymKey`.
 * Gap months between the earliest and latest observed month are emitted with
 * zeros so a chart cannot imply a compressed timeline.
 */
export function computeMonthlyVelocity(rows: readonly ReviewStatsRow[], now: Date): ReviewVelocityBucket[] {
    const dated = datedRows(rows, now);
    const span = monthSpanOf(dated);
    if (!span)
        return [];
    const byMonth = new Map<number, ReviewVelocityBucket>();
    for (const row of dated) {
        const index = monthIndexOf(row.reviewedAt);
        let bucket = byMonth.get(index);
        if (!bucket) {
            bucket = { ymKey: monthKeyOfIndex(index), total: 0, perSource: zeroPerSource() };
            byMonth.set(index, bucket);
        }
        bucket.total += 1;
        bucket.perSource[row.source] += 1;
    }
    const buckets: ReviewVelocityBucket[] = [];
    for (let index = span.first; index <= span.last; index += 1) {
        buckets.push(byMonth.get(index) ?? {
            ymKey: monthKeyOfIndex(index),
            total: 0,
            perSource: zeroPerSource(),
        });
    }
    return buckets;
}
/**
 * Mean star rating per calendar month, total and per source, ascending by
 * `ymKey`. A month with rows but no usable ratings — and a gap month with no
 * rows at all — reports `null`, never a zero that would read as "one star".
 */
export function computeAverageRatingTrend(rows: readonly ReviewStatsRow[], now: Date): ReviewTrendBucket[] {
    const dated = datedRows(rows, now);
    const span = monthSpanOf(dated);
    if (!span)
        return [];
    interface Accumulator {
        sum: number;
        count: number;
        perSource: Record<ReviewSourceName, {
            sum: number;
            count: number;
        }>;
    }
    const emptyAccumulator = (): Accumulator => ({
        sum: 0,
        count: 0,
        perSource: {
            google: { sum: 0, count: 0 },
            trustpilot: { sum: 0, count: 0 },
            tripadvisor: { sum: 0, count: 0 },
        },
    });
    const accumulators = new Map<number, Accumulator>();
    for (const row of dated) {
        const index = monthIndexOf(row.reviewedAt);
        let accumulator = accumulators.get(index);
        if (!accumulator) {
            accumulator = emptyAccumulator();
            accumulators.set(index, accumulator);
        }
        // A null-rating row still marks the month as observed; it just adds
        // nothing to the mean.
        if (row.rating === null || !Number.isFinite(row.rating))
            continue;
        accumulator.sum += row.rating;
        accumulator.count += 1;
        const perSource = accumulator.perSource[row.source];
        perSource.sum += row.rating;
        perSource.count += 1;
    }
    const buckets: ReviewTrendBucket[] = [];
    for (let index = span.first; index <= span.last; index += 1) {
        const accumulator = accumulators.get(index) ?? emptyAccumulator();
        const perSource = {} as ReviewPerSourceAverages;
        for (const source of REVIEW_SOURCES) {
            const entry = accumulator.perSource[source];
            perSource[source] = entry.count === 0 ? null : roundMean(entry.sum, entry.count);
        }
        buckets.push({
            ymKey: monthKeyOfIndex(index),
            total: accumulator.count === 0 ? null : roundMean(accumulator.sum, accumulator.count),
            perSource,
        });
    }
    return buckets;
}
/** Row counts per source over the whole inventory, plus the grand total. */
export function computeSourceMix(rows: readonly ReviewStatsRow[]): ReviewSourceMix {
    const mix: ReviewSourceMix = { ...zeroPerSource(), total: 0 };
    for (const row of rows) {
        mix[row.source] += 1;
        mix.total += 1;
    }
    return mix;
}
/** The four deterministic series, computed once over one row set. */
export function computeReviewStats(rows: readonly ReviewStatsRow[], now: Date): ReviewStats {
    return {
        ratingHistogram: computeRatingHistogram(rows),
        monthlyVelocity: computeMonthlyVelocity(rows, now),
        averageRatingTrend: computeAverageRatingTrend(rows, now),
        sourceMix: computeSourceMix(rows),
    };
}
