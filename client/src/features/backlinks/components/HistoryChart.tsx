import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { chartXAxisPosition } from '@shared/charts/x-axis';
import { useI18nDirection } from '@shared/i18n/useDirection';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { TableHeaderHelp } from '@shared/ui/table-header-help';
import type { HistoryPoint } from '../types';

export function orderHistory(points: readonly HistoryPoint[]): HistoryPoint[] {
  return [...points]
    .sort((a, b) => (a.year !== b.year ? a.year - b.year : a.month - b.month))
    .slice(-24);
}

export function HistoryChart({ points }: { points: readonly HistoryPoint[] }) {
  const { t, i18n } = useTranslation('backlinks');
  const direction = useI18nDirection(i18n);
  const number = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);
  const ordered = orderHistory(points);
  const width = 640;
  const height = 180;
  const padding = 24;
  const max = Math.max(1, ...ordered.map((point) => point.backlinks));
  const coordinates = ordered.map((point, index) => ({
    point,
    x: chartXAxisPosition(index, {
      pointCount: ordered.length,
      width,
      padding,
      rtl: direction === 'rtl',
    }),
    y: height - padding - (point.backlinks / max) * (height - padding * 2),
  }));
  const line = coordinates
    .map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`)
    .join(' ');
  const baseline = height - padding;
  const firstX = coordinates[0]?.x ?? padding;
  const lastX = coordinates.at(-1)?.x ?? padding;
  const area = `${line} L ${lastX} ${baseline} L ${firstX} ${baseline} Z`;
  const month = (point: HistoryPoint) =>
    new Intl.DateTimeFormat(i18n.language, { month: 'short', year: 'numeric' }).format(
      new Date(Date.UTC(point.year, point.month - 1, 1)),
    );

  return (
    <div
      className="flex flex-col gap-4 motion-reduce:animate-none motion-reduce:transition-none"
      data-testid="link-history-chart"
      data-motion="static"
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={t('intelligence.history.chartLabel')}
        className="border-border bg-background w-full rounded-md border motion-reduce:animate-none motion-reduce:transition-none"
        data-rtl={direction === 'rtl' ? 'true' : 'false'}
      >
        <path
          d={area}
          className="fill-chart-1/10 motion-reduce:animate-none motion-reduce:transition-none"
          stroke="none"
        />
        <path
          d={line}
          fill="none"
          className="stroke-highlight motion-reduce:animate-none motion-reduce:transition-none"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <Table data-testid="link-history-table">
        <caption className="sr-only">{t('intelligence.history.tableCaption')}</caption>
        <TableHeader>
          <TableRow>
            <TableHead>{t('intelligence.columns.month')}</TableHead>
            <TableHead>{t('intelligence.columns.backlinks')}</TableHead>
            <TableHead>
              <TableHeaderHelp
                label={t('intelligence.columns.referringDomains')}
                description={t('common:tableHelp.referringDomains')}
              />
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ordered.map((point) => (
            <TableRow key={`${point.year}-${point.month}`}>
              <TableCell>{month(point)}</TableCell>
              <TableCell>{number.format(point.backlinks)}</TableCell>
              <TableCell>{number.format(point.referringDomains)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
