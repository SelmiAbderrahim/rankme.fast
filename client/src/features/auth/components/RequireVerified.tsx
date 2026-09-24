import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthSession } from '../useAuthSession';
import { requiredPasswordChangeHref } from '../intent';
import { SessionPending } from './SessionPending';

interface RequireVerifiedProps {
  children: ReactNode;
}

/**
 * Product routes are hard-gated behind email verification. Runs alongside
 * {@link RequireAuth}: an unauthenticated user goes to /login, an
 * authenticated but unverified user is bounced to /verify-email. Session
 * state comes straight from the Better Auth cookie session — nothing is
 * seeded from client-readable storage.
 */
export const RequireVerified = ({ children }: RequireVerifiedProps) => {
  const {
    authenticated,
    emailVerified,
    isPending,
    mustChangePassword,
    provisionalAccount,
  } = useAuthSession();

  if (isPending) {
    return <SessionPending />;
  }
  if (!authenticated) {
    return <Navigate to="/login" replace />;
  }
  if (mustChangePassword) {
    return <Navigate to={requiredPasswordChangeHref('/dashboard')} replace />;
  }
  if (provisionalAccount) {
    return <Navigate to="/team/invitations" replace />;
  }
  if (!emailVerified) {
    return <Navigate to="/verify-email" replace />;
  }
  return <>{children}</>;
};
