import { useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { UNSAFE_DataRouterStateContext } from 'react-router-dom';
import { Spinner } from '@shared/ui/spinner';

/** Keep the current screen usable while the next route's chunk or loader settles. */
export const NavigationPendingIndicator = () => {
  const { t } = useTranslation('common');
  const state = useContext(UNSAFE_DataRouterStateContext);
  const pending = state !== null && state.navigation.state !== 'idle';
  return (
    <span role={pending ? 'status' : undefined} aria-live="polite" className="inline-flex shrink-0 items-center">
      {pending ? (
        <>
          <Spinner className="size-4 text-muted-foreground" />
          <span className="sr-only">{t('shell.navigating')}</span>
        </>
      ) : null}
    </span>
  );
};
