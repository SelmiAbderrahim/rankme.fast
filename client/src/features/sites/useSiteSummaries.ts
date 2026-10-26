import { useEffect, useState } from 'react';
import type { SiteSummaryRow } from '@features/dashboard/types';
import { fetchSiteSummariesRequest } from './api';

export interface SiteSummariesState {
  byId: ReadonlyMap<string, SiteSummaryRow>;
  loading: boolean;
  failed: boolean;
}

/** Discard a response when the visible Sites page changes during the read. */
export function useSiteSummaries(siteIds: readonly string[]): SiteSummariesState {
  const key = siteIds.join(',');
  const [state, setState] = useState<SiteSummariesState>({ byId: new Map(), loading: key !== '', failed: false });
  useEffect(() => {
    if (!key) { setState({ byId: new Map(), loading: false, failed: false }); return; }
    let current = true;
    setState((previous) => ({ ...previous, loading: true, failed: false }));
    fetchSiteSummariesRequest(key.split(',')).then(
      ({ summaries }) => { if (current) setState({ byId: new Map(summaries.map((row) => [row.id, row])), loading: false, failed: false }); },
      () => { if (current) setState({ byId: new Map(), loading: false, failed: true }); },
    );
    return () => { current = false; };
  }, [key]);
  return state;
}
