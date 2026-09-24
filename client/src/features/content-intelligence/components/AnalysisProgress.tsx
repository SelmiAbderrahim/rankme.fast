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
const TOTAL_STAGES = STAGE_ORDER.length;

interface AnalysisProgressProps {
  analysis: ContentAnalysis;
}

/**
 * Live progress for a non-terminal analysis: a spinner, an honest completed-
 * stage progress bar (real closed stages ÷ 7 — never a fabricated percent or
 * ETA), the current stage label, and a "step N of 7" counter. Driven by the
 * detail view's bounded poll. Mirrors `audience-research/RunStatusCard` and
 * `inventory/InventoryProgress`.
 */
export function AnalysisProgress({ analysis }: AnalysisProgressProps) {
  const { t } = useTranslation('contentIntelligence');
  const completed = analysis.stages.filter((s) => s.completedAt !== null).length;
  // Only non-terminal statuses reach this component, and every one of them is
  // in STAGE_ORDER, so indexOf is always ≥ 0.
  const currentStep = STAGE_ORDER.indexOf(analysis.status) + 1;
  const percent = Math.round((completed / TOTAL_STAGES) * 100);

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
          <span className="font-medium">{t(`status.${analysis.status}`)}</span>
          <span
            className="text-muted-foreground text-xs"
            data-testid="content-detail-progress-step"
          >
            {t('detail.progress.step', { current: currentStep, total: TOTAL_STAGES })}
          </span>
        </div>
        <p className="text-muted-foreground text-xs">
          {t('detail.progress.autoRefresh')}
        </p>
      </CardContent>
    </Card>
  );
}
