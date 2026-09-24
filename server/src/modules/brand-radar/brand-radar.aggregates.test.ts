/**
 * Spec 07a-3 — Brand Radar deterministic aggregates.
 *
 * These are the numbers the product reports, so every one of them is proven
 * here without Mongo, without a provider, and without an AI runner: empty row
 * sets, tie-breaking, the ≤50 domain clamp, missing/unrecognized polarity, the
 * sum-to-100 guarantee, and the single-scan trend absence sentinel.
 */
import { describe, expect, it } from 'vitest';
import {
  BRAND_RADAR_SENTIMENT_KEYS,
  BRAND_RADAR_TOP_DOMAINS_LIMIT,
  computeBrandRadarAggregates,
  computeMentionCount,
  computeSentimentDistribution,
  computeTopDomains,
  computeTrendVsPrevious,
  isTrendAbsent,
  type BrandRadarAggregateRow,
} from './brand-radar.aggregates.js';

function row(
  domain: string,
  polarity?: string | null,
): BrandRadarAggregateRow {
  return polarity === undefined ? { domain } : { domain, polarity };
}

describe('computeMentionCount', () => {
  it('is zero for an empty stored row set', () => {
    expect(computeMentionCount([])).toBe(0);
  });

  it('counts every stored row, duplicates included', () => {
    expect(
      computeMentionCount([
        row('a.com', 'positive'),
        row('a.com', 'positive'),
        row('b.com', 'negative'),
      ]),
    ).toBe(3);
  });
});

describe('computeSentimentDistribution', () => {
  it('returns four zero buckets for an empty row set', () => {
    expect(computeSentimentDistribution([])).toEqual({
      positive: 0,
      neutral: 0,
      negative: 0,
      unknown: 0,
    });
  });

  it('reports whole percentages that sum to exactly 100', () => {
    const distribution = computeSentimentDistribution([
      row('a.com', 'positive'),
      row('a.com', 'positive'),
      row('b.com', 'neutral'),
      row('c.com', 'negative'),
    ]);
    expect(distribution).toEqual({
      positive: 50,
      neutral: 25,
      negative: 25,
      unknown: 0,
    });
    const total = BRAND_RADAR_SENTIMENT_KEYS.reduce(
      (sum, key) => sum + distribution[key],
      0,
    );
    expect(total).toBe(100);
  });

  it('apportions a repeating share to 100 within the ±1 tolerance', () => {
    // Three rows → 33.33% each; largest-remainder hands the stray point to the
    // first bucket in key order, so the total is exactly 100, not 99.
    const distribution = computeSentimentDistribution([
      row('a.com', 'positive'),
      row('b.com', 'neutral'),
      row('c.com', 'negative'),
    ]);
    const total = BRAND_RADAR_SENTIMENT_KEYS.reduce(
      (sum, key) => sum + distribution[key],
      0,
    );
    expect(Math.abs(total - 100)).toBeLessThanOrEqual(1);
    expect(total).toBe(100);
    expect(distribution).toEqual({
      positive: 34,
      neutral: 33,
      negative: 33,
      unknown: 0,
    });
  });

  it('needs no residual pass when every share is already whole', () => {
    expect(
      computeSentimentDistribution([row('a.com', 'positive'), row('b.com', 'neutral')]),
    ).toEqual({ positive: 50, neutral: 50, negative: 0, unknown: 0 });
  });

  it('buckets a missing, null, or unrecognized polarity as unknown', () => {
    expect(
      computeSentimentDistribution([
        row('a.com'),
        row('b.com', null),
        row('c.com', 'mixed'),
        row('d.com', 'positive'),
      ]),
    ).toEqual({ positive: 25, neutral: 0, negative: 0, unknown: 75 });
  });
});

describe('computeTopDomains', () => {
  it('is empty for an empty row set', () => {
    expect(computeTopDomains([])).toEqual([]);
  });

  it('sorts by count descending', () => {
    expect(
      computeTopDomains([
        row('rare.com', 'neutral'),
        row('common.com', 'neutral'),
        row('common.com', 'neutral'),
      ]),
    ).toEqual([
      { domain: 'common.com', count: 2 },
      { domain: 'rare.com', count: 1 },
    ]);
  });

  it('breaks a count tie lexicographically on the domain', () => {
    expect(
      computeTopDomains([
        row('zeta.com', 'neutral'),
        row('alpha.com', 'neutral'),
        row('mid.com', 'neutral'),
      ]),
    ).toEqual([
      { domain: 'alpha.com', count: 1 },
      { domain: 'mid.com', count: 1 },
      { domain: 'zeta.com', count: 1 },
    ]);
  });

  it('clamps to fifty domains even when more are stored', () => {
    const rows = Array.from({ length: 80 }, (_, index) =>
      row(`d${String(index).padStart(3, '0')}.com`, 'neutral'),
    );
    const domains = computeTopDomains(rows);
    expect(domains).toHaveLength(BRAND_RADAR_TOP_DOMAINS_LIMIT);
    expect(domains[0]).toEqual({ domain: 'd000.com', count: 1 });
    expect(domains.at(-1)).toEqual({ domain: 'd049.com', count: 1 });
  });

  it('honours a caller limit below the cap and refuses a negative one', () => {
    const rows = [row('a.com', 'neutral'), row('b.com', 'neutral')];
    expect(computeTopDomains(rows, 1)).toEqual([{ domain: 'a.com', count: 1 }]);
    expect(computeTopDomains(rows, -5)).toEqual([]);
    expect(computeTopDomains(rows, 999)).toHaveLength(2);
  });
});

describe('computeTrendVsPrevious', () => {
  it('returns the absence sentinel for the first scan of a series', () => {
    const trend = computeTrendVsPrevious(12, null);
    expect(trend).toEqual({ absent: true });
    expect(isTrendAbsent(trend)).toBe(true);
    // Absence is NOT a zero delta — the sentinel carries no delta at all.
    expect(trend).not.toHaveProperty('delta');
  });

  it('reports an upward delta against a smaller prior scan', () => {
    const trend = computeTrendVsPrevious(10, { mentionCount: 4 });
    expect(trend).toEqual({ delta: 6, direction: 'up' });
    expect(isTrendAbsent(trend)).toBe(false);
  });

  it('reports a downward delta against a larger prior scan', () => {
    expect(computeTrendVsPrevious(4, { mentionCount: 10 })).toEqual({
      delta: -6,
      direction: 'down',
    });
  });

  it('reports flat when the count is unchanged', () => {
    expect(computeTrendVsPrevious(7, { mentionCount: 7 })).toEqual({
      delta: 0,
      direction: 'flat',
    });
  });
});

describe('computeBrandRadarAggregates', () => {
  it('bundles the three row-derived aggregates in one pass', () => {
    expect(
      computeBrandRadarAggregates([
        row('a.com', 'positive'),
        row('a.com', 'negative'),
      ]),
    ).toEqual({
      mentionCount: 2,
      sentimentDistribution: {
        positive: 50,
        neutral: 0,
        negative: 50,
        unknown: 0,
      },
      topDomains: [{ domain: 'a.com', count: 2 }],
    });
  });

  it('is all-zero for a scan that retained nothing', () => {
    expect(computeBrandRadarAggregates([])).toEqual({
      mentionCount: 0,
      sentimentDistribution: {
        positive: 0,
        neutral: 0,
        negative: 0,
        unknown: 0,
      },
      topDomains: [],
    });
  });
});
