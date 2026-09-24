import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { StatusChip } from '@shared/ui/status-chip';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { isContentInventoryCancellable, type InventoryRun } from '../../types';
import { inventoryStatusTone } from './status';

interface InventoryProgressProps {
  run: InventoryRun;
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
 * Live run progress: status chip, page + block counters, warnings, terminal
 * error, and a cancel affordance while the run is non-terminal.
 */
export function InventoryProgress({ run, onCancel, cancelling }: InventoryProgressProps) {
  const { t } = useTranslation('contentIntelligence');
  const cancellable = isContentInventoryCancellable(run.status);

  return (
    <Card data-testid="inventory-progress" data-status={run.status}>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>{t('inventory.progress.title')}</CardTitle>
        <StatusChip tone={inventoryStatusTone(run.status)} aria-live="polite">
          {t(`inventory.status.${run.status}`)}
        </StatusChip>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Stat
            label={t('inventory.progress.pagesRequested')}
            value={run.progress.pagesRequested}
            testId="inventory-progress-requested"
          />
          <Stat
            label={t('inventory.progress.pagesProcessed')}
            value={run.progress.pagesProcessed}
            testId="inventory-progress-processed"
          />
          <Stat
            label={t('inventory.progress.pagesFailed')}
            value={run.progress.pagesFailed}
            testId="inventory-progress-failed"
          />
          <Stat
            label={t('inventory.progress.blocksReserved')}
            value={run.progress.blocksReserved}
            testId="inventory-progress-reserved"
          />
          <Stat
            label={t('inventory.progress.blocksRefunded')}
            value={run.progress.blocksRefunded}
            testId="inventory-progress-refunded"
          />
        </div>

        {run.warnings.length > 0 ? (
          <div data-testid="inventory-progress-warnings">
            <p className="text-sm font-medium">{t('inventory.progress.warningsTitle')}</p>
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
          <Alert variant="destructive" data-testid="inventory-progress-error">
            <AlertTitle>{t('inventory.progress.errorTitle')}</AlertTitle>
            <AlertDescription>
              {t(`inventory.errorCategory.${run.error.category}`, {
                defaultValue: t('inventory.progress.errorGeneric'),
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
              loadingLabel={t('inventory.progress.cancelling')}
              data-testid="inventory-progress-cancel"
            >
              {t('inventory.progress.cancel')}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
