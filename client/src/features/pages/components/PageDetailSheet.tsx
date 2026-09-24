import { ExternalLink, FileSearch, RotateCcw, X } from 'lucide-react';
import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Badge } from '@shared/ui/badge';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@shared/ui/sheet';
import { Skeleton } from '@shared/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@shared/ui/table';
import { SAFE_EXTERNAL_REL, safeExternalHref } from '@shared/security/output-encoding';
import type { PagesCacheEntry, PagesDetailResponse, PagesLoadState } from '../types';
import { formatPagesMetric } from '../formatters';
import { PagesTrendChart } from './PagesTrendChart';

interface PageDetailSheetProps {
  entry: PagesCacheEntry<PagesDetailResponse>;
  loadState: PagesLoadState;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRetry: () => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}

const DETAIL_METRICS = [
  'clicks',
  'impressions',
  'ctr',
  'averagePosition',
  'keywordCount',
  'searchVolume',
  'estimatedTraffic',
] as const;

export function PageDetailSheet({
  entry,
  loadState,
  open,
  onOpenChange,
  onRetry,
  returnFocusRef,
}: PageDetailSheetProps) {
  const { t, i18n } = useTranslation('pages');
  const locale = i18n.language;
  const detail = entry.data;
  const page = detail?.page;
  const isRtl = i18n.dir() === 'rtl';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isRtl ? 'left' : 'right'}
        showCloseButton={false}
        className="w-full min-w-0 max-w-full gap-0 sm:max-w-2xl"
        data-testid="pages-detail-sheet"
        aria-busy={loadState === 'initial_loading' || loadState === 'background_loading'}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusRef.current?.focus();
        }}
      >
        <SheetHeader className="border-b border-border pe-14">
          <SheetTitle className="break-words text-start">
            {page?.title || page?.displayUrl || t('detail.title')}
          </SheetTitle>
          <SheetDescription className="break-all text-start">
            {page?.url ?? t('detail.description')}
          </SheetDescription>
          <SheetClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute end-3 top-3"
              aria-label={t('detail.close')}
            >
              <X aria-hidden="true" />
            </Button>
          </SheetClose>
        </SheetHeader>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
          {loadState === 'initial_loading' ? (
            <div className="flex flex-col gap-4" data-testid="pages-detail-skeleton">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-44 w-full" />
              <Skeleton className="h-52 w-full" />
            </div>
          ) : null}

          {loadState === 'error' && detail === null ? (
            <Alert variant="destructive" role="alert">
              <FileSearch aria-hidden="true" />
              <AlertTitle>{t('detail.errorTitle')}</AlertTitle>
              <AlertDescription className="flex flex-col items-start gap-3">
                <p>{entry.error?.message || t('states.transport.body')}</p>
                <Button type="button" variant="outline" size="sm" onClick={onRetry}>
                  <RotateCcw aria-hidden="true" />
                  {t('actions.retry')}
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}

          {detail && page ? (
            <>
              {loadState === 'background_loading' ? (
                <p className="text-sm text-muted-foreground" role="status">
                  {t('states.backgroundLoading')}
                </p>
              ) : null}

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t('detail.pageContext')}</CardTitle>
                </CardHeader>
                <CardContent className="flex min-w-0 flex-col gap-4">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={page.performanceSource ? 'secondary' : 'outline'}>
                      {page.performanceSource
                        ? t(`sources.${page.performanceSource}.short`)
                        : t('sources.unmeasured')}
                    </Badge>
                    <Badge variant="outline">
                      {page.isIndexable === null
                        ? t('indexability.unknown')
                        : page.isIndexable
                          ? t('indexability.indexable')
                          : t('indexability.nonIndexable')}
                    </Badge>
                  </div>
                  {page.nonIndexableReason ? (
                    <p className="break-words text-sm text-muted-foreground">
                      {t('detail.crawlReason', { reason: page.nonIndexableReason })}
                    </p>
                  ) : null}
                  {/* eslint-disable-next-line react/jsx-no-target-blank -- SAFE_EXTERNAL_REL includes noopener and noreferrer. */}
                  <a
                    href={safeExternalHref(page.url)}
                    target="_blank"
                    rel={SAFE_EXTERNAL_REL}
                    className="inline-flex min-h-11 w-fit max-w-full items-center gap-2 break-all py-2 text-sm font-medium underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ExternalLink aria-hidden="true" className="shrink-0" />
                    <span>{t('actions.openPage')}</span>
                  </a>
                  <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {DETAIL_METRICS.map((metric) => (
                      <div key={metric} className="min-w-0">
                        <dt className="text-xs text-muted-foreground">{t(`metrics.${metric}`)}</dt>
                        <dd className="break-words font-medium" dir="ltr">
                          {formatPagesMetric(locale, metric, page.metrics[metric])
                            ?? t('common.notAvailable')}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t('detail.opportunities')}</CardTitle>
                </CardHeader>
                <CardContent>
                  {page.insights.length > 0 ? (
                    <ul className="flex flex-col gap-3">
                      {page.insights.map((insight) => (
                        <li key={insight} className="flex min-w-0 items-start gap-2">
                          <Badge variant="secondary">{t(`insights.${insight}.label`)}</Badge>
                          <span className="min-w-0 text-sm text-muted-foreground">
                            {t(`insights.${insight}.description`)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">{t('detail.noOpportunities')}</p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    {detail.associated.kind === 'keywords'
                      ? t('detail.keywordsTitle')
                      : t('detail.queriesTitle')}
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {t('detail.associatedCount', {
                      shown: detail.associated.rows.length,
                      total: detail.associated.total,
                    })}
                    {detail.associated.truncated ? ` ${t('detail.truncated')}` : ''}
                  </p>
                </CardHeader>
                <CardContent className="min-w-0">
                  {detail.associated.rows.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t('detail.associatedEmpty')}</p>
                  ) : (
                    <Table>
                      <caption className="sr-only">{t('detail.associatedCaption')}</caption>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('detail.queryOrKeyword')}</TableHead>
                          <TableHead>{t('metrics.averagePosition')}</TableHead>
                          <TableHead>{t('metrics.clicks')}</TableHead>
                          <TableHead>{t('metrics.impressions')}</TableHead>
                          <TableHead>{t('metrics.ctr')}</TableHead>
                          <TableHead>{t('metrics.searchVolume')}</TableHead>
                          <TableHead>{t('metrics.difficulty')}</TableHead>
                          <TableHead>{t('metrics.estimatedTraffic')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detail.associated.rows.map((row, index) => (
                          <TableRow key={`${row.query}-${index}`}>
                            <TableCell className="max-w-64 whitespace-normal break-words">
                              {row.query}
                            </TableCell>
                            <TableCell dir="ltr">
                              {formatPagesMetric(locale, 'averagePosition', row.position)
                                ?? t('common.notAvailable')}
                            </TableCell>
                            <TableCell dir="ltr">
                              {formatPagesMetric(locale, 'clicks', row.clicks)
                                ?? t('common.notAvailable')}
                            </TableCell>
                            <TableCell dir="ltr">
                              {formatPagesMetric(locale, 'impressions', row.impressions)
                                ?? t('common.notAvailable')}
                            </TableCell>
                            <TableCell dir="ltr">
                              {formatPagesMetric(locale, 'ctr', row.ctr)
                                ?? t('common.notAvailable')}
                            </TableCell>
                            <TableCell dir="ltr">
                              {formatPagesMetric(locale, 'searchVolume', row.searchVolume)
                                ?? t('common.notAvailable')}
                            </TableCell>
                            <TableCell dir="ltr">
                              {formatPagesMetric(locale, 'difficulty', row.difficulty)
                                ?? t('common.notAvailable')}
                            </TableCell>
                            <TableCell dir="ltr">
                              {formatPagesMetric(locale, 'estimatedTraffic', row.estimatedTraffic)
                                ?? t('common.notAvailable')}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t('detail.trendTitle')}</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {t('detail.trendDescription', {
                      count: detail.trend.length,
                    })}
                  </p>
                </CardHeader>
                <CardContent>
                  <PagesTrendChart points={detail.trend} locale={locale} t={t} />
                </CardContent>
              </Card>
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
