import { describe, expect, it } from 'vitest';
import {
  formatPagesDate,
  formatPagesMetric,
  formatPagesNumber,
  formatPagesPercent,
  formatPagesPosition,
  formatSignedPagesValue,
  rangeDays,
} from './formatters';

describe('Pages locale-aware formatters', () => {
  it('preserves null and formats counts, percentages, positions, and valid dates', () => {
    expect(formatPagesNumber('en', null)).toBeNull();
    expect(formatPagesNumber('en', 1200)).toBe('1,200');
    expect(formatPagesPercent('en', 0.125)).toBe('12.5%');
    expect(formatPagesPosition('en', 7.45)).toBe('7.5');
    expect(formatPagesDate('en', null)).toBeNull();
    expect(formatPagesDate('en', 'not-a-date')).toBeNull();
    expect(formatPagesDate('en', '2026-08-10T12:00:00.000Z')).toMatch(/Aug/);
  });

  it('maps every supported range to its exact day count', () => {
    expect(rangeDays('7d')).toBe(7);
    expect(rangeDays('28d')).toBe(28);
    expect(rangeDays('90d')).toBe(90);
  });

  it('uses the correct formatter for every metric family', () => {
    expect(formatPagesMetric('en', 'ctr', 0.1)).toBe('10%');
    expect(formatPagesMetric('en', 'averagePosition', 3.25)).toBe('3.3');
    expect(formatPagesMetric('en', 'bestPosition', 2)).toBe('2');
    expect(formatPagesMetric('en', 'difficulty', 12.25)).toBe('12.3');
    expect(formatPagesMetric('en', 'clicks', 1000)).toBe('1,000');
    expect(formatPagesMetric('en', 'clicks', null)).toBeNull();
  });

  it('formats signed deltas without turning zero or null into a gain', () => {
    expect(formatSignedPagesValue('en', null)).toBeNull();
    expect(formatSignedPagesValue('en', 0)).toBe('0');
    expect(formatSignedPagesValue('en', 2.4)).toBe('+2.4');
    expect(formatSignedPagesValue('en', -2.4)).toBe('−2.4');
    expect(formatSignedPagesValue('en', 0.25, true)).toBe('+25%');
  });
});
