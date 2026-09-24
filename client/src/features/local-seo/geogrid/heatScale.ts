/**
 * Heat-grid colour buckets.
 *
 * Flat soft tints of the shipped `--chart-*` tokens (SPEC-A2) — never a
 * gradient, never a raw hex. Colour is decoration only: every cell also
 * carries its position numeral, the dash glyph, or the failure icon plus an
 * `sr-only` label, so the state is readable without colour vision.
 */
import type { GeogridCell } from './types';

export type GeogridHeatBucket = 'top' | 'mid' | 'low' | 'notInPack' | 'failed';

export const GEOGRID_BUCKET_CLASS: Record<GeogridHeatBucket, string> = {
  top: 'bg-chart-2/25 border-chart-2/40',
  mid: 'bg-chart-3/25 border-chart-3/40',
  low: 'bg-chart-1/20 border-chart-1/40',
  notInPack: 'bg-muted border-border',
  failed: 'bg-destructive/10 border-destructive/40',
};

export function bucketForCell(cell: GeogridCell): GeogridHeatBucket {
  if (cell.state === 'failed') return 'failed';
  if (cell.state === 'not_in_pack') return 'notInPack';
  if (cell.position <= 3) return 'top';
  if (cell.position <= 7) return 'mid';
  return 'low';
}

/**
 * Grid cells indexed by `pointIndex`, in row-major order. A cell the server
 * has not settled yet is `undefined` — the renderer shows a pending
 * placeholder rather than inventing an outcome.
 */
export function cellsByIndex(
  cells: readonly GeogridCell[],
  totalCells: number,
): Array<GeogridCell | undefined> {
  const byIndex = new Map(cells.map((cell) => [cell.pointIndex, cell]));
  return Array.from({ length: totalCells }, (_, index) => byIndex.get(index));
}

export function formatCoordinate(lat: number, lng: number): string {
  return `${lat}, ${lng}`;
}
