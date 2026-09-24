import { apiClient } from '@shared/api/client';
import type { AppSeoComparison } from './compare-types';

export const fetchAppSeoComparison = (siteId: string, profileId: string) =>
  apiClient<AppSeoComparison>(
    `/sites/${encodeURIComponent(siteId)}/apps/compare?profileId=${encodeURIComponent(profileId)}`,
  );
