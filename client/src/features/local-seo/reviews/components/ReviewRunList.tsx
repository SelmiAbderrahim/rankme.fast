import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Skeleton } from '@shared/ui/skeleton';
import { StatusChip, type StatusTone } from '@shared/ui/status-chip';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { TableHeaderHelp } from '@shared/ui/table-header-help';
import type {
  ReviewAiTerminalState,
  ReviewRequestStatus,
  ReviewRun,
  ReviewRunStatus,
  ReviewSourceOutcome,
} from '../types';

const RUN_TONES: Record<ReviewRunStatus, StatusTone> = {
  queued: 'warning',
  running: 'info',
  succeeded: 'success',
  partial: 'warning',
  failed: 'destructive',
};

const OUTCOME_TONES: Record<ReviewSourceOutcome, StatusTone> = {
  ok: 'success',
  failed: 'destructive',
  zeroNew: 'muted',
};

const AI_TONES: Record<ReviewAiTerminalState, StatusTone> = {
  pending: 'warning',
  'themes-ok': 'success',
  'no-reliable-themes': 'muted',
  'ai-failed-reviews-intact': 'warning',
};

const AI_LABEL_KEYS: Record<ReviewAiTerminalState, string> = {
  pending: 'runs.ai.pending',
  'themes-ok': 'runs.ai.themesOk',
  'no-reliable-themes': 'runs.ai.noReliableThemes',
  'ai-failed-reviews-intact': 'runs.ai.aiFailed',
};

interface ReviewRunListProps {
  runs: ReviewRun[];
  status: ReviewRequestStatus;
  error: string;
  selectedRunId: string | null;
  onSelect: (runId: string) => void;
}

/**
 * Bounded run history (the server pages at 20 by default and hands back a
 * cursor; this surface renders the first page and selects into detail).
 * Every per-source outcome is disclosed — a partial sync must not read as a
 * clean one.
 */
export const ReviewRunList = ({
  runs,
  status,
  error,
  selectedRunId,
  onSelect,
}: ReviewRunListProps) => {
  const { t, i18n } = useTranslation(['reviewIntelligence', 'language']);
  const dateTime = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }),
    [i18n.language],
  );

  if (status === 'loading' && runs.length === 0) {
    return (
      <Card aria-busy="true" data-testid="reviews-runs-loading">
        <CardHeader>
          <CardTitle>{t('runs.title')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="reviews-runs">
      <CardHeader>
        <CardTitle>{t('runs.title')}</CardTitle>
        <CardDescription>{t('runs.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <Alert role="alert" data-testid="reviews-runs-error">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {runs.length === 0 && !error ? (
          <p className="text-muted-foreground text-sm" data-testid="reviews-runs-empty">
            {t('runs.empty')}
          </p>
        ) : null}
        {runs.length > 0 ? (
          <Table>
            <caption className="sr-only">{t('runs.title')}</caption>
            <TableHeader>
              <TableRow>
                <TableHead>{t('runs.createdAt')}</TableHead>
                <TableHead>{t('runs.columns.status')}</TableHead>
                <TableHead>
                  <TableHeaderHelp
                    label={t('runs.columns.outcomes')}
                    description={t('common:tableHelp.reviewOutcomes')}
                  />
                </TableHead>
                <TableHead className="text-end">
                  <TableHeaderHelp
                    label={t('runs.columns.retained')}
                    description={t('common:tableHelp.retainedReviews')}
                  />
                </TableHead>
                <TableHead>
                  <TableHeaderHelp
                    label={t('runs.columns.ai')}
                    description={t('common:tableHelp.aiProcessing')}
                  />
                </TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => (
                <TableRow
                  key={run.id}
                  data-testid={`reviews-run-row-${run.id}`}
                  data-selected={run.id === selectedRunId ? 'true' : undefined}
                >
                  <TableCell>{dateTime.format(new Date(run.createdAt))}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      <StatusChip tone={RUN_TONES[run.status]}>
                        {t(`runs.status.${run.status}`)}
                      </StatusChip>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {run.perSourceOutcomes.length === 0 ? (
                        <span className="text-muted-foreground text-sm">—</span>
                      ) : (
                        run.perSourceOutcomes.map((outcome) => (
                          <StatusChip
                            key={outcome.source}
                            tone={OUTCOME_TONES[outcome.outcome]}
                            data-testid={`reviews-run-outcome-${run.id}-${outcome.source}`}
                          >
                            {t(`sourceNames.${outcome.source}`)} ·{' '}
                            {t(`runs.outcome.${outcome.outcome}`)}
                          </StatusChip>
                        ))
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-end tabular-nums">{run.retainedCount}</TableCell>
                  <TableCell>
                    <StatusChip
                      tone={AI_TONES[run.aiTerminalState]}
                      data-testid={`reviews-run-ai-${run.id}`}
                    >
                      {t(AI_LABEL_KEYS[run.aiTerminalState])}
                    </StatusChip>
                    {run.outputLocale ? (
                      <StatusChip tone="muted" data-testid={`reviews-run-locale-${run.id}`}>
                        {t('outputLocale', {
                          locale: t(`language:names.${run.outputLocale}`),
                        })}
                      </StatusChip>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      data-testid={`reviews-run-open-${run.id}`}
                      onClick={() => onSelect(run.id)}
                    >
                      {t('runs.view')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </CardContent>
    </Card>
  );
};
