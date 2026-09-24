/**
 * Deterministic formula suite for Keyword Trends readouts.
 *
 * Every assertion pins the frozen numeric contract; DO NOT re-derive
 * thresholds — future changes must edit both the formula and this file.
 */
import { describe, expect, it } from 'vitest';
import {
  SEARCH_INTEREST_INDEX_KEY,
  estimateEnvelope,
  momentum,
  seasonalityMonths,
  yearOverYear,
  type WeeklyPoint,
} from './keyword-research.trends.js';

function week(iso: string, value: number): WeeklyPoint {
  return { date: iso, value };
}

/** Build a Mon-anchored weekly series starting `start` with `n` points and
 *  a `producer(i) → value`. */
function makeSeries(
  start: Date,
  n: number,
  producer: (i: number) => number,
): WeeklyPoint[] {
  const out: WeeklyPoint[] = [];
  for (let i = 0; i < n; i += 1) {
    const d = new Date(start.getTime() + i * 7 * 24 * 60 * 60 * 1000);
    out.push({ date: d.toISOString().slice(0, 10), value: producer(i) });
  }
  return out;
}

describe('yearOverYear', () => {
  it('returns insufficient_history when fewer than 56 weeks', () => {
    const series = makeSeries(new Date(Date.UTC(2023, 0, 2)), 55, () => 40);
    const result = yearOverYear(series);
    expect(result.deltaFraction).toBeNull();
    expect(result.reason).toBe('insufficient_history');
  });

  it('returns a definite deltaFraction at exactly 56 valid weeks (linear 1..56 scaled 0..100)', () => {
    const series = makeSeries(new Date(Date.UTC(2023, 0, 2)), 56, (i) => {
      // scale 1..56 into 0..100 (inclusive); i=0 → 0, i=55 → 100.
      return (i / 55) * 100;
    });
    const result = yearOverYear(series);
    // recent (i=52..55) = [52,53,54,55]/55 * 100 → mean 94.5454545...
    const recentValues = [52, 53, 54, 55].map((i) => (i / 55) * 100);
    const priorValues = [0, 1, 2, 3].map((i) => (i / 55) * 100);
    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    const priorMean = mean(priorValues);
    const expected = (mean(recentValues) - priorMean) / Math.max(1, priorMean);
    expect(result.deltaFraction).toBeCloseTo(expected, 9);
    expect(result.reason).toBeUndefined();
  });

  it('is 0 on a flat 208-week series (208 valid points, means equal)', () => {
    const series = makeSeries(new Date(Date.UTC(2020, 0, 6)), 208, () => 50);
    expect(yearOverYear(series).deltaFraction).toBe(0);
  });

  it('filters NaN and negative points — 55 valid + 1 NaN + 1 negative < 56 valid', () => {
    // 55 valid + one NaN + one negative → still 55 valid → insufficient_history.
    const series: WeeklyPoint[] = [
      ...makeSeries(new Date(Date.UTC(2023, 0, 2)), 55, () => 40),
      week('2024-01-15', Number.NaN),
      week('2024-01-22', -10),
    ];
    expect(yearOverYear(series).deltaFraction).toBeNull();
  });

  it('divides by 1 when the prior window mean is zero-ish (recent 100)', () => {
    // Build 56 points; the prior 4-week window is exactly zero.
    const values: number[] = [];
    for (let i = 0; i < 56; i += 1) values.push(0);
    for (let i = 52; i < 56; i += 1) values[i] = 100;
    const series = makeSeries(new Date(Date.UTC(2023, 0, 2)), 56, (i) => values[i]!);
    const result = yearOverYear(series);
    // recent mean=100, prior mean=0 → denom = max(1, 0) = 1 → 100.
    expect(result.deltaFraction).toBe(100);
  });
});

describe('momentum', () => {
  it('returns insufficient_history when fewer than 12 weeks', () => {
    const series = makeSeries(new Date(Date.UTC(2024, 0, 1)), 11, (i) => i);
    const result = momentum(series);
    expect(result.direction).toBe('flat');
    expect(result.slopePerWeek).toBeNull();
    expect(result.reason).toBe('insufficient_history');
  });

  it("returns 'flat' on a flat 12-week series", () => {
    const series = makeSeries(new Date(Date.UTC(2024, 0, 1)), 12, () => 50);
    const result = momentum(series);
    expect(result.direction).toBe('flat');
    expect(result.slopePerWeek).toBe(0);
    expect(result.reason).toBeUndefined();
  });

  it("returns 'up' on a strongly increasing 12-week series (slope > 0.5)", () => {
    const series = makeSeries(new Date(Date.UTC(2024, 0, 1)), 12, (i) => i);
    const result = momentum(series);
    expect(result.direction).toBe('up');
    expect(result.slopePerWeek).toBeGreaterThan(0.5);
  });

  it("returns 'down' on a strongly decreasing 12-week series (slope < -0.5)", () => {
    // Values 100, 99, 98, ..., 89 (all ≥ 0) → slope -1/week.
    const series = makeSeries(new Date(Date.UTC(2024, 0, 1)), 12, (i) => 100 - i);
    const result = momentum(series);
    expect(result.direction).toBe('down');
    expect(result.slopePerWeek!).toBeLessThan(-0.5);
    expect(result.slopePerWeek).toBeCloseTo(-1, 9);
  });

  it("returns 'flat' at slope exactly +0.5 (boundary)", () => {
    // slope = 0.5/week — build values around a mean so slope hits exactly 0.5.
    const series = makeSeries(new Date(Date.UTC(2024, 0, 1)), 12, (i) => i * 0.5);
    const result = momentum(series);
    expect(result.slopePerWeek).toBeCloseTo(0.5, 9);
    expect(result.direction).toBe('flat');
  });

  it("returns 'up' just above 0.5 (0.5001)", () => {
    const series = makeSeries(new Date(Date.UTC(2024, 0, 1)), 12, (i) => i * 0.5001);
    const result = momentum(series);
    expect(result.slopePerWeek!).toBeGreaterThan(0.5);
    expect(result.direction).toBe('up');
  });

  it("returns 'flat' at slope exactly -0.5 (boundary)", () => {
    // Values 100, 99.5, 99, ..., 94.5 (all ≥ 0) → slope -0.5/week.
    const series = makeSeries(new Date(Date.UTC(2024, 0, 1)), 12, (i) => 100 - i * 0.5);
    const result = momentum(series);
    expect(result.slopePerWeek).toBeCloseTo(-0.5, 9);
    expect(result.direction).toBe('flat');
  });

  it("returns 'down' just below -0.5 (-0.5001)", () => {
    // Values 100, 99.4999, ..., all positive → slope -0.5001/week.
    const series = makeSeries(new Date(Date.UTC(2024, 0, 1)), 12, (i) => 100 - i * 0.5001);
    const result = momentum(series);
    expect(result.slopePerWeek!).toBeLessThan(-0.5);
    expect(result.direction).toBe('down');
  });

  it('filters NaN and negative values before computing slope', () => {
    // Slot two invalid points into a 14-point series; after filter we get 12
    // exactly-linear points → slope 1/week → 'up'.
    const series: WeeklyPoint[] = [];
    let x = 0;
    for (let i = 0; i < 14; i += 1) {
      const d = new Date(Date.UTC(2024, 0, 1 + i * 7));
      if (i === 3) series.push({ date: d.toISOString().slice(0, 10), value: Number.NaN });
      else if (i === 7) series.push({ date: d.toISOString().slice(0, 10), value: -1 });
      else {
        series.push({ date: d.toISOString().slice(0, 10), value: x });
        x += 1;
      }
    }
    const result = momentum(series);
    // 12 valid points 0..11 → slope exactly 1.
    expect(result.slopePerWeek).toBeCloseTo(1, 9);
    expect(result.direction).toBe('up');
  });
});

describe('seasonalityMonths', () => {
  it('returns insufficient_history when fewer than 24 distinct months', () => {
    // 12 monthly points (one per month) → only 12 distinct months.
    const series: WeeklyPoint[] = [];
    for (let m = 1; m <= 12; m += 1) {
      series.push(week(`2024-${String(m).padStart(2, '0')}-01`, 30));
    }
    const result = seasonalityMonths(series);
    expect(result.months).toEqual([]);
    expect(result.reason).toBe('insufficient_history');
  });

  it('returns [] on a flat 208-week (5-year) series — no month exceeds 1.15x mean', () => {
    const series = makeSeries(new Date(Date.UTC(2020, 0, 6)), 208, () => 50);
    const result = seasonalityMonths(series);
    expect(result.months).toEqual([]);
    expect(result.reason).toBeUndefined();
  });

  it('detects a seasonal peak in month 12 across 4 years (208 weeks)', () => {
    // 208-week series (~4 years); December weeks (month=12) get value 100,
    // all other weeks get value 10 → december mean ≈ 100, yearly mean much
    // lower, december strongly > 1.15 × yearly mean.
    const series = makeSeries(new Date(Date.UTC(2020, 0, 6)), 208, (i) => {
      const d = new Date(Date.UTC(2020, 0, 6) + i * 7 * 24 * 60 * 60 * 1000);
      return d.getUTCMonth() + 1 === 12 ? 100 : 10;
    });
    const result = seasonalityMonths(series);
    expect(result.months).toContain(12);
    // Every element in [1..12].
    for (const m of result.months) expect(m).toBeGreaterThanOrEqual(1);
    for (const m of result.months) expect(m).toBeLessThanOrEqual(12);
    // Ascending order.
    const sorted = [...result.months].sort((a, b) => a - b);
    expect(result.months).toEqual(sorted);
  });

  it('returns multiple detected peak months in ascending order', () => {
    const series: WeeklyPoint[] = [];
    for (let year = 2022; year <= 2023; year += 1) {
      for (let month = 1; month <= 12; month += 1) {
        const value = month === 3 || month === 12 ? 100 : 10;
        series.push(
          week(`${year}-${String(month).padStart(2, '0')}-01`, value),
        );
      }
    }

    expect(seasonalityMonths(series).months).toEqual([3, 12]);
  });

  it('skips dates that fail Date parsing', () => {
    // 24 valid months + a garbage-date point (filtered) → still 24 months →
    // enough history; garbage date doesn't grow the byMonth map.
    const series: WeeklyPoint[] = [];
    for (let y = 2022; y <= 2023; y += 1) {
      for (let m = 1; m <= 12; m += 1) {
        series.push(week(`${y}-${String(m).padStart(2, '0')}-01`, 40));
      }
    }
    series.push({ date: 'not-a-date', value: 1_000_000 });
    const result = seasonalityMonths(series);
    // Flat mean; no peak.
    expect(result.months).toEqual([]);
    expect(result.reason).toBeUndefined();
  });
});

describe('single-point and empty edge cases', () => {
  it('single-point series → yoy null, momentum flat/insufficient, seasonality [] insufficient', () => {
    const series = [week('2024-01-01', 42)];
    expect(yearOverYear(series).deltaFraction).toBeNull();
    expect(yearOverYear(series).reason).toBe('insufficient_history');
    const mom = momentum(series);
    expect(mom.direction).toBe('flat');
    expect(mom.slopePerWeek).toBeNull();
    expect(mom.reason).toBe('insufficient_history');
    const seasons = seasonalityMonths(series);
    expect(seasons.months).toEqual([]);
    expect(seasons.reason).toBe('insufficient_history');
  });

  it('empty series → yoy null, momentum flat/insufficient, seasonality [] insufficient', () => {
    const series: WeeklyPoint[] = [];
    expect(yearOverYear(series).reason).toBe('insufficient_history');
    expect(momentum(series).reason).toBe('insufficient_history');
    expect(seasonalityMonths(series).reason).toBe('insufficient_history');
  });
});

describe('estimateEnvelope invariants', () => {
  it('always tags source=estimate + carries the search-interest-index KEY', () => {
    const env = estimateEnvelope();
    expect(env.source).toBe('estimate');
    expect(env.observationMeta.searchInterestIndexKey).toBe(
      SEARCH_INTEREST_INDEX_KEY,
    );
    // The key must be the exact dictionary path — a future refactor that
    // drops the `keywordResearch.trends.coverageNote.*` namespace should
    // break this assertion.
    expect(SEARCH_INTEREST_INDEX_KEY).toBe(
      'keywordResearch.trends.coverageNote.searchInterestIndex',
    );
  });
});
