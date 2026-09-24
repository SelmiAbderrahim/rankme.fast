import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAppDispatch } from '@shared/hooks/redux';
import { resetAccountState } from '@app/store';
import { authClient } from '../authClient';

export const Logout = () => {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { t } = useTranslation('auth');

  useEffect(() => {
    // signOut resolves with `{ error }` rather than rejecting; either way the
    // only sensible landing is the login screen. Keep the rejection branch
    // explicit as a transport failure must not retain another principal's
    // account-scoped cache in this browser tab.
    const finishLogout = () => {
      dispatch(resetAccountState());
      navigate('/login');
    };
    void authClient.signOut().then(finishLogout, finishLogout);
  }, [dispatch, navigate]);

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
