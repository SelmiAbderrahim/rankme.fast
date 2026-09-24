import { apiClient } from '@shared/api/client';
import type {
  TrafficSnapshotDetail,
  TrafficSnapshotCompareResponse,
  TrafficSnapshotListFilters,
  TrafficSnapshotListResponse,
  TrafficSnapshotRequestInput,
  TrafficSnapshotRequestResult,
  TrafficSpendPreview,
} from './types';

const ROOT = '/competitors/traffic-snapshots';

export const requestTrafficSnapshot = (
  input: TrafficSnapshotRequestInput,
): Promise<TrafficSnapshotRequestResult> =>
  apiClient<TrafficSnapshotRequestResult>(ROOT, { method: 'POST', body: input });

export const previewTrafficSnapshot = (domains: string[]): Promise<TrafficSpendPreview> =>
  apiClient<TrafficSpendPreview>(`${ROOT}/preview`, {
    method: 'POST',
    body: { domains },
  });

export const fetchTrafficSnapshot = (
  id: string,
  siteId?: string,
): Promise<TrafficSnapshotDetail> => {
  const params = new URLSearchParams();
  if (siteId) params.set('siteId', siteId);
  const query = params.toString();
  return apiClient<TrafficSnapshotDetail>(
    `${ROOT}/${encodeURIComponent(id)}${query ? `?${query}` : ''}`,
  );
};

export const compareTrafficSnapshots = (
  ids: string[],
  options?: { signal?: AbortSignal; siteId?: string },
): Promise<TrafficSnapshotCompareResponse> => {
  const params = new URLSearchParams({ ids: ids.join(',') });
  if (options?.siteId) params.set('siteId', options.siteId);
  const init = options?.signal ? { signal: options.signal } : undefined;
  return apiClient<TrafficSnapshotCompareResponse>(`${ROOT}/compare?${params}`, init);
};

export const fetchTrafficSnapshots = (
  filters: TrafficSnapshotListFilters,
  init?: { signal?: AbortSignal },
): Promise<TrafficSnapshotListResponse> => {
  const params = new URLSearchParams();
  if (filters.siteId) params.set('siteId', filters.siteId);
  if (filters.domain) params.set('domain', filters.domain);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.cursor) params.set('cursor', filters.cursor);
  const query = params.toString();
  const path = query ? `${ROOT}?${query}` : ROOT;
  return init ? apiClient<TrafficSnapshotListResponse>(path, init) : apiClient(path);
};
