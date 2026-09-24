import { apiClient } from '@shared/api/client';
import type {
  AppKeyword,
  AppKeywordHistoryPoint,
  AppKeywordListResponse,
  MintAppKeywordInput,
  MintAppKeywordPreview,
  RecheckAppKeywordResponse,
} from './tracking-types';

const root = (siteId: string) => `/sites/${siteId}/apps/keywords`;
const profileQuery = (profileId: string, preview = false) =>
  `?profileId=${encodeURIComponent(profileId)}${preview ? '&preview=true' : ''}`;

export const fetchAppKeywords = (siteId: string, profileId: string) =>
  apiClient<AppKeywordListResponse>(`${root(siteId)}${profileQuery(profileId)}`);

export const previewMintAppKeyword = (
  siteId: string,
  profileId: string,
  input: MintAppKeywordInput,
) => apiClient<MintAppKeywordPreview>(`${root(siteId)}${profileQuery(profileId, true)}`, {
  method: 'POST',
  body: input,
});

export const createTrackedAppKeyword = async (
  siteId: string,
  profileId: string,
  input: MintAppKeywordInput,
): Promise<AppKeyword> => {
  const response = await apiClient<{ keyword: AppKeyword }>(
    `${root(siteId)}${profileQuery(profileId)}`,
    { method: 'POST', body: input },
  );
  return response.keyword;
};

export const removeTrackedAppKeyword = (siteId: string, keywordId: string) =>
  apiClient<void>(`${root(siteId)}/${encodeURIComponent(keywordId)}`, { method: 'DELETE' });

export const recheckTrackedAppKeyword = (
  siteId: string,
  keywordId: string,
  confirm: boolean,
) => apiClient<RecheckAppKeywordResponse>(
  `${root(siteId)}/${encodeURIComponent(keywordId)}/recheck`,
  { method: 'POST', body: { confirm } },
);

export const fetchTrackedAppKeywordHistory = async (
  siteId: string,
  keywordId: string,
): Promise<AppKeywordHistoryPoint[]> => {
  const response = await apiClient<{ items: AppKeywordHistoryPoint[] }>(
    `${root(siteId)}/${encodeURIComponent(keywordId)}/history`,
  );
  return response.items;
};
