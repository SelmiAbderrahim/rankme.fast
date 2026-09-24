import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { chartXAxisPosition } from '@shared/charts/x-axis';
import { useI18nDirection } from '@shared/i18n/useDirection';
import type { TrafficHistoryPoint } from '../types';
import { CoverageNote } from './CoverageNote';

interface HistorySparklineProps {
  points: TrafficHistoryPoint[];
}

const WIDTH = 640;
const HEIGHT = 180;
const PADDING = 24;

export const HistorySparkline = ({ points }: HistorySparklineProps) => {
  const { t, i18n } = useTranslation('competitorsTraffic');
  const direction = useI18nDirection(i18n);
  const formatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }),
    [i18n.language],
  );
  const number = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);

  if (points.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('detail.history.empty')}</p>;
  }

  const max = Math.max(1, ...points.map((point) => point.traffic.value));
  const plotted = points.map((point, index) => ({
    point,
    x: chartXAxisPosition(index, {
      pointCount: points.length,
      width: WIDTH,
      padding: PADDING,
      rtl: direction === 'rtl',
    }),
    y:
      HEIGHT -
      PADDING -
      (point.traffic.value / max) * (HEIGHT - PADDING * 2),
  }));
  const linePath = plotted
    .map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`)
    .join(' ');
  const baseline = HEIGHT - PADDING;
  const areaPath = `${linePath} L ${plotted[plotted.length - 1]!.x} ${baseline} L ${plotted[0]!.x} ${baseline} Z`;

  return (
    <div className="flex flex-col gap-2" data-testid="traffic-history-chart">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        aria-hidden="true"
        focusable="false"
        className="w-full rounded-md border bg-background"
        data-rtl={direction === 'rtl' ? 'true' : 'false'}
      >
        <line
          x1={PADDING}
          x2={WIDTH - PADDING}
          y1={baseline}
          y2={baseline}
          className="stroke-border"
          strokeWidth={1}
        />
        <path d={areaPath} className="fill-chart-1/10" stroke="none" />
        <path
          d={linePath}
          className="stroke-chart-1"
          fill="none"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {plotted.map(({ point, x, y }) => (
          <circle key={point.capturedAt} cx={x} cy={y} r={3} className="fill-chart-1" />
        ))}
      </svg>
      <details className="sr-only" data-testid="traffic-history-table-fallback">
        <summary>{t('detail.history.expandTable')}</summary>
        <table>
          <caption>{t('detail.history.tableCaption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('detail.history.date')}</th>
              <th scope="col">{t('detail.rank')}</th>
              <th scope="col">{t('detail.monthlyVisits')}</th>
              <th scope="col">{t('detail.keywords')}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.capturedAt}>
                <td>{formatter.format(new Date(point.capturedAt))}</td>
                <td>
                  {point.rank.value === null
                    ? t('common.notAvailable')
                    : number.format(point.rank.value)}
                  <CoverageNote observation={point.rank.observation} />
                </td>
                <td>
                  {number.format(point.traffic.value)}
                  <CoverageNote observation={point.traffic.observation} />
                </td>
                <td>
                  {number.format(point.keywordCount.value)}
                  <CoverageNote observation={point.keywordCount.observation} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
};
