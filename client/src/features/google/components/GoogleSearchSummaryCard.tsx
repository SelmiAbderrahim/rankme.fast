/**
 * GoogleSearchSummaryCard — the Search Analytics summary on the
 * `?tab=google` surface, shown ONLY when the connection is `connected`.
 * Reads the Postgres snapshot the audit processor wrote (a 404 means "no
 * snapshot for this window yet" — rendered as the empty state). The window is
 * the shared `?range=` param (7/28/90 days, default 28).
 *
 * A Refresh control (populated + empty states) triggers a live re-pull without
 * wiping the current data; the time-series chart and the country/device
 * breakdowns hang off the same summary.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { ReportExportControl } from '@features/report-export';
import { Button } from '@shared/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyTitle } from '@shared/ui/empty';
import { Skeleton } from '@shared/ui/skeleton';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import {
  selectGoogleConnection,
  selectGoogleConnectionSiteId,
  selectGoogleSearchSummary,
  selectGoogleSummaryEmpty,
  selectGoogleSummaryError,
  selectGoogleSummaryLoaded,
  selectGoogleSummaryLoading,
  selectGoogleSummaryRange,
  selectGoogleSummaryRefreshing,
  selectGoogleSummarySiteId,
} from '../store/selectors';
import { loadSearchSummary, refreshSearchSummary } from '../store/thunks';
import { useGoogleSearchView, type GoogleSearchView } from '../lib/searchView';
import { rangeDays, useGoogleRange } from '../lib/range';
import {
  deviceLabelKey,
  formatDate,
  formatInt,
  formatPercent,
  formatPosition,
} from '../lib/format';
import { GscTimeseriesChart } from './GscTimeseriesChart';
import { GscBreakdownList } from './GscBreakdownList';
import { GoogleRangeSelect } from './GoogleRangeSelect';

export interface GoogleSearchSummaryCardProps {
  siteId: string;
}

/**
 * Quiet "View all →" link — sets the `?view=` drill-in subview while
 * preserving `?tab=google` (the hook writes on top of the current search
 * string). One shared component so every section link behaves identically.
 */
const ViewAllLink = ({
  view,
  section,
  label,
}: {
  view: GoogleSearchView;
  section: string;
  label?: string;
}) => {
  const { t } = useTranslation('google');
  const [, setView] = useGoogleSearchView();
  return (
    <Button
      type="button"
      variant="link"
      size="sm"
      className="mt-1 h-auto px-0"
      onClick={() => setView(view)}
      aria-label={t('searchSummary.viewAllLabel', { section })}
      data-testid={`google-summary-view-${view}`}
    >
      {label ?? t('searchSummary.viewAll')}
      <ArrowRight aria-hidden="true" className="rtl:rotate-180" />
    </Button>
  );
};

export const GoogleSearchSummaryCard = ({ siteId }: GoogleSearchSummaryCardProps) => {
  const { t, i18n } = useTranslation('google');
  const locale = i18n.language;
  const dispatch = useAppDispatch();
  const connection = useAppSelector(selectGoogleConnection);
  const connectionSiteId = useAppSelector(selectGoogleConnectionSiteId);
  const summary = useAppSelector(selectGoogleSearchSummary);
  const summarySiteId = useAppSelector(selectGoogleSummarySiteId);
  const summaryRange = useAppSelector(selectGoogleSummaryRange);
  const loading = useAppSelector(selectGoogleSummaryLoading);
  const loaded = useAppSelector(selectGoogleSummaryLoaded);
  const refreshing = useAppSelector(selectGoogleSummaryRefreshing);
  const empty = useAppSelector(selectGoogleSummaryEmpty);
  const error = useAppSelector(selectGoogleSummaryError);
  const [range] = useGoogleRange();
  const days = rangeDays(range);

  const connected =
    connectionSiteId === siteId && connection?.status === 'connected';

  useEffect(() => {
    if (!connected || !siteId) return;
    if (loading) return;
    if (loaded && summarySiteId === siteId && summaryRange === range && !error) {
      return;
    }
    void dispatch(loadSearchSummary({ siteId, range }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refire only on target change
  }, [dispatch, connected, siteId, range]);

  // Transient "Updated just now" after a successful refresh — set when the
  // refresh flag falls from true→false without an error, cleared when the next
  // refresh starts.
  const [justRefreshed, setJustRefreshed] = useState(false);
  const wasRefreshing = useRef(refreshing);
  useEffect(() => {
    const was = wasRefreshing.current;
    wasRefreshing.current = refreshing;
    if (refreshing) {
      setJustRefreshed(false);
    } else if (was && !error) {
      setJustRefreshed(true);
    }
  }, [refreshing, error]);

  if (!connected) return null;

  const showSkeleton = loading || (!loaded && !summary);
  const showHardError = !showSkeleton && Boolean(error) && !summary;
  // Controls (Refresh + status region) belong to the populated and empty
  // states only — never the loading skeleton or the initial hard error.
  const showControls = !showSkeleton && !showHardError;

  const breakdownValueHeader = `${t('searchSummary.clicks')} · ${t('searchSummary.ctr')}`;
  const countryRows = (summary?.countries ?? []).map((row) => ({
    id: row.country,
    label: row.country.toUpperCase(),
    value: row.clicks,
    rate: row.ctr,
  }));
  const deviceRows = (summary?.devices ?? []).map((row) => ({
    id: row.device,
    label: t(`searchSummary.devices.${deviceLabelKey(row.device)}`),
    value: row.clicks,
    rate: row.ctr,
  }));

  return (
    <section
      className="rounded-xl border bg-card p-4 shadow-sm"
      data-testid="google-search-summary-card"
      aria-label={t('searchSummary.title', { days })}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t('searchSummary.title', { days })}</h3>
        <div className="flex items-center gap-2">
          {summary ? (
            <ReportExportControl
              kind="google.gsc_search"
              target={{ scope: 'site', siteId }}
              selection={{ window: range }}
            />
          ) : null}
          {summary ? (
            <span className="text-muted-foreground text-xs">
              {t('searchSummary.asOf', { date: formatDate(locale, summary.asOf) })}
            </span>
          ) : null}
          {showControls ? (
            <>
              <GoogleRangeSelect testId="google-summary-range" />
              <Button
                type="button"
                variant="outline"
                size="sm"
                loading={refreshing}
                loadingLabel={t('searchSummary.refreshing')}
                onClick={() => void dispatch(refreshSearchSummary({ siteId, range }))}
                data-testid="google-summary-refresh"
              >
                <RefreshCw />
                {t('searchSummary.refresh')}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <p
        aria-live="polite"
        className="text-muted-foreground mt-1 text-xs"
        data-testid="google-summary-refreshed"
      >
        {justRefreshed ? t('searchSummary.refreshedJustNow') : null}
      </p>

      {showSkeleton ? (
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-hidden="true">
          <Skeleton className="h-14" data-testid="google-summary-skeleton" />
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : showHardError ? (
        <div className="mt-3" data-testid="google-summary-error" role="alert">
          <p className="text-destructive text-sm">{t('searchSummary.error')}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => void dispatch(loadSearchSummary({ siteId, range }))}
          >
            {t('searchSummary.retry')}
          </Button>
        </div>
      ) : empty || !summary ? (
        <Empty className="mt-3" data-testid="google-summary-empty">
          <EmptyContent>
            <EmptyTitle>{t('searchSummary.emptyTitle')}</EmptyTitle>
            <EmptyDescription>{t('searchSummary.empty')}</EmptyDescription>
            <p className="text-muted-foreground mt-2 text-xs">
              {t('searchSummary.emptyCta')}
            </p>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-lg border p-3" data-testid="google-summary-clicks">
              <dt className="text-muted-foreground text-xs">
                {t('searchSummary.clicks')}
              </dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums" dir="ltr">
                {formatInt(locale, summary.totalClicks)}
              </dd>
            </div>
            <div className="rounded-lg border p-3">
              <dt className="text-muted-foreground text-xs">
                {t('searchSummary.impressions')}
              </dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums" dir="ltr">
                {formatInt(locale, summary.totalImpressions)}
              </dd>
            </div>
            <div className="rounded-lg border p-3">
              <dt className="text-muted-foreground text-xs">
                {t('searchSummary.ctr')}
              </dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums" dir="ltr">
                {formatPercent(locale, summary.averageCtr)}
              </dd>
            </div>
            <div className="rounded-lg border p-3">
              <dt className="text-muted-foreground text-xs">
                {t('searchSummary.position')}
              </dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums" dir="ltr">
                {formatPosition(locale, summary.averagePosition)}
              </dd>
            </div>
          </dl>

          {summary.previousPeriod ? (
            <p
              className="text-muted-foreground mt-2 text-xs"
              data-testid="google-summary-previous"
            >
              {t('searchSummary.previousPeriod', {
                clicks: formatInt(locale, summary.previousPeriod.totalClicks),
                impressions: formatInt(locale, summary.previousPeriod.totalImpressions),
              })}
            </p>
          ) : null}

          {error ? (
            <p
              className="text-destructive mt-3 text-sm"
              role="alert"
              data-testid="google-summary-refresh-error"
            >
              {t('searchSummary.refreshError')}
            </p>
          ) : null}

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {summary.topQueries.length > 0 ? (
              <div>
                <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                  {t('searchSummary.topQueries')}
                </p>
                <ul className="mt-1 space-y-1" data-testid="google-summary-top-queries">
                  {summary.topQueries.map((query) => (
                    <li
                      key={query.query}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <span className="min-w-0 flex-1 truncate" title={query.query}>
                        {query.query}
                      </span>
                      <span className="text-muted-foreground shrink-0 tabular-nums" dir="ltr">
                        {formatInt(locale, query.clicks)} · {formatPercent(locale, query.ctr)}
                      </span>
                    </li>
                  ))}
                </ul>
                <ViewAllLink view="queries" section={t('searchSummary.topQueries')} />
              </div>
            ) : null}
            {summary.topPages.length > 0 ? (
              <div>
                <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                  {t('searchSummary.topPages')}
                </p>
                <ul className="mt-1 space-y-1" data-testid="google-summary-top-pages">
                  {summary.topPages.map((page) => (
                    <li
                      key={page.url}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <span className="min-w-0 flex-1 truncate" title={page.url} dir="ltr">
                        {page.url}
                      </span>
                      <span className="text-muted-foreground shrink-0 tabular-nums" dir="ltr">
                        {formatInt(locale, page.clicks)} · {formatPercent(locale, page.ctr)}
                      </span>
                    </li>
                  ))}
                </ul>
                <ViewAllLink view="pages" section={t('searchSummary.topPages')} />
              </div>
            ) : null}
          </div>

          <div className="mt-4">
            <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
              {t('searchSummary.timeseriesTitle')}
            </p>
            <p className="text-muted-foreground text-xs">
              {t('searchSummary.timeseriesSubtitle', { days })}
            </p>
            <GscTimeseriesChart points={summary.timeseries ?? []} days={days} />
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <GscBreakdownList
                testId="google-summary-countries"
                title={t('searchSummary.countriesTitle')}
                caption={t('searchSummary.countriesTableCaption')}
                keyHeader={t('searchSummary.countryHeader')}
                valueHeader={breakdownValueHeader}
                emptyLabel={t('searchSummary.countriesEmpty')}
                rows={countryRows}
                total={summary.totalClicks}
              />
              <ViewAllLink
                view="countries"
                section={t('searchSummary.countriesTitle')}
              />
            </div>
            <div>
              <GscBreakdownList
                testId="google-summary-devices"
                title={t('searchSummary.devicesTitle')}
                caption={t('searchSummary.devicesTableCaption')}
                keyHeader={t('searchSummary.deviceHeader')}
                valueHeader={breakdownValueHeader}
                emptyLabel={t('searchSummary.devicesEmpty')}
                rows={deviceRows}
                total={summary.totalClicks}
              />
              <ViewAllLink view="devices" section={t('searchSummary.devicesTitle')} />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
            <Link
              to={`/sites/${siteId}?tab=report`}
              className="text-primary inline-block text-sm font-medium underline"
              data-testid="google-summary-report-link"
            >
              {t('searchSummary.reportLink')}
            </Link>
            <ViewAllLink
              view="sitemaps"
              section={t('searchDetail.views.sitemaps')}
              label={t('searchSummary.sitemapsLink')}
            />
          </div>
        </>
      )}
    </section>
  );
};
