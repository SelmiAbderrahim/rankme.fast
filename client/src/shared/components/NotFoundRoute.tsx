import { RequirePasswordCurrent, SessionPending, useAuthSession } from '@features/auth';
import { AppLayout } from './AppLayout';
import { NotFound } from './NotFound';
import { PublicLayout } from './PublicLayout';

/**
 * The 404 for a path no route claims. A signed-in user stays inside the
 * authenticated app shell (sidebar, top bar, no sign-in/sign-up calls to
 * action); everyone else gets the public shell. The server always renders the
 * public variant and the browser hydrates it first, so the session decides the
 * shell only after hydration. A client-only render waits for the session
 * instead of flashing the signed-out chrome.
 */
export const NotFoundRoute = () => {
  const { authenticated, isPending } = useAuthSession();

  if (authenticated) {
    return (
      <RequirePasswordCurrent>
        <AppLayout>
          <NotFound />
        </AppLayout>
      </RequirePasswordCurrent>
    );
  }

  const hydratingServerHtml = typeof window === 'undefined' || window.__SSR__ === true;
  if (isPending && !hydratingServerHtml) return <SessionPending />;

  return (
    <PublicLayout>
      <NotFound />
    </PublicLayout>
  );
};
