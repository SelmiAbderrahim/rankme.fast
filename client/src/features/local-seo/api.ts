import { apiClient } from '@shared/api/client';
import type { LocalSeoRefreshResult, LocalSeoSnapshot } from './types';

export const fetchLocalSeo = (
  siteId: string,
  init?: { signal?: AbortSignal },
): Promise<LocalSeoSnapshot> => {
  const path = `/sites/${siteId}/local-seo`;
  return init ? apiClient<LocalSeoSnapshot>(path, init) : apiClient<LocalSeoSnapshot>(path);
};

/** Manual refresh — POST because it spends vendor budget (one `local_listing_checks` unit). */
export const refreshLocalSeo = (siteId: string): Promise<LocalSeoRefreshResult> =>
  apiClient<LocalSeoRefreshResult>(`/sites/${siteId}/local-seo/refresh`, {
    method: 'POST',
  });
