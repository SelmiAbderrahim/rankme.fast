import { apiClient } from '@shared/api/client';
import type { SiteSummaryRow } from '@features/dashboard/types';
import type { MarketChoice, ResolvedSiteMarket } from '@shared/markets';
import type {
  CreateSiteResponse,
  GetSiteResponse,
  DeleteSiteResponse,
  PauseSiteResponse,
  SiteListPage,
  UpdateSiteResponse,
} from './types';

export const fetchSitesRequest = (
  cursor?: string | null,
  signal?: AbortSignal,
  limit?: number,
): Promise<SiteListPage> => {
  const params: string[] = [];
  if (cursor) params.push(`cursor=${encodeURIComponent(cursor)}`);
  if (limit !== undefined) params.push(`limit=${encodeURIComponent(limit)}`);
  const query = params.length ? `?${params.join('&')}` : '';
  return signal === undefined
    ? apiClient<SiteListPage>(`/sites${query}`)
    : apiClient<SiteListPage>(`/sites${query}`, { signal });
};

export const fetchSiteSummariesRequest = (ids: readonly string[]): Promise<{ summaries: SiteSummaryRow[] }> =>
  apiClient<{ summaries: SiteSummaryRow[] }>(`/dashboard/site-summaries?ids=${encodeURIComponent(ids.join(','))}`);

export const fetchSiteRequest = (id: string): Promise<GetSiteResponse> =>
  apiClient<GetSiteResponse>(`/sites/${encodeURIComponent(id)}`);

export const createSiteRequest = (url: string): Promise<CreateSiteResponse> =>
  apiClient<CreateSiteResponse>('/sites', {
    method: 'POST',
    body: { url },
  });

export const deleteSiteRequest = (id: string): Promise<DeleteSiteResponse> =>
  apiClient<DeleteSiteResponse>(`/sites/${id}`, { method: 'DELETE' });

export const updateSiteRequest = (
  id: string,
  displayName: string,
): Promise<UpdateSiteResponse> =>
  apiClient<UpdateSiteResponse>(`/sites/${id}`, {
    method: 'PATCH',
    body: { displayName },
  });

export const updateSiteMarketRequest = (id: string, market: MarketChoice): Promise<UpdateSiteResponse> =>
  apiClient<UpdateSiteResponse>(`/sites/${encodeURIComponent(id)}`, {
    method: 'PATCH', body: { defaultMarket: market },
  });

export const fetchSiteMarketRequest = (id: string, signal?: AbortSignal): Promise<{
  market: ResolvedSiteMarket & { countryCode: string | null };
}> => apiClient(`/sites/${encodeURIComponent(id)}/market`, signal ? { signal } : {});

export const pauseSiteRequest = (id: string): Promise<PauseSiteResponse> =>
  apiClient<PauseSiteResponse>(`/sites/${id}/pause`, { method: 'POST' });

export const resumeSiteRequest = (id: string): Promise<PauseSiteResponse> =>
  apiClient<PauseSiteResponse>(`/sites/${id}/resume`, { method: 'POST' });
