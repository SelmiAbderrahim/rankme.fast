/**
 * Deterministic review stats.
 *
 * Every case runs against an explicit `now`; nothing here reads the wall
 * clock, so the expectations are stable forever.
 */
import { describe, expect, it } from 'vitest';
import {
  computeAverageRatingTrend,
  computeMonthlyVelocity,
  computeRatingHistogram,
  computeReviewStats,
  computeSourceMix,
  monthKeyOf,
  ratingBucketOf,
  type ReviewStatsRow,
} from './reviews.stats.js';

const NOW = new Date('2026-03-15T12:00:00.000Z');

function row(overrides: Partial<ReviewStatsRow> = {}): ReviewStatsRow {
  return {
    source: 'google',
    rating: 5,
    reviewedAt: new Date('2026-01-10T00:00:00.000Z'),
    ...overrides,
  };
}

describe('rating buckets and month keys', () => {
  it('rounds half stars into a star bucket and rejects out-of-range ratings', () => {
    expect(ratingBucketOf(4.5)).toBe(5);
    expect(ratingBucketOf(4.4)).toBe(4);
    expect(ratingBucketOf(1)).toBe(1);
    expect(ratingBucketOf(0)).toBeNull();
    expect(ratingBucketOf(6)).toBeNull();
    expect(ratingBucketOf(Number.NaN)).toBeNull();
    expect(ratingBucketOf(null)).toBeNull();
  });

  it('formats month keys in UTC with zero padding', () => {
    expect(monthKeyOf(new Date('2026-01-31T23:59:59.999Z'))).toBe('2026-01');
    expect(monthKeyOf(new Date('2026-12-01T00:00:00.000Z'))).toBe('2026-12');
    expect(monthKeyOf(new Date('0999-04-01T00:00:00.000Z'))).toBe('0999-04');
  });
});

describe('empty inventory', () => {
  it('returns a zero histogram, empty series, and a zero source mix', () => {
    const stats = computeReviewStats([], NOW);
    expect(stats.ratingHistogram).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, unrated: 0 });
    expect(stats.monthlyVelocity).toEqual([]);
    expect(stats.averageRatingTrend).toEqual([]);
    expect(stats.sourceMix).toEqual({ google: 0, trustpilot: 0, tripadvisor: 0, total: 0 });
  });
});

describe('single review in a single month', () => {
  it('reports one bucket per series with the review in the right source', () => {
    const stats = computeReviewStats(
      [row({ source: 'trustpilot', rating: 4, reviewedAt: new Date('2026-02-05T00:00:00.000Z') })],
      NOW,
    );
    expect(stats.ratingHistogram).toEqual({ 1: 0, 2: 0, 3: 0, 4: 1, 5: 0, unrated: 0 });
    expect(stats.monthlyVelocity).toEqual([
      { ymKey: '2026-02', total: 1, perSource: { google: 0, trustpilot: 1, tripadvisor: 0 } },
    ]);
    expect(stats.averageRatingTrend).toEqual([
      {
        ymKey: '2026-02',
        total: 4,
        perSource: { google: null, trustpilot: 4, tripadvisor: null },
      },
    ]);
    expect(stats.sourceMix).toEqual({ google: 0, trustpilot: 1, tripadvisor: 0, total: 1 });
  });
});

describe('gap months', () => {
  it('emits zero-count velocity and null-value trend buckets between observed months', () => {
    const rows = [
      // Deliberately out of order — the span is computed, not assumed.
      row({ rating: 3, reviewedAt: new Date('2026-03-02T00:00:00.000Z') }),
      row({ rating: 5, reviewedAt: new Date('2025-12-31T23:00:00.000Z') }),
    ];
    const velocity = computeMonthlyVelocity(rows, NOW);
    expect(velocity.map((bucket) => bucket.ymKey)).toEqual([
      '2025-12',
      '2026-01',
      '2026-02',
      '2026-03',
    ]);
    expect(velocity[1]!).toEqual({
      ymKey: '2026-01',
      total: 0,
      perSource: { google: 0, trustpilot: 0, tripadvisor: 0 },
    });
    expect(velocity[2]!.total).toBe(0);
    expect(velocity[0]!.total).toBe(1);
    expect(velocity[3]!.total).toBe(1);

    const trend = computeAverageRatingTrend(rows, NOW);
    expect(trend.map((bucket) => bucket.ymKey)).toEqual([
      '2025-12',
      '2026-01',
      '2026-02',
      '2026-03',
    ]);
    expect(trend[1]!).toEqual({
      ymKey: '2026-01',
      total: null,
      perSource: { google: null, trustpilot: null, tripadvisor: null },
    });
    expect(trend[0]!.total).toBe(5);
    expect(trend[3]!.total).toBe(3);
  });

  it('computes the same span when the rows arrive oldest-first', () => {
    const ascending = [
      row({ rating: 5, reviewedAt: new Date('2025-12-31T23:00:00.000Z') }),
      row({ rating: 3, reviewedAt: new Date('2026-03-02T00:00:00.000Z') }),
    ];
    expect(computeMonthlyVelocity(ascending, NOW).map((bucket) => bucket.ymKey)).toEqual([
      '2025-12',
      '2026-01',
      '2026-02',
      '2026-03',
    ]);
    expect(computeAverageRatingTrend(ascending, NOW).map((bucket) => bucket.total)).toEqual([
      5,
      null,
      null,
      3,
    ]);
  });
});

describe('future-dated reviews', () => {
  it('clamps them out of the time series but keeps them in the histogram and mix', () => {
    const rows = [
      row({ rating: 5, reviewedAt: new Date('2026-01-10T00:00:00.000Z') }),
      row({
        source: 'tripadvisor',
        rating: 1,
        // Strictly after `now` — vendor clock skew, never a real datapoint.
        reviewedAt: new Date('2026-03-15T12:00:00.001Z'),
      }),
    ];
    const stats = computeReviewStats(rows, NOW);
    expect(stats.monthlyVelocity).toEqual([
      { ymKey: '2026-01', total: 1, perSource: { google: 1, trustpilot: 0, tripadvisor: 0 } },
    ]);
    expect(stats.averageRatingTrend).toHaveLength(1);
    expect(stats.averageRatingTrend[0]!.total).toBe(5);
    expect(stats.ratingHistogram).toEqual({ 1: 1, 2: 0, 3: 0, 4: 0, 5: 1, unrated: 0 });
    expect(stats.sourceMix).toEqual({ google: 1, trustpilot: 0, tripadvisor: 1, total: 2 });
  });

  it('keeps a review dated exactly at `now`', () => {
    const velocity = computeMonthlyVelocity([row({ reviewedAt: NOW })], NOW);
    expect(velocity).toEqual([
      { ymKey: '2026-03', total: 1, perSource: { google: 1, trustpilot: 0, tripadvisor: 0 } },
    ]);
  });
});

describe('null ratings', () => {
  it('counts them as unrated and leaves them out of every mean', () => {
    const rows = [
      row({ rating: null }),
      row({ rating: Number.NaN }),
      row({ rating: 4 }),
      row({ source: 'trustpilot', rating: null }),
    ];
    const stats = computeReviewStats(rows, NOW);
    expect(stats.ratingHistogram).toEqual({ 1: 0, 2: 0, 3: 0, 4: 1, 5: 0, unrated: 3 });
    expect(stats.averageRatingTrend).toEqual([
      {
        ymKey: '2026-01',
        total: 4,
        perSource: { google: 4, trustpilot: null, tripadvisor: null },
      },
    ]);
    // The unrated rows still count as reviews received that month.
    expect(stats.monthlyVelocity[0]!.total).toBe(4);
  });

  it('reports a null mean for a month whose only rows are unrated', () => {
    const trend = computeAverageRatingTrend([row({ rating: null })], NOW);
    expect(trend).toEqual([
      {
        ymKey: '2026-01',
        total: null,
        perSource: { google: null, trustpilot: null, tripadvisor: null },
      },
    ]);
  });
});

describe('null review dates', () => {
  it('excludes undated rows from the series but keeps them in the histogram and mix', () => {
    const rows = [
      row({ source: 'tripadvisor', rating: 2, reviewedAt: null }),
      row({ rating: 5, reviewedAt: new Date('2026-02-01T00:00:00.000Z') }),
    ];
    const stats = computeReviewStats(rows, NOW);
    expect(stats.monthlyVelocity).toEqual([
      { ymKey: '2026-02', total: 1, perSource: { google: 1, trustpilot: 0, tripadvisor: 0 } },
    ]);
    expect(stats.averageRatingTrend[0]!.perSource.tripadvisor).toBeNull();
    expect(stats.ratingHistogram).toEqual({ 1: 0, 2: 1, 3: 0, 4: 0, 5: 1, unrated: 0 });
    expect(stats.sourceMix).toEqual({ google: 1, trustpilot: 0, tripadvisor: 1, total: 2 });
  });

  it('returns empty series when every row is undated', () => {
    const rows = [row({ reviewedAt: null }), row({ source: 'trustpilot', reviewedAt: null })];
    expect(computeMonthlyVelocity(rows, NOW)).toEqual([]);
    expect(computeAverageRatingTrend(rows, NOW)).toEqual([]);
    expect(computeRatingHistogram(rows)[5]).toBe(2);
    expect(computeSourceMix(rows)).toEqual({
      google: 1,
      trustpilot: 1,
      tripadvisor: 0,
      total: 2,
    });
  });
});

describe('multi-source month', () => {
  it('splits per source so the parts sum to the month total and averages the means', () => {
    const at = (day: number) => new Date(Date.UTC(2026, 0, day));
    const rows = [
      row({ source: 'google', rating: 5, reviewedAt: at(2) }),
      row({ source: 'google', rating: 4, reviewedAt: at(3) }),
      row({ source: 'trustpilot', rating: 2, reviewedAt: at(4) }),
      row({ source: 'tripadvisor', rating: 3, reviewedAt: at(5) }),
      row({ source: 'tripadvisor', rating: 4, reviewedAt: at(6) }),
      row({ source: 'tripadvisor', rating: 4, reviewedAt: at(7) }),
    ];
    const [velocity] = computeMonthlyVelocity(rows, NOW);
    expect(velocity!.total).toBe(6);
    expect(velocity!.perSource).toEqual({ google: 2, trustpilot: 1, tripadvisor: 3 });
    expect(
      velocity!.perSource.google + velocity!.perSource.trustpilot + velocity!.perSource.tripadvisor,
    ).toBe(velocity!.total);

    const [trend] = computeAverageRatingTrend(rows, NOW);
    expect(trend!.perSource).toEqual({ google: 4.5, trustpilot: 2, tripadvisor: 3.67 });
    // (5+4+2+3+4+4)/6 = 3.6666… → two decimals.
    expect(trend!.total).toBe(3.67);
  });
});
