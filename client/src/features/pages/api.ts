import { apiClient } from '@shared/api/client';
import { PagesClientError, toPagesRequestError } from './error';
import { serializePagesListQuery } from './urlState';
import type {
  PagesDetailResponse,
  PagesListQuery,
  PagesListResponse,
  PagesRange,
  PagesRefreshResponse,
} from './types';

const pagesBasePath = (siteId: string): string =>
  `/sites/${encodeURIComponent(siteId)}/pages`;

async function pagesRequest<T>(path: string, options?: Parameters<typeof apiClient>[1]): Promise<T> {
  try {
    return await apiClient<T>(path, options);
  } catch (error) {
    throw new PagesClientError(toPagesRequestError(error));
  }
}

export function fetchPagesList(
  siteId: string,
  query: PagesListQuery,
  signal?: AbortSignal,
): Promise<PagesListResponse> {
  const search = serializePagesListQuery(query);
  return pagesRequest<PagesListResponse>(`${pagesBasePath(siteId)}?${search}`, { signal });
}

export function fetchPagesDetail(
  siteId: string,
  pageId: string,
  range: PagesRange,
  signal?: AbortSignal,
): Promise<PagesDetailResponse> {
  const search = new URLSearchParams({ range }).toString();
  return pagesRequest<PagesDetailResponse>(
    `${pagesBasePath(siteId)}/${encodeURIComponent(pageId)}?${search}`,
    { signal },
  );
}

export function requestPagesRefresh(
  siteId: string,
  signal?: AbortSignal,
): Promise<PagesRefreshResponse> {
  return pagesRequest<PagesRefreshResponse>(`${pagesBasePath(siteId)}/refresh`, {
    method: 'POST',
    body: {},
    signal,
  });
}
