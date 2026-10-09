import { authClient } from './authClient';

/** Minimum gap between two focus-triggered `GET /api/auth/get-session` calls. */
export const SESSION_FOCUS_MIN_INTERVAL_MS = 60_000;

interface KeepAliveDeps {
  client?: Pick<typeof authClient, '$store'>;
  doc?: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>;
  now?: () => number;
}

/**
 * Keeps the Better Auth session atom mounted for the lifetime of the page and
 * refreshes it when the tab becomes visible, at most once per
 * `SESSION_FOCUS_MIN_INTERVAL_MS`.
 *
 * Better Auth fetches `/get-session` each time its atom mounts, and the atom
 * unmounts whenever no component is subscribed (every route-guard swap), so
 * ordinary navigation re-fetched the session over and over. A permanent no-op
 * listener makes the first fetch the only mount fetch; tab-return refreshes
 * still catch a revoked or expired session. Returns a disposer.
 */
export const retainAuthSession = ({
  client = authClient,
  doc = document,
  now = Date.now,
}: KeepAliveDeps = {}): (() => void) => {
  const unlisten = client.$store.atoms.session!.listen(() => {});
  let lastRefresh = now();
  const onVisible = () => {
    if (doc.visibilityState !== 'visible') return;
    if (now() - lastRefresh < SESSION_FOCUS_MIN_INTERVAL_MS) return;
    lastRefresh = now();
    client.$store.notify('$sessionSignal');
  };
  doc.addEventListener('visibilitychange', onVisible);
  return () => {
    doc.removeEventListener('visibilitychange', onVisible);
    unlisten();
  };
};
