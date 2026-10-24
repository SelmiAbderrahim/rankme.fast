import { describe, expect, it } from 'vitest';
import { describePositionChange } from './position-change.js';

const window = { range: '28d', comparison: 'previous_sync' } as const;
describe('position movement', () => {
  it.each([
    [3, 10, -7, 'improved'],
    [10, 3, 7, 'declined'],
    [3, 3, 0, 'unchanged'],
  ])('describes current %i against previous %i', (current, previous, delta, direction) => {
    expect(describePositionChange(current, previous, window)).toEqual({
      currentPosition: current, previousPosition: previous, positionDelta: delta, direction, window,
    });
  });
  it.each([[null, 3], [3, null], [null, null]])('does not invent movement from missing data', (current, previous) => {
    expect(describePositionChange(current, previous, window)).toEqual({
      currentPosition: current, previousPosition: previous, positionDelta: null, direction: null, window,
    });
  });
  it('treats average-position noise as unchanged while retaining its measured delta', () => {
    const result = describePositionChange(9.98, 10, window);
    expect(result.direction).toBe('unchanged');
    expect(result.positionDelta).toBeCloseTo(-0.02);
    expect(describePositionChange(10.05, 10, window).direction).toBe('declined');
  });
});
