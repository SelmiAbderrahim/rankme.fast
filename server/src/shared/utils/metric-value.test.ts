import { describe, expect, it } from 'vitest';
import { metricOrNull, percentOrNull } from './metric-value.js';

describe('metric values without observations', () => {
  it('preserves real zero counts and rejects missing or non-finite values', () => {
    expect(metricOrNull('count', 0)).toBe(0);
    expect(metricOrNull('count', 12)).toBe(12);
    for (const value of [null, undefined, NaN, Infinity, -Infinity]) {
      expect(metricOrNull('count', value)).toBeNull();
    }
  });
  it('requires a positive position and an observed denominator when supplied', () => {
    expect(metricOrNull('position', 3)).toBe(3);
    expect(metricOrNull('position', 0)).toBeNull();
    expect(metricOrNull('position', -1)).toBeNull();
    expect(metricOrNull('position', 3, 10)).toBe(3);
    for (const denominator of [null, 0, -1, NaN, Infinity]) {
      expect(metricOrNull('position', 3, denominator)).toBeNull();
      expect(metricOrNull('ratio', 0, denominator)).toBeNull();
    }
  });
  it('distinguishes zero observed share from no measured share', () => {
    expect(metricOrNull('ratio', 0)).toBe(0);
    expect(percentOrNull(0, 10)).toBe(0);
    expect(percentOrNull(0.25, 4)).toBe(25);
    expect(percentOrNull(0, 0)).toBeNull();
    expect(percentOrNull(0.25, undefined)).toBeNull();
    expect(percentOrNull(null, 4)).toBeNull();
  });
});
