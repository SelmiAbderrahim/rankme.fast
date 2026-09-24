import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { chartXAxisPosition } from '@shared/charts/x-axis';
import { useI18nDirection } from '@shared/i18n/useDirection';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@shared/ui/table';
import { REVIEW_SOURCES, type ReviewSourceName, type ReviewTrendBucket } from '../types';

const WIDTH = 760;
const HEIGHT = 240;
const PADDING = 28;
const MAX_STARS = 5;

/**
 * Series colors from the design-system chart palette: the combined average on
 * `--chart-1`, then one token per source. Declared as a literal map rather
 * than an indexed lookup so a new source cannot silently reuse a color.
 */
const TOTAL_COLOR = 'var(--chart-1)';
const SOURCE_COLORS: Record<ReviewSourceName, string> = {
  google: 'var(--chart-2)',
  trustpilot: 'var(--chart-3)',
  tripadvisor: 'var(--chart-4)',
};

interface ReviewTrendChartProps {
  buckets: ReviewTrendBucket[];
}

interface TrendSeries {
  key: 'total' | ReviewSourceName;
  labelKey: string;
  color: string;
  values: Array<number | null>;
}

/** The one place that knows which bucket field a series reads. */
export function trendValueOf(
  bucket: ReviewTrendBucket,
  key: 'total' | ReviewSourceName,
): number | null {
  return key === 'total' ? bucket.total : bucket.perSource[key];
}

/**
 * Average star rating per calendar month.
 *
 * A `null` bucket is a GAP — a month with no usable rating. It is rendered as
 * a break in the line and a dash in the fallback table, never as zero stars.
 * That is why the polyline is emitted per contiguous segment rather than as
 * one path across the whole span.
 */
export function trendSegments(
  values: ReadonlyArray<number | null>,
  toPoint: (index: number, value: number) => { x: number; y: number },
): Array<Array<{ x: number; y: number }>> {
  const segments: Array<Array<{ x: number; y: number }>> = [];
  let current: Array<{ x: number; y: number }> = [];
  values.forEach((value, index) => {
    if (value === null) {
      if (current.length > 0) segments.push(current);
      current = [];
      return;
    }
    current.push(toPoint(index, value));
  });
  if (current.length > 0) segments.push(current);
  return segments;
}

export const ReviewTrendChart = ({ buckets }: ReviewTrendChartProps) => {
  const { t, i18n } = useTranslation('reviewIntelligence');
  const direction = useI18nDirection(i18n);
  const number = useMemo(
    () => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 }),
    [i18n.language],
  );

  const series: TrendSeries[] = [
    {
      key: 'total',
      labelKey: 'trend.total',
      color: TOTAL_COLOR,
      values: buckets.map((bucket) => bucket.total),
    },
    ...REVIEW_SOURCES.map((source) => ({
      key: source,
      labelKey: `sourceNames.${source}`,
      color: SOURCE_COLORS[source],
      values: buckets.map((bucket) => bucket.perSource[source]),
    })),
  ];

  const toPoint = (index: number, value: number) => ({
    x: chartXAxisPosition(index, {
      pointCount: buckets.length,
      width: WIDTH,
      padding: PADDING,
      rtl: direction === 'rtl',
    }),
    y: HEIGHT - PADDING - (value / MAX_STARS) * (HEIGHT - PADDING * 2),
  });

  return (
    <Card data-testid="reviews-trend">
      <CardHeader>
        <CardTitle>{t('trend.title')}</CardTitle>
        <CardDescription>{t('trend.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {buckets.length === 0 ? (
          <p className="text-muted-foreground text-sm" data-testid="reviews-trend-empty">
            {t('trend.empty')}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-4" aria-hidden="true">
              {series.map((entry) => (
                <span key={entry.key} className="inline-flex items-center gap-2 text-sm">
                  <span
                    className="size-3 rounded-full"
                    style={{ backgroundColor: entry.color }}
                  />
                  {t(entry.labelKey)}
                </span>
              ))}
            </div>
            <svg
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              role="img"
              aria-label={t('trend.chartLabel')}
              className="bg-background w-full rounded-md border"
              data-rtl={direction === 'rtl' ? 'true' : 'false'}
              data-testid="reviews-trend-chart"
            >
              <line
                x1={PADDING}
                x2={WIDTH - PADDING}
                y1={HEIGHT - PADDING}
                y2={HEIGHT - PADDING}
                className="stroke-border"
              />
              {series.map((entry) => (
                <g key={entry.key} data-series={entry.key}>
                  {trendSegments(entry.values, toPoint).map((segment, index) => (
                    <g key={`${entry.key}-${index}`}>
                      {segment.length > 1 ? (
                        <polyline
                          points={segment.map((point) => `${point.x},${point.y}`).join(' ')}
                          fill="none"
                          stroke={entry.color}
                          strokeWidth={2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      ) : null}
                      {segment.map((point) => (
                        <circle
                          key={`${point.x}-${point.y}`}
                          cx={point.x}
                          cy={point.y}
                          r={3}
                          fill={entry.color}
                        />
                      ))}
                    </g>
                  ))}
                </g>
              ))}
            </svg>

            <details data-testid="reviews-trend-table-fallback">
              <summary className="cursor-pointer text-sm font-medium">
                {t('trend.expandTable')}
              </summary>
              <Table className="mt-3">
                <caption className="sr-only">{t('trend.tableCaption')}</caption>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('trend.month')}</TableHead>
                    {series.map((entry) => (
                      <TableHead key={entry.key} className="text-end">
                        {t(entry.labelKey)}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {buckets.map((bucket) => (
                    <TableRow key={bucket.ymKey}>
                      <TableCell>{bucket.ymKey}</TableCell>
                      {series.map((entry) => {
                        const value = trendValueOf(bucket, entry.key);
                        return (
                          <TableCell key={entry.key} className="text-end tabular-nums">
                            {value === null ? t('trend.gap') : number.format(value)}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </details>
          </>
        )}
      </CardContent>
    </Card>
  );
};
