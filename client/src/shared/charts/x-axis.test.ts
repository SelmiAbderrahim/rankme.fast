import { describe, expect, it } from 'vitest';
import { chartXAxisPosition } from './x-axis';

describe('chartXAxisPosition', () => {
  it('places chronological points from inline-start to inline-end in LTR', () => {
    const options = { pointCount: 3, width: 100, padding: 10, rtl: false };
    expect([0, 1, 2].map((index) => chartXAxisPosition(index, options))).toEqual([
      10, 50, 90,
    ]);
  });

  it('mirrors the x-axis in RTL and handles a single point', () => {
    const options = { pointCount: 3, width: 100, padding: 10, rtl: true };
    expect([0, 1, 2].map((index) => chartXAxisPosition(index, options))).toEqual([
      90, 50, 10,
    ]);
    expect(
      chartXAxisPosition(0, { pointCount: 1, width: 100, padding: 10, rtl: true }),
    ).toBe(90);
  });
});
