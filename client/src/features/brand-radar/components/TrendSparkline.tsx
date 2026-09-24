import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { chartXAxisPosition } from '@shared/charts/x-axis';
import { useI18nDirection } from '@shared/i18n/useDirection';
import type { BrandRadarTrendPoint } from '../types';

/**
 * Scan-over-scan mention trend — a single `--highlight` (chart-1) series with
 * a FLAT ≤10 % fill (SPEC-A5, never a gradient) and a table fallback.
 *
 * Rendered only when at least two settled scans exist for the query; the
 * caller owns the honest "first scan" state. Every delta shown comes from the
 * server (`trend.delta`) and is attached to the scan being viewed — a delta is
 * never re-derived here.
 */
const WIDTH = 640;
const HEIGHT = 180;
const PADDING = 24;

export const BRAND_RADAR_TREND_MIN_POINTS = 2;

interface TrendSparklineProps {
  points: BrandRadarTrendPoint[];
}

export const TrendSparkline = ({ points }: TrendSparklineProps) => {
  const { t, i18n } = useTranslation('brandRadar');
  const direction = useI18nDirection(i18n);
  const date = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }),
    [i18n.language],
  );
  const number = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);
  const signed = useMemo(
    () => new Intl.NumberFormat(i18n.language, { signDisplay: 'exceptZero' }),
    [i18n.language],
  );

  const max = Math.max(1, ...points.map((point) => point.mentionCount));
  const plotted = points.map((point, index) => ({
    point,
    x: chartXAxisPosition(index, {
      pointCount: points.length,
      width: WIDTH,
      padding: PADDING,
      rtl: direction === 'rtl',
    }),
    y: HEIGHT - PADDING - (point.mentionCount / max) * (HEIGHT - PADDING * 2),
  }));
  const linePath = plotted
    .map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`)
    .join(' ');
  const baseline = HEIGHT - PADDING;
  const areaPath = `${linePath} L ${plotted[plotted.length - 1]!.x} ${baseline} L ${plotted[0]!.x} ${baseline} Z`;

  return (
    <section className="flex flex-col gap-2" data-testid="brand-radar-trend-chart">
      <h3 className="text-sm font-semibold">{t('detail.trend.title')}</h3>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        aria-hidden="true"
        focusable="false"
        className="bg-background w-full rounded-md border"
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
          <circle key={point.scanId} cx={x} cy={y} r={3} className="fill-chart-1" />
        ))}
      </svg>
      <details data-testid="brand-radar-trend-table">
        <summary className="cursor-pointer text-sm">
          {t('detail.trend.expandTable')}
        </summary>
        <table className="mt-2 w-full text-sm">
          <caption className="text-muted-foreground text-start text-xs">
            {t('detail.trend.tableCaption')}
          </caption>
          <thead>
            <tr>
              <th scope="col" className="text-start">
                {t('detail.trend.capturedAt')}
              </th>
              <th scope="col" className="text-start">
                {t('detail.trend.mentions')}
              </th>
              <th scope="col" className="text-start">
                {t('detail.trend.delta')}
              </th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.scanId} data-testid="brand-radar-trend-row">
                <td>{date.format(new Date(point.capturedAt))}</td>
                <td className="tabular-nums">{number.format(point.mentionCount)}</td>
                <td className="tabular-nums">
                  {/* Only the viewed scan carries a server-computed delta. */}
                  {point.delta === null
                    ? t('detail.trend.deltaUnavailable')
                    : signed.format(point.delta)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
};
