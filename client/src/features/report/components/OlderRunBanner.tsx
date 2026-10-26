import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { History } from 'lucide-react';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { formatAbsoluteDate } from '@shared/lib/datetime';
import { TAP_TARGET_LINK } from '@shared/ui/tap-target';

/**
 * Persistent notice on a pinned audit that is not the site's newest one
 *, with the way back to the latest report. It never shows
 * on the latest report itself.
 */
export const OlderRunBanner = ({
  siteId,
  runAt,
}: {
  siteId: string;
  /** When the pinned run finished (ISO); null = unknown, the date is left out. */
  runAt: string | null;
}) => {
  const { t, i18n } = useTranslation('report');
  return (
    <Alert role="status" data-testid="report-older-run">
      <History aria-hidden="true" />
      <AlertDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>
          {runAt
            ? t('olderRun.viewing', { date: formatAbsoluteDate(runAt, i18n.language) })
            : t('olderRun.viewingUndated')}
        </span>
        <Link
          to={`/sites/${siteId}?tab=report`}
          className={`text-primary font-medium underline ${TAP_TARGET_LINK}`}
          data-testid="report-older-run-latest"
        >
          {t('olderRun.backToLatest')}
        </Link>
      </AlertDescription>
    </Alert>
  );
};
