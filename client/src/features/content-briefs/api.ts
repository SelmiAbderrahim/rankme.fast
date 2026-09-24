import { apiClient, type ApiClientOptions } from '@shared/api/client';
import type {
  ContentBriefCreated,
  ContentBriefDetail,
  ContentBriefListResponse,
  ContentBriefPreview,
  ContentBriefStatusFilter,
} from './types';

const root = (siteId: string): string =>
  `/sites/${encodeURIComponent(siteId)}/content-briefs`;

export function previewContentBrief(
  siteId: string,
  input: { keyword: string; locale: string },
  options: Pick<ApiClientOptions, 'signal'> = {},
): Promise<ContentBriefPreview> {
  return apiClient<ContentBriefPreview>(`${root(siteId)}/preview`, {
    method: 'POST',
    body: input,
    ...options,
  });
}

export function createContentBrief(
  siteId: string,
  input: { keyword: string; locale: string; clientKey: string },
): Promise<ContentBriefCreated> {
  return apiClient<ContentBriefCreated>(root(siteId), { method: 'POST', body: input });
}

export function listContentBriefs(
  siteId: string,
  status: ContentBriefStatusFilter,
  cursor?: string,
  options: Pick<ApiClientOptions, 'signal'> = {},
): Promise<ContentBriefListResponse> {
  const params = new URLSearchParams({ status, limit: '20' });
  if (cursor) params.set('cursor', cursor);
  return apiClient<ContentBriefListResponse>(`${root(siteId)}?${params.toString()}`, options);
}

export function getContentBrief(
  siteId: string,
  briefId: string,
  options: Pick<ApiClientOptions, 'signal'> = {},
): Promise<ContentBriefDetail> {
  return apiClient<ContentBriefDetail>(
    `${root(siteId)}/${encodeURIComponent(briefId)}`,
    options,
  );
}

export function rescoreContentBrief(
  siteId: string,
  briefId: string,
  input: { draft: string; locale: string },
): Promise<ContentBriefDetail> {
  return apiClient<ContentBriefDetail>(
    `${root(siteId)}/${encodeURIComponent(briefId)}/drafts`,
    { method: 'POST', body: input },
  );
}
