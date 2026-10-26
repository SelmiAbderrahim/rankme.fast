import { afterEach, describe, expect, it, vi } from 'vitest';
import { stubViewerTimeZone } from '@/test/timeZone';
import { formatDate, formatDay, formatPercent, formatPosition } from './format';

describe('google format helpers', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('keeps a stored snapshot day on July 1 west of UTC', () => {
    stubViewerTimeZone('America/Los_Angeles');
    expect(formatDate('en', '2026-07-01')).toBe('Jul 1, 2026');
    expect(formatDate('de', '2026-07-01')).toBe('01.07.2026');
  });
  it('formats rates, positions and dates in the reader locale', () => {
    expect(formatPercent('en', 0.0217)).toBe('2.2%');
    expect(formatPosition('en', 6.44)).toBe('6.4');
    expect(formatPosition('de', 12.5)).toBe('12,5');
    expect(formatDate('en', '2026-07-04T00:00:00.000Z')).toMatch(/2026/);
    expect(formatDay('en', '2026-07-04')).toMatch(/2026/);
  });

  it('shows a dash instead of a position below the first result', () => {
    expect(formatPosition('en', 0)).toBe('—');
    expect(formatPosition('en', 0.4)).toBe('—');
  });
});
