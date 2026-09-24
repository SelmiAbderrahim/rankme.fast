import { useMemo } from 'react';
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
import type { AppChartHistoryPoint, AppChartSubscription } from '../../charts-types';

export function AppChartHistoryChart({
  subscription,
  points,
}: {
  subscription: AppChartSubscription;
  points: AppChartHistoryPoint[];
}) {
  const { t, i18n } = useTranslation('appSeoCharts');
  const date = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }),
    [i18n.language],
  );
  const width = 680;
  const height = 220;
  const padding = 28;
  const maxPosition = Math.max(2, ...points.flatMap((point) =>
    point.position === null ? [] : [point.position]));
  const coordinates = points.map((point, index) => ({
    point,
    x: points.length <= 1
      ? width / 2
      : padding + (index / (points.length - 1)) * (width - padding * 2),
    y: point.position === null
      ? null
      : padding + ((point.position - 1) / (maxPosition - 1)) * (height - padding * 2),
  }));
  const segments: string[] = [];
  let current = '';
  for (const coordinate of coordinates) {
    if (coordinate.y === null) {
      if (current) segments.push(current);
      current = '';
      continue;
    }
    current += `${current ? ' L' : 'M'} ${coordinate.x} ${coordinate.y}`;
  }
  if (current) segments.push(current);

  if (points.length === 0) {
    return <p className="text-muted-foreground text-sm">{t('history.empty')}</p>;
  }

  return (
    <div className="flex flex-col gap-4" data-testid="app-chart-history">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={t('history.chartLabel', { chart: subscription.chartId })}
        className="border-border bg-background w-full rounded-md border"
      >
        {segments.map((segment) => (
          <path
            key={segment}
            d={segment}
            fill="none"
            className="stroke-highlight"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {coordinates.map(({ point, x, y }) => y === null ? null : (
          <circle key={point.checkedAt} cx={x} cy={y} r="3" className="fill-highlight" />
        ))}
      </svg>
      <Table>
        <TableCaption className="sr-only">{t('history.tableCaption')}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>{t('history.date')}</TableHead>
            <TableHead>{t('history.position')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {points.map((point) => (
            <TableRow key={point.checkedAt}>
              <TableCell>{date.format(new Date(point.checkedAt))}</TableCell>
              <TableCell>
                {point.position === null ? t('history.notInTop100') : point.position}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
