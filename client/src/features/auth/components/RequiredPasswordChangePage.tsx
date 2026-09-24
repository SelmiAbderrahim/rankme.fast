import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { safeTeamReturnTo } from '../intent';
import { ChangePassword } from './ChangePassword';

export const RequiredPasswordChangePage = () => {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Keep the validated invitation intent for the lifetime of this page. The
  // auth/session refresh after a successful password mutation can scrub the
  // query string before ChangePassword invokes onSuccess; recalculating from
  // that transient URL would incorrectly drop the user at the invitation list.
  const returnTo = useRef(
    safeTeamReturnTo(searchParams.get('returnTo')) ?? '/team/invitations',
  );

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-10">
      <Alert>
        <AlertDescription>{t('provisional.passwordNotice')}</AlertDescription>
      </Alert>
      <ChangePassword onSuccess={() => navigate(returnTo.current, { replace: true })} />
    </main>
  );
};
