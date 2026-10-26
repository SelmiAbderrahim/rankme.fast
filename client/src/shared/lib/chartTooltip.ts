export interface TooltipPlacement {
  horizontal: 'start' | 'center' | 'end';
  vertical: 'above' | 'below';
  transform: string;
}

/** Chart coordinates are physical so edge placement is independent of RTL. */
export function tooltipPlacement(x: number, y: number, width: number): TooltipPlacement {
  const horizontal = x < width * 0.3 ? 'start' : x > width * 0.7 ? 'end' : 'center';
  const vertical = y < 44 ? 'below' : 'above';
  const offsetX = horizontal === 'start' ? '-8px' : horizontal === 'end' ? 'calc(-100% + 8px)' : '-50%';
  const offsetY = vertical === 'above' ? 'calc(-100% - 8px)' : '12px';
  return { horizontal, vertical, transform: `translate(${offsetX}, ${offsetY})` };
}
