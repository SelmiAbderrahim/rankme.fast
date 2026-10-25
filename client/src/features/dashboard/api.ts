import { apiClient } from '@shared/api/client';
import type { SiteHealthResponse } from './types';

/** A stored-data read; the server never starts vendor work. */
export const fetchSiteHealthRequest = (): Promise<SiteHealthResponse> =>
  apiClient<SiteHealthResponse>('/dashboard/site-health');
