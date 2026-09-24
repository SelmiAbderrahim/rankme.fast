/**
 * Geogrid heat grid.
 *
 * A chart, so `design-system.md` applies: flat 1px-bordered cells, soft tints
 * of the `--chart-*` tokens, NO gradients, and a mandatory accessible table
 * fallback rendered alongside (never hover-revealed).
 *
 * Every cell is a real `<button>`: keyboard reachable, focus-visible, and
 * labelled with its state, coordinate, and capture time. RTL flips only the
 * visual column order via the document direction — `pointIndex` is unchanged,
 * so a shared `?cell=` link opens the same cell in every locale.
 *
 * data-testid contract:
 *   - geogrid-heat                    grid root
 *   - geogrid-cell-<pointIndex>       one button per settled or pending cell
 *   - geogrid-legend                  bucket legend
 */
import { useTranslation } from 'react-i18next';
import { TriangleAlert } from 'lucide-react';
import { cn } from '@shared/lib/utils';
import { GEOGRID_BUCKET_CLASS, bucketForCell, cellsByIndex } from '../heatScale';
import type { GeogridCell } from '../types';

interface Props {
  cells: readonly GeogridCell[];
  gridSize: number;
  totalCells: number;
  selectedIndex: number | null;
  onSelect: (pointIndex: number) => void;
}

export const GeogridHeatGrid = ({
  cells,
  gridSize,
  totalCells,
  selectedIndex,
  onSelect,
}: Props) => {
  const { t } = useTranslation('geogrid');
  const slots = cellsByIndex(cells, totalCells);

  const cellLabel = (cell: GeogridCell | undefined, pointIndex: number): string => {
    if (!cell) return t('grid.cellPending', { index: pointIndex + 1 });
    if (cell.state === 'failed') {
      return t('grid.cellFailed', {
        index: pointIndex + 1,
        lat: String(cell.lat),
        lng: String(cell.lng),
      });
    }
    if (cell.state === 'not_in_pack') {
      return t('grid.cellNotInPack', {
        index: pointIndex + 1,
        lat: String(cell.lat),
        lng: String(cell.lng),
        capturedAt: cell.capturedAt,
      });
    }
    return t('grid.cellObserved', {
      index: pointIndex + 1,
      position: cell.position,
      packSize: cell.totalPackSize,
      lat: String(cell.lat),
      lng: String(cell.lng),
      capturedAt: cell.capturedAt,
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div
        data-testid="geogrid-heat"
        role="group"
        aria-label={t('grid.ariaLabel', { size: gridSize })}
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${gridSize}, minmax(0, 1fr))` }}
      >
        {slots.map((cell, pointIndex) => {
          const bucket = cell ? bucketForCell(cell) : null;
          return (
            <button
              key={pointIndex}
              type="button"
              data-testid={`geogrid-cell-${pointIndex}`}
              data-state={cell ? cell.state : 'pending'}
              aria-pressed={selectedIndex === pointIndex}
              onClick={() => onSelect(pointIndex)}
              title={cellLabel(cell, pointIndex)}
              className={cn(
                'flex aspect-square min-h-11 cursor-pointer items-center justify-center border text-sm font-medium',
                'focus-visible:ring-ring transition-colors focus-visible:ring-2 focus-visible:outline-none',
                bucket ? GEOGRID_BUCKET_CLASS[bucket] : 'border-dashed border-border bg-background',
                selectedIndex === pointIndex && 'ring-ring ring-2',
              )}
            >
              <span aria-hidden="true">
                {!cell ? (
                  '·'
                ) : cell.state === 'failed' ? (
                  <TriangleAlert className="text-destructive size-4" />
                ) : cell.state === 'not_in_pack' ? (
                  '—'
                ) : (
                  cell.position
                )}
              </span>
              <span className="sr-only">{cellLabel(cell, pointIndex)}</span>
            </button>
          );
        })}
      </div>
      <ul
        data-testid="geogrid-legend"
        className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs"
      >
        <li>{t('grid.legend.top')}</li>
        <li>{t('grid.legend.mid')}</li>
        <li>{t('grid.legend.low')}</li>
        <li>{t('grid.legend.notInPack')}</li>
        <li>{t('grid.legend.failed')}</li>
      </ul>
    </div>
  );
};
