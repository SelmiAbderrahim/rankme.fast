/**
 * Accessible data-table fallback for the heat grid (,
 * `design-system.md` chart rule). ALWAYS rendered — never hover-revealed and
 * never behind a toggle, because it is the non-visual reading of the chart.
 *
 * data-testid contract:
 *   - geogrid-cell-table              table root
 *   - geogrid-cell-row-<pointIndex>   one row per settled cell
 */
import { useTranslation } from 'react-i18next';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@shared/ui/table';
import { TableHeaderHelp } from '@shared/ui/table-header-help';
import type { GeogridCell } from '../types';

interface Props {
  cells: readonly GeogridCell[];
}

export const GeogridCellTable = ({ cells }: Props) => {
  const { t } = useTranslation('geogrid');
  return (
    <div className="overflow-x-auto">
      <Table data-testid="geogrid-cell-table">
        <TableCaption>{t('table.caption')}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>
              <TableHeaderHelp
                label={t('table.point')}
                description={t('common:tableHelp.geogridPoint')}
              />
            </TableHead>
            <TableHead>{t('table.latitude')}</TableHead>
            <TableHead>{t('table.longitude')}</TableHead>
            <TableHead className="text-end">
              <TableHeaderHelp
                label={t('table.position')}
                description={t('common:tableHelp.localPackPosition')}
              />
            </TableHead>
            <TableHead className="text-end">
              <TableHeaderHelp
                label={t('table.packSize')}
                description={t('common:tableHelp.packSize')}
              />
            </TableHead>
            <TableHead>{t('table.capturedAt')}</TableHead>
            <TableHead>
              <TableHeaderHelp
                label={t('table.state')}
                description={t('common:tableHelp.geogridState')}
              />
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {cells.map((cell) => (
            <TableRow key={cell.pointIndex} data-testid={`geogrid-cell-row-${cell.pointIndex}`}>
              <TableCell>{cell.pointIndex + 1}</TableCell>
              <TableCell>{cell.lat}</TableCell>
              <TableCell>{cell.lng}</TableCell>
              <TableCell className="text-end">
                {cell.state === 'observed' ? `#${cell.position}` : '—'}
              </TableCell>
              <TableCell className="text-end">
                {cell.state === 'failed' ? '—' : cell.totalPackSize}
              </TableCell>
              <TableCell>{cell.state === 'failed' ? '—' : cell.capturedAt}</TableCell>
              <TableCell>{t(`states.${cell.state}`)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};
