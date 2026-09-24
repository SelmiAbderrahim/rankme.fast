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
import type { AppReviewStats } from '../../reviews-types';

export function AppReviewStatsView({ stats }: { stats: AppReviewStats }) {
  const { t, i18n } = useTranslation('appSeoReviews');
  const number = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);
  const maxBucket = Math.max(1, ...stats.histogram.map((bucket) => bucket.count));
  const trendWidth = 680;
  const trendHeight = 180;
  const padding = 24;
  const maxTrendCount = Math.max(1, ...stats.volumeTrend.map((point) => point.count));
  const trendPoints = stats.volumeTrend.map((point, index) => ({
    ...point,
    x: stats.volumeTrend.length <= 1
      ? trendWidth / 2
      : padding + (index / (stats.volumeTrend.length - 1)) * (trendWidth - padding * 2),
    y: trendHeight - padding - (point.count / maxTrendCount) * (trendHeight - padding * 2),
  }));
  const trendPath = trendPoints.map((point, index) =>
    `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');

  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="border-border bg-card rounded-xl border p-4">
          <p className="text-muted-foreground text-sm">{t('stats.total')}</p>
          <p className="text-2xl font-semibold">{number.format(stats.total)}</p>
        </div>
        <div className="border-border bg-card rounded-xl border p-4">
          <p className="text-muted-foreground text-sm">{t('stats.average')}</p>
          <p className="text-2xl font-semibold">
            {stats.averageRating === null ? t('common.notAvailable') : number.format(stats.averageRating)}
          </p>
        </div>
        {(['positive', 'neutral', 'negative'] as const).map((key) => (
          <div key={key} className="border-border bg-card rounded-xl border p-4">
            <p className="text-muted-foreground text-sm">{t(`mix.${key}`)}</p>
            <p className="text-2xl font-semibold">{number.format(stats.ratingMix[key])}</p>
          </div>
        ))}
      </div>

      <section className="flex flex-col gap-4" aria-labelledby="review-histogram-title">
        <h4 id="review-histogram-title" className="font-semibold">{t('histogram.title')}</h4>
        <div
          role="img"
          aria-label={t('histogram.chartLabel')}
          className="border-border bg-background flex flex-col gap-3 rounded-md border p-4"
        >
          {stats.histogram.map((bucket) => (
            <div key={bucket.star} className="grid grid-cols-[4rem_1fr_3rem] items-center gap-3">
              <span className="text-sm">{t('histogram.star', { star: bucket.star })}</span>
              <div className="bg-muted h-3 overflow-hidden rounded-sm">
                <div
                  className="bg-chart-1 h-full"
                  style={{ width: `${(bucket.count / maxBucket) * 100}%` }}
                />
              </div>
              <span className="text-end text-sm tabular-nums">{number.format(bucket.count)}</span>
            </div>
          ))}
        </div>
        <Table>
          <TableCaption className="sr-only">{t('histogram.tableCaption')}</TableCaption>
          <TableHeader><TableRow>
            <TableHead>{t('histogram.rating')}</TableHead>
            <TableHead>{t('histogram.count')}</TableHead>
          </TableRow></TableHeader>
          <TableBody>{stats.histogram.map((bucket) => (
            <TableRow key={bucket.star}>
              <TableCell>{t('histogram.star', { star: bucket.star })}</TableCell>
              <TableCell>{number.format(bucket.count)}</TableCell>
            </TableRow>
          ))}</TableBody>
        </Table>
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="review-trend-title">
        <h4 id="review-trend-title" className="font-semibold">{t('trend.title')}</h4>
        {trendPoints.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('trend.empty')}</p>
        ) : (
          <>
            <svg
              viewBox={`0 0 ${trendWidth} ${trendHeight}`}
              role="img"
              aria-label={t('trend.chartLabel')}
              className="border-border bg-background w-full rounded-md border"
            >
              <path
                d={trendPath}
                fill="none"
                className="stroke-highlight"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {trendPoints.map((point) => (
                <circle key={point.period} cx={point.x} cy={point.y} r="3" className="fill-highlight" />
              ))}
            </svg>
            <Table>
              <TableCaption className="sr-only">{t('trend.tableCaption')}</TableCaption>
              <TableHeader><TableRow>
                <TableHead>{t('trend.period')}</TableHead>
                <TableHead>{t('trend.count')}</TableHead>
                <TableHead>{t('trend.average')}</TableHead>
              </TableRow></TableHeader>
              <TableBody>{stats.volumeTrend.map((point) => (
                <TableRow key={point.period}>
                  <TableCell>{point.period}</TableCell>
                  <TableCell>{number.format(point.count)}</TableCell>
                  <TableCell>{number.format(point.averageRating)}</TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          </>
        )}
      </section>
    </div>
  );
}

