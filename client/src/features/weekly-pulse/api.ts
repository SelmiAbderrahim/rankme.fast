import { apiClient } from '@shared/api/client';
import type {
  GscGenerativeAppearanceRead,
  PulseHistoryDetail,
  PulseHistoryPage,
  PulseStateView,
  SetSubscriptionRequest,
  SpendPreview,
} from './types';

export interface WeeklyPulseApiInit {
  signal?: AbortSignal;
}

export function getWeeklyPulseState(
  siteId: string,
  init: WeeklyPulseApiInit = {},
): Promise<PulseStateView> {
  return apiClient<PulseStateView>(
    `/sites/${encodeURIComponent(siteId)}/weekly-pulse`,
    { method: 'GET', ...(init.signal ? { signal: init.signal } : {}) },
  );
}

export function previewWeeklyPulse(
  siteId: string,
  init: WeeklyPulseApiInit = {},
): Promise<SpendPreview> {
  return apiClient<SpendPreview>(
    `/sites/${encodeURIComponent(siteId)}/weekly-pulse/preview`,
    { method: 'POST', body: {}, ...(init.signal ? { signal: init.signal } : {}) },
  );
}

export function setWeeklyPulseSubscription(
  siteId: string,
  body: SetSubscriptionRequest,
  init: WeeklyPulseApiInit = {},
): Promise<PulseStateView> {
  return apiClient<PulseStateView>(
    `/sites/${encodeURIComponent(siteId)}/weekly-pulse`,
    { method: 'PUT', body, ...(init.signal ? { signal: init.signal } : {}) },
  );
}

export interface ListHistoryParams {
  limit?: number;
  cursor?: string | null;
}

export function listWeeklyPulseHistory(
  siteId: string,
  params: ListHistoryParams = {},
  init: WeeklyPulseApiInit = {},
): Promise<PulseHistoryPage> {
  const search = new URLSearchParams();
  if (params.limit) search.set('limit', String(params.limit));
  if (params.cursor) search.set('cursor', params.cursor);
  const q = search.toString();
  return apiClient<PulseHistoryPage>(
    `/sites/${encodeURIComponent(siteId)}/weekly-pulse/history${q ? `?${q}` : ''}`,
    { method: 'GET', ...(init.signal ? { signal: init.signal } : {}) },
  );
}

export function getWeeklyPulseHistoryDetail(
  siteId: string,
  pulseId: string,
  init: WeeklyPulseApiInit = {},
): Promise<PulseHistoryDetail> {
  return apiClient<PulseHistoryDetail>(
    `/sites/${encodeURIComponent(siteId)}/weekly-pulse/history/${encodeURIComponent(pulseId)}`,
    { method: 'GET', ...(init.signal ? { signal: init.signal } : {}) },
  );
}

/** GSC first-party generative-AI appearance for a site. */
export function getGenerativeAppearance(
  siteId: string,
  init: WeeklyPulseApiInit = {},
): Promise<{ appearance: GscGenerativeAppearanceRead }> {
  return apiClient<{ appearance: GscGenerativeAppearanceRead }>(
    `/google/generative-appearance?siteId=${encodeURIComponent(siteId)}`,
    { method: 'GET', ...(init.signal ? { signal: init.signal } : {}) },
  );
}
