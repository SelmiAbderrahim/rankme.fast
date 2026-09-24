import { apiClient } from '@shared/api/client';
import type {
  AppChartHistoryPoint,
  AppChartListResponse,
  AppChartSubscription,
  CreateAppChartSubscriptionInput,
  RecheckAppChartResponse,
} from './charts-types';

const root = (siteId: string) => `/sites/${siteId}/apps/charts`;

export const fetchAppChartSubscriptions = (siteId: string, profileId: string) =>
  apiClient<AppChartListResponse>(
    `${root(siteId)}?profileId=${encodeURIComponent(profileId)}`,
  );

export const createTrackedAppChart = async (
  siteId: string,
  input: CreateAppChartSubscriptionInput,
): Promise<AppChartSubscription> => {
  const response = await apiClient<{ subscription: AppChartSubscription }>(root(siteId), {
    method: 'POST',
    body: input,
  });
  return response.subscription;
};

export const removeTrackedAppChart = (siteId: string, subscriptionId: string) =>
  apiClient<void>(`${root(siteId)}/${encodeURIComponent(subscriptionId)}`, {
    method: 'DELETE',
  });

export const recheckTrackedAppChart = (
  siteId: string,
  subscriptionId: string,
  confirm: boolean,
) => apiClient<RecheckAppChartResponse>(
  `${root(siteId)}/${encodeURIComponent(subscriptionId)}/recheck`,
  { method: 'POST', body: { confirm } },
);

export const fetchTrackedAppChartHistory = async (
  siteId: string,
  subscriptionId: string,
): Promise<AppChartHistoryPoint[]> => {
  const response = await apiClient<{ items: AppChartHistoryPoint[] }>(
    `${root(siteId)}/${encodeURIComponent(subscriptionId)}/history`,
  );
  return response.items;
};
