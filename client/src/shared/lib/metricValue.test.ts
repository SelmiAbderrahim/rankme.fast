import { describe, expect, it } from 'vitest';
import { formatMetricValue, metricHasData } from './metricValue';

describe('metric data and display', () => {
  it.each([null, undefined, NaN, Infinity])('does not invent a value for %s', (value) => {
    expect(metricHasData('count', value)).toBe(false);
    expect(formatMetricValue('decimal', value, 'en')).toBeNull();
  });

  it('preserves real zeros while requiring evidence behind positions and ratios', () => {
    expect(formatMetricValue('count', 0, 'en', { denominator: 0 })).toBe('0');
    expect(formatMetricValue('ratio', 0, 'en', { denominator: 10 })).toBe('0%');
    for (const denominator of [0, null, NaN, -1]) {
      expect(metricHasData('position', 2, { denominator })).toBe(false);
      expect(metricHasData('ratio', 0, { denominator })).toBe(false);
    }
    expect(metricHasData('position', 0)).toBe(false);
    expect(metricHasData('position', -1)).toBe(false);
    expect(formatMetricValue('position', 2.36, 'en')).toBe('2.4');
    expect(formatMetricValue('position', 3, 'en', { denominator: 1 })).toBe('3');
    expect(formatMetricValue('count', 1234, 'de')).toBe('1.234');
    expect(formatMetricValue('decimal', 1.2345, 'en')).toBe('1.23');
  });
});
