import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { chartXAxisPosition } from '@shared/charts/x-axis';
import { useI18nDirection } from '@shared/i18n/useDirection';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { TableHeaderHelp } from '@shared/ui/table-header-help';
import type { TrafficSnapshotSummary } from '../types';

interface TrafficCompareChartProps {
  snapshots: TrafficSnapshotSummary[];
}

const WIDTH = 760;
const HEIGHT = 260;
const PADDING = 28;
const CHART_TOKENS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
] as const;

export const TrafficCompareChart = ({ snapshots }: TrafficCompareChartProps) => {
  const { t, i18n } = useTranslation('competitorsTraffic');
  const direction = useI18nDirection(i18n);
  const date = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }),
    [i18n.language],
  );
  const number = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);
  const dates = useMemo(
    () =>
      [
        ...new Set(
          snapshots.flatMap((snapshot) =>
            snapshot.payload.history.map((point) => point.capturedAt),
          ),
        ),
      ].sort((left, right) => new Date(left).getTime() - new Date(right).getTime()),
    [snapshots],
  );
  const maximum = Math.max(
    1,
    ...snapshots.flatMap((snapshot) =>
      snapshot.payload.history.map((point) => point.traffic.value),
    ),
  );
  const series = snapshots.map((snapshot, snapshotIndex) => {
    const byDate = new Map(
      snapshot.payload.history.map((point) => [point.capturedAt, point.traffic.value]),
    );
    const points = dates.flatMap((capturedAt, dateIndex) => {
      const value = byDate.get(capturedAt);
      if (value === undefined) return [];
      return [
        {
          capturedAt,
          value,
          x: chartXAxisPosition(dateIndex, {
            pointCount: dates.length,
            width: WIDTH,
            padding: PADDING,
            rtl: direction === 'rtl',
          }),
          y: HEIGHT - PADDING - (value / maximum) * (HEIGHT - PADDING * 2),
        },
      ];
    });
    return {
      snapshot,
      color: CHART_TOKENS[snapshotIndex]!,
      points,
      path: points.map(({ x, y }) => `${x},${y}`).join(' '),
    };
  });

  return (
    <div className="flex flex-col gap-4" data-testid="traffic-compare-chart">
      <div className="flex flex-wrap gap-4" aria-hidden="true">
        {series.map(({ snapshot, color }) => (
          <span key={snapshot.id} className="inline-flex items-center gap-2 text-sm">
            <span className="size-3 rounded-full" style={{ backgroundColor: color }} />
            {snapshot.targetDomain}
          </span>
        ))}
      </div>
      {dates.length > 0 ? (
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={t('compare.chartLabel')}
          className="w-full rounded-md border bg-background"
          data-rtl={direction === 'rtl' ? 'true' : 'false'}
        >
          <line
            x1={PADDING}
            x2={WIDTH - PADDING}
            y1={HEIGHT - PADDING}
            y2={HEIGHT - PADDING}
            className="stroke-border"
          />
          {series.map(({ snapshot, color, path, points }) => (
            <g key={snapshot.id}>
              {points.length > 1 ? (
                <polyline
                  points={path}
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  data-series-id={snapshot.id}
                />
              ) : null}
              {points.map((point) => (
                <circle key={point.capturedAt} cx={point.x} cy={point.y} r={3} fill={color} />
              ))}
            </g>
          ))}
        </svg>
      ) : (
        <p className="text-sm text-muted-foreground">{t('compare.historyEmpty')}</p>
      )}

      <details data-testid="traffic-compare-table-fallback">
        <summary className="cursor-pointer text-sm font-medium">{t('compare.expandTable')}</summary>
        <Table className="mt-3">
          <caption className="sr-only">{t('compare.tableCaption')}</caption>
          <TableHeader>
            <TableRow>
              <TableHead>{t('detail.history.date')}</TableHead>
              {snapshots.map((snapshot) => (
                <TableHead key={snapshot.id} className="text-end">
                  <TableHeaderHelp
                    label={`${snapshot.targetDomain} · ${t('estimate.label')}`}
                    description={t('common:tableHelp.estimatedTraffic')}
                  />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {dates.map((capturedAt) => (
              <TableRow key={capturedAt}>
                <TableCell>{date.format(new Date(capturedAt))}</TableCell>
                {snapshots.map((snapshot) => {
                  const point = snapshot.payload.history.find(
                    (candidate) => candidate.capturedAt === capturedAt,
                  );
                  return (
                    <TableCell key={snapshot.id} className="text-end tabular-nums">
                      {point ? number.format(point.traffic.value) : '—'}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </details>
    </div>
  );
};
