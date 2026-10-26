import { useLayoutEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

/** Window-scrolling public layouts only; app shells use useShellScrollRestoration. */
export function useScrollTopOnNavigate(): void {
  const { pathname, hash } = useLocation();
  const navigation = useNavigationType();
  useLayoutEffect(() => {
    if (navigation === 'POP' || hash) return;
    if (typeof window.scrollTo === 'function') window.scrollTo(0, 0);
    // Query-only changes preserve the reader's position.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);
}
