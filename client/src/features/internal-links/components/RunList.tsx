import { useTranslation } from 'react-i18next';
import { Badge } from '@shared/ui/badge';
import { Button } from '@shared/ui/button';
import { Card, CardContent } from '@shared/ui/card';
import type { InternalLinkRunSummary } from '../types';

interface RunListProps {
  runs: InternalLinkRunSummary[];
  activeRunId: string | null;
  onOpen: (runId: string) => void;
}

export const RunList = ({ runs, activeRunId, onOpen }: RunListProps) => {
  const { t } = useTranslation('internalLinks');
  return (
    <div className="grid gap-3" data-testid="internal-links-run-list">
      {runs.map((run) => (
        <Card key={run.id} data-testid={`internal-links-run-${run.id}`}>
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={run.status === 'failed' ? 'destructive' : 'secondary'}>
                  {t(`status.${run.status}`)}
                </Badge>
                {run.refunded ? <Badge variant="outline">{t('status.refunded')}</Badge> : null}
              </div>
              <p className="text-sm font-medium">
                {t('runs.snapshot', { date: run.inventoryDate })}
              </p>
              <p className="text-muted-foreground text-xs">
                {t('runs.suggestionCount', { count: run.suggestionCount })}
              </p>
            </div>
            <Button
              type="button"
              variant={activeRunId === run.id ? 'secondary' : 'outline'}
              onClick={() => onOpen(run.id)}
              data-testid={`internal-links-open-${run.id}`}
            >
              {t('runs.open')}
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

