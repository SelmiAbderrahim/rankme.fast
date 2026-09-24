import { useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import { ReportExportControl } from '@features/report-export';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { Skeleton } from '@shared/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { StatusChip } from '@shared/ui/status-chip';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@shared/ui/table';
import { Empty, EmptyContent, EmptyDescription, EmptyMedia, EmptyTitle } from '@shared/ui/empty';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import {
  cancelCompetitorRunThunk,
  loadCompetitorRun,
  loadCompetitorRuns,
} from '../../store/thunks';
import {
  selectCompetitorCancelling,
  selectCompetitorDetailError,
  selectCompetitorDetailLoading,
  selectCompetitorListError,
  selectCompetitorListLoaded,
  selectCompetitorListLoading,
  selectCompetitorRunById,
  selectCompetitorRuns,
  selectCompetitorRunsNextCursor,
} from '../../store/selectors';
import { isCompetitorContentTerminal, type CompetitorContentRun } from '../../types';
import { competitorStatusTone } from './status';
import { CompetitorManager } from './CompetitorManager';
import { RunSetupForm } from './RunSetupForm';
import { RunProgress } from './RunProgress';
import { ComparisonOverview } from './ComparisonOverview';
import { OpportunityList } from './OpportunityList';
import { PageDrilldown } from './PageDrilldown';

interface CompetitorContentPanelProps {
  siteId: string;
}

const RUN_PARAM = 'ccRun';
const POLL_MS = 4000;

/**
 * Competitor content intelligence sub-view. Routes between the run
 * index (portfolio manager + run setup + runs list) and a single-run comparison
 * detail via `?ccRun=`.
 */
export function CompetitorContentPanel({ siteId }: CompetitorContentPanelProps) {
  const [params, setParams] = useSearchParams();
  const runId = params.get(RUN_PARAM);

  const openRun = useCallback(
    (id: string) => {
      const next = new URLSearchParams(params);
      next.set(RUN_PARAM, id);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const backToIndex = useCallback(() => {
    const next = new URLSearchParams(params);
    next.delete(RUN_PARAM);
    setParams(next, { replace: true });
  }, [params, setParams]);

  const startAnalysisDeepLink = useCallback(
    (url: string, keyword: string) => {
      const next = new URLSearchParams(params);
      next.set('view', 'analyses');
      next.delete(RUN_PARAM);
      next.set('prefillUrl', url);
      next.set('prefillKeyword', keyword);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  if (runId) {
    return (
      <CompetitorRunDetailView
        siteId={siteId}
        runId={runId}
        onBack={backToIndex}
        onStartAnalysis={startAnalysisDeepLink}
      />
    );
  }

  return <CompetitorIndex siteId={siteId} onOpen={openRun} />;
}

// ---------------------------------------------------------------------------
// Index — portfolio manager + run setup + runs list.
// ---------------------------------------------------------------------------

interface CompetitorIndexProps {
  siteId: string;
  onOpen: (runId: string) => void;
}

function CompetitorIndex({ siteId, onOpen }: CompetitorIndexProps) {
  const { t } = useTranslation('contentIntelligence');
  const dispatch = useAppDispatch();
  const runs = useAppSelector(selectCompetitorRuns);
  const cursor = useAppSelector(selectCompetitorRunsNextCursor);
  const loading = useAppSelector(selectCompetitorListLoading);
  const loaded = useAppSelector(selectCompetitorListLoaded);
  const listError = useAppSelector(selectCompetitorListError);

  useEffect(() => {
    const promise = dispatch(loadCompetitorRuns({ siteId }));
    return () => promise.abort();
  }, [dispatch, siteId]);

  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasInflight = runs.some((r) => !isCompetitorContentTerminal(r.status));
  useEffect(() => {
    if (!hasInflight) return;
    pollTimer.current = setTimeout(() => {
      void dispatch(loadCompetitorRuns({ siteId }));
    }, POLL_MS);
    return () => clearTimeout(pollTimer.current!);
  }, [runs, dispatch, hasInflight, siteId]);

  const activeRun = runs.find((r) => !isCompetitorContentTerminal(r.status));
  const retry = useCallback(() => {
    void dispatch(loadCompetitorRuns({ siteId }));
  }, [dispatch, siteId]);
  const loadMore = useCallback(() => {
    void dispatch(loadCompetitorRuns({ siteId, cursor: cursor!, append: true }));
  }, [cursor, dispatch, siteId]);

  return (
    <div className="flex flex-col gap-4" data-testid="competitor-panel">
      <CompetitorManager siteId={siteId} />
      <RunSetupForm siteId={siteId} disabled={Boolean(activeRun)} onStarted={onOpen} />

      <Card data-testid="competitor-runs">
        <CardHeader>
          <CardTitle>{t('competitorContent.runs.title')}</CardTitle>
          <CardDescription>{t('competitorContent.runs.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading && !loaded ? (
            <div className="flex flex-col gap-2" aria-busy="true">
              <Skeleton className="h-8 w-1/3" />
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
            </div>
          ) : listError ? (
            <Alert variant="destructive" data-testid="competitor-runs-error">
              <AlertTitle>{t('competitorContent.errors.loadFailed')}</AlertTitle>
              <AlertDescription>{listError}</AlertDescription>
              <div className="mt-2">
                <Button size="sm" variant="outline" onClick={retry}>
                  {t('competitorContent.errors.retry')}
                </Button>
              </div>
            </Alert>
          ) : runs.length === 0 ? (
            <Empty data-testid="competitor-runs-empty">
              <EmptyMedia />
              <EmptyContent>
                <EmptyTitle>{t('competitorContent.runs.empty.title')}</EmptyTitle>
                <EmptyDescription>{t('competitorContent.runs.empty.description')}</EmptyDescription>
              </EmptyContent>
            </Empty>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('competitorContent.runs.columns.requested')}</TableHead>
                      <TableHead>{t('competitorContent.runs.columns.status')}</TableHead>
                      <TableHead className="text-end">
                        {t('competitorContent.runs.columns.competitors')}
                      </TableHead>
                      <TableHead className="text-end">
                        {t('competitorContent.runs.columns.pages')}
                      </TableHead>
                      <TableHead className="text-end">
                        {t('competitorContent.runs.columns.actions')}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.map((run) => (
                      <CompetitorRunRow key={run.runId} run={run} onOpen={onOpen} />
                    ))}
                  </TableBody>
                </Table>
              </div>
              {cursor ? (
                <div className="mt-4">
                  <Button
                    variant="outline"
                    onClick={loadMore}
                    disabled={loading}
                    data-testid="competitor-runs-load-more"
                  >
                    {t('competitorContent.runs.loadMore')}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface CompetitorRunRowProps {
  run: CompetitorContentRun;
  onOpen: (runId: string) => void;
}

function CompetitorRunRow({ run, onOpen }: CompetitorRunRowProps) {
  const { t, i18n } = useTranslation('contentIntelligence');
  const requestedAt = run.requestedAt
    ? new Intl.DateTimeFormat(i18n.language, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(run.requestedAt))
    : '';
  return (
    <TableRow data-testid={`competitor-run-${run.runId}`} data-status={run.status}>
      <TableCell className="text-muted-foreground text-xs">{requestedAt}</TableCell>
      <TableCell>
        <StatusChip tone={competitorStatusTone(run.status)} aria-live="polite">
          {t(`competitorContent.status.${run.status}`)}
        </StatusChip>
      </TableCell>
      <TableCell className="text-end tabular-nums">
        {run.progress.competitorsProcessed}/{run.progress.competitorsRequested}
      </TableCell>
      <TableCell className="text-end tabular-nums">{run.progress.pagesScraped}</TableCell>
      <TableCell className="text-end">
        <Button size="sm" variant="outline" onClick={() => onOpen(run.runId)}>
          {t('competitorContent.runs.view')}
        </Button>
      </TableCell>
    </TableRow>
  );
}

// ---------------------------------------------------------------------------
// Detail — one comparison run.
// ---------------------------------------------------------------------------

interface CompetitorRunDetailViewProps {
  siteId: string;
  runId: string;
  onBack: () => void;
  onStartAnalysis: (url: string, keyword: string) => void;
}

function CompetitorRunDetailView({
  siteId,
  runId,
  onBack,
  onStartAnalysis,
}: CompetitorRunDetailViewProps) {
  const { t } = useTranslation('contentIntelligence');
  const dispatch = useAppDispatch();
  const run = useAppSelector(selectCompetitorRunById(runId));
  const loading = useAppSelector(selectCompetitorDetailLoading(runId));
  const detailError = useAppSelector(selectCompetitorDetailError(runId));
  const cancelling = useAppSelector(selectCompetitorCancelling(runId));

  useEffect(() => {
    const promise = dispatch(loadCompetitorRun({ siteId, runId }));
    return () => promise.abort();
  }, [dispatch, siteId, runId]);

  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nonTerminal = run ? !isCompetitorContentTerminal(run.status) : false;
  useEffect(() => {
    if (!nonTerminal) return;
    pollTimer.current = setTimeout(() => {
      void dispatch(loadCompetitorRun({ siteId, runId }));
    }, POLL_MS);
    return () => clearTimeout(pollTimer.current!);
  }, [run, dispatch, nonTerminal, siteId, runId]);

  const onCancel = useCallback(() => {
    void dispatch(cancelCompetitorRunThunk({ siteId, runId })).then(() => {
      void dispatch(loadCompetitorRun({ siteId, runId }));
    });
  }, [dispatch, siteId, runId]);

  const back = (
    <Button variant="ghost" size="sm" onClick={onBack} data-testid="competitor-detail-back">
      <ArrowLeft aria-hidden="true" className="me-2 size-4 rtl:rotate-180" />
      {t('competitorContent.detail.back')}
    </Button>
  );

  if (loading && !run) {
    return (
      <div className="flex flex-col gap-4" data-testid="competitor-detail-loading">
        {back}
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (detailError && !run) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <Alert variant="destructive" data-testid="competitor-detail-error">
          <AlertTitle>{t('competitorContent.errors.loadOneFailed')}</AlertTitle>
          <AlertDescription>{detailError}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!run) {
    return <div className="flex flex-col gap-4">{back}</div>;
  }

  const findings = run.findings;

  return (
    <div className="flex flex-col gap-4" data-testid="competitor-detail">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {back}
        {findings ? (
          <ReportExportControl
            kind="competitors.content_run"
            target={{ scope: 'site_resource', siteId, resourceId: runId }}
            selection={{}}
          />
        ) : null}
      </div>
      <RunProgress run={run} onCancel={onCancel} cancelling={cancelling} />
      {findings ? (
        <>
          {findings.aiExplanation ? (
            <Card data-testid="competitor-ai-explanation">
              <CardHeader>
                <CardTitle>{t('competitorContent.findings.explanation.title')}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed">{findings.aiExplanation}</p>
              </CardContent>
            </Card>
          ) : null}
          <ComparisonOverview
            deltas={findings.deltas}
            partialDomains={findings.partialDomains}
          />
          <OpportunityList
            opportunities={findings.opportunities}
            onStartAnalysis={() => onStartAnalysis(run.ownedUrl, run.keyword ?? '')}
          />
          <PageDrilldown pages={run.pages} />
        </>
      ) : (
        <Card data-testid="competitor-detail-pending">
          <CardContent className="text-muted-foreground py-6 text-sm">
            {t('competitorContent.detail.pending')}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
