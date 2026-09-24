/**
 * Honest state surfaces. Each renders the SERVER's localized
 * message plus the one action that is actually available — the client never
 * invents a reason for a refusal it did not author.
 *
 * data-testid contract:
 *   - geogrid-gate-<kind>       one per refusal kind
 *   - geogrid-partial-banner    partial-scan disclosure
 *   - geogrid-failed-banner     all-failed disclosure
 */
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import type { GeogridGate, GeogridScanSummary } from '../types';

export const GeogridGateNotice = ({ gate }: { gate: GeogridGate }) => {
  const { t } = useTranslation('geogrid');
  return (
    <Alert
      data-testid={`geogrid-gate-${gate.kind}`}
      variant={gate.kind === 'failed' || gate.kind === 'invalid' ? 'destructive' : 'default'}
    >
      <AlertTitle>{t(`gates.${gate.kind}`)}</AlertTitle>
      <AlertDescription>
        <span>{gate.message}</span>
      </AlertDescription>
    </Alert>
  );
};

/**
 * Terminal-state disclosure for a stored scan. A partial scan names the exact
 * number of grid points that failed; a fully failed scan says nothing answered.
 */
export const GeogridOutcomeBanner = ({ scan }: { scan: GeogridScanSummary }) => {
  const { t } = useTranslation('geogrid');
  if (scan.status === 'completed_partial') {
    return (
      <Alert data-testid="geogrid-partial-banner">
        <AlertTitle>{t('outcome.partialTitle')}</AlertTitle>
        <AlertDescription>
          {t('outcome.partialBody', {
            failed: scan.failedCells,
            total: scan.totalCells,
          })}
        </AlertDescription>
      </Alert>
    );
  }
  if (scan.status === 'failed') {
    return (
      <Alert data-testid="geogrid-failed-banner" variant="destructive">
        <AlertTitle>{t('outcome.failedTitle')}</AlertTitle>
        <AlertDescription>
          {t('outcome.failedBody')}
        </AlertDescription>
      </Alert>
    );
  }
  return null;
};
