import { useMemo } from 'react';
import type { TFunction } from 'i18next';
import type { TrendPoint } from '../types';
import { formatPagesDate, formatPagesMetric } from '../formatters';

interface PagesTrendChartProps {
  points: TrendPoint[];
  locale: string;
  t: TFunction<'pages'>;
}

const WIDTH = 640;
const HEIGHT = 176;
const PADDING = 24;

export function PagesTrendChart({ points, locale, t }: PagesTrendChartProps) {
  const plotted = useMemo(
    () => points.filter((point) => point.metrics.averagePosition !== null).slice(-90),
    [points],
  );
  const coordinates = useMemo(() => {
    if (plotted.length === 0) return [];
    const positions = plotted.map((point) => point.metrics.averagePosition as number);
    const minimum = Math.min(...positions);
    const maximum = Math.max(...positions);
    const spread = Math.max(1, maximum - minimum);
    const xSpan = Math.max(1, plotted.length - 1);
    return plotted.map((point, index) => ({
      key: `${point.observedAt}-${index}`,
      x: PADDING + (index * (WIDTH - PADDING * 2)) / xSpan,
      y: PADDING
        + (((point.metrics.averagePosition as number) - minimum) / spread)
          * (HEIGHT - PADDING * 2),
    }));
  }, [plotted]);

  if (plotted.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('detail.trendEmpty')}</p>;
  }

  const path = coordinates
    .map((coordinate, index) => `${index === 0 ? 'M' : 'L'} ${coordinate.x} ${coordinate.y}`)
    .join(' ');

  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="pages-trend">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={t('detail.trendAria', { count: plotted.length })}
        className="w-full rounded-md border border-border bg-background"
        style={{ direction: 'ltr' }}
      >
        <line
          x1={PADDING}
          x2={WIDTH - PADDING}
          y1={HEIGHT - PADDING}
          y2={HEIGHT - PADDING}
          className="stroke-border"
          strokeWidth={1}
        />
        <path
          d={path}
          fill="none"
          className="stroke-chart-1 motion-reduce:transition-none"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {coordinates.map((coordinate) => (
          <circle
            key={coordinate.key}
            cx={coordinate.x}
            cy={coordinate.y}
            r={3}
            className="fill-chart-1"
          />
        ))}
      </svg>
      <table className="sr-only" data-testid="pages-trend-table">
        <caption>{t('detail.trendTableCaption')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('detail.date')}</th>
            <th scope="col">{t('metrics.averagePosition')}</th>
            <th scope="col">{t('metrics.clicks')}</th>
            <th scope="col">{t('metrics.estimatedTraffic')}</th>
          </tr>
        </thead>
        <tbody>
          {plotted.map((point) => (
            <tr key={`${point.observedAt}-${point.source}`}>
              <td>{formatPagesDate(locale, point.observedAt) ?? t('common.notAvailable')}</td>
              <td>{formatPagesMetric(locale, 'averagePosition', point.metrics.averagePosition)}</td>
              <td>{formatPagesMetric(locale, 'clicks', point.metrics.clicks) ?? t('common.notAvailable')}</td>
              <td>
                {formatPagesMetric(locale, 'estimatedTraffic', point.metrics.estimatedTraffic)
                  ?? t('common.notAvailable')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
