import { apiClient } from '@shared/api/client';
import type {
  AppCompetitorResearchInput,
  AppCompetitorResearchResult,
  AppGapResearchInput,
  AppGapResearchResult,
  AppKeywordResearchInput,
  AppKeywordResearchResult,
  AppResearchSpendPreview,
  AppResearchStore,
  AppResearchSurface,
} from './research-types';

const root = (siteId: string) => `/sites/${siteId}/apps/research`;
const query = (profileId: string, store: AppResearchStore) =>
  `profileId=${encodeURIComponent(profileId)}&store=${encodeURIComponent(store)}`;

export const fetchAppResearchPreview = (
  siteId: string,
  surface: AppResearchSurface,
  profileId: string,
  store: AppResearchStore,
  appIds?: string[],
) => apiClient<{ preview: AppResearchSpendPreview }>(
  `${root(siteId)}/${surface}/preview?${query(profileId, store)}${appIds ? `&appIds=${encodeURIComponent(appIds.join(','))}` : ''}`,
);

export const fetchLatestAppResearch = <T>(
  siteId: string,
  surface: AppResearchSurface,
  profileId: string,
  store: AppResearchStore,
) => apiClient<{
  result: T | null;
  researchEnabled: boolean;
}>(`${root(siteId)}/${surface}?${query(profileId, store)}`);

export const submitAppKeywordResearch = async (
  siteId: string,
  input: AppKeywordResearchInput,
) => (await apiClient<{ result: AppKeywordResearchResult }>(`${root(siteId)}/keywords`, {
  method: 'POST', body: input,
})).result;

export const submitAppGapResearch = async (
  siteId: string,
  input: AppGapResearchInput,
) => (await apiClient<{ result: AppGapResearchResult }>(`${root(siteId)}/gap`, {
  method: 'POST', body: input,
})).result;

export const submitAppCompetitorResearch = async (
  siteId: string,
  input: AppCompetitorResearchInput,
) => (await apiClient<{ result: AppCompetitorResearchResult }>(`${root(siteId)}/competitors`, {
  method: 'POST', body: input,
})).result;
