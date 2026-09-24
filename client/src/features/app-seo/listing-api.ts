import { apiClient } from '@shared/api/client';
import type {
  AppListingHistoryResponse,
  AppListingReadResponse,
  AppListingRunInput,
  AppListingRunResponse,
} from './listing-types';

const root = (siteId: string) =>
  `/sites/${encodeURIComponent(siteId)}/apps/listing`;

const profileQuery = (profileId: string) =>
  `profileId=${encodeURIComponent(profileId)}`;

export const fetchLatestAppListing = (siteId: string, profileId: string) =>
  apiClient<AppListingReadResponse>(
    `${root(siteId)}/latest?${profileQuery(profileId)}`,
  );

export const fetchAppListingHistory = (
  siteId: string,
  profileId: string,
  limit = 12,
) => apiClient<AppListingHistoryResponse>(
  `${root(siteId)}/history?${profileQuery(profileId)}&limit=${encodeURIComponent(String(limit))}`,
);

export const startAppListingRun = (siteId: string, input: AppListingRunInput) =>
  apiClient<AppListingRunResponse>(`${root(siteId)}/runs`, {
    method: 'POST',
    body: input,
  });
