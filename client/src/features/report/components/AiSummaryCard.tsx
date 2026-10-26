import { Bdi } from '@shared/components/Bdi';
/** Durable, refresh-safe AI summary card. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import { ApiError } from '@shared/api/client';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { Skeleton } from '@shared/ui/skeleton';
import { StatusChip } from '@shared/ui/status-chip';
import { TAP_TARGET_LINK } from '@shared/ui/tap-target';
import { cn } from '@shared/lib/utils';
import { fetchAiSummaryStateRequest, generateAiSummaryRequest } from '../api';
import type {
  AiSummaryItem,
  AiSummaryStructured,
  AuditReportAiSummary,
  AuditSummaryFreshness,
  AuditSummaryProgress,
  AuditSummaryState,
  AuditSummaryStatus,
} from '../types';
import { DocsLink } from '@shared/docs/DocsLink';
import type { SupportedLocale } from '@shared/i18n';

const POLL_INTERVAL_MS = 3_000;

/** `m:ss`, the same in every locale. */
const formatElapsed = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

export interface AiSummaryCardProps {
  runId: string;
  /** The site the run belongs to; summary items link into its workspace tabs. */
  siteId?: string;
  initial: AuditReportAiSummary | null;
  initialStatus?: AuditSummaryStatus;
  /** Whether the stored summary still matches the open findings. */
  initialFreshness?: AuditSummaryFreshness | null;
  requestedLocale: SupportedLocale;
  /**
   * A finding was dismissed, restored, fixed or reopened on this page since
   * the report loaded: the stored summary no longer matches what the list shows.
   */
  triageChanged?: boolean;
  onStateChange?: (next: AuditSummaryState, runId: string) => void;
}

const isActive = (status: AuditSummaryStatus): boolean =>
  status === 'queued' || status === 'running';

export const AiSummaryCard = ({
  runId,
  siteId,
  initial,
  initialStatus,
  initialFreshness = null,
  requestedLocale,
  triageChanged = false,
  onStateChange,
}: AiSummaryCardProps) => {
  const { t } = useTranslation('report');
  const [summary, setSummary] = useState<AuditReportAiSummary | null>(initial);
  const [status, setStatus] = useState<AuditSummaryStatus>(
    initialStatus ?? (initial ? 'succeeded' : 'idle'),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [freshness, setFreshness] = useState<AuditSummaryFreshness | null>(initialFreshness);
  const [showPrevious, setShowPrevious] = useState(false);
  // Server-reported stage, elapsed time and failure reason of the latest job.
  const [progress, setProgress] = useState<AuditSummaryProgress | null>(null);
  const [progressAt, setProgressAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [announcement, setAnnouncement] = useState('');
  const watchedActive = useRef(false);

  const applyState = useCallback(
    (next: AuditSummaryState): void => {
      if (next.requestedLocale !== requestedLocale) return;
      setSummary(next.aiSummary);
      setStatus(next.status);
      setFreshness(next.freshness ?? null);
      setShowPrevious(false);
      setProgress(next.progress ?? null);
      setProgressAt(Date.now());
      setMessage(
        next.status !== 'failed'
          ? null
          : next.progress?.failureCode
            ? t(`aiSummary.failure.${next.progress.failureCode}`)
            : t('aiSummary.errors.unavailable'),
      );
      onStateChange?.(next, runId);
    },
    [onStateChange, requestedLocale, runId, t],
  );

  useEffect(() => {
    setSummary(initial);
    setStatus(initialStatus ?? (initial ? 'succeeded' : 'idle'));
    setMessage(null);
    setFreshness(initialFreshness);
    setShowPrevious(false);
  }, [initial, initialFreshness, initialStatus, requestedLocale, runId]);

  // Elapsed timer: the server's measure plus local seconds since it arrived.
  useEffect(() => {
    if (!isActive(status)) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [status]);

  // Announce the outcome politely and land focus on the summary heading when
  // a generation this card watched finishes; leaving the page is safe, the
  // result is stored and shown on return.
  useEffect(() => {
    if (isActive(status)) {
      watchedActive.current = true;
      return;
    }
    if (!watchedActive.current) return;
    watchedActive.current = false;
    if (status === 'succeeded') {
      setAnnouncement(t('aiSummary.ready'));
      document.getElementById('report-ai-summary-heading')?.focus();
    } else {
      setAnnouncement(t('aiSummary.failedAnnouncement'));
    }
  }, [status, t]);

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
    setProgress(null);
    setProgressAt(Date.now());
    setNow(Date.now());
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
  // A stale summary keeps its text out of sight until asked for: it may
  // recommend work the owner has since dismissed or fixed. Regenerating stays
  // a user action, so this only informs.
  const stale = Boolean(summary) && (freshness?.stale === true || triageChanged) && !loading;
  const basisCount = stale ? 0 : (summary?.basisRuleIds?.length ?? 0);
  const errorMessage = status === 'failed' ? (message ?? t('aiSummary.errors.unavailable')) : null;
  const stage = progress?.stage ?? 'queued';
  const elapsed = formatElapsed((progress?.elapsedMs ?? 0) + Math.max(0, now - progressAt));

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
            <h2 id="report-ai-summary-heading" tabIndex={-1} className="text-base font-semibold">
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

      {/* One polite region: the stage as it changes, then the outcome. */}
      <p className="sr-only" role="status" aria-live="polite" data-testid="report-ai-summary-announcer">
        {loading ? t(`aiSummary.stage.${stage}`) : announcement}
      </p>

      {loading ? (
        <div
          data-testid="report-ai-summary-loading"
          aria-busy="true"
          className="flex flex-col gap-2"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <p className="font-medium" data-testid="report-ai-summary-stage" data-stage={stage}>
              {t(`aiSummary.stage.${stage}`)}
            </p>
            <p className="text-muted-foreground tabular-nums" data-testid="report-ai-summary-elapsed">
              {t('aiSummary.elapsed', { time: elapsed })}
            </p>
          </div>
          <p className="text-muted-foreground text-xs" data-testid="report-ai-summary-expectation">
            {t('aiSummary.expectation')}
          </p>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      ) : null}

      {errorMessage ? (
        <Alert variant="destructive" role="alert" data-testid="report-ai-summary-error">
          <AlertDescription className="flex flex-col items-start gap-2">
            <p>{errorMessage}</p>
            {progress?.failureCode ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void runSummarize()}
                data-testid="report-ai-summary-try-again"
              >
                {t('aiSummary.tryAgain')}
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {stale ? (
        <Alert data-testid="report-ai-summary-stale">
          <AlertTitle>{t('aiSummary.staleTitle')}</AlertTitle>
          <AlertDescription>
            <p>{t('aiSummary.staleBody')}</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2"
              aria-expanded={showPrevious}
              onClick={() => setShowPrevious((open) => !open)}
              data-testid="report-ai-summary-toggle-previous"
            >
              {showPrevious ? t('aiSummary.hidePrevious') : t('aiSummary.showPrevious')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2 ms-2"
              onClick={() => void runSummarize()}
              data-testid="report-ai-summary-stale-regenerate"
            >
              {t('aiSummary.regenerate')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {summary && (!stale || showPrevious) ? (
        <div className="flex flex-col gap-2">
          {/* The marker sits right next to the text it qualifies: an out-of-date
              summary is never shown beside the list without it. */}
          {stale ? (
            <StatusChip tone="warning" className="self-start" data-testid="report-ai-summary-stale-marker">
              {t('aiSummary.staleMarker')}
            </StatusChip>
          ) : null}
          {summary.structured ? (
            <StructuredSummary structured={summary.structured} siteId={siteId} muted={stale} />
          ) : (
            <p
              data-testid="report-ai-summary-text"
              className={cn('whitespace-pre-line text-sm', stale && 'text-muted-foreground')}
            >
              <Bdi>{summary.text}</Bdi>
            </p>
          )}
          {summary.truncated ? (
            <p data-testid="report-ai-summary-truncated" className="text-muted-foreground text-xs">
              {t('aiSummary.truncatedNote')}
            </p>
          ) : null}
          {basisCount > 0 ? (
            <p className="text-muted-foreground text-xs" data-testid="report-ai-summary-basis">
              {t('aiSummary.basis', { count: basisCount })}
            </p>
          ) : null}
          <p className="text-muted-foreground text-xs" data-testid="report-ai-summary-attribution">
            {t('aiSummary.attribution')}
          </p>
        </div>
      ) : null}
    </section>
  );
};

/** Where each summary item is acted on: a site-workspace tab (report items open their finding). */
const actHref = (siteId: string, item: AiSummaryItem): string =>
  item.whereToAct === 'report'
    ? `/sites/${siteId}?tab=report&finding=${encodeURIComponent(item.ruleId)}`
    : `/sites/${siteId}?tab=${item.whereToAct}`;

/** Status sentence + top items, all rendered as text nodes. */
const StructuredSummary = ({
  structured,
  siteId,
  muted,
}: {
  structured: AiSummaryStructured;
  siteId: string | undefined;
  muted: boolean;
}) => {
  const { t } = useTranslation('report');
  return (
    <div
      data-testid="report-ai-summary-text"
      className={cn('flex flex-col gap-3 text-sm', muted && 'text-muted-foreground')}
    >
      <p data-testid="report-ai-summary-status">
        <Bdi>{structured.status}</Bdi>
      </p>
      {structured.items.length > 0 ? (
        <ol className="flex list-decimal flex-col gap-3 ps-5">
          {structured.items.map((item) => (
            <li key={item.ruleId} data-testid="report-ai-summary-item">
              <p className="font-medium">
                <Bdi>{item.what}</Bdi>
              </p>
              <p>
                <Bdi>{item.why}</Bdi>
              </p>
              <p>
                <span className="font-medium">{t('aiSummary.firstStep')}</span>{' '}
                <Bdi>{item.firstStep}</Bdi>
              </p>
              {siteId ? (
                <Link
                  to={actHref(siteId, item)}
                  className={`text-primary font-medium underline ${TAP_TARGET_LINK}`}
                  data-testid="report-ai-summary-act"
                >
                  {t(`aiSummary.actIn.${item.whereToAct}`)}
                </Link>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
};
