import { isolateText } from '@shared/lib/bidi';
import { Bdi } from '@shared/components/Bdi';
/**
 * Action-first site overview — the default `?tab=overview` surface.
 *
 * The panel only performs non-spending reads. In particular, competitor data
 * is shown only when it is already cached in Redux after visiting that tab;
 * opening Overview never consumes a competitor lookup.
 */
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Gauge,
  Link2,
  Search,
  ShieldAlert,
  ShieldCheck,
  Target,
  Users,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@shared/ui/card';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@shared/ui/empty';
import { Skeleton } from '@shared/ui/skeleton';
import { StatCard } from '@shared/ui/stat-card';
import { MetricValue } from '@shared/components/MetricValue';
import { PositionDelta } from '@shared/components/PositionDelta';
import { StatusChip } from '@shared/ui/status-chip';
import {
  CodeFixPromptButton,
  type CodeFixPromptInput,
} from '@shared/components/CodeFixPromptButton';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import {
  backlinksReducer,
  loadSummary,
  selectBacklinksSiteId,
  selectError as selectBacklinksError,
  selectLoaded as selectBacklinksLoaded,
  selectLoading as selectBacklinksLoading,
  selectSummary,
} from '@features/backlinks';
import { selectCompetitorsList, selectCompetitorsSiteId } from '@features/competitors';
import {
  DEFAULT_GOOGLE_RANGE,
  GscTotalsNote,
  loadConnection,
  loadSearchSummary,
  selectGoogleConnection,
  selectGoogleConnectionSiteId,
  selectGoogleLoaded,
  selectGoogleLoading,
  selectGoogleSearchSummary,
  selectGoogleSummaryLoading,
  selectGoogleSummaryRange,
  selectGoogleSummarySiteId,
  SiteGoogleNotice,
  useSiteGoogleReadiness,
} from '@features/google';
import {
  loadKeywords,
  selectKeywords,
  selectRanksError,
  selectRanksLoaded,
  selectRanksLoading,
  selectRanksSiteId,
  type Keyword,
} from '@features/ranks';
import {
  loadReport,
  reportReducer,
  selectReport,
  selectReportError,
  selectReportLoaded,
  selectReportLoading,
  selectReportRunAt,
  selectReportRunStatus,
  selectReportSiteId,
  StaleAuditCallout,
  uncountedDecisions,
  worstCoreWebVitalsCategory,
} from '@features/report';
import {
  ACTION_FRESHNESS_TONES,
  ACTION_STATE_TONES,
  actionsReducer,
  loadActions,
  loadAuditDecisions,
  nextActionsRequestSeq,
  openFindingCount,
  resolvedTotals,
  safeInternalHref,
  selectActionsListStatus,
  selectActionsSiteId,
  selectAllSourcesUnavailable,
  selectAnyPartialSource,
  selectAuditDecisionStates,
  selectOverviewActions,
  tallyResolvedAuditFindings,
  type ListActionsFilters,
} from '@features/actions';
import { rootReducer } from '@app/store';
import {
  presentationRequestIdentity,
  usePresentationRefreshSignal,
} from '@shared/i18n';

rootReducer.inject({ reducerPath: 'report', reducer: reportReducer });
rootReducer.inject({ reducerPath: 'backlinks', reducer: backlinksReducer });
rootReducer.inject({ reducerPath: 'actions', reducer: actionsReducer });

// Next actions lists only work still to do: dismissed and marked-fixed items
// belong to the Actions tab history, not the Overview worklist.
const OVERVIEW_ACTION_FILTERS: ListActionsFilters = { state: ['open', 'planned'] };

interface Props {
  siteId: string;
}

const NA = '—';

const keywordState = (keyword: Keyword): 'ranked' | 'failed' | 'not-ranking' | 'awaiting' => {
  if (keyword.latestPosition !== null) return 'ranked';
  if (keyword.lastFailedCheckAt !== null && keyword.lastCheckedAt === null) return 'failed';
  if (keyword.lastCheckedAt !== null) return 'not-ranking';
  return 'awaiting';
};

export const OverviewPanel = ({ siteId }: Props) => {
  const { t, i18n } = useTranslation([
    'sites',
    'report',
    'ranks',
    'backlinks',
    'competitors',
    'common',
    'actions',
  ]);
  const locale = i18n.language;
  const presentation = usePresentationRefreshSignal();
  const dispatch = useAppDispatch();
  const report = useAppSelector(selectReport);
  const reportLoading = useAppSelector(selectReportLoading);
  const reportLoaded = useAppSelector(selectReportLoaded);
  const reportError = useAppSelector(selectReportError);
  const reportSiteId = useAppSelector(selectReportSiteId);
  const reportRunStatus = useAppSelector(selectReportRunStatus);
  const reportRunAt = useAppSelector(selectReportRunAt);

  const keywords = useAppSelector(selectKeywords);
  const ranksLoading = useAppSelector(selectRanksLoading);
  const ranksLoaded = useAppSelector(selectRanksLoaded);
  const ranksError = useAppSelector(selectRanksError);
  const ranksSiteId = useAppSelector(selectRanksSiteId);

  const backlinkSummary = useAppSelector(selectSummary);
  const backlinksLoading = useAppSelector(selectBacklinksLoading);
  const backlinksLoaded = useAppSelector(selectBacklinksLoaded);
  const backlinksError = useAppSelector(selectBacklinksError);
  const backlinksSiteId = useAppSelector(selectBacklinksSiteId);

  const competitorList = useAppSelector(selectCompetitorsList);
  const competitorsSiteId = useAppSelector(selectCompetitorsSiteId);

  const googleConnection = useAppSelector(selectGoogleConnection);
  const googleConnectionSiteId = useAppSelector(selectGoogleConnectionSiteId);
  const googleLoading = useAppSelector(selectGoogleLoading);
  const googleLoaded = useAppSelector(selectGoogleLoaded);
  const siteGoogleReadiness = useSiteGoogleReadiness();
  const searchSummary = useAppSelector(selectGoogleSearchSummary);
  const searchSummarySiteId = useAppSelector(selectGoogleSummarySiteId);
  const searchSummaryRange = useAppSelector(selectGoogleSummaryRange);
  const searchSummaryLoading = useAppSelector(selectGoogleSummaryLoading);

  const overviewActions = useAppSelector(selectOverviewActions);
  const auditDecisions = useAppSelector((state) => selectAuditDecisionStates(state, siteId));
  const actionsStatus = useAppSelector(selectActionsListStatus);
  const actionsSiteId = useAppSelector(selectActionsSiteId);
  const actionsAllUnavailable = useAppSelector(selectAllSourcesUnavailable);
  const actionsAnyPartial = useAppSelector(selectAnyPartialSource);

  useEffect(() => {
    if (!reportLoaded || reportSiteId !== siteId) {
      void dispatch(
        loadReport({
          siteId,
          presentationLocale: presentation.locale,
          presentationGeneration: presentation.generation,
        }),
      );
    }
  }, [
    dispatch,
    presentation.generation,
    presentation.locale,
    presentation.refreshGeneration,
    siteId,
    reportLoaded,
    reportSiteId,
  ]);

  // Overview top five: one unfiltered `GET actions?limit=5`
  // read — a stored-data read that never invokes competitor, AI, audit, or
  // any other paid endpoint. Refs mirror the slice indicators so a pending
  // fulfillment does not re-run the effect and abort its own dispatch.
  const hasReport = Boolean(report);
  const actionsSiteIdRef = useRef(actionsSiteId);
  actionsSiteIdRef.current = actionsSiteId;
  const actionsStatusRef = useRef(actionsStatus);
  actionsStatusRef.current = actionsStatus;
  useEffect(() => {
    if (!hasReport) return;
    if (actionsSiteIdRef.current === siteId && actionsStatusRef.current !== 'idle') {
      return;
    }
    const promise = dispatch(
      loadActions({
        siteId,
        filters: OVERVIEW_ACTION_FILTERS,
        limit: 5,
        requestSeq: nextActionsRequestSeq(),
        presentationLocale: presentation.locale,
        presentationGeneration: presentation.generation,
      }),
    );
    return () => {
      promise.abort();
    };
  }, [
    dispatch,
    siteId,
    hasReport,
    presentation.generation,
    presentation.locale,
    presentation.refreshGeneration,
  ]);

  // Resolved audit decisions (dismissed / marked fixed) so the Fix now and
  // Watch counters only count open work. A stored-data read, refreshed on
  // every visit because decisions are taken on other tabs.
  useEffect(() => {
    if (!hasReport) return;
    const promise = dispatch(loadAuditDecisions({ siteId }));
    return () => {
      promise.abort();
    };
  }, [dispatch, siteId, hasReport]);

  useEffect(() => {
    if (!ranksLoaded || ranksSiteId !== siteId) {
      void dispatch(loadKeywords({ siteId }));
    }
  }, [dispatch, siteId, ranksLoaded, ranksSiteId]);

  useEffect(() => {
    if (!backlinksLoaded || backlinksSiteId !== siteId) {
      void dispatch(loadSummary({ siteId }));
    }
  }, [dispatch, siteId, backlinksLoaded, backlinksSiteId]);

  useEffect(() => {
    if (!googleLoaded || googleConnectionSiteId !== siteId) {
      void dispatch(loadConnection(siteId));
    }
  }, [dispatch, googleConnectionSiteId, googleLoaded, siteId]);

  const siteGoogleConnection =
    googleConnectionSiteId === siteId ? googleConnection : null;
  const googleConnected = siteGoogleConnection?.status === 'connected';
  const searchSummaryRequestedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!googleConnected || searchSummaryRequestedFor.current === siteId) return;
    searchSummaryRequestedFor.current = siteId;
    void dispatch(loadSearchSummary({ siteId, range: DEFAULT_GOOGLE_RANGE }));
  }, [dispatch, googleConnected, siteId]);

  const count = (value: number | null | undefined): string =>
    typeof value === 'number' ? new Intl.NumberFormat(locale).format(value) : NA;
  const decimal = (value: number | null | undefined): string =>
    typeof value === 'number'
      ? new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)
      : NA;
  const date = (value: string): string =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(value));

  const pageSpeedSample =
    report?.pageSpeed?.status === 'ok'
      ? (report.pageSpeed.samples.find((sample) => sample.strategy === 'mobile') ??
        report.pageSpeed.samples[0])
      : undefined;
  // Core Web Vitals come from real-visitor field data across EVERY sampled
  // page, the same reading the `core-web-vitals-poor` finding uses, so the
  // tile never says "no data" while that finding is open.
  const siteCoreWebVitals = worstCoreWebVitalsCategory(
    report?.pageSpeed?.status === 'ok' ? report.pageSpeed.samples : [],
  );
  // Only a measured-then-failed run gets the "service unreachable" copy; no
  // audit yet (or one still running) is a neutral empty state.
  const pageSpeedEmptyCopy = (() => {
    if (report?.pageSpeed?.status === 'unavailable') {
      return {
        title: t('report:pageSpeed.unavailableTitle'),
        description: t('report:pageSpeed.unavailableBody'),
      };
    }
    if (!report && (reportRunStatus === 'queued' || reportRunStatus === 'running')) {
      return {
        title: t('sites:overview.next.inProgressTitle'),
        description: t('report:states.runInProgress'),
      };
    }
    if (!report) {
      return {
        title: t('sites:overview.pageSpeed.noAuditTitle'),
        description: t('sites:overview.pageSpeed.noAuditBody'),
      };
    }
    return {
      title: t('sites:overview.pageSpeed.notMeasuredTitle'),
      description: t('sites:overview.pageSpeed.notMeasuredBody'),
    };
  })();
  const gsc = report?.gscSearch;
  const latestSearchSnapshot = searchSummarySiteId === siteId && searchSummaryRange === DEFAULT_GOOGLE_RANGE
    ? searchSummary : null;
  const searchData = latestSearchSnapshot ? {
    totalClicks: latestSearchSnapshot.totalClicks,
    totalImpressions: latestSearchSnapshot.totalImpressions,
    averageCtr: latestSearchSnapshot.averageCtr,
    averagePosition: latestSearchSnapshot.averagePosition,
    topQuery: latestSearchSnapshot.topQueries[0]?.query ?? null,
    asOf: latestSearchSnapshot.asOf,
  } : gsc?.status === 'ok' ? {
    totalClicks: gsc.totalClicks,
    totalImpressions: gsc.totalImpressions,
    averageCtr: gsc.averageCtr,
    averagePosition: gsc.averagePosition,
    topQuery: gsc.topQueries[0]?.query ?? null,
    asOf: null,
  } : null;
  const searchSnapshotPending = googleConnected && searchSummaryLoading && !searchData;
  // The same decisions the Report tab leaves out of its counts: the ones the
  // server applied to the report, with a decision taken on this page winning.
  const resolvedAudit = tallyResolvedAuditFindings(
    report?.findings ?? [],
    uncountedDecisions(report?.findings ?? [], auditDecisions),
  );
  const resolvedCount = resolvedTotals(resolvedAudit);
  const openFixNow = openFindingCount(report?.counts.fixNow, resolvedAudit.fixNow);
  const cachedCompetitors =
    competitorsSiteId === siteId ? competitorList?.competitors.slice(0, 3) : undefined;

  const primaryAction = (() => {
    if (reportLoading && !reportLoaded) return null;
    if (reportRunStatus === 'queued' || reportRunStatus === 'running') {
      return { label: t('sites:overview.next.viewProgress'), to: '?tab=report' };
    }
    if (!report) {
      return { label: t('report:retest.first'), to: '?tab=report' };
    }
    return {
      label: t('sites:overview.next.openReport'),
      to: '?tab=report&bucket=fix-now',
    };
  })();

  const searchEmptyCopy = (() => {
    if (gsc?.status === 'unavailable') {
      return {
        title: t('report:gscBlock.unavailableTitle'),
        description: t('report:gscBlock.unavailableBody'),
      };
    }
    if (
      gsc?.status === 'needs-reconnect' ||
      siteGoogleConnection?.status === 'needs_reconnect' ||
      siteGoogleConnection?.status === 'revoked'
    ) {
      return {
        title: t('report:gscBlock.reconnectTitle'),
        description: t('report:gscBlock.reconnectBody'),
      };
    }
    if (gsc?.status === 'no-data' || siteGoogleConnection?.status === 'connected') {
      return {
        title: t('report:gscBlock.noDataTitle'),
        description: t('report:gscBlock.noDataBody'),
      };
    }
    return {
      title: t('report:gscBlock.notConnectedTitle'),
      description: t('report:gscBlock.notConnectedBody'),
    };
  })();

  return (
    <div className="flex flex-col gap-8" data-testid="overview-panel">
      {/* The audit is older than the freshness window: offer the existing
          retest flow (the confirmation lives on the Report tab). */}
      {report ? (
        <StaleAuditCallout
          runAt={reportRunAt}
          running={reportRunStatus === 'queued' || reportRunStatus === 'running'}
          freshDays={report.auditFreshDays}
          to="?tab=report&retest=1"
        />
      ) : null}
      <Card data-testid="overview-next-actions">
        <CardHeader>
          <CardTitle>
            <h2 className="text-lg">{t('sites:overview.next.title')}</h2>
          </CardTitle>
          <CardDescription>{t('sites:overview.next.description')}</CardDescription>
          {primaryAction ? (
            <CardAction>
              <Button asChild data-testid="overview-primary-action">
                <Link to={primaryAction.to}>
                  <Bdi>{primaryAction.label}</Bdi>
                  <ArrowRight aria-hidden="true" className="rtl:rotate-180" />
                </Link>
              </Button>
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {reportLoading && !reportLoaded ? (
            <div className="space-y-4" aria-busy="true">
              <div className="grid gap-3 sm:grid-cols-3">
                {Array.from({ length: 3 }, (_, index) => (
                  <Skeleton key={index} className="h-24" />
                ))}
              </div>
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </div>
          ) : reportError && !report ? (
            <Alert variant="destructive">
              <AlertCircle aria-hidden="true" />
              <AlertTitle>{t('report:loadFailed')}</AlertTitle>
              <AlertDescription>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void dispatch(loadReport({ siteId, ...presentationRequestIdentity() }))
                  }
                >
                  {t('common:retry')}
                </Button>
              </AlertDescription>
            </Alert>
          ) : report ? (
            <>
              <div className="grid gap-3 sm:grid-cols-3" data-testid="overview-audit-counts">
                {/* Red only when something needs fixing: a zero count is the good
                    outcome (success); an unreadable count stays neutral. */}
                <StatCard
                  variant="chip"
                  tone={
                    (openFixNow ?? 0) > 0
                      ? 'destructive'
                      : openFixNow === 0
                        ? 'success'
                        : 'muted'
                  }
                  icon={(openFixNow ?? 0) > 0 ? ShieldAlert : ShieldCheck}
                  label={t('report:tabs.fix-now')}
                  value={count(openFixNow)}
                  data-testid="overview-count-fix-now"
                />
                <StatCard
                  variant="chip"
                  tone="warning"
                  icon={Clock3}
                  label={t('report:tabs.watch')}
                  value={count(openFindingCount(report.counts.watch, resolvedAudit.watch))}
                />
                <StatCard
                  variant="chip"
                  tone="success"
                  icon={CheckCircle2}
                  label={t('report:tabs.passed')}
                  value={count(report.counts.passed)}
                />
              </div>
              {resolvedCount.dismissed + resolvedCount.completed > 0 ? (
                <p className="text-sm text-muted-foreground" data-testid="overview-audit-not-counted">
                  {t('actions:report.notCounted', {
                    dismissed: count(resolvedCount.dismissed),
                    completed: count(resolvedCount.completed),
                  })}
                </p>
              ) : null}
              {actionsStatus === 'loading' || actionsStatus === 'idle' ? (
                <div className="space-y-3" aria-busy="true" data-testid="overview-actions-loading">
                  <Skeleton className="h-16" />
                  <Skeleton className="h-16" />
                </div>
              ) : actionsStatus === 'error' ? (
                <Alert variant="destructive" data-testid="overview-actions-error">
                  <AlertCircle aria-hidden="true" />
                  <AlertTitle>{t('actions:overview.error')}</AlertTitle>
                  <AlertDescription>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void dispatch(
                          loadActions({
                            siteId,
                            filters: OVERVIEW_ACTION_FILTERS,
                            limit: 5,
                            requestSeq: nextActionsRequestSeq(),
                            ...presentationRequestIdentity(),
                          }),
                        )
                      }
                    >
                      {t('common:retry')}
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : overviewActions.length > 0 ? (
                <>
                  {actionsAnyPartial ? (
                    <Alert role="status" data-testid="overview-actions-degraded">
                      <AlertCircle aria-hidden="true" />
                      <AlertDescription>{t('actions:overview.degraded')}</AlertDescription>
                    </Alert>
                  ) : null}
                  <ol className="divide-y rounded-xl border" data-testid="overview-actions-list">
                    {overviewActions.map((item) => {
                      const internalHref = safeInternalHref(item.sourceLink);
                      const freshness = item.evidence[0]?.observation.freshness;
                      const codeFixPrompt: CodeFixPromptInput | null = item.codeFixPrompt
                        ? {
                            reference: item.codeFixPrompt.reference,
                            severity: item.severity,
                            confidence: item.confidence,
                            problem: item.problem,
                            whyItMatters: item.whyItMatters,
                            recommendedFix: item.codeFixPrompt.recommendedFix,
                            affectedUrls: item.affectedUrls,
                            affectedUrlCount: item.codeFixPrompt.affectedUrlCount,
                          }
                        : null;
                      return (
                        <li
                          key={item.id}
                          className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between"
                          data-testid="overview-action-item"
                        >
                          <div className="min-w-0 space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <StatusChip tone={ACTION_STATE_TONES[item.state]} dot>
                                {t(`actions:state.${item.state}`)}
                              </StatusChip>
                              <StatusChip tone="muted">
                                {t(`actions:source.${item.sourceType}`)}
                              </StatusChip>
                              {freshness ? (
                                <StatusChip tone={ACTION_FRESHNESS_TONES[freshness]}>
                                  {t(`actions:freshness.${freshness}`)}
                                </StatusChip>
                              ) : null}
                            </div>
                            <h3 className="font-medium text-foreground">{item.problem}</h3>
                          </div>
                          {codeFixPrompt || internalHref ? (
                            <div className="flex shrink-0 flex-wrap items-center gap-2">
                              {codeFixPrompt ? <CodeFixPromptButton input={codeFixPrompt} /> : null}
                              {internalHref ? (
                                <Button asChild variant="link" size="sm" className="self-start px-0">
                                  <Link to={internalHref} data-testid="overview-action-link">
                                    {t('actions:overview.open')}
                                    <ArrowRight aria-hidden="true" className="rtl:rotate-180" />
                                  </Link>
                                </Button>
                              ) : null}
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ol>
                  <Button asChild variant="link" size="sm" className="self-start px-0">
                    <Link to="?tab=actions" data-testid="overview-actions-view-all">
                      {t('actions:overview.viewAll')}
                      <ArrowRight aria-hidden="true" className="rtl:rotate-180" />
                    </Link>
                  </Button>
                </>
              ) : actionsAllUnavailable || actionsAnyPartial ? (
                <Empty className="border py-8" data-testid="overview-actions-unavailable">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <AlertCircle aria-hidden="true" />
                    </EmptyMedia>
                    <EmptyTitle>{t('actions:sources.unavailableTitle')}</EmptyTitle>
                    <EmptyDescription>{t('actions:sources.unavailableBody')}</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <Empty className="border py-8">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <CheckCircle2 aria-hidden="true" />
                    </EmptyMedia>
                    <EmptyTitle>{t('sites:overview.next.clearTitle')}</EmptyTitle>
                    <EmptyDescription>{t('sites:overview.next.clearDescription')}</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </>
          ) : reportRunStatus === 'queued' || reportRunStatus === 'running' ? (
            <Empty className="border py-8">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Clock3 aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>{t('sites:overview.next.inProgressTitle')}</EmptyTitle>
                <EmptyDescription>{t('report:states.runInProgress')}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Empty className="border py-8">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Target aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>{t('report:noRun.title')}</EmptyTitle>
                <EmptyDescription>{t('report:noRun.description')}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>

      <section aria-labelledby="overview-search-experience-title" className="space-y-4">
        <div>
          <h2 id="overview-search-experience-title" className="text-lg font-semibold">
            {t('sites:overview.sections.searchExperienceTitle')}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t('sites:overview.sections.searchExperienceDescription')}
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card data-testid="overview-search">
            <CardHeader>
              <CardTitle>
                <h3>{t('sites:overview.search.title')}</h3>
              </CardTitle>
              <CardDescription>{t('sites:overview.search.description')}</CardDescription>
            </CardHeader>
            <CardContent>
              {(reportLoading && !reportLoaded) || googleLoading || searchSnapshotPending ? (
                <div className="grid grid-cols-2 gap-3" aria-busy="true">
                  {Array.from({ length: 4 }, (_, index) => (
                    <Skeleton key={index} className="h-24" />
                  ))}
                </div>
              ) : searchData ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <StatCard
                      variant="kpi"
                      label={t('report:gscBlock.totalClicks')}
                      value={count(searchData.totalClicks)}
                    />
                    <StatCard
                      variant="kpi"
                      label={t('report:gscBlock.totalImpressions')}
                      value={count(searchData.totalImpressions)}
                    />
                    <StatCard
                      variant="kpi"
                      label={t('report:gscBlock.averageCtr')}
                      // No impressions means no CTR or position, not 0.
                      value={
                        <MetricValue
                          kind="ratio"
                          value={searchData.averageCtr}
                          denominator={searchData.totalImpressions}
                        />
                      }
                    />
                    <StatCard
                      variant="kpi"
                      label={t('report:gscBlock.averagePosition')}
                      value={
                        <MetricValue
                          kind="position"
                          value={searchData.averagePosition}
                          denominator={searchData.totalImpressions}
                        />
                      }
                    />
                  </div>
                  {searchData.asOf ? <p className="text-muted-foreground text-xs">{t('sites:overview.search.asOf', { date: date(searchData.asOf) })}</p> : null}
                  <GscTotalsNote testId="overview-scope-note" />
                  {searchData.topQuery ? (
                    <div className="rounded-xl border p-4">
                      <p className="text-xs text-muted-foreground">
                        {t('sites:overview.search.topQuery')}
                      </p>
                      <p className="mt-1 truncate font-medium" title={isolateText(searchData.topQuery)}>
                        <Bdi>{searchData.topQuery}</Bdi>
                      </p>
                    </div>
                  ) : null}
                  <Button asChild variant="link" className="h-auto px-0">
                    <Link to="?tab=google">
                      {t('sites:overview.search.openGoogle')}
                      <ArrowRight aria-hidden="true" className="rtl:rotate-180" />
                    </Link>
                  </Button>
                </div>
              ) : siteGoogleReadiness?.readiness?.gsc.status !== undefined &&
                siteGoogleReadiness.readiness.gsc.status !== 'ok' ? (
                <SiteGoogleNotice product="gsc" />
              ) : (
                <Empty className="border py-8">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Search aria-hidden="true" />
                    </EmptyMedia>
                    <EmptyTitle><Bdi>{searchEmptyCopy.title}</Bdi></EmptyTitle>
                    <EmptyDescription><Bdi>{searchEmptyCopy.description}</Bdi></EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <Button asChild variant="outline" size="sm">
                      <Link to="?tab=google">{t('sites:overview.search.openGoogle')}</Link>
                    </Button>
                  </EmptyContent>
                </Empty>
              )}
            </CardContent>
          </Card>

          <Card data-testid="overview-pagespeed">
            <CardHeader>
              <CardTitle>
                <h3>{t('sites:overview.pageSpeed.title')}</h3>
              </CardTitle>
              <CardDescription>{t('sites:overview.pageSpeed.description')}</CardDescription>
            </CardHeader>
            <CardContent>
              {reportLoading && !reportLoaded ? (
                <div className="grid grid-cols-2 gap-3" aria-busy="true">
                  {Array.from({ length: 4 }, (_, index) => (
                    <Skeleton key={index} className="h-24" />
                  ))}
                </div>
              ) : pageSpeedSample ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <StatCard
                      variant="kpi"
                      label={t('report:pageSpeed.metrics.performance')}
                      value={count(pageSpeedSample.labScores.performance)}
                    />
                    <StatCard
                      variant="kpi"
                      label={t('sites:overview.pageSpeed.accessibility')}
                      value={count(pageSpeedSample.labScores.accessibility)}
                    />
                    <StatCard
                      variant="kpi"
                      label={t('sites:overview.pageSpeed.seo')}
                      value={count(pageSpeedSample.labScores.seo)}
                    />
                    <div className="rounded-xl border p-4">
                      <p className="text-sm text-muted-foreground">
                        {t('sites:overview.pageSpeed.coreWebVitals')}
                      </p>
                      <div className="mt-3">
                        {siteCoreWebVitals ? (
                          <StatusChip
                            tone={
                              siteCoreWebVitals === 'good'
                                ? 'success'
                                : siteCoreWebVitals === 'needs-improvement'
                                  ? 'warning'
                                  : 'destructive'
                            }
                            dot
                          >
                            {t(`report:pageSpeed.categories.${siteCoreWebVitals}`)}
                          </StatusChip>
                        ) : (
                          <StatusChip tone="muted">{t('ranks:aiUnknown')}</StatusChip>
                        )}
                      </div>
                      <p
                        className="mt-2 text-xs text-muted-foreground"
                        data-testid="overview-pagespeed-cwv-source"
                      >
                        {siteCoreWebVitals
                          ? t('sites:overview.pageSpeed.coreWebVitalsSource')
                          : t('sites:overview.pageSpeed.coreWebVitalsNoFieldData')}
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <Empty className="border py-8">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Gauge aria-hidden="true" />
                    </EmptyMedia>
                    <EmptyTitle><Bdi>{pageSpeedEmptyCopy.title}</Bdi></EmptyTitle>
                    <EmptyDescription><Bdi>{pageSpeedEmptyCopy.description}</Bdi></EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      <section aria-labelledby="overview-tracking-title" className="space-y-4">
        <div>
          <h2 id="overview-tracking-title" className="text-lg font-semibold">
            {t('sites:overview.sections.trackingTitle')}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t('sites:overview.sections.trackingDescription')}
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card data-testid="overview-keywords">
            <CardHeader>
              <CardTitle>
                <h3>{t('sites:overview.keywords.title')}</h3>
              </CardTitle>
              <CardDescription>{t('sites:overview.keywords.description')}</CardDescription>
              <CardAction>
                <Button asChild variant="link" size="sm" className="px-0">
                  <Link to="?tab=keywords">{t('sites:overview.keywords.open')}</Link>
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              {ranksLoading && !ranksLoaded ? (
                <div className="space-y-3" aria-busy="true">
                  {Array.from({ length: 4 }, (_, index) => (
                    <Skeleton key={index} className="h-14" />
                  ))}
                </div>
              ) : ranksError && keywords.length === 0 ? (
                <Alert variant="destructive">
                  <AlertCircle aria-hidden="true" />
                  <AlertTitle>{t('ranks:loadFailed')}</AlertTitle>
                  <AlertDescription>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void dispatch(loadKeywords({ siteId }))}
                    >
                      {t('common:retry')}
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : keywords.length > 0 ? (
                <ul className="divide-y rounded-xl border">
                  {keywords.slice(0, 4).map((keyword) => {
                    const state = keywordState(keyword);
                    return (
                      <li key={keyword.id} className="flex items-center justify-between gap-4 p-4">
                        <div className="min-w-0">
                          <p className="truncate font-medium" title={isolateText(keyword.phrase)}>
                            <Bdi>{keyword.phrase}</Bdi>
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {keyword.lastCheckedAt
                              ? `${t('ranks:columnLastChecked')}: ${date(keyword.lastCheckedAt)}`
                              : keyword.lastFailedCheckAt
                                ? // The cause follows the timestamp when one was
                                  // recorded; older rows keep the bare label.
                                  `${t('ranks:checkErrored')}: ${date(keyword.lastFailedCheckAt)}${
                                    keyword.lastFailedReason
                                      ? ` — ${t(`ranks:checkErroredReason.${keyword.lastFailedReason}`)}`
                                      : ''
                                  }`
                                : t('sites:overview.keywords.awaiting')}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {state === 'ranked' ? (
                            <span className="font-semibold tabular-nums">
                              #{count(keyword.latestPosition)}
                            </span>
                          ) : (
                            <StatusChip tone={state === 'failed' ? 'destructive' : 'muted'}>
                              {state === 'failed'
                                ? t('ranks:checkErrored')
                                : state === 'not-ranking'
                                  ? t('ranks:notInTop100')
                                  : t('sites:overview.keywords.awaiting')}
                            </StatusChip>
                          )}
                          {state === 'ranked' || state === 'not-ranking' ? (
                            <PositionDelta
                              change={keyword.positionChange}
                              movement={keyword.movement}
                              fallbackDelta={keyword.delta}
                            />
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <Empty className="border py-8">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Target aria-hidden="true" />
                    </EmptyMedia>
                    <EmptyTitle>{t('ranks:emptyTitle')}</EmptyTitle>
                    <EmptyDescription>{t('ranks:emptyDescription')}</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </CardContent>
          </Card>

          <Card data-testid="overview-backlinks">
              <CardHeader>
                <CardTitle>
                  <h3>{t('backlinks:title')}</h3>
                </CardTitle>
                <CardDescription>
                  {backlinkSummary
                    ? t('sites:overview.backlinks.updated', {
                        date: date(backlinkSummary.fetchedAt),
                      })
                    : t('backlinks:description')}
                </CardDescription>
                <CardAction>
                  <Button asChild variant="link" size="sm" className="px-0">
                    <Link to="?tab=backlinks">{t('sites:overview.backlinks.open')}</Link>
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent>
                {backlinksLoading && !backlinksLoaded ? (
                  <div className="grid grid-cols-2 gap-3" aria-busy="true">
                    {Array.from({ length: 4 }, (_, index) => (
                      <Skeleton key={index} className="h-24" />
                    ))}
                  </div>
                ) : backlinksError && !backlinkSummary ? (
                  <Alert variant="destructive">
                    <AlertCircle aria-hidden="true" />
                    <AlertTitle>{t('backlinks:loadFailed')}</AlertTitle>
                    <AlertDescription>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void dispatch(loadSummary({ siteId }))}
                      >
                        {t('common:retry')}
                      </Button>
                    </AlertDescription>
                  </Alert>
                ) : backlinkSummary ? (
                  <div className="grid grid-cols-2 gap-3">
                    <StatCard
                      variant="kpi"
                      label={t('backlinks:summary.domainRating')}
                      value={decimal(backlinkSummary.domainRating)}
                      delta={
                        backlinkSummary.delta
                          ? {
                              value: backlinkSummary.delta.domainRating,
                              options: { maximumFractionDigits: 1 },
                            }
                          : undefined
                      }
                    />
                    <StatCard
                      variant="kpi"
                      label={t('backlinks:summary.referringDomains')}
                      value={count(backlinkSummary.referringDomains)}
                      delta={
                        backlinkSummary.delta
                          ? {
                              value: backlinkSummary.delta.referringDomains,
                            }
                          : undefined
                      }
                    />
                    <StatCard
                      variant="kpi"
                      label={t('backlinks:summary.backlinks')}
                      value={count(backlinkSummary.backlinks)}
                      delta={
                        backlinkSummary.delta
                          ? {
                              value: backlinkSummary.delta.backlinks,
                            }
                          : undefined
                      }
                    />
                    <StatCard
                      variant="kpi"
                      label={t('backlinks:summary.brokenBacklinks')}
                      value={count(backlinkSummary.brokenBacklinks)}
                      delta={
                        backlinkSummary.delta
                          ? {
                              value: backlinkSummary.delta.brokenBacklinks,
                              goodDirection: 'down',
                            }
                          : undefined
                      }
                    />
                  </div>
                ) : (
                  <Empty className="border py-8">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <Link2 aria-hidden="true" />
                      </EmptyMedia>
                      <EmptyTitle>{t('sites:overview.backlinks.noSnapshotTitle')}</EmptyTitle>
                      <EmptyDescription>
                        {t('sites:overview.backlinks.noSnapshotDescription')}
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}
              </CardContent>
          </Card>

          <Card data-testid="overview-competitors">
              <CardHeader>
                <CardTitle>
                  <h3>{t('competitors:title')}</h3>
                </CardTitle>
                <CardDescription>{t('competitors:description')}</CardDescription>
                <CardAction>
                  <Button asChild variant="link" size="sm" className="px-0">
                    <Link to="?tab=competitors">{t('sites:overview.competitors.open')}</Link>
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent>
                {cachedCompetitors && cachedCompetitors.length > 0 ? (
                  <ul className="divide-y rounded-xl border">
                    {cachedCompetitors.map((competitor) => (
                      <li
                        key={competitor.domain}
                        className="flex items-center justify-between gap-4 p-4"
                      >
                        <span className="min-w-0 truncate font-medium" title={isolateText(competitor.domain)}>
                          <Bdi>{competitor.domain}</Bdi>
                        </span>
                        <div className="shrink-0 text-end text-sm">
                          <p className="font-medium tabular-nums">
                            {t('competitors:table.overlap')}: {count(competitor.intersections)}
                          </p>
                          <p className="text-xs text-muted-foreground tabular-nums">
                            {t('competitors:table.avgPosition')}:{' '}
                            <MetricValue kind="position" value={competitor.avgPosition} />
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty className="border py-8">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <Users aria-hidden="true" />
                      </EmptyMedia>
                      <EmptyTitle>{t('sites:overview.competitors.notLoadedTitle')}</EmptyTitle>
                      <EmptyDescription>
                        {t('sites:overview.competitors.notLoadedDescription')}
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}
              </CardContent>
          </Card>
        </div>
      </section>

    </div>
  );
};
