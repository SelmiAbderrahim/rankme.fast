/** Durable, refresh-safe AI summary card. */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import { ApiError } from '@shared/api/client';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { Skeleton } from '@shared/ui/skeleton';
import { fetchAiSummaryStateRequest, generateAiSummaryRequest } from '../api';
import type { AuditReportAiSummary, AuditSummaryState, AuditSummaryStatus } from '../types';
import { DocsLink } from '@shared/docs/DocsLink';
import type { SupportedLocale } from '@shared/i18n';

const POLL_INTERVAL_MS = 3_000;

export interface AiSummaryCardProps {
  runId: string;
  initial: AuditReportAiSummary | null;
  initialStatus?: AuditSummaryStatus;
  requestedLocale: SupportedLocale;
}

const isActive = (status: AuditSummaryStatus): boolean =>
  status === 'queued' || status === 'running';

export const AiSummaryCard = ({
  runId,
  initial,
  initialStatus,
  requestedLocale,
}: AiSummaryCardProps) => {
  const { t } = useTranslation('report');
  const [summary, setSummary] = useState<AuditReportAiSummary | null>(initial);
  const [status, setStatus] = useState<AuditSummaryStatus>(
    initialStatus ?? (initial ? 'succeeded' : 'idle'),
  );
  const [message, setMessage] = useState<string | null>(null);

  const applyState = useCallback(
    (next: AuditSummaryState): void => {
      if (next.requestedLocale !== requestedLocale) return;
      setSummary(next.aiSummary);
      setStatus(next.status);
      setMessage(next.status === 'failed' ? t('aiSummary.errors.unavailable') : null);
    },
    [requestedLocale, t],
  );

  useEffect(() => {
    setSummary(initial);
    setStatus(initialStatus ?? (initial ? 'succeeded' : 'idle'));
    setMessage(null);
  }, [initial, initialStatus, requestedLocale, runId]);

  useEffect(() => {
    if (!isActive(status)) return undefined;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = (): void => {
      timer = setTimeout(() => {
        void fetchAiSummaryStateRequest(runId, requestedLocale, { signal: controller.signal })
          .then((next) => {
            if (controller.signal.aborted) return;
            applyState(next);
            if (isActive(next.status)) schedule();
          })
          .catch(() => {
            if (controller.signal.aborted) return;
            setStatus('failed');
            setMessage(t('aiSummary.errors.unavailable'));
          });
      }, POLL_INTERVAL_MS);
    };

    schedule();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [applyState, requestedLocale, runId, status, t]);

  const runSummarize = async (): Promise<void> => {
    setMessage(null);
    setStatus('queued');
    try {
      applyState(await generateAiSummaryRequest(runId, requestedLocale));
    } catch (error) {
      setStatus('failed');
      setMessage(
        error instanceof ApiError && error.status === 402
          ? t('aiSummary.errors.capReached')
          : t('aiSummary.errors.unavailable'),
      );
    }
  };

  const loading = isActive(status);
  const errorMessage = status === 'failed' ? (message ?? t('aiSummary.errors.unavailable')) : null;

  return (
    <section
      data-testid="report-ai-summary"
      className="border-border bg-card flex flex-col gap-3 rounded-xl border p-4"
      aria-labelledby="report-ai-summary-heading"
    >
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-2">
          <Sparkles aria-hidden="true" className="text-muted-foreground mt-0.5 size-4" />
          <div>
            <h2 id="report-ai-summary-heading" className="text-base font-semibold">
              {t('aiSummary.cardTitle')}
            </h2>
            <p className="text-muted-foreground text-sm">{t('aiSummary.cardDescription')}</p>
            <div className="mt-1">
              <DocsLink slug="ai-summary" />
            </div>
          </div>
        </div>
        {summary ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void runSummarize()}
            loading={loading}
            loadingLabel={t('aiSummary.regenerate')}
            data-testid="report-ai-summary-regenerate"
          >
            {t('aiSummary.regenerate')}
          </Button>
        ) : (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void runSummarize()}
            loading={loading}
            loadingLabel={t('aiSummary.cta')}
            data-testid="report-ai-summary-cta"
          >
            {t('aiSummary.cta')}
          </Button>
        )}
      </header>

      {loading ? (
        <div
          data-testid="report-ai-summary-loading"
          aria-busy="true"
          aria-live="polite"
          className="flex flex-col gap-2"
        >
          <p className="text-muted-foreground text-sm">{t('aiSummary.loading')}</p>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      ) : null}

      {errorMessage ? (
        <Alert variant="destructive" role="alert" data-testid="report-ai-summary-error">
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      {summary ? (
        <div className="flex flex-col gap-2">
          <p data-testid="report-ai-summary-text" className="whitespace-pre-line text-sm">
            {summary.text}
          </p>
          {summary.truncated ? (
            <p data-testid="report-ai-summary-truncated" className="text-muted-foreground text-xs">
              {t('aiSummary.truncatedNote')}
            </p>
          ) : null}
          <p className="text-muted-foreground text-xs">
            {t('aiSummary.attribution')} <span aria-hidden="true">·</span>{' '}
            <span className="font-mono">{summary.model}</span>
          </p>
        </div>
      ) : null}
    </section>
  );
};
