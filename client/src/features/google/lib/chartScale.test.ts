import { describe, expect, it } from 'vitest';
import { niceScale, tickIndices } from './chartScale';

describe('chart axes', () => {
  it('keeps a zero baseline and uses whole, readable count steps', () => {
    expect(niceScale(0)).toEqual({ top: 1, ticks: [0, 1] });
    expect(niceScale(7)).toEqual({ top: 8, ticks: [0, 2, 4, 6, 8] });
    expect(niceScale(43)).toEqual({ top: 60, ticks: [0, 20, 40, 60] });
  });

  it('keeps both ends of a long date series', () => {
    expect(tickIndices(0, 6)).toEqual([]);
    expect(tickIndices(3, 6)).toEqual([0, 1, 2]);
    expect(tickIndices(28, 6)).toEqual([0, 5, 11, 16, 22, 27]);
  });
});
