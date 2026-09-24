import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Skeleton } from '@shared/ui/skeleton';
import { REVIEW_SOURCES, type ReviewRequestStatus, type ReviewStats } from '../types';
import { ReviewObservationMeta } from './ReviewObservationMeta';

interface ReviewStatsCardsProps {
  stats: ReviewStats | null;
  status: ReviewRequestStatus;
  error: string;
}

const STARS = [5, 4, 3, 2, 1] as const;

/** Percentage of a whole, or 0 when the denominator is 0 — never NaN. */
export function shareOf(part: number, total: number): number {
  return total === 0 ? 0 : Math.round((part / total) * 100);
}

/**
 * Deterministic stats rendered exactly as the server computed them:
 * a horizontal rating distribution, a monthly-velocity KPI, and the source
 * mix. Nothing is re-derived here beyond the percentage widths.
 */
export const ReviewStatsCards = ({ stats, status, error }: ReviewStatsCardsProps) => {
  const { t, i18n } = useTranslation('reviewIntelligence');
  const number = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);

  if (status === 'loading' && !stats) {
    return (
      <Card aria-busy="true" data-testid="reviews-stats-loading">
        <CardHeader>
          <CardTitle>{t('stats.title')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Alert role="alert" data-testid="reviews-stats-error">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!stats) return null;

  const total = stats.totalReviews;
  const velocity = stats.monthlyVelocity;
  const latest = velocity.at(-1) ?? null;
  const averagePerMonth =
    velocity.length === 0
      ? 0
      : Math.round(
          (velocity.reduce((sum, bucket) => sum + bucket.total, 0) / velocity.length) * 10,
        ) / 10;

  return (
    <div className="flex flex-col gap-3" data-testid="reviews-stats">
      <ReviewObservationMeta observation={stats.observation} />
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
        <CardHeader>
          <CardTitle>{t('stats.distribution.title')}</CardTitle>
          <CardDescription>{t('stats.total', { total: number.format(total) })}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {total === 0 ? (
            <p className="text-muted-foreground text-sm" data-testid="reviews-stats-empty">
              {t('stats.empty')}
            </p>
          ) : (
            <>
              {STARS.map((star) => {
                const count = stats.ratingHistogram[star];
                const share = shareOf(count, total);
                return (
                  <div
                    key={star}
                    className="flex items-center gap-2 text-sm"
                    data-testid={`reviews-histogram-${star}`}
                  >
                    <span className="w-16 shrink-0 text-start">
                      {t('stats.distribution.stars', { stars: star })}
                    </span>
                    <span className="bg-muted h-2 flex-1 rounded-full">
                      <span
                        className="bg-chart-1 block h-2 rounded-full"
                        style={{ width: `${share}%` }}
                        data-share={share}
                      />
                    </span>
                    <span className="w-10 shrink-0 text-end tabular-nums">
                      {number.format(count)}
                    </span>
                  </div>
                );
              })}
              <div className="flex items-center gap-2 text-sm" data-testid="reviews-histogram-unrated">
                <span className="w-16 shrink-0 text-start">{t('stats.distribution.unrated')}</span>
                <span className="w-10 shrink-0 text-end tabular-nums">
                  {number.format(stats.ratingHistogram.unrated)}
                </span>
              </div>
            </>
          )}
        </CardContent>
        </Card>

        <Card>
        <CardHeader>
          <CardTitle>{t('stats.velocity.title')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 text-sm" data-testid="reviews-velocity">
          {latest ? (
            <>
              <span className="text-2xl font-semibold tabular-nums">
                {number.format(latest.total)}
              </span>
              <span className="text-muted-foreground">
                {t('stats.velocity.latest', { month: latest.ymKey })}
              </span>
              <span className="text-muted-foreground">
                {t('stats.velocity.average', { average: number.format(averagePerMonth) })}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">{t('stats.empty')}</span>
          )}
        </CardContent>
        </Card>

        <Card>
        <CardHeader>
          <CardTitle>{t('stats.sourceMix.title')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm" data-testid="reviews-source-mix">
          {REVIEW_SOURCES.map((source) => (
            <div
              key={source}
              className="flex items-center justify-between gap-2"
              data-testid={`reviews-source-mix-${source}`}
            >
              <span>{t(`sourceNames.${source}`)}</span>
              <span className="tabular-nums">
                {number.format(stats.sourceMix[source])} ·{' '}
                {shareOf(stats.sourceMix[source], stats.sourceMix.total)}%
              </span>
            </div>
          ))}
        </CardContent>
        </Card>
      </div>
    </div>
  );
};
