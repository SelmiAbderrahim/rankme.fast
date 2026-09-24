import { apiClient } from '@shared/api/client';
import type { AppProfile, RegisterAppProfileInput } from './types';

export const fetchAppProfiles = async (siteId: string): Promise<AppProfile[]> => {
  const response = await apiClient<{ items: AppProfile[] }>(`/sites/${siteId}/apps/profiles`);
  return response.items;
};

export const createAppProfile = async (
  siteId: string,
  input: RegisterAppProfileInput,
): Promise<AppProfile> => {
  const response = await apiClient<{ profile: AppProfile }>(`/sites/${siteId}/apps/profiles`, {
    method: 'POST',
    body: input,
  });
  return response.profile;
};

export const removeAppProfile = async (siteId: string, profileId: string): Promise<void> => {
  await apiClient(`/sites/${siteId}/apps/profiles/${encodeURIComponent(profileId)}`, {
    method: 'DELETE',
  });
};
