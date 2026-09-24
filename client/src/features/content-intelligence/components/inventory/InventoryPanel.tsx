import { useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { Skeleton } from '@shared/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { StatusChip } from '@shared/ui/status-chip';
import { ArrowLeft } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { TableHeaderHelp } from '@shared/ui/table-header-help';
import { Empty, EmptyContent, EmptyDescription, EmptyMedia, EmptyTitle } from '@shared/ui/empty';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { ReportExportControl } from '@features/report-export';
import { cancelInventoryThunk, loadInventoryRun, loadInventoryRuns } from '../../store/thunks';
import {
  selectInventoryCancelling,
  selectInventoryDetailError,
  selectInventoryDetailLoading,
  selectInventoryListError,
  selectInventoryListLoaded,
  selectInventoryListLoading,
  selectInventoryNextCursor,
  selectInventoryRunById,
  selectInventoryRuns,
} from '../../store/selectors';
import { isContentInventoryTerminal, type InventoryRun } from '../../types';
import { inventoryStatusTone } from './status';
import { InventoryStartForm } from './InventoryStartForm';
import { InventoryProgress } from './InventoryProgress';
import { InventoryTable } from './InventoryTable';
import { ClusterView } from './ClusterView';
import { InternalLinksTable } from './InternalLinksTable';
import { CannibalizationList } from './CannibalizationList';
import { TopicalGaps } from './TopicalGaps';

interface InventoryPanelProps {
  siteId: string;
}

const RUN_PARAM = 'invRun';
const POLL_MS = 4000;

/**
 * Content Inventory sub-view. Routes between the run index
 * (start form + runs list) and a single-run detail via `?invRun=`.
 */
export function InventoryPanel({ siteId }: InventoryPanelProps) {
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
    (query: string, url: string) => {
      const next = new URLSearchParams(params);
      next.set('view', 'analyses');
      next.delete(RUN_PARAM);
      next.set('prefillUrl', url);
      next.set('prefillKeyword', query);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  if (runId) {
    return (
      <InventoryRunDetailView
        siteId={siteId}
        runId={runId}
        onBack={backToIndex}
        onStartAnalysis={startAnalysisDeepLink}
      />
    );
  }

  return <InventoryIndex siteId={siteId} onOpen={openRun} />;
}

// ---------------------------------------------------------------------------
// Index — start form + runs list.
// ---------------------------------------------------------------------------

interface InventoryIndexProps {
  siteId: string;
  onOpen: (runId: string) => void;
}

function InventoryIndex({ siteId, onOpen }: InventoryIndexProps) {
  const { t } = useTranslation('contentIntelligence');
  const dispatch = useAppDispatch();
  const runs = useAppSelector(selectInventoryRuns);
  const cursor = useAppSelector(selectInventoryNextCursor);
  const loading = useAppSelector(selectInventoryListLoading);
  const loaded = useAppSelector(selectInventoryListLoaded);
  const listError = useAppSelector(selectInventoryListError);

  useEffect(() => {
    const promise = dispatch(loadInventoryRuns({ siteId }));
    return () => promise.abort();
  }, [dispatch, siteId]);

  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasInflight = runs.some((r) => !isContentInventoryTerminal(r.status));
  useEffect(() => {
    if (!hasInflight) return;
    pollTimer.current = setTimeout(() => {
      void dispatch(loadInventoryRuns({ siteId }));
    }, POLL_MS);
    return () => clearTimeout(pollTimer.current!);
  }, [runs, dispatch, hasInflight, siteId]);

  const activeRun = runs.find((r) => !isContentInventoryTerminal(r.status));
  const retry = useCallback(() => {
    void dispatch(loadInventoryRuns({ siteId }));
  }, [dispatch, siteId]);
  const loadMore = useCallback(() => {
    void dispatch(loadInventoryRuns({ siteId, cursor: cursor!, append: true }));
  }, [cursor, dispatch, siteId]);

  return (
    <div className="flex flex-col gap-4" data-testid="inventory-panel">
      <InventoryStartForm siteId={siteId} disabled={Boolean(activeRun)} onStarted={onOpen} />

      <Card data-testid="inventory-runs">
        <CardHeader>
          <CardTitle>{t('inventory.runs.title')}</CardTitle>
          <CardDescription>{t('inventory.runs.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading && !loaded ? (
            <div className="flex flex-col gap-2" aria-busy="true">
              <Skeleton className="h-8 w-1/3" />
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
            </div>
          ) : listError ? (
            <Alert variant="destructive" data-testid="inventory-runs-error">
              <AlertTitle>{t('inventory.errors.loadFailed')}</AlertTitle>
              <AlertDescription>{listError}</AlertDescription>
              <div className="mt-2">
                <Button size="sm" variant="outline" onClick={retry}>
                  {t('inventory.errors.retry')}
                </Button>
              </div>
            </Alert>
          ) : runs.length === 0 ? (
            <Empty data-testid="inventory-runs-empty">
              <EmptyMedia />
              <EmptyContent>
                <EmptyTitle>{t('inventory.runs.empty.title')}</EmptyTitle>
                <EmptyDescription>{t('inventory.runs.empty.description')}</EmptyDescription>
              </EmptyContent>
            </Empty>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('inventory.runs.columns.requested')}</TableHead>
                      <TableHead>{t('inventory.runs.columns.status')}</TableHead>
                      <TableHead className="text-end">
                        {t('inventory.runs.columns.pages')}
                      </TableHead>
                      <TableHead className="text-end">
                        <TableHeaderHelp
                          label={t('inventory.runs.columns.blocks')}
                          description={t('common:tableHelp.contentBlocks')}
                        />
                      </TableHead>
                      <TableHead className="text-end">
                        {t('inventory.runs.columns.actions')}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.map((run) => (
                      <InventoryRunRow key={run.runId} run={run} onOpen={onOpen} />
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
                    data-testid="inventory-runs-load-more"
                  >
                    {t('inventory.runs.loadMore')}
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

interface InventoryRunRowProps {
  run: InventoryRun;
  onOpen: (runId: string) => void;
}

function InventoryRunRow({ run, onOpen }: InventoryRunRowProps) {
  const { t, i18n } = useTranslation('contentIntelligence');
  const requestedAt = run.requestedAt
    ? new Intl.DateTimeFormat(i18n.language, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(run.requestedAt))
    : '';
  return (
    <TableRow data-testid={`inventory-run-${run.runId}`} data-status={run.status}>
      <TableCell className="text-muted-foreground text-xs">{requestedAt}</TableCell>
      <TableCell>
        <StatusChip tone={inventoryStatusTone(run.status)} aria-live="polite">
          {t(`inventory.status.${run.status}`)}
        </StatusChip>
      </TableCell>
      <TableCell className="text-end tabular-nums">
        {run.progress.pagesProcessed}/{run.progress.pagesRequested}
      </TableCell>
      <TableCell className="text-end tabular-nums">{run.progress.blocksReserved}</TableCell>
      <TableCell className="text-end">
        <Button size="sm" variant="outline" onClick={() => onOpen(run.runId)}>
          {t('inventory.runs.view')}
        </Button>
      </TableCell>
    </TableRow>
  );
}

// ---------------------------------------------------------------------------
// Detail — one run.
// ---------------------------------------------------------------------------

interface InventoryRunDetailViewProps {
  siteId: string;
  runId: string;
  onBack: () => void;
  onStartAnalysis: (query: string, url: string) => void;
}

function InventoryRunDetailView({
  siteId,
  runId,
  onBack,
  onStartAnalysis,
}: InventoryRunDetailViewProps) {
  const { t } = useTranslation('contentIntelligence');
  const dispatch = useAppDispatch();
  const run = useAppSelector(selectInventoryRunById(runId));
  const loading = useAppSelector(selectInventoryDetailLoading(runId));
  const detailError = useAppSelector(selectInventoryDetailError(runId));
  const cancelling = useAppSelector(selectInventoryCancelling(runId));

  useEffect(() => {
    const promise = dispatch(loadInventoryRun({ siteId, runId }));
    return () => promise.abort();
  }, [dispatch, siteId, runId]);

  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nonTerminal = run ? !isContentInventoryTerminal(run.status) : false;
  useEffect(() => {
    if (!nonTerminal) return;
    pollTimer.current = setTimeout(() => {
      void dispatch(loadInventoryRun({ siteId, runId }));
    }, POLL_MS);
    return () => clearTimeout(pollTimer.current!);
  }, [run, dispatch, nonTerminal, siteId, runId]);

  const onCancel = useCallback(() => {
    void dispatch(cancelInventoryThunk({ siteId, runId })).then(() => {
      void dispatch(loadInventoryRun({ siteId, runId }));
    });
  }, [dispatch, siteId, runId]);

  const back = (
    <Button variant="ghost" size="sm" onClick={onBack} data-testid="inventory-detail-back">
      <ArrowLeft aria-hidden="true" className="me-2 size-4 rtl:rotate-180" />
      {t('inventory.detail.back')}
    </Button>
  );

  if (loading && !run) {
    return (
      <div className="flex flex-col gap-4" data-testid="inventory-detail-loading">
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
        <Alert variant="destructive" data-testid="inventory-detail-error">
          <AlertTitle>{t('inventory.errors.loadOneFailed')}</AlertTitle>
          <AlertDescription>{detailError}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!run) {
    return <div className="flex flex-col gap-4">{back}</div>;
  }

  const findings = run.findings;
  const pages = run.pages;

  return (
    <div className="flex flex-col gap-4" data-testid="inventory-detail">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {back}
        {findings ? (
          <ReportExportControl
            kind="content.inventory_run"
            target={{ scope: 'site_resource', siteId, resourceId: runId }}
            selection={{}}
          />
        ) : null}
      </div>
      <InventoryProgress run={run} onCancel={onCancel} cancelling={cancelling} />
      {findings ? (
        <>
          {findings.opportunityExplanation ? (
            <Card data-testid="inventory-opportunity">
              <CardHeader>
                <CardTitle>{t('inventory.findings.opportunity.title')}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed">{findings.opportunityExplanation}</p>
              </CardContent>
            </Card>
          ) : null}
          <ClusterView clusters={findings.clusters} />
          <CannibalizationList
            candidates={findings.cannibalization}
            onStartAnalysis={onStartAnalysis}
          />
          <TopicalGaps gaps={findings.gaps} />
          <InternalLinksTable pages={pages} />
          <InventoryTable pages={pages} />
        </>
      ) : (
        <Card data-testid="inventory-detail-pending">
          <CardContent className="text-muted-foreground py-6 text-sm">
            {t('inventory.detail.pending')}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
