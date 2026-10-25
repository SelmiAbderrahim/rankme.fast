import { apiClient } from '@shared/api/client';
import type { LocalBusinessSetup, LocalPlaceSearchResult, LocalSeoRefreshResult, LocalSeoSnapshot } from './types';

export const fetchLocalSeo = (
  siteId: string,
  init?: { signal?: AbortSignal },
): Promise<LocalSeoSnapshot> => {
  const path = `/sites/${siteId}/local-seo`;
  return init ? apiClient<LocalSeoSnapshot>(path, init) : apiClient<LocalSeoSnapshot>(path);
};

/** Manual refresh — POST because it asks the listings provider for fresh data. */
export const refreshLocalSeo = (siteId: string): Promise<LocalSeoRefreshResult> =>
  apiClient<LocalSeoRefreshResult>(`/sites/${siteId}/local-seo/refresh`, {
    method: 'POST',
  });

/** Business setup. Reading and saving never call the provider. */
export const fetchLocalBusinessSetup = (siteId: string): Promise<LocalBusinessSetup> =>
  apiClient<LocalBusinessSetup>(`/sites/${siteId}/local-seo/business`);

/** One provider lookup; the results are stored so the owner picks from what came back. */
export const searchLocalBusinessRequest = (siteId: string, query: string): Promise<LocalBusinessSetup> =>
  apiClient<LocalBusinessSetup>(`/sites/${siteId}/local-seo/business/search`, {
    method: 'POST',
    body: { query },
  });

export const selectLocalBusinessRequest = (siteId: string, candidateId: string): Promise<LocalBusinessSetup> =>
  apiClient<LocalBusinessSetup>(`/sites/${siteId}/local-seo/business`, {
    method: 'PUT',
    body: { candidateId },
  });

/** Find a place to centre a geogrid on: the same lookup as the business search, nothing is saved. */
export const searchLocalPlacesRequest = (siteId: string, query: string): Promise<LocalPlaceSearchResult> =>
  apiClient<LocalPlaceSearchResult>(`/sites/${siteId}/local-seo/places/search`, {
    method: 'POST',
    body: { query },
  });
