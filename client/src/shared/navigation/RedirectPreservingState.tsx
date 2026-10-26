import { Navigate, useLocation } from 'react-router-dom';

interface RedirectPreservingStateProps {
  to: string;
}

/** Keep URL and router state when replacing a legacy history entry. */
export const RedirectPreservingState = ({ to }: RedirectPreservingStateProps) => {
  const { search, hash, state } = useLocation();
  return <Navigate to={{ pathname: to, search, hash }} state={state} replace />;
};
