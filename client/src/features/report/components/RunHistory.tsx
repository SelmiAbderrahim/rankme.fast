import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { Skeleton } from '@shared/ui/skeleton';
import { StatusChip, type StatusTone } from '@shared/ui/status-chip';
import { loadRuns } from '../store/thunks';
import {
  selectReportRuns,
  selectReportRunsError,
  selectReportRunsLoading,
  selectReportRunsSiteId,
} from '../store/selectors';
import type { PublicAuditRun } from '../types';
import { usePresentationRefreshSignal } from '@shared/i18n';

const STATUS_TONE: Record<PublicAuditRun['status'], StatusTone> = {
  queued: 'warning',
  running: 'info',
  succeeded: 'success',
  failed: 'destructive',
};

/**
 * Compact audit run-history block on the report page. Lists the site's
 * recent runs (date + status), each row deep-linking to
 * `/sites/:siteId/report/:runId` — the previously undiscoverable per-run route.
 * Read-only, owner-scoped, no vendor spend.
 */
export const RunHistory = ({ siteId }: { siteId: string }) => {
  const { t, i18n } = useTranslation('report');
  const presentation = usePresentationRefreshSignal();
  const dispatch = useAppDispatch();
  const runs = useAppSelector(selectReportRuns);
  const runsSiteId = useAppSelector(selectReportRunsSiteId);
  const runsLoading = useAppSelector(selectReportRunsLoading);
  const runsError = useAppSelector(selectReportRunsError);
  const runsSiteIdRef = useRef(runsSiteId);
  runsSiteIdRef.current = runsSiteId;

  useEffect(() => {
    if (runsSiteIdRef.current !== siteId) {
      const request = dispatch(
        loadRuns({
          siteId,
          presentationLocale: presentation.locale,
          presentationGeneration: presentation.generation,
        }),
      );
      return () => request.abort();
    }
  }, [
    dispatch,
    presentation.generation,
    presentation.locale,
    presentation.refreshGeneration,
    siteId,
  ]);

  const retry = () => {
    void dispatch(
      loadRuns({
        siteId,
        presentationLocale: presentation.locale,
        presentationGeneration: presentation.generation,
      }),
    );
  };

  const fmtDate = (iso: string): string =>
    new Intl.DateTimeFormat(i18n.language, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));

  return (
    <section
      className="rounded-xl border bg-card p-4 shadow-sm"
      data-testid="report-run-history"
      aria-label={t('history.title')}
    >
      <h3 className="text-sm font-semibold">{t('history.title')}</h3>
      {runsError ? (
        <div className="mt-2 flex flex-col items-start gap-2">
          <Alert variant="destructive" role="alert" data-testid="report-run-history-error">
            <AlertDescription>{runsError}</AlertDescription>
          </Alert>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={retry}
            loading={runsLoading}
            loadingLabel={t('history.loading')}
            data-testid="report-run-history-retry"
          >
            {t('states.retry')}
          </Button>
        </div>
      ) : runs.length === 0 && runsLoading ? (
        <div
          className="mt-2 flex flex-col gap-2"
          aria-busy="true"
          aria-live="polite"
          data-testid="report-run-history-loading"
        >
          <span className="sr-only">{t('history.loading')}</span>
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-2/3" />
        </div>
      ) : runs.length === 0 ? (
        <p className="text-muted-foreground mt-2 text-sm" data-testid="report-run-history-empty">
          {t('history.empty')}
        </p>
      ) : (
        <ul className="mt-3 flex flex-col divide-y">
          {runs.map((run) => (
            <li
              key={run.id}
              className="flex items-center justify-between gap-3 py-2"
              data-testid={`report-run-${run.id}`}
            >
              <div className="flex items-center gap-2 text-sm">
                <StatusChip tone={STATUS_TONE[run.status]}>
                  {t(`history.status.${run.status}`)}
                </StatusChip>
                <span className="text-muted-foreground">{fmtDate(run.createdAt)}</span>
              </div>
              <Link
                to={`/sites/${siteId}/report/${run.id}`}
                className="text-primary text-sm font-medium hover:underline"
              >
                {t('history.viewRun')}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
