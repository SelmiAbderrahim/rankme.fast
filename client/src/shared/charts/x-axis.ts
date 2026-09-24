export interface ChartXAxisOptions {
  pointCount: number;
  width: number;
  padding: number;
  /** Mirrors logical time order so the newest point sits at inline-end. */
  rtl: boolean;
}

/**
 * Shared logical x-axis primitive for the lightweight SVG charts.
 *
 * Callers always supply points in chronological order. In RTL locales the
 * coordinate is mirrored inside the padded plot area; the source array and
 * accessible table therefore keep their semantic chronological order.
 */
export function chartXAxisPosition(index: number, options: ChartXAxisOptions): number {
  const span = Math.max(1, options.pointCount - 1);
  const logicalIndex = options.rtl ? span - index : index;
  return options.padding + (logicalIndex * (options.width - options.padding * 2)) / span;
}
