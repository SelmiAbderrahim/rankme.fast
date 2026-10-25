import { describe, expect, it } from 'vitest';
import { attachShares, computeShares, formatShare } from './shares';

describe('breakdown shares', () => {
  it('allocates rounding remainders only when the rows form a complete partition', () => {
    expect(computeShares([1, 1, 1], 3)).toEqual([33.4, 33.3, 33.3]);
    expect(computeShares([1, 1], 3)).toEqual([33.3, 33.3]);
    expect(computeShares([0, 0], 0)).toEqual([null, null]);
    expect(computeShares([1], Number.POSITIVE_INFINITY)).toEqual([null]);
  });

  it('preserves row identity and formats zero-denominator shares honestly', () => {
    expect(attachShares([{ value: 2, id: 'a' }], 2)).toEqual([{ value: 2, id: 'a', share: 100 }]);
    expect(formatShare('en', null)).toBe('—');
    expect(formatShare('en', 12.5)).toBe('12.5%');
  });
});
