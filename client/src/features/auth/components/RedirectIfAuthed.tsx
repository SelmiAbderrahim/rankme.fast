import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthSession } from '../useAuthSession';
import { authSuccessHref, requiredPasswordChangeHref, verifyEmailHref } from '../intent';
import { SessionPending } from './SessionPending';

interface RedirectIfAuthedProps {
  children: ReactNode;
  /** Where to send an already-authenticated visitor. Defaults to /dashboard. */
  to?: string;
}

/**
 * Inverse of {@link RequireAuth}. Guest-only surfaces — login, register,
 * forgot/reset-password — wrap their element so an authenticated session is
 * bounced to the product shell instead of showing a stale form. The initial
 * redirect target for authenticated-but-unverified users is /verify-email;
 * that screen owns the "check your inbox" story, so it wins over /dashboard.
 */
export const RedirectIfAuthed = ({ children, to }: RedirectIfAuthedProps) => {
  const {
    authenticated,
    emailVerified,
    isPending,
    mustChangePassword,
    provisionalAccount,
  } = useAuthSession();
  const location = useLocation();

  if (isPending) {
    return <SessionPending />;
  }
  if (authenticated) {
    const target = mustChangePassword
      ? requiredPasswordChangeHref(authSuccessHref(location.search))
      : provisionalAccount
        ? '/team/invitations'
      : !emailVerified
      ? verifyEmailHref(location.search)
      : to ?? authSuccessHref(location.search);
    return <Navigate to={target} replace />;
  }

  return <>{children}</>;
};
