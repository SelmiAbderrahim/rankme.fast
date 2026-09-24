import { apiClient } from '@shared/api/client';
import type {
  CreateSiteResponse,
  DeleteSiteResponse,
  PauseSiteResponse,
  SiteListPage,
  UpdateSiteResponse,
} from './types';

export const fetchSitesRequest = (cursor?: string | null): Promise<SiteListPage> => {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return apiClient<SiteListPage>(`/sites${query}`);
};

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
