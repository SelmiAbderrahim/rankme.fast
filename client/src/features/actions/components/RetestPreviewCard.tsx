/**
 * Shared audit retest preview presentation.
 *
 * One presentation for BOTH mutation routes: the Actions-item retest
 * (`POST /sites/:siteId/actions/:actionId/retest`) and the shipped
 * report-level retest (`POST /sites/:siteId/audits`). It renders honest
 * static facts only: one retest runs exactly one audit and always runs a
 * fresh crawl.
 */
import { useTranslation } from 'react-i18next';

export function RetestPreviewCard() {
  const { t } = useTranslation('actions');

  return (
    <div
      className="border-border flex flex-col gap-2 rounded-md border p-3 text-sm"
      data-testid="retest-preview"
    >
      <p>
        <span className="text-muted-foreground">{t('retest.unitsLabel')}: </span>
        <span className="font-medium" data-testid="retest-preview-units">
          {t('retest.unitsValue')}
        </span>
      </p>
      <p className="text-muted-foreground">{t('retest.freshRun')}</p>
      <p className="text-muted-foreground" data-testid="retest-preview-remaining">
        {t('retest.selfHosted')}
      </p>
    </div>
  );
}
