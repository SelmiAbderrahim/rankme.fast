import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { StatusChip } from '@shared/ui/status-chip';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { isCompetitorContentCancellable, type CompetitorContentRun } from '../../types';
import { competitorStatusTone } from './status';

interface RunProgressProps {
  run: CompetitorContentRun;
  onCancel?: (() => void) | undefined;
  cancelling?: boolean | undefined;
}

interface StatProps {
  label: string;
  value: number;
  testId: string;
}

function Stat({ label, value, testId }: StatProps) {
  return (
    <div className="border-border flex flex-col gap-1 rounded-md border p-3">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-lg font-semibold tabular-nums" data-testid={testId}>
        {value}
      </span>
    </div>
  );
}

/**
 * Live competitor-run progress: status chip, competitor + page counters,
 * warnings, terminal error, and a cancel affordance while non-terminal.
 */
export function RunProgress({ run, onCancel, cancelling }: RunProgressProps) {
  const { t } = useTranslation('contentIntelligence');
  const cancellable = isCompetitorContentCancellable(run.status);

  return (
    <Card data-testid="competitor-progress" data-status={run.status}>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>{t('competitorContent.progress.title')}</CardTitle>
        <StatusChip tone={competitorStatusTone(run.status)} aria-live="polite">
          {t(`competitorContent.status.${run.status}`)}
        </StatusChip>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            label={t('competitorContent.progress.competitorsRequested')}
            value={run.progress.competitorsRequested}
            testId="competitor-progress-requested"
          />
          <Stat
            label={t('competitorContent.progress.competitorsProcessed')}
            value={run.progress.competitorsProcessed}
            testId="competitor-progress-processed"
          />
          <Stat
            label={t('competitorContent.progress.competitorsFailed')}
            value={run.progress.competitorsFailed}
            testId="competitor-progress-failed"
          />
          <Stat
            label={t('competitorContent.progress.pagesScraped')}
            value={run.progress.pagesScraped}
            testId="competitor-progress-pages"
          />
        </div>

        {run.warnings.length > 0 ? (
          <div data-testid="competitor-progress-warnings">
            <p className="text-sm font-medium">
              {t('competitorContent.progress.warningsTitle')}
            </p>
            <ul className="text-muted-foreground list-disc space-y-1 ps-5 text-sm">
              {run.warnings.map((w) => (
                <li key={w.code}>
                  {w.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {run.error ? (
          <Alert variant="destructive" data-testid="competitor-progress-error">
            <AlertTitle>{t('competitorContent.progress.errorTitle')}</AlertTitle>
            <AlertDescription>
              {t(`competitorContent.errorCategory.${run.error.category}`, {
                defaultValue: t('competitorContent.progress.errorGeneric'),
              })}
            </AlertDescription>
          </Alert>
        ) : null}

        {cancellable && onCancel ? (
          <div>
            <Button
              variant="outline"
              onClick={onCancel}
              loading={cancelling}
              loadingLabel={t('competitorContent.progress.cancelling')}
              data-testid="competitor-progress-cancel"
            >
              {t('competitorContent.progress.cancel')}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
