import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { Skeleton } from '@shared/ui/skeleton';
import { Spinner } from '@shared/ui/spinner';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Badge } from '@shared/ui/badge';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import {
  selectResultError,
  selectResultLoading,
  selectRunById,
  selectRunError,
  selectRunLoading,
  selectRunResultById,
} from '../store/selectors';
import { fetchRun, fetchRunResult } from '../store/thunks';
import { isAudienceResearchTerminal } from '../types';
import { SignalList } from './SignalList';

const POLL_INTERVAL_MS = 4000;

interface RunStatusCardProps {
  siteId: string;
  runId: string;
}

/**
 * Named-stage progress display — never a fabricated percent, never an ETA.
 * Polls the read-only run-status endpoint on a bounded
 * interval, pausing while the tab is hidden and stopping once the run
 * reaches a terminal state. Reads never spend a unit or call a vendor.
 */
export function RunStatusCard({ siteId, runId }: RunStatusCardProps) {
  const { t } = useTranslation(['audienceResearch', 'language']);
  const dispatch = useAppDispatch();
  const run = useAppSelector(selectRunById(runId));
  const loading = useAppSelector(selectRunLoading(runId));
  const error = useAppSelector(selectRunError(runId));
  const result = useAppSelector(selectRunResultById(runId));
  const resultLoading = useAppSelector(selectResultLoading(runId));
  const resultError = useAppSelector(selectResultError(runId));

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const poll = useCallback(() => {
    void dispatch(fetchRun({ siteId, runId }));
  }, [dispatch, runId, siteId]);

  // Initial load.
  useEffect(() => {
    const promise = dispatch(fetchRun({ siteId, runId }));
    return () => promise.abort();
  }, [dispatch, runId, siteId]);

  const terminal = run ? isAudienceResearchTerminal(run.state) : false;

  // Bounded poll: schedule the next fetch only while non-terminal AND the
  // tab is visible; a `visibilitychange` listener resumes polling the
  // moment the tab comes back into view instead of silently drifting.
  useEffect(() => {
    if (!run || terminal) return undefined;

    // Called exactly once per effect run (the effect's own cleanup below
    // clears any pending timer before a re-run), so no stale-timer guard is
    // needed here.
    const schedule = () => {
      if (document.visibilityState === 'hidden') return;
      timerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        poll();
      }
    };

    schedule();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [poll, run, terminal]);

  // Fetch the full result view (sources + signals) once the run reaches a
  // terminal state. Reads never enqueue, never spend a unit.
  //
  // `resultLoading` is deliberately NOT a guard/dependency here: listing it
  // made React re-run this effect the moment its own dispatch flipped
  // `loading` to true — running the cleanup and ABORTING the request it had
  // just issued. The slice's abort branch leaves state untouched, so
  // `loading` stayed latched true and no retry ever fired: terminal signals
  // never rendered (net::ERR_ABORTED on every first /result fetch). With
  // the flag out of the dependency set the in-flight request survives its
  // own pending action; the cleanup still aborts on unmount or when
  // siteId/runId change.
  useEffect(() => {
    if (!terminal || result) return undefined;
    const promise = dispatch(fetchRunResult({ siteId, runId }));
    return () => promise.abort();
  }, [dispatch, result, runId, siteId, terminal]);

  if (loading && !run) {
    return (
      <Card aria-busy="true" data-testid="audience-research-status-loading">
        <CardHeader>
          <CardTitle>
            <Skeleton className="h-6 w-48" />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error && !run) {
    return (
      <Alert variant="destructive" data-testid="audience-research-status-error">
        <AlertTitle>{t('errors.generic')}</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
        <div className="mt-2">
          <Button size="sm" variant="outline" onClick={poll}>
            {t('history.prev')}
          </Button>
        </div>
      </Alert>
    );
  }

  if (!run) return null;

  const stageKey = run.state;
  const reasonCode = run.terminal.reasonCode;
  const isNoUsableEvidence = reasonCode === 'no_usable_public_evidence';

  return (
    <div className="flex flex-col gap-4">
    <Card data-testid="audience-research-status">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Badge data-testid="audience-research-status-stage">
            {t(`progress.stage.${stageKey}`)}
          </Badge>
          {run.outputLocale ? (
            <Badge variant="outline" data-testid="audience-research-status-output-locale">
              {t('outputLocale', { locale: t(`language:names.${run.outputLocale}`) })}
            </Badge>
          ) : null}
          {!terminal ? (
            <Spinner
              className="size-4 text-muted-foreground"
              data-testid="audience-research-status-spinner"
            />
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {!terminal ? (
          <div className="flex flex-col gap-1">
            <div
              role="progressbar"
              aria-valuenow={run.progress.percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={t('progress.percentComplete', {
                percent: run.progress.percent,
              })}
              className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
              data-testid="audience-research-status-progress"
            >
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${run.progress.percent}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground">
              {t('progress.percentComplete', { percent: run.progress.percent })}
            </span>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-4" aria-live="polite">
          <span data-testid="audience-research-status-sources">
            {t('progress.counts.sources', { count: run.counts.sources })}
          </span>
          <span data-testid="audience-research-status-signals">
            {t('progress.counts.signals', { count: run.counts.signals })}
          </span>
        </div>

        {run.terminal.state === 'partial' && !isNoUsableEvidence ? (
          <Alert data-testid="audience-research-status-partial">
            <AlertTitle>{t('progress.partial.title')}</AlertTitle>
            <AlertDescription>{t('progress.partial.body')}</AlertDescription>
          </Alert>
        ) : null}

        {run.terminal.state === 'failed' && !isNoUsableEvidence ? (
          <Alert variant="destructive" data-testid="audience-research-status-failed">
            <AlertTitle>{t('progress.failed.title')}</AlertTitle>
            <AlertDescription>{t('progress.failed.body')}</AlertDescription>
          </Alert>
        ) : null}

        {isNoUsableEvidence ? (
          <Alert data-testid="audience-research-status-no-usable-evidence">
            <AlertTitle>{t('progress.noUsableEvidence.title')}</AlertTitle>
            <AlertDescription>{t('progress.noUsableEvidence.body')}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
      {terminal && !isNoUsableEvidence ? (
        resultLoading && !result ? (
          <div data-testid="audience-research-signals-loading">
            <Skeleton className="h-24 w-full" />
          </div>
        ) : resultError && !result ? (
          <Alert variant="destructive" data-testid="audience-research-signals-error">
            <AlertTitle>{t('errors.generic')}</AlertTitle>
            <AlertDescription>{resultError}</AlertDescription>
            <div className="mt-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => dispatch(fetchRunResult({ siteId, runId }))}
              >
                {t('history.prev')}
              </Button>
            </div>
          </Alert>
        ) : result ? (
          <SignalList siteId={siteId} runId={runId} result={result} />
        ) : null
      ) : null}
    </div>
  );
}
