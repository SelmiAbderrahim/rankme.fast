import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSignOut } from '../useSignOut';

export const Logout = () => {
  const { t } = useTranslation('auth');
  const { signOut } = useSignOut();

  useEffect(() => {
    void signOut();
  }, [signOut]);

  return (
    <div
      className="text-muted-foreground flex min-h-[70vh] items-center justify-center text-sm"
      role="status"
      aria-live="polite"
    >
      {t('logoutGoodbye')}
    </div>
  );
};
