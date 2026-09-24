import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { Skeleton } from '@shared/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Badge } from '@shared/ui/badge';
import { TableHeaderHelp } from '@shared/ui/table-header-help';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { Empty, EmptyContent, EmptyDescription, EmptyMedia, EmptyTitle } from '@shared/ui/empty';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { countryName, languageName } from '@shared/markets';
import {
  selectListCanGoPrev,
  selectListCursor,
  selectListError,
  selectListLoaded,
  selectListLoading,
  selectRunResultById,
  selectRuns,
} from '../store/selectors';
import { fetchRuns } from '../store/thunks';
import type { AudienceResearchState, RunStatusView } from '../types';

interface RunHistoryTableProps {
  siteId: string;
  onOpen: (runId: string) => void;
}

function stateBadgeVariant(
  state: AudienceResearchState,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (state === 'completed') return 'default';
  if (state === 'failed') return 'destructive';
  if (state === 'partial') return 'secondary';
  return 'outline';
}

export function RunHistoryTable({ siteId, onOpen }: RunHistoryTableProps) {
  const { t, i18n } = useTranslation('audienceResearch');
  const dispatch = useAppDispatch();
  const runs = useAppSelector(selectRuns);
  const loading = useAppSelector(selectListLoading);
  const loaded = useAppSelector(selectListLoaded);
  const error = useAppSelector(selectListError);
  const cursor = useAppSelector(selectListCursor);
  const canGoPrev = useAppSelector(selectListCanGoPrev);

  useEffect(() => {
    const promise = dispatch(fetchRuns({ siteId }));
    return () => promise.abort();
  }, [dispatch, siteId]);

  // No `!cursor` guard here — the "Next" button below is already disabled
  // whenever `cursor` is falsy, so this callback is only ever invoked with a
  // real cursor.
  const goNext = useCallback(() => {
    void dispatch(fetchRuns({ siteId, cursor: cursor as string, direction: 'next' }));
  }, [cursor, dispatch, siteId]);

  const goPrev = useCallback(() => {
    void dispatch(fetchRuns({ siteId, cursor: null, direction: 'prev' }));
  }, [dispatch, siteId]);

  const retry = useCallback(() => {
    void dispatch(fetchRuns({ siteId }));
  }, [dispatch, siteId]);

  return (
    <Card data-testid="audience-research-history">
      <CardHeader>
        <CardTitle>{t('history.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading && !loaded ? (
          <div
            className="flex flex-col gap-2"
            aria-busy="true"
            data-testid="audience-research-history-loading"
          >
            <Skeleton className="h-8 w-1/3" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
            <span className="sr-only">{t('history.loading')}</span>
          </div>
        ) : error ? (
          <Alert variant="destructive" data-testid="audience-research-history-error">
            <AlertTitle>{t('history.empty.title')}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
            <div className="mt-2">
              <Button size="sm" variant="outline" onClick={retry}>
                {t('history.prev')}
              </Button>
            </div>
          </Alert>
        ) : runs.length === 0 ? (
          <Empty data-testid="audience-research-history-empty">
            <EmptyMedia />
            <EmptyContent>
              <EmptyTitle>{t('history.empty.title')}</EmptyTitle>
              <EmptyDescription>{t('history.empty.body')}</EmptyDescription>
            </EmptyContent>
          </Empty>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <TableHeaderHelp
                      label={t('history.columns.market')}
                      description={t('common:tableHelp.audienceMarket')}
                    />
                  </TableHead>
                  <TableHead>{t('history.columns.requestedAt')}</TableHead>
                  <TableHead>{t('history.columns.state')}</TableHead>
                  <TableHead className="text-end">
                    <TableHeaderHelp
                      label={t('history.columns.sources')}
                      description={t('common:tableHelp.audienceSources')}
                    />
                  </TableHead>
                  <TableHead className="text-end">
                    <TableHeaderHelp
                      label={t('history.columns.signals')}
                      description={t('common:tableHelp.audienceSignals')}
                    />
                  </TableHead>
                  <TableHead>
                    <TableHeaderHelp
                      label={t('history.columns.coverage')}
                      description={t('common:tableHelp.coverage')}
                    />
                  </TableHead>
                  <TableHead className="w-10">
                    <span className="sr-only">{t('history.view')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <RunRow key={run.runId} run={run} locale={i18n.language} onOpen={onOpen} />
                ))}
              </TableBody>
            </Table>
            <div className="mt-4 flex items-center justify-between">
              <Button
                variant="outline"
                size="sm"
                onClick={goPrev}
                disabled={!canGoPrev || loading}
                data-testid="audience-research-history-prev"
              >
                {t('history.prev')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={goNext}
                disabled={!cursor || loading}
                data-testid="audience-research-history-next"
              >
                {t('history.next')}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface RunRowProps {
  run: RunStatusView;
  locale: string;
  onOpen: (runId: string) => void;
}

function RunRow({ run, locale, onOpen }: RunRowProps) {
  const { t } = useTranslation(['audienceResearch', 'language']);
  // The list DTO (`RunStatusView`) does not carry the requested market — only
  // the per-run result view does. Show it opportunistically from the client
  // cache (populated once the user has opened this run at least once this
  // session) rather than firing an N+1 result fetch per history row or
  // inventing data the server has not returned.
  const cachedResult = useAppSelector(selectRunResultById(run.runId));
  const marketLabel = cachedResult?.input.siteMarket
    ? `${countryName(cachedResult.input.siteMarket.country, locale) ?? t('common:market.unknownCountry')} · ${languageName(cachedResult.input.siteMarket.language, locale) ?? t('common:market.unknownLanguage')}`
    : t('history.marketUnavailable');
  const requestedAt = run.requestedAt ? new Date(run.requestedAt).toLocaleString(locale) : '';
  const hasCoverageNote = run.coverageNoteKey !== null || run.terminal.state === 'partial';
  return (
    <TableRow data-testid={`audience-research-history-row-${run.runId}`} data-state={run.state}>
      <TableCell className="text-muted-foreground text-xs">
        <span className="block">{marketLabel}</span>
        {run.outputLocale ? (
          <span className="block" data-testid={`audience-research-history-locale-${run.runId}`}>
            {t('outputLocale', { locale: t(`language:names.${run.outputLocale}`) })}
          </span>
        ) : null}
      </TableCell>
      <TableCell className="text-muted-foreground text-xs">{requestedAt}</TableCell>
      <TableCell>
        <Badge variant={stateBadgeVariant(run.state)} aria-live="polite">
          {t(`progress.stage.${run.terminal.state ?? run.state}`)}
        </Badge>
      </TableCell>
      <TableCell className="text-end">{run.counts.sources}</TableCell>
      <TableCell className="text-end">{run.counts.signals}</TableCell>
      <TableCell className="text-muted-foreground text-xs">
        {hasCoverageNote ? t('history.coverageNote') : t('history.coverageFull')}
      </TableCell>
      <TableCell className="text-end">
        <Button size="sm" variant="outline" onClick={() => onOpen(run.runId)}>
          {t('history.view')}
        </Button>
      </TableCell>
    </TableRow>
  );
}
