import { useCallback, useEffect, useState } from 'react';
import { fetchSitesRequest } from './api';
import type { Site } from './types';

export const SITE_PICKER_PAGE_SIZE = 100;
/** Operational read guard for pickers, independent of site creation capacity. */
export const SITE_PICKER_MAX_PAGES = 100;
export type AllSitesState =
  | { status: 'loading'; sites: Site[] }
  | { status: 'ready'; sites: Site[]; truncated: boolean }
  | { status: 'error'; sites: Site[] };

/** Read picker options without changing the paginated Sites store. */
export function useAllSites(): AllSitesState & { retry: () => void } {
  const [state, setState] = useState<AllSitesState>({ status: 'loading', sites: [] });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading', sites: [] });
    void (async () => {
      const sites: Site[] = [];
      const cursors = new Set<string>();
      let cursor: string | null = null;
      try {
        for (let page = 0; page < SITE_PICKER_MAX_PAGES; page += 1) {
          const result = await fetchSitesRequest(cursor, controller.signal, SITE_PICKER_PAGE_SIZE);
          if (controller.signal.aborted) return;
          sites.push(...result.sites);
          cursor = result.nextCursor;
          if (!cursor || cursors.has(cursor)) break;
          cursors.add(cursor);
        }
        setState({ status: 'ready', sites, truncated: Boolean(cursor) });
      } catch {
        if (!controller.signal.aborted) setState({ status: 'error', sites });
      }
    })();
    return () => controller.abort();
  }, [attempt]);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { ...state, retry };
}
