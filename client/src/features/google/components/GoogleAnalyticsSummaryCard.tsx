/**
 * GoogleAnalyticsSummaryCard — the GA4 card on the `?tab=google`
 * surface, rendered between the search summary and the connection card and
 * ONLY when the connection is `connected`.
 *
 * State ladder (priority order):
 *   1. enable      — GA4 scope missing on the connection → one linkSocial CTA
 *   2. picker      — scope granted, no `ga4PropertyId` → inline property picker
 *   3. skeleton    — first load in flight
 *   4. hard error  — non-404 failure with nothing to show → retry
 *   5. empty       — 404 with GA4 fully configured (no snapshot yet)
 *   6. populated   — tiles + engagement line + chart + breakdowns
 *
 * data-testid contract:
 *   - google-analytics-summary-card    root
 *   - google-analytics-enable/-enable-cta enable CTA
 *   - google-analytics-picker          inline property picker wrapper
 *   - google-analytics-skeleton        loading tiles
 *   - google-analytics-error/-retry    hard error
 *   - google-analytics-empty           no data yet
 *   - google-analytics-range/-refresh  header controls
 *   - google-analytics-refreshed       "Updated just now" live region
 *   - google-analytics-<metric>        stat tiles; -engagement, -previous
 *   - google-analytics-channels/-pages/-countries/-devices breakdowns
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { ReportExportControl } from '@features/report-export';
import { Button } from '@shared/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyTitle } from '@shared/ui/empty';
import { Skeleton } from '@shared/ui/skeleton';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import {
  selectGoogleAnalytics,
  selectGoogleConnection,
  selectGoogleConnectionSiteId,
} from '../store/selectors';
import { loadAnalyticsSummary, refreshAnalyticsSummary } from '../store/thunks';
import { rangeDays, useGoogleRange } from '../lib/range';
import { GA4_SCOPE, GSC_SCOPE, hasGa4Scope } from '../lib/googleScopes';
import {
  GOOGLE_ERROR_QUERY_KEY,
  GOOGLE_LINKED_QUERY_KEY,
  markerCallbackUrl,
  startGoogleLink,
} from '../lib/googleLink';
import { deviceLabelKey, formatDate, formatInt, formatPercent } from '../lib/format';
import { MetricTimeseriesChart } from './MetricTimeseriesChart';
import { GscBreakdownList, type GscBreakdownRow } from './GscBreakdownList';
import { GoogleRangeSelect } from './GoogleRangeSelect';
import { Ga4PropertySelect } from './Ga4PropertySelect';
import type { GoogleAnalyticsMetrics } from '../types';

export interface GoogleAnalyticsSummaryCardProps {
  siteId: string;
}

/** Per-row engagement rate — engaged sessions / sessions, 0-guarded. */
const rowRate = (row: GoogleAnalyticsMetrics): number =>
  row.sessions > 0 ? row.engagedSessions / row.sessions : 0;

export const GoogleAnalyticsSummaryCard = ({
  siteId,
}: GoogleAnalyticsSummaryCardProps) => {
  const { t, i18n } = useTranslation('google');
  const locale = i18n.language;
  const dispatch = useAppDispatch();
  const connection = useAppSelector(selectGoogleConnection);
  const connectionSiteId = useAppSelector(selectGoogleConnectionSiteId);
  const analytics = useAppSelector(selectGoogleAnalytics);
  const [range] = useGoogleRange();
  const days = rangeDays(range);

  const connected =
    connectionSiteId === siteId && connection?.status === 'connected';
  const scopeGranted = hasGa4Scope(connection);
  const hasProperty = Boolean(connection?.ga4PropertyId);
  const summary = analytics.summary;

  useEffect(() => {
    if (!connected || !siteId) return;
    if (analytics.loading) return;
    if (
      // NOTE: unlike the search card this guard deliberately ignores `error` —
      // `loaded` is a dependency (it flips false after a scope grant /
      // property change to force a refetch), so keying on the error here
      // would fire a duplicate fetch after every failure. Errors retry via
      // the Retry button instead.
      analytics.loaded &&
      analytics.siteId === siteId &&
      analytics.range === range
    ) {
      return;
    }
    void dispatch(loadAnalyticsSummary({ siteId, range }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refire only on target change (loaded flips false after a scope/property change)
  }, [dispatch, connected, siteId, range, analytics.loaded]);

  // Transient "Updated just now" after a successful refresh — set when the
  // refresh flag falls from true→false without an error, cleared when the next
  // refresh starts. Mirrors GoogleSearchSummaryCard.
  const [justRefreshed, setJustRefreshed] = useState(false);
  const wasRefreshing = useRef(analytics.refreshing);
  useEffect(() => {
    const was = wasRefreshing.current;
    wasRefreshing.current = analytics.refreshing;
    if (analytics.refreshing) {
      setJustRefreshed(false);
    } else if (was && !analytics.error) {
      setJustRefreshed(true);
    }
  }, [analytics.refreshing, analytics.error]);

  // The Enable CTA hands off to the Google OAuth link flow; on success the
  // browser navigates away, so `linking` stays true until the redirect.
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const startEnable = async () => {
    setLinking(true);
    setLinkError(null);
    const { error } = await startGoogleLink({
      scopes: [GSC_SCOPE, GA4_SCOPE],
      callbackURL: markerCallbackUrl(GOOGLE_LINKED_QUERY_KEY),
      errorCallbackURL: markerCallbackUrl(GOOGLE_ERROR_QUERY_KEY),
    });
    if (error) {
      setLinking(false);
      setLinkError(t('errors.unavailable'));
    }
  };

  if (!connected) return null;

  const showEnable = !scopeGranted;
  const showPicker = !showEnable && !hasProperty;
  const showConfigured = !showEnable && !showPicker;
  const showSkeleton =
    showConfigured && (analytics.loading || (!analytics.loaded && !summary));
  const showHardError =
    showConfigured && !showSkeleton && Boolean(analytics.error) && !summary;
  // Controls (range + refresh + status region) belong to the populated and
  // empty states only — never the gating states, the skeleton, or the error.
  const showControls = showConfigured && !showSkeleton && !showHardError;

  const channelRows: GscBreakdownRow[] = (summary?.channels ?? []).map((row) => ({
    id: row.channel,
    label: row.channel,
    value: row.sessions,
    rate: rowRate(row),
  }));
  const pageRows: GscBreakdownRow[] = (summary?.topPages ?? []).map((row) => ({
    id: row.url,
    label: row.url,
    value: row.sessions,
    rate: rowRate(row),
  }));
  const countryRows: GscBreakdownRow[] = (summary?.countries ?? []).map((row) => ({
    id: row.country,
    label: row.country,
    value: row.sessions,
    rate: rowRate(row),
  }));
  const deviceRows: GscBreakdownRow[] = (summary?.devices ?? []).map((row) => ({
    id: row.device,
    label: t(`searchSummary.devices.${deviceLabelKey(row.device)}`),
    value: row.sessions,
    rate: rowRate(row),
  }));
  const breakdownValueHeader = `${t('analytics.sessions')} · ${t('analytics.engagementRateLabel')}`;

  return (
    <section
      className="rounded-xl border bg-card p-4 shadow-sm"
      data-testid="google-analytics-summary-card"
      aria-label={t('analytics.title', { days })}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t('analytics.title', { days })}</h3>
        <div className="flex items-center gap-2">
          {summary ? (
            <ReportExportControl
              kind="google.ga4"
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
              <GoogleRangeSelect testId="google-analytics-range" />
              <Button
                type="button"
                variant="outline"
                size="sm"
                loading={analytics.refreshing}
                loadingLabel={t('searchSummary.refreshing')}
                onClick={() =>
                  void dispatch(refreshAnalyticsSummary({ siteId, range }))
                }
                data-testid="google-analytics-refresh"
              >
                <RefreshCw />
                {t('analytics.refresh')}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <p
        aria-live="polite"
        className="text-muted-foreground mt-1 text-xs"
        data-testid="google-analytics-refreshed"
      >
        {justRefreshed ? t('searchSummary.refreshedJustNow') : null}
      </p>

      {showEnable ? (
        <Empty className="mt-3" data-testid="google-analytics-enable">
          <EmptyContent>
            <EmptyTitle>{t('analytics.enableTitle')}</EmptyTitle>
            <EmptyDescription>{t('analytics.enableBody')}</EmptyDescription>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              loading={linking}
              loadingLabel={t('connect.connecting')}
              onClick={() => void startEnable()}
              data-testid="google-analytics-enable-cta"
            >
              {t('analytics.enableCta')}
            </Button>
            {linkError ? (
              <p role="alert" className="text-destructive text-sm">
                {linkError}
              </p>
            ) : null}
          </EmptyContent>
        </Empty>
      ) : showPicker ? (
        <div className="mt-3" data-testid="google-analytics-picker">
          <p className="text-muted-foreground text-sm">
            {t('analytics.pickerHint')}
          </p>
          {connection?.ga4Status &&
          connection.ga4Status !== 'unbound' &&
          connection.ga4Status !== 'bound' ? (
            <p className="text-muted-foreground mt-1 text-xs" role="status">
              {t(`autoMatch.${connection.ga4Status}`)}
            </p>
          ) : null}
          <div className="mt-2">
            <Ga4PropertySelect siteId={siteId} id="ga4-property-card" />
          </div>
        </div>
      ) : showSkeleton ? (
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-hidden="true">
          <Skeleton className="h-14" data-testid="google-analytics-skeleton" />
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : showHardError ? (
        <div className="mt-3" data-testid="google-analytics-error" role="alert">
          <p className="text-destructive text-sm">{t('analytics.error')}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => void dispatch(loadAnalyticsSummary({ siteId, range }))}
            data-testid="google-analytics-retry"
          >
            {t('searchSummary.retry')}
          </Button>
        </div>
      ) : !summary ? (
        <Empty className="mt-3" data-testid="google-analytics-empty">
          <EmptyContent>
            <EmptyTitle>{t('analytics.emptyTitle')}</EmptyTitle>
            <EmptyDescription>{t('analytics.empty')}</EmptyDescription>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-lg border p-3" data-testid="google-analytics-sessions">
              <dt className="text-muted-foreground text-xs">
                {t('analytics.sessions')}
              </dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums" dir="ltr">
                {formatInt(locale, summary.totalSessions)}
              </dd>
            </div>
            <div className="rounded-lg border p-3" data-testid="google-analytics-active-users">
              <dt className="text-muted-foreground text-xs">
                {t('analytics.activeUsers')}
              </dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums" dir="ltr">
                {formatInt(locale, summary.totalActiveUsers)}
              </dd>
            </div>
            <div className="rounded-lg border p-3" data-testid="google-analytics-engaged-sessions">
              <dt className="text-muted-foreground text-xs">
                {t('analytics.engagedSessions')}
              </dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums" dir="ltr">
                {formatInt(locale, summary.totalEngagedSessions)}
              </dd>
            </div>
            <div className="rounded-lg border p-3" data-testid="google-analytics-key-events">
              <dt className="text-muted-foreground text-xs">
                {t('analytics.keyEvents')}
              </dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums" dir="ltr">
                {formatInt(locale, summary.totalKeyEvents)}
              </dd>
            </div>
          </dl>

          <p
            className="text-muted-foreground mt-2 text-xs"
            data-testid="google-analytics-engagement"
          >
            {t('analytics.engagementRateLine', {
              rate: formatPercent(locale, summary.engagementRate),
            })}
          </p>

          {summary.previousPeriod ? (
            <p
              className="text-muted-foreground mt-1 text-xs"
              data-testid="google-analytics-previous"
            >
              {t('analytics.previousPeriod', {
                sessions: formatInt(locale, summary.previousPeriod.totalSessions),
                activeUsers: formatInt(
                  locale,
                  summary.previousPeriod.totalActiveUsers,
                ),
              })}
            </p>
          ) : null}

          {analytics.error ? (
            <p
              className="text-destructive mt-3 text-sm"
              role="alert"
              data-testid="google-analytics-refresh-error"
            >
              {t('analytics.refreshError')}
            </p>
          ) : null}

          <div className="mt-4">
            <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
              {t('analytics.timeseriesTitle')}
            </p>
            <p className="text-muted-foreground text-xs">
              {t('analytics.timeseriesSubtitle', { days })}
            </p>
            <MetricTimeseriesChart
              points={summary.timeseries}
              locale={locale}
              toggles={[
                {
                  id: 'sessions',
                  label: t('analytics.sessions'),
                  value: (p) => p.sessions,
                },
                {
                  id: 'activeUsers',
                  label: t('analytics.activeUsers'),
                  value: (p) => p.activeUsers,
                },
              ]}
              columns={[
                {
                  id: 'sessions',
                  header: t('analytics.sessions'),
                  format: (l, p) => formatInt(l, p.sessions),
                },
                {
                  id: 'activeUsers',
                  header: t('analytics.activeUsers'),
                  format: (l, p) => formatInt(l, p.activeUsers),
                },
                {
                  id: 'engagedSessions',
                  header: t('analytics.engagedSessions'),
                  format: (l, p) => formatInt(l, p.engagedSessions),
                },
                {
                  id: 'keyEvents',
                  header: t('analytics.keyEvents'),
                  format: (l, p) => formatInt(l, p.keyEvents),
                },
              ]}
              chartLabel={(metric) =>
                t('analytics.timeseriesChartLabel', { metric, days })
              }
              metricGroupLabel={t('searchSummary.metricLabel')}
              tableCaption={t('analytics.timeseriesTableCaption', { days })}
              dateHeader={t('searchSummary.tableDate')}
              emptyLabel={t('searchSummary.timeseriesEmpty')}
              testIdPrefix="ga4-timeseries"
            />
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <GscBreakdownList
              testId="google-analytics-channels"
              title={t('analytics.channelsTitle')}
              caption={t('analytics.channelsTableCaption')}
              keyHeader={t('analytics.channelHeader')}
              valueHeader={breakdownValueHeader}
              emptyLabel={t('analytics.channelsEmpty')}
              rows={channelRows}
              total={summary.totalSessions}
            />
            <GscBreakdownList
              testId="google-analytics-pages"
              title={t('analytics.pagesTitle')}
              caption={t('analytics.pagesTableCaption')}
              keyHeader={t('analytics.pageHeader')}
              valueHeader={breakdownValueHeader}
              emptyLabel={t('analytics.pagesEmpty')}
              rows={pageRows}
              total={summary.totalSessions}
            />
            <GscBreakdownList
              testId="google-analytics-countries"
              title={t('analytics.countriesTitle')}
              caption={t('analytics.countriesTableCaption')}
              keyHeader={t('analytics.countryHeader')}
              valueHeader={breakdownValueHeader}
              emptyLabel={t('analytics.countriesEmpty')}
              rows={countryRows}
              total={summary.totalSessions}
            />
            <GscBreakdownList
              testId="google-analytics-devices"
              title={t('analytics.devicesTitle')}
              caption={t('analytics.devicesTableCaption')}
              keyHeader={t('analytics.deviceHeader')}
              valueHeader={breakdownValueHeader}
              emptyLabel={t('analytics.devicesEmpty')}
              rows={deviceRows}
              total={summary.totalSessions}
            />
          </div>
        </>
      )}
    </section>
  );
};
