/**
 * Local SEO panel — NAP consistency, review/Q&A health,
 * local-pack rank.
 *
 * data-testid contract:
 *   - local-seo-panel                   root
 *   - local-seo-loading                 loading skeleton
 *   - local-seo-error                   error alert
 *   - local-seo-listings                listings card
 *   - local-seo-listing-row-<source>    one row per directory
 *   - local-seo-reviews                 reviews summary card
 *   - local-seo-local-pack              local-pack card
 *   - local-seo-local-pack-row-<i>      one row per tracked local-pack keyword
 *   - local-seo-empty                   empty state
 *   - local-seo-refresh                 refresh button
 */
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ReportExportControl } from '@features/report-export';
import { CheckCircle2, MapPin, XCircle } from 'lucide-react';
import { RefreshButton } from '@shared/components/RefreshButton';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Badge } from '@shared/ui/badge';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@shared/ui/empty';
import { Skeleton } from '@shared/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { TableHeaderHelp } from '@shared/ui/table-header-help';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { loadLocalSeo, refreshLocalSeo } from '../store/thunks';
import {
  selectLocalSeoCooldownUntil,
  selectLocalSeoError,
  selectLocalSeoIsRefreshing,
  selectLocalSeoLoaded,
  selectLocalSeoLoading,
  selectLocalSeoRefreshError,
  selectLocalSeoSiteId,
  selectLocalSeoSnapshot,
} from '../store/selectors';

interface Props {
  siteId: string;
}

function formatRating(value: number | null): string {
  if (value === null) return '—';
  return value.toFixed(1);
}

function formatPosition(value: number | null, notRankedLabel: string): string {
  if (value === null) return notRankedLabel;
  return `#${value}`;
}

function formatCount(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value);
}

export const LocalSeoPanel = ({ siteId }: Props) => {
  const { t, i18n } = useTranslation('localSeo');
  const dispatch = useAppDispatch();
  const snapshot = useAppSelector(selectLocalSeoSnapshot);
  const loading = useAppSelector(selectLocalSeoLoading);
  const loaded = useAppSelector(selectLocalSeoLoaded);
  const error = useAppSelector(selectLocalSeoError);
  const isRefreshing = useAppSelector(selectLocalSeoIsRefreshing);
  const cooldownUntil = useAppSelector(selectLocalSeoCooldownUntil);
  const refreshError = useAppSelector(selectLocalSeoRefreshError);
  const sliceSiteId = useAppSelector(selectLocalSeoSiteId);
  const sliceSiteIdRef = useRef(sliceSiteId);
  sliceSiteIdRef.current = sliceSiteId;

  useEffect(() => {
    if (sliceSiteIdRef.current === siteId) return;
    const promise = dispatch(loadLocalSeo({ siteId }));
    return () => {
      promise.abort();
    };
  }, [dispatch, siteId]);

  useEffect(() => {
    if (refreshError) toast.error(refreshError);
  }, [refreshError]);

  const listings = snapshot?.listings ?? [];
  const reviews = snapshot?.reviews ?? null;
  const localPack = snapshot?.localPack ?? [];
  const hasAnyData =
    loaded && !loading && (listings.length > 0 || reviews !== null || localPack.length > 0);

  return (
    <div className="flex flex-col gap-6 px-4 py-8" data-testid="local-seo-panel">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <p className="text-muted-foreground text-sm">{t('description')}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <ReportExportControl
            kind="local.seo_snapshot"
            target={{ scope: 'site', siteId }}
            selection={{}}
          />
          <RefreshButton
            onRefresh={() => void dispatch(refreshLocalSeo({ siteId }))}
            isRefreshing={isRefreshing}
            cooldownUntil={cooldownUntil}
            labelKey="localSeo:refresh.button"
            cooldownKey="localSeo:refresh.cooldown"
            data-testid="local-seo-refresh"
          />
        </div>
      </div>

      {error ? (
        <div className="flex flex-col gap-3">
          <Alert variant="destructive" role="alert" data-testid="local-seo-error">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
          <div>
            <Button
              variant="outline"
              data-testid="local-seo-retry"
              onClick={() => void dispatch(loadLocalSeo({ siteId }))}
            >
              {t('common:retry')}
            </Button>
          </div>
        </div>
      ) : null}

      {loading && !loaded ? (
        <div
          className="flex flex-col gap-2"
          aria-busy="true"
          aria-live="polite"
          data-testid="local-seo-loading"
        >
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-2/3" />
        </div>
      ) : null}

      {listings.length > 0 ? (
        <Card data-testid="local-seo-listings">
          <CardHeader>
            <CardTitle className="text-base">{t('listings.title')}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <TableHeaderHelp
                      label={t('listings.source')}
                      description={t('common:tableHelp.reviewSource')}
                    />
                  </TableHead>
                  <TableHead>{t('listings.name')}</TableHead>
                  <TableHead>{t('listings.address')}</TableHead>
                  <TableHead>{t('listings.phone')}</TableHead>
                  <TableHead className="text-end">{t('listings.status')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listings.map((row) => (
                  <TableRow key={row.source} data-testid={`local-seo-listing-row-${row.source}`}>
                    <TableCell className="font-medium">{row.source}</TableCell>
                    <TableCell>{row.name}</TableCell>
                    <TableCell>{row.address ?? '—'}</TableCell>
                    <TableCell>{row.phone ?? '—'}</TableCell>
                    <TableCell className="text-end">
                      {row.consistent ? (
                        <Badge variant="outline" className="bg-success/10 text-success">
                          <CheckCircle2 className="me-1 h-3 w-3" aria-hidden="true" />
                          {t('listings.consistent')}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-destructive/10 text-destructive">
                          <XCircle className="me-1 h-3 w-3" aria-hidden="true" />
                          {t('listings.inconsistent')}
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {reviews !== null ? (
        <Card data-testid="local-seo-reviews">
          <CardHeader>
            <CardTitle className="text-base">{t('reviews.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-muted-foreground text-sm">{t('reviews.averageRating')}</dt>
                <dd className="text-lg font-semibold tabular-nums">
                  {formatRating(reviews.averageRating)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-sm">{t('reviews.reviewCount')}</dt>
                <dd className="text-lg font-semibold tabular-nums">
                  {formatCount(reviews.reviewCount, i18n.language)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-sm">
                  {t('reviews.unansweredQuestions')}
                </dt>
                <dd className="text-lg font-semibold tabular-nums">
                  {formatCount(reviews.unansweredQuestionCount, i18n.language)}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      ) : null}

      {localPack.length > 0 ? (
        <Card data-testid="local-seo-local-pack">
          <CardHeader>
            <CardTitle className="text-base">
              <span className="flex items-center gap-2">
                <MapPin className="h-4 w-4" aria-hidden="true" />
                {t('localPack.title')}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('localPack.keyword')}</TableHead>
                  <TableHead className="text-end">
                    <TableHeaderHelp
                      label={t('localPack.position')}
                      description={t('common:tableHelp.localPackPosition')}
                    />
                  </TableHead>
                  <TableHead className="text-end">
                    <TableHeaderHelp
                      label={t('localPack.packSize')}
                      description={t('common:tableHelp.packSize')}
                    />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {localPack.map((row, i) => (
                  <TableRow
                    key={`${row.keywordId}-${i}`}
                    data-testid={`local-seo-local-pack-row-${i}`}
                  >
                    <TableCell className="font-medium">{row.phrase}</TableCell>
                    <TableCell className="text-end tabular-nums">
                      {formatPosition(row.position, t('localPack.notRanked'))}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      {formatCount(row.totalPackSize, i18n.language)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {!hasAnyData && loaded && !loading && !error ? (
        <Empty data-testid="local-seo-empty">
          <EmptyHeader>
            <EmptyTitle>{t('emptyTitle')}</EmptyTitle>
            <EmptyDescription>{t('empty')}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              variant="outline"
              loading={isRefreshing}
              data-testid="local-seo-empty-refresh"
              onClick={() => void dispatch(refreshLocalSeo({ siteId }))}
            >
              {t('emptyCta')}
            </Button>
          </EmptyContent>
        </Empty>
      ) : null}
    </div>
  );
};
