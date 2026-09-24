import { apiClient } from '@shared/api/client';
import { parseObservationMeta } from '@shared/observations/observations';
import type { ObservationMeta } from '@shared/observations/types';
import type {
  ReviewInventoryFilters,
  ReviewInventoryResponse,
  ReviewRun,
  ReviewRunListResponse,
  ReviewSource,
  ReviewSourceListResponse,
  ReviewSourceName,
  ReviewSpendPreview,
  ReviewStats,
  ReviewSyncSubmitResult,
  ReviewThemesResponse,
} from './types';

const ROOT = '/local-seo/reviews';

const parseObservation = (value: unknown): ObservationMeta | null =>
  value === null ? null : parseObservationMeta(value);

const inventoryParams = (
  profileId: string,
  filters: ReviewInventoryFilters,
  includePage: boolean,
): URLSearchParams => {
  const params = new URLSearchParams({ profileId });
  if (includePage) params.set('page', String(filters.page));
  if (filters.src) params.set('src', filters.src);
  if (filters.rating !== undefined) params.set('rating', String(filters.rating));
  if (filters.q) params.set('q', filters.q);
  if (filters.sort && filters.sort !== 'newest') params.set('sort', filters.sort);
  return params;
};

export const fetchReviewSources = (
  profileId: string,
  init?: { signal?: AbortSignal },
): Promise<ReviewSourceListResponse> => {
  const path = `${ROOT}/sources?${new URLSearchParams({ profileId })}`;
  return init ? apiClient<ReviewSourceListResponse>(path, init) : apiClient(path);
};

export const createReviewSource = (input: {
  profileId: string;
  source: ReviewSourceName;
  target: string;
}): Promise<ReviewSource> =>
  apiClient<ReviewSource>(`${ROOT}/sources`, { method: 'POST', body: input });

export const deleteReviewSource = (id: string): Promise<{ id: string; deleted: true }> =>
  apiClient<{ id: string; deleted: true }>(`${ROOT}/sources/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });

export const previewReviewSync = (input: {
  profileId: string;
  sources: ReviewSourceName[];
}): Promise<ReviewSpendPreview> =>
  apiClient<ReviewSpendPreview>(`${ROOT}/preview`, { method: 'POST', body: input });

export const submitReviewSync = (input: {
  profileId: string;
  sources: ReviewSourceName[];
  depth: number;
}): Promise<ReviewSyncSubmitResult> =>
  apiClient<ReviewSyncSubmitResult>(`${ROOT}/sync`, { method: 'POST', body: input });

export const fetchReviewRuns = (
  profileId: string,
  init?: { signal?: AbortSignal },
): Promise<ReviewRunListResponse> => {
  const path = `${ROOT}/runs?${new URLSearchParams({ profileId })}`;
  return init ? apiClient<ReviewRunListResponse>(path, init) : apiClient(path);
};

export const fetchReviewRun = (id: string): Promise<ReviewRun> =>
  apiClient<ReviewRun>(`${ROOT}/runs/${encodeURIComponent(id)}`);

export const fetchReviewStats = async (runId: string): Promise<ReviewStats> => {
  const response = await apiClient<ReviewStats>(`${ROOT}/stats/${encodeURIComponent(runId)}`);
  return { ...response, observation: parseObservation(response.observation) };
};

export const fetchReviewThemes = async (runId: string): Promise<ReviewThemesResponse> => {
  const response = await apiClient<ReviewThemesResponse>(
    `${ROOT}/themes/${encodeURIComponent(runId)}`,
  );
  return { ...response, observation: parseObservation(response.observation) };
};

export const fetchReviewInventory = async (
  profileId: string,
  filters: ReviewInventoryFilters,
  init?: { signal?: AbortSignal },
): Promise<ReviewInventoryResponse> => {
  const params = inventoryParams(profileId, filters, true);
  const path = `${ROOT}/reviews?${params}`;
  const response = init
    ? await apiClient<ReviewInventoryResponse>(path, init)
    : await apiClient<ReviewInventoryResponse>(path);
  return { ...response, observation: parseObservation(response.observation) };
};

/** Free, stored-data export using the same filter/sort set without pagination. */
export const exportReviewInventory = (
  profileId: string,
  filters: ReviewInventoryFilters,
): Promise<string> =>
  apiClient<string>(`${ROOT}/export.csv?${inventoryParams(profileId, filters, false)}`, {
    localeMode: 'artifact',
    allowLegacyNullContentLanguage: true,
    headers: { Accept: 'text/csv' },
  });
