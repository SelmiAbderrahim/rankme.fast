import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthSession } from '../useAuthSession';
import { SessionPending } from './SessionPending';

interface RequireAuthProps {
  children: ReactNode;
}

/**
 * Session gate. The Better Auth session hook resolves the cookie-backed
 * session; while it's in flight we show a pending state (not a premature
 * redirect — a hard refresh with a valid cookie must NOT bounce to /login).
 */
export const RequireAuth = ({ children }: RequireAuthProps) => {
  const { authenticated, isPending } = useAuthSession();
  const location = useLocation();

  if (isPending) {
    return <SessionPending />;
  }
  if (!authenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
};
