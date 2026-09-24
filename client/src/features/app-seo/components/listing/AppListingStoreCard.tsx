import { ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { safeExternalHref } from '@shared/security';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import type {
  AppListingFinding,
  AppListingNotObservedNote,
  AppListingStoreSnapshot,
} from '../../listing-types';
import type { AppStoreKind } from '../../tracking-types';
import { AppListingFindingBuckets, AppListingNotEvaluated } from './AppListingFindingBuckets';

export function AppListingStoreCard({
  store,
  snapshot,
  findings,
  notes,
}: {
  store: AppStoreKind;
  snapshot: AppListingStoreSnapshot | null;
  findings: AppListingFinding[];
  notes: AppListingNotObservedNote[];
}) {
  const { t, i18n } = useTranslation('appSeoListing');
  const number = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 });
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' });
  const listing = snapshot?.listing ?? null;
  const listingHref = listing?.url ? safeExternalHref(listing.url) : null;
  const screenshotLinks = (listing?.imageUrls ?? [])
    .map((url) => safeExternalHref(url))
    .filter((url) => url !== '#')
    .slice(0, 5);

  return (
    <Card className="min-w-0 shadow-none">
      <CardHeader>
        <CardDescription>{t(`stores.${store}`)}</CardDescription>
        <CardTitle className="break-words">
          {listing?.title ?? t('notObserved.storeTitle')}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6">
        {listing ? (
          <>
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">{t('store.rating')}</dt>
                <dd className="font-medium tabular-nums">
                  {listing.rating === null
                    ? t('common.notObserved')
                    : number.format(listing.rating)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('store.reviews')}</dt>
                <dd className="font-medium tabular-nums">
                  {listing.reviewCount === null
                    ? t('common.notObserved')
                    : number.format(listing.reviewCount)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('store.category')}</dt>
                <dd className="break-words font-medium">
                  {listing.mainCategory ?? t('common.notObserved')}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('store.updated')}</dt>
                <dd className="font-medium">
                  {listing.updatedAt
                    ? date.format(new Date(listing.updatedAt))
                    : t('common.notObserved')}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('store.screenshots')}</dt>
                <dd className="font-medium tabular-nums">
                  {number.format(listing.imageUrls.length)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('store.installs')}</dt>
                <dd className="font-medium tabular-nums">
                  {listing.installs?.raw ?? t('common.notObserved')}
                </dd>
              </div>
            </dl>
            {listing.description ? (
              <div>
                <p className="mb-1 text-sm font-medium">{t('store.description')}</p>
                <p className="line-clamp-3 whitespace-pre-line text-sm text-muted-foreground">
                  {listing.description}
                </p>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-3">
              {listingHref && listingHref !== '#' ? (
                <a
                  className="inline-flex min-h-11 items-center gap-2 text-sm font-medium underline underline-offset-4"
                  href={listingHref}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {t('store.openListing')}
                  <ExternalLink aria-hidden="true" className="size-4" />
                </a>
              ) : null}
              {screenshotLinks.map((href, index) => (
                <a
                  key={href}
                  className="inline-flex min-h-11 items-center text-sm underline underline-offset-4"
                  href={href}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {t('store.screenshotLink', { number: index + 1 })}
                </a>
              ))}
              {listing.imageUrls.length - screenshotLinks.length > 0 ? (
                <span className="inline-flex min-h-11 items-center text-sm text-muted-foreground">
                  {t('store.moreScreenshots', {
                    count: listing.imageUrls.length - screenshotLinks.length,
                  })}
                </span>
              ) : null}
            </div>
          </>
        ) : (
          <Alert>
            <AlertTitle>{t('notObserved.storeTitle')}</AlertTitle>
            <AlertDescription>{t('notObserved.storeFailed')}</AlertDescription>
          </Alert>
        )}

        {notes.length > 0 ? (
          <div className="grid gap-2">
            <p className="font-medium">{t('notObserved.fieldsTitle')}</p>
            <ul className="grid gap-2 text-sm text-muted-foreground">
              {notes.map((note) => (
                <li
                  key={`${note.store}:${note.field}`}
                  className="rounded-lg border border-border p-3"
                >
                  {note.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <section aria-label={t('findings.storeLabel', { store: t(`stores.${store}`) })}>
          <AppListingFindingBuckets findings={findings} />
        </section>
        <AppListingNotEvaluated findings={findings} />
      </CardContent>
    </Card>
  );
}
