import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@shared/api/client';
import { fetchSiteRequest } from './api';
import type { Site } from './types';

export type SiteLookupStatus = 'idle' | 'loading' | 'found' | 'notFound' | 'error';

export interface SiteLookup {
  status: SiteLookupStatus;
  site: Site | null;
  retry: () => void;
}

/**
 * Resolve one site by id when it is not already in the (paginated) sites list.
 * A 404 — the API's single answer for a missing id, another account's site, and
 * a site outside the caller's team scope — is a definitive `notFound`; any other
 * failure (network, timeout, 5xx) is a retryable `error`, never "not found".
 */
export const useSiteLookup = (siteId: string, enabled: boolean): SiteLookup => {
  const [state, setState] = useState<{ siteId: string; status: SiteLookupStatus; site: Site | null }>({
    siteId,
    status: 'idle',
    site: null,
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    setState({ siteId, status: 'loading', site: null });
    fetchSiteRequest(siteId)
      .then(({ site }) => {
        if (!cancelled) setState({ siteId, status: 'found', site });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const status = err instanceof ApiError && err.status === 404 ? 'notFound' : 'error';
        setState({ siteId, status, site: null });
      });
    return () => {
      cancelled = true;
    };
  }, [siteId, enabled, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  // A result for a previous id must never be shown for the current one.
  if (state.siteId !== siteId) return { status: 'idle', site: null, retry };
  return { status: state.status, site: state.site, retry };
};
