import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { Skeleton } from '@shared/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Progress } from '@shared/ui/progress';
import { StatusChip } from '@shared/ui/status-chip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@shared/ui/alert-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@shared/ui/table';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@shared/ui/empty';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import type { ContentAnalysis } from '../types';
import {
  selectAnalyses,
  selectAnalysesNextCursor,
  selectAnalysisSiteId,
  selectListError,
  selectListLoaded,
  selectListLoading,
  selectCancelling,
} from '../store/selectors';
import { cancelAnalysisThunk, loadAnalyses } from '../store/thunks';
import { isContentAnalysisCancellable, isContentAnalysisTerminal } from '../types';
import { analysisStatusTone } from './status';

interface AnalysisListProps {
  siteId: string;
  onOpen: (analysisId: string) => void;
  onNew: () => void;
}

export function AnalysisList({ siteId, onOpen, onNew }: AnalysisListProps) {
  const { t } = useTranslation('contentIntelligence');
  const dispatch = useAppDispatch();
  const analyses = useAppSelector(selectAnalyses);
  const stateSiteId = useAppSelector(selectAnalysisSiteId);
  const cursor = useAppSelector(selectAnalysesNextCursor);
  const loading = useAppSelector(selectListLoading);
  const loaded = useAppSelector(selectListLoaded);
  const listError = useAppSelector(selectListError);
  const siteMatches = stateSiteId === siteId;
  const visibleAnalyses = siteMatches ? analyses : [];
  const visibleCursor = siteMatches ? cursor : null;
  const visibleLoading = loading || !siteMatches;
  const visibleLoaded = loaded && siteMatches;
  const visibleError = siteMatches ? listError : '';

  useEffect(() => {
    const promise = dispatch(loadAnalyses({ siteId }));
    return () => promise.abort();
  }, [dispatch, siteId]);

  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasInflight = visibleAnalyses.some(
    (a) => !isContentAnalysisTerminal(a.status),
  );
  useEffect(() => {
    if (!hasInflight) return undefined;
    let disposed = false;
    let activeRequest: { abort: () => void } | null = null;

    const schedule = () => {
      if (disposed || document.visibilityState === 'hidden') return;
      pollTimer.current = setTimeout(() => {
        pollTimer.current = null;
        const request = dispatch(loadAnalyses({ siteId }));
        activeRequest = request;
        void request.finally(() => {
          activeRequest = null;
          schedule();
        });
      }, 4000);
    };
    const onVisibilityChange = () => {
      if (
        document.visibilityState === 'visible' &&
        pollTimer.current === null &&
        activeRequest === null
      ) {
        schedule();
      }
    };

    schedule();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      disposed = true;
      if (pollTimer.current !== null) clearTimeout(pollTimer.current);
      pollTimer.current = null;
      activeRequest?.abort();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [dispatch, hasInflight, siteId]);

  const loadMore = useCallback(() => {
    void dispatch(loadAnalyses({ siteId, cursor: visibleCursor!, append: true }));
  }, [dispatch, siteId, visibleCursor]);

  const retry = useCallback(() => {
    void dispatch(loadAnalyses({ siteId }));
  }, [dispatch, siteId]);

  return (
    <Card data-testid="content-analysis-list">
      <CardHeader>
        <CardTitle>{t('list.title')}</CardTitle>
        <CardDescription>{t('list.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {visibleLoading && !visibleLoaded ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            <Skeleton className="h-8 w-1/3" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
          </div>
        ) : visibleError ? (
          <Alert variant="destructive" data-testid="content-list-error">
            <AlertTitle>{t('errors.loadFailed')}</AlertTitle>
            <AlertDescription>{visibleError}</AlertDescription>
            <div className="mt-2">
              <Button size="sm" variant="outline" onClick={retry}>
                {t('errors.retry')}
              </Button>
            </div>
          </Alert>
        ) : visibleAnalyses.length === 0 ? (
          <Empty data-testid="content-list-empty">
            <EmptyHeader>
              <EmptyTitle>{t('list.empty.title')}</EmptyTitle>
              <EmptyDescription>{t('list.empty.description')}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button
                variant="outline"
                onClick={onNew}
                data-testid="content-list-empty-cta"
              >
                {t('list.empty.action')}
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <>
            <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('list.columns.page')}</TableHead>
                  <TableHead>{t('list.columns.keyword')}</TableHead>
                  <TableHead>{t('list.columns.locale')}</TableHead>
                  <TableHead>{t('list.columns.status')}</TableHead>
                  <TableHead>{t('list.columns.score')}</TableHead>
                  <TableHead>{t('list.columns.requestedAt')}</TableHead>
                  <TableHead>{t('list.columns.completedAt')}</TableHead>
                  <TableHead>{t('list.columns.warnings')}</TableHead>
                  <TableHead className="text-end">{t('list.columns.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleAnalyses.map((a) => (
                  <AnalysisRow key={a.analysisId} a={a} onOpen={onOpen} />
                ))}
              </TableBody>
            </Table>
            </div>
            <div className="flex flex-col gap-3 md:hidden" data-testid="content-analysis-cards">
              {visibleAnalyses.map((analysis) => (
                <AnalysisCard key={analysis.analysisId} analysis={analysis} onOpen={onOpen} />
              ))}
            </div>
            {visibleCursor ? (
              <div className="mt-4">
                <Button
                  variant="outline"
                  onClick={loadMore}
                  disabled={loading}
                  data-testid="content-list-load-more"
                >
                  {t('list.loadMore')}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface AnalysisRowProps {
  a: ContentAnalysis;
  onOpen: (id: string) => void;
}

function AnalysisRow({ a, onOpen }: AnalysisRowProps) {
  const { t, i18n } = useTranslation('contentIntelligence');
  const requestedAt = a.requestedAt
    ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(a.requestedAt))
    : '';
  const completedAt = a.completedAt
    ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(a.completedAt))
    : t('list.notAvailable');
  const score =
    a.scorecardV2?.total ?? (a.scorecard === null
      ? null
      : Math.round(
          (a.scorecard.readabilityScore +
            a.scorecard.coverageScore +
            a.scorecard.structureScore) /
            3,
        ));
  return (
    <TableRow
      data-testid={`content-row-${a.analysisId}`}
      data-status={a.status}
    >
      <TableCell className="max-w-[240px] truncate">
        <span className="font-medium">{a.ownedUrl}</span>
      </TableCell>
      <TableCell>{a.keyword}</TableCell>
      <TableCell>{a.locale}</TableCell>
      <TableCell>
        <StatusChip tone={analysisStatusTone(a.status)} aria-live="polite">
          {t(`status.${a.status}`)}
        </StatusChip>
        <RowProgress analysis={a} />
      </TableCell>
      <TableCell>{score ?? t('list.notAvailable')}</TableCell>
      <TableCell className="text-muted-foreground text-xs">{requestedAt}</TableCell>
      <TableCell className="text-muted-foreground text-xs">{completedAt}</TableCell>
      <TableCell>{a.warnings.length > 0 ? t('list.warningCount', { count: a.warnings.length }) : t('list.notAvailable')}</TableCell>
      <TableCell className="text-end">
        <RowActions analysis={a} onOpen={onOpen} />
      </TableCell>
    </TableRow>
  );
}

function analysisPercent(analysis: ContentAnalysis): number {
  const runningStages = 7;
  return Math.round((analysis.stages.filter((stage) => stage.completedAt !== null).length / runningStages) * 100);
}

function RowProgress({ analysis }: { analysis: ContentAnalysis }) {
  const { t } = useTranslation('contentIntelligence');
  if (isContentAnalysisTerminal(analysis.status)) return null;
  const value = analysisPercent(analysis);
  return (
    <div className="mt-2 min-w-28" aria-live="polite">
      <Progress value={value} aria-label={t('list.progress', { value })} />
      <span className="text-muted-foreground text-xs">{t(`status.${analysis.status}`)}</span>
    </div>
  );
}

function RowActions({ analysis, onOpen }: { analysis: ContentAnalysis; onOpen: (id: string) => void }) {
  const { t } = useTranslation('contentIntelligence');
  const dispatch = useAppDispatch();
  const cancelling = useAppSelector(selectCancelling(analysis.analysisId));
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button size="sm" variant="outline" onClick={() => onOpen(analysis.analysisId)}>
        {t('list.row.view')}
      </Button>
      {isContentAnalysisCancellable(analysis.status) ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="outline" disabled={cancelling}>{t('list.row.cancel')}</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('confirm.cancel.title')}</AlertDialogTitle>
              <AlertDialogDescription>{t('confirm.cancel.description')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('confirm.cancel.back')}</AlertDialogCancel>
              <AlertDialogAction onClick={() => void dispatch(cancelAnalysisThunk({ analysisId: analysis.analysisId }))}>
                {t('confirm.cancel.confirm')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  );
}

function AnalysisCard({ analysis, onOpen }: { analysis: ContentAnalysis; onOpen: (id: string) => void }) {
  const { t, i18n } = useTranslation('contentIntelligence');
  const score =
    analysis.scorecardV2?.total ?? (analysis.scorecard === null
      ? null
      : Math.round(
          (analysis.scorecard.readabilityScore +
            analysis.scorecard.coverageScore +
            analysis.scorecard.structureScore) /
            3,
        ));
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' });
  const requested = analysis.requestedAt
    ? date.format(new Date(analysis.requestedAt))
    : t('list.notAvailable');
  const completed = analysis.completedAt
    ? date.format(new Date(analysis.completedAt))
    : t('list.notAvailable');
  return (
    <section className="rounded-lg border border-border p-4" data-testid={`content-card-${analysis.analysisId}`}>
      <h3 className="break-words font-medium">{analysis.ownedUrl}</h3>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
        <div><dt className="text-muted-foreground">{t('list.columns.keyword')}</dt><dd>{analysis.keyword}</dd></div>
        <div><dt className="text-muted-foreground">{t('list.columns.locale')}</dt><dd>{analysis.locale}</dd></div>
        <div><dt className="text-muted-foreground">{t('list.columns.score')}</dt><dd>{score ?? t('list.notAvailable')}</dd></div>
        <div><dt className="text-muted-foreground">{t('list.columns.requestedAt')}</dt><dd>{requested}</dd></div>
        <div><dt className="text-muted-foreground">{t('list.columns.completedAt')}</dt><dd>{completed}</dd></div>
        <div><dt className="text-muted-foreground">{t('list.columns.warnings')}</dt><dd>{analysis.warnings.length > 0 ? t('list.warningCount', { count: analysis.warnings.length }) : t('list.notAvailable')}</dd></div>
      </dl>
      <div className="mt-3"><StatusChip tone={analysisStatusTone(analysis.status)}>{t(`status.${analysis.status}`)}</StatusChip><RowProgress analysis={analysis} /></div>
      <div className="mt-3"><RowActions analysis={analysis} onOpen={onOpen} /></div>
    </section>
  );
}
