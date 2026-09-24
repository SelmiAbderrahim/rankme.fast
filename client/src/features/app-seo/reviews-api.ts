import { apiClient } from '@shared/api/client';
import type {
  AppReviewRunDetail,
  AppReviewRunListResponse,
  StartAppReviewRunInput,
  StartAppReviewRunResponse,
} from './reviews-types';

const root = (siteId: string) => `/sites/${encodeURIComponent(siteId)}/apps/reviews/runs`;

export const fetchAppReviewRuns = (
  siteId: string,
  profileId: string,
  store: StartAppReviewRunInput['store'],
) => apiClient<AppReviewRunListResponse>(
  `${root(siteId)}?profileId=${encodeURIComponent(profileId)}&store=${encodeURIComponent(store)}`,
);

export const fetchAppReviewRun = async (
  siteId: string,
  runId: string,
): Promise<AppReviewRunDetail> => {
  const response = await apiClient<{ run: AppReviewRunDetail }>(
    `${root(siteId)}/${encodeURIComponent(runId)}`,
  );
  return response.run;
};

export const startAppReviewRun = (
  siteId: string,
  input: StartAppReviewRunInput,
) => apiClient<StartAppReviewRunResponse>(root(siteId), { method: 'POST', body: input });

