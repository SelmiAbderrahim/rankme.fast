import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { resetAccountState } from '@app/store';
import { useAppDispatch } from '@shared/hooks/redux';
import { authClient } from './authClient';
import { sessionMutation } from './sessionMutation';

/** One sign-out action clears account data even if the transport fails. */
export function useSignOut(): { signOut: () => Promise<void>; signingOut: boolean } {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const [signingOut, setSigningOut] = useState(false);
  const inFlight = useRef(false);

  const signOut = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSigningOut(true);
    try {
      await sessionMutation(() => authClient.signOut());
    } catch {
      // Local account data must still be cleared after an attempted sign-out.
    } finally {
      dispatch(resetAccountState());
      navigate('/login');
      inFlight.current = false;
      setSigningOut(false);
    }
  }, [dispatch, navigate]);

  return { signOut, signingOut };
}
