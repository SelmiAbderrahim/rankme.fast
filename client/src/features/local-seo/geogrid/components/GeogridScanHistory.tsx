/**
 * Stored-scan history. Reopening a stored scan is FREE — no
 * metric, no vendor call — and the selection is URL-backed so a grid is
 * shareable.
 *
 * data-testid contract:
 *   - geogrid-history               list root
 *   - geogrid-history-row-<scanId>  one button per stored scan
 *   - geogrid-history-empty         empty state
 */
import { useTranslation } from 'react-i18next';
import { Button } from '@shared/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@shared/ui/empty';
import { cn } from '@shared/lib/utils';
import type { GeogridScanSummary } from '../types';

interface Props {
  scans: GeogridScanSummary[];
  selectedScanId: string | null;
  onSelect: (scanId: string) => void;
}

export const GeogridScanHistory = ({ scans, selectedScanId, onSelect }: Props) => {
  const { t } = useTranslation('geogrid');
  if (scans.length === 0) {
    return (
      <Empty data-testid="geogrid-history-empty">
        <EmptyHeader>
          <EmptyTitle>{t('history.emptyTitle')}</EmptyTitle>
          <EmptyDescription>{t('history.emptyBody')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <ul data-testid="geogrid-history" className="flex flex-col gap-2">
      {scans.map((scan) => (
        <li key={scan.id}>
          <Button
            type="button"
            variant="outline"
            data-testid={`geogrid-history-row-${scan.id}`}
            aria-pressed={selectedScanId === scan.id}
            onClick={() => onSelect(scan.id)}
            className={cn(
              'h-auto w-full justify-start py-2 text-start',
              selectedScanId === scan.id && 'border-primary',
            )}
          >
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">
                {t('history.row', { keyword: scan.keyword, size: scan.gridSize })}
              </span>
              <span className="text-muted-foreground text-xs">
                {t('history.meta', {
                  status: t(`status.${scan.status}`),
                  createdAt: scan.createdAt,
                })}
              </span>
            </span>
          </Button>
        </li>
      ))}
    </ul>
  );
};
