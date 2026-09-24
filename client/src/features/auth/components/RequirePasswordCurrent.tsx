import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { requiredPasswordChangeHref } from '../intent';
import { useAuthSession } from '../useAuthSession';
import { SessionPending } from './SessionPending';

interface RequirePasswordCurrentProps {
  children: ReactNode;
}

/** Stop a provisional identity before the application shell starts its API work. */
export const RequirePasswordCurrent = ({ children }: RequirePasswordCurrentProps) => {
  const { authenticated, isPending, mustChangePassword, provisionalAccount } = useAuthSession();
  const location = useLocation();

  if (isPending) return <SessionPending />;
  if (authenticated && mustChangePassword) {
    return (
      <Navigate
        to={requiredPasswordChangeHref(`${location.pathname}${location.search}`)}
        replace
      />
    );
  }
  if (authenticated && provisionalAccount) {
    return <Navigate to="/team/invitations" replace />;
  }
  return <>{children}</>;
};
