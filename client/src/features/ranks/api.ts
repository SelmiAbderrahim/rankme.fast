import { apiClient } from '@shared/api/client';
import type {
  AltEngineSpendPreview,
  RankEngine,
  CadenceUpdateResponse,
  CheckNowResponse,
  CreateKeywordBody,
  CreateKeywordResponse,
  KeywordListPage,
  KeywordSuggestionsBody,
  KeywordSuggestionsResponse,
  RankCadence,
  RankHistoryResponse,
  RemoveKeywordResponse,
  SerpFeatureDetail,
  SerpFeaturesResponse,
} from './types';

export const fetchKeywordsRequest = (
  siteId: string,
  cursor?: string | null,
  init?: { signal?: AbortSignal; engine?: RankEngine },
): Promise<KeywordListPage> => {
  // Keep the shipped cursor encoding byte-identical (`%20`, not the `+`
  // emitted by URLSearchParams) while extending the query with an engine.
  const params: string[] = [];
  if (cursor) params.push(`cursor=${encodeURIComponent(cursor)}`);
  if (init?.engine) params.push(`engine=${encodeURIComponent(init.engine)}`);
  const query = params.join('&');
  const path = `/sites/${siteId}/keywords${query ? `?${query}` : ''}`;
  const requestInit = init?.signal ? { signal: init.signal } : undefined;
  return requestInit
    ? apiClient<KeywordListPage>(path, requestInit)
    : apiClient<KeywordListPage>(path);
};

export const createKeywordRequest = (
  siteId: string,
  body: CreateKeywordBody,
): Promise<CreateKeywordResponse> =>
  apiClient<CreateKeywordResponse>(`/sites/${siteId}/keywords`, {
    method: 'POST',
    body,
  });

/**
 * Read-only slot + spend disclosure before a paid alt-engine add
 *. Never reserves; the create call repeats every
 * check for itself.
 */
export const previewAltEngineKeywordRequest = (
  siteId: string,
  engine: RankEngine,
): Promise<AltEngineSpendPreview> =>
  apiClient<AltEngineSpendPreview>(`/sites/${siteId}/keywords/preview`, {
    method: 'POST',
    body: { engine },
  });

export const fetchKeywordSuggestionsRequest = (
  siteId: string,
  body: KeywordSuggestionsBody,
): Promise<KeywordSuggestionsResponse> =>
  apiClient<KeywordSuggestionsResponse>(`/sites/${siteId}/keyword-suggestions`, {
    method: 'POST',
    body,
  });

export const checkNowRequest = (
  siteId: string,
  keywordId?: string,
): Promise<CheckNowResponse> =>
  apiClient<CheckNowResponse>(
    keywordId ? `/keywords/${keywordId}/check` : `/sites/${siteId}/keywords/check`,
    {
      method: 'POST',
    },
  );

export const removeKeywordRequest = (id: string): Promise<RemoveKeywordResponse> =>
  apiClient<RemoveKeywordResponse>(`/keywords/${id}`, { method: 'DELETE' });

export const updateCadenceRequest = (
  siteId: string,
  cadence: RankCadence,
): Promise<CadenceUpdateResponse> =>
  apiClient<CadenceUpdateResponse>(`/sites/${siteId}/rank-cadence`, {
    method: 'PATCH',
    body: { cadence },
  });

export const fetchKeywordHistoryRequest = (
  keywordId: string,
  init?: { signal?: AbortSignal },
): Promise<RankHistoryResponse> => {
  const path = `/keywords/${keywordId}/history`;
  return init ? apiClient<RankHistoryResponse>(path, init) : apiClient<RankHistoryResponse>(path);
};

/**
 * Stored SERP-feature observations for a site.
 * Read-only: no vendor call, no metric, no preview.
 */
export const fetchSerpFeaturesRequest = (
  siteId: string,
  init?: { signal?: AbortSignal },
): Promise<SerpFeaturesResponse> => {
  const path = `/sites/${siteId}/serp-features`;
  return init ? apiClient<SerpFeaturesResponse>(path, init) : apiClient<SerpFeaturesResponse>(path);
};

/** Per-keyword feature history plus the stored top-100 for the latest check. */
export const fetchSerpFeatureDetailRequest = (
  keywordId: string,
  init?: { signal?: AbortSignal },
): Promise<SerpFeatureDetail> => {
  const path = `/keywords/${keywordId}/serp-features`;
  return init ? apiClient<SerpFeatureDetail>(path, init) : apiClient<SerpFeatureDetail>(path);
};
