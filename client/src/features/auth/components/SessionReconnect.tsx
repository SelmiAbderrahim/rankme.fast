import { useTranslation } from 'react-i18next';
import { Button } from '@shared/ui/button';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { useAuthSession } from '../useAuthSession';

/** The session transport error is never shown directly to the user. */
export const SessionReconnect = () => {
  const { t } = useTranslation(['auth', 'common']);
  const { refetch, isRefetching } = useAuthSession();
  return (
    <Alert role="status" className="mx-auto my-4 max-w-lg" data-testid="session-reconnect">
      <AlertDescription className="flex flex-col items-start gap-3">
        <span>{t('auth:sessionUnavailable')}</span>
        <Button type="button" variant="outline" disabled={isRefetching} onClick={() => void refetch?.()}>
          {t('common:retry')}
        </Button>
      </AlertDescription>
    </Alert>
  );
};
