import { ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { safeExternalHref } from '@shared/security';
import { Badge } from '@shared/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import type { AppSeoCompareListing, AppSeoComparison } from '../../compare-types';
import { ComparisonDeltaChip } from './ComparisonDeltaChip';

function ListingCard({ listing, storeLabel }: {
  listing: AppSeoCompareListing | null;
  storeLabel: string;
}) {
  const { t, i18n } = useTranslation('appSeoCompare');
  const number = new Intl.NumberFormat(i18n.language);
  return (
    <Card className="gap-4 py-5 shadow-none">
      <CardHeader className="px-5">
        <CardDescription>{storeLabel}</CardDescription>
        <CardTitle className="break-words">
          {listing?.title ?? t('common.notObserved')}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 px-5 sm:grid-cols-2">
        <div>
          <p className="text-muted-foreground text-xs">{t('header.rating')}</p>
          <p className="font-semibold tabular-nums">
            {listing?.rating == null ? t('common.notObserved') : number.format(listing.rating)}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">{t('header.reviews')}</p>
          <p className="font-semibold tabular-nums">
            {listing?.reviewCount == null
              ? t('common.notObserved')
              : number.format(listing.reviewCount)}
          </p>
        </div>
        {listing?.url ? (
          <a
            className="inline-flex min-h-11 items-center gap-2 text-sm font-medium underline underline-offset-4 sm:col-span-2"
            href={safeExternalHref(listing.url)}
            rel="nofollow ugc noopener noreferrer"
            target="_blank"
          >
            {t('header.openListing')}
            <ExternalLink aria-hidden="true" className="size-4" />
          </a>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function AppComparisonHeader({ comparison }: { comparison: AppSeoComparison }) {
  const { t, i18n } = useTranslation('appSeoCompare');
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle role="heading" aria-level={3}>{t('header.title')}</CardTitle>
            <CardDescription>{t('header.description')}</CardDescription>
          </div>
          <Badge variant="outline">{t('common.userPaired')}</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <ListingCard
            listing={comparison.listings.google_play}
            storeLabel={t('stores.googlePlay')}
          />
          <ListingCard
            listing={comparison.listings.app_store}
            storeLabel={t('stores.appStore')}
          />
        </div>
        <div className="flex flex-wrap gap-3" aria-label={t('header.deltaSummary')}>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{t('header.ratingDelta')}</span>
            <ComparisonDeltaChip
              value={comparison.ratingDelta}
              format={(value) => new Intl.NumberFormat(i18n.language, {
                maximumFractionDigits: 2,
              }).format(value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{t('header.reviewDelta')}</span>
            <ComparisonDeltaChip value={comparison.reviewCountDelta} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
