import { apiClient } from '@shared/api/client';
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

export const pauseSiteRequest = (id: string): Promise<PauseSiteResponse> =>
  apiClient<PauseSiteResponse>(`/sites/${id}/pause`, { method: 'POST' });

export const resumeSiteRequest = (id: string): Promise<PauseSiteResponse> =>
  apiClient<PauseSiteResponse>(`/sites/${id}/resume`, { method: 'POST' });
