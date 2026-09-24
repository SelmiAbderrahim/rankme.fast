import { useTranslation } from 'react-i18next';
import { Badge } from '@shared/ui/badge';
import { Button } from '@shared/ui/button';
import type { KeywordClusterRunSummary } from '../types';

interface RunListProps {
  runs: readonly KeywordClusterRunSummary[];
  activeRunId: string | null;
  onOpen: (runId: string) => void;
}

export const RunList = ({ runs, activeRunId, onOpen }: RunListProps) => {
  const { t } = useTranslation('keywordClusters');
  return (
    <ul className="space-y-2" data-testid="keyword-clusters-runs">
      {runs.map((run) => (
        <li
          key={run.id}
          className="border-border flex flex-wrap items-center justify-between gap-3 border p-3"
          data-testid={`keyword-clusters-run-${run.id}`}
        >
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{t(`status.${run.status}`)}</Badge>
              <span className="text-sm font-medium">
                {t('runs.summary', {
                  clusters: run.groupedClusterCount,
                  keywords: run.keywordCount,
                })}
              </span>
            </div>
            <p className="text-muted-foreground text-xs">
              {t('runs.requestedAt', { date: run.requestedAt })}
            </p>
          </div>
          <Button
            type="button"
            variant={activeRunId === run.id ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => onOpen(run.id)}
            data-testid={`keyword-clusters-open-${run.id}`}
          >
            {t('runs.open')}
          </Button>
        </li>
      ))}
    </ul>
  );
};
