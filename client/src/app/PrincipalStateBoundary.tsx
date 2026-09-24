import { useEffect, useLayoutEffect, useRef } from 'react';
import { useAuthSession } from '@features/auth';
import { useAppDispatch } from '@shared/hooks/redux';
import { resetAccountState } from './store';

const UNRESOLVED = Symbol('unresolved-principal');

// Layout timing prevents a newly authenticated principal from painting the
// previous account's cached Redux data. SSR has no layout phase, so useEffect
// avoids React's server warning there.
const useBeforePaintEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * Binds the browser Redux singleton to the settled Better Auth principal.
 * Explicit logout, session expiry, and a direct A -> B account switch all
 * reset the complete reducer tree before the next account can paint it.
 */
export const PrincipalStateBoundary = () => {
  const dispatch = useAppDispatch();
  const { authenticated, isPending, user } = useAuthSession();
  const previous = useRef<string | null | typeof UNRESOLVED>(UNRESOLVED);

  useBeforePaintEffect(() => {
    if (isPending) return;

    const current = authenticated ? (user?.id ?? null) : null;
    if (previous.current === UNRESOLVED) {
      previous.current = current;
      return;
    }
    if (previous.current !== current) {
      dispatch(resetAccountState());
      previous.current = current;
    }
  }, [authenticated, dispatch, isPending, user?.id]);

  return null;
};
