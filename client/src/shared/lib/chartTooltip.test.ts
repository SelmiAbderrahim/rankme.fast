import { describe, expect, it } from 'vitest';
import { tooltipPlacement } from './chartTooltip';

describe('chart tooltip placement', () => {
  it('keeps labels inside both plot edges and below points near the top', () => {
    expect(tooltipPlacement(0, 0, 100)).toEqual({ horizontal: 'start', vertical: 'below', transform: 'translate(-8px, 12px)' });
    expect(tooltipPlacement(50, 60, 100)).toEqual({ horizontal: 'center', vertical: 'above', transform: 'translate(-50%, calc(-100% - 8px))' });
    expect(tooltipPlacement(100, 44, 100)).toEqual({ horizontal: 'end', vertical: 'above', transform: 'translate(calc(-100% + 8px), calc(-100% - 8px))' });
  });
});
