import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { Spinner } from '@shared/ui/spinner';
import { Progress } from '@shared/ui/progress';
import {
  CONTENT_ANALYSIS_STATUSES,
  isContentAnalysisTerminal,
  type ContentAnalysis,
} from '../types';

/** The ordered non-terminal pipeline stages (queued → generating_draft). */
const STAGE_ORDER = CONTENT_ANALYSIS_STATUSES.filter(
  (s) => !isContentAnalysisTerminal(s),
);

interface AnalysisProgressProps {
  analysis: ContentAnalysis;
  /**
   * The status poll reached its time limit while the run is still going: the
   * page stops updating, so it says so instead of promising automatic updates.
   */
  capped?: boolean;
}

/**
 * Live progress for a non-terminal analysis: a spinner, an honest step bar
 * (finished steps ÷ 7 — never a fabricated percent or ETA), the current step
 * label and a "step N of 7" counter. Step and stage come from the server's
 * job status; responses from before it fall back to the run status.
 */
export function AnalysisProgress({ analysis, capped = false }: AnalysisProgressProps) {
  const { t } = useTranslation('contentIntelligence');
  const total = analysis.progress?.stepCount ?? STAGE_ORDER.length;
  const currentStep = analysis.progress?.stepIndex ?? STAGE_ORDER.indexOf(analysis.status) + 1;
  const stepKey = analysis.progress?.stepKey ?? analysis.status;
  const percent = Math.round(((currentStep - 1) / total) * 100);

  return (
    <Card data-testid="content-detail-progress" data-status={analysis.status}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Spinner
            className="text-muted-foreground size-4"
            data-testid="content-detail-progress-spinner"
          />
          {t('detail.progress.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <Progress
          value={percent}
          aria-label={t('detail.progress.percentComplete', { percent })}
          data-testid="content-detail-progress-bar"
        />
        <div
          className="flex flex-wrap items-center justify-between gap-2"
          aria-live="polite"
        >
          <span className="font-medium">{t(`status.${stepKey}`)}</span>
          <span
            className="text-muted-foreground text-xs"
            data-testid="content-detail-progress-step"
          >
            {t('detail.progress.step', { current: currentStep, total })}
          </span>
        </div>
        <p className="text-muted-foreground text-xs" data-testid="content-detail-progress-note">
          {capped ? t('detail.progress.stillRunning') : t('detail.progress.autoRefresh')}
        </p>
      </CardContent>
    </Card>
  );
}
