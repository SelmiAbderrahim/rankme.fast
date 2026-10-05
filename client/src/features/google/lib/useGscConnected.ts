import { useEffect, useState } from 'react';
import { getConnectionConfiguration } from '../api';
import { hasGscScope } from './googleScopes';

/**
 * `unknown` means the connection could not be read; callers must not claim the
 * site is disconnected on a failed lookup.
 */
export type GscConnectedState = 'loading' | 'connected' | 'disconnected' | 'unknown';

/**
 * Whether Search Console is usable for a site: a healthy Google connection,
 * a bound property, and the Search Console scope. Read-only and local to the
 * caller, so it never touches the Google tab's own store.
 */
export function useGscConnected(siteId: string): GscConnectedState {
  const [result, setResult] = useState<{ siteId: string; state: GscConnectedState }>({
    siteId,
    state: 'loading',
  });

  useEffect(() => {
    let active = true;
    getConnectionConfiguration(siteId)
      .then((connection) => {
        if (!active) return;
        const connected =
          connection?.status === 'connected' &&
          Boolean(connection.propertyUrl) &&
          hasGscScope(connection);
        setResult({ siteId, state: connected ? 'connected' : 'disconnected' });
      })
      .catch(() => {
        if (active) setResult({ siteId, state: 'unknown' });
      });
    return () => {
      active = false;
    };
  }, [siteId]);

  return result.siteId === siteId ? result.state : 'loading';
}
