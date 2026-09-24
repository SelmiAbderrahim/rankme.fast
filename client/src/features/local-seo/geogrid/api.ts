import { apiClient } from '@shared/api/client';
import type {
  GeogridCreateResponse,
  GeogridDefinition,
  GeogridPreviewResponse,
  GeogridScanDetail,
  GeogridScanSummary,
} from './types';

/** Read-only estimate. Never reserves — the submit repeats every check. */
export const previewGeogridScan = (
  siteId: string,
  definition: GeogridDefinition,
): Promise<GeogridPreviewResponse> =>
  apiClient<GeogridPreviewResponse>(`/sites/${siteId}/geogrid/preview`, {
    method: 'POST',
    // `apiClient` serializes the body itself — passing a pre-stringified
    // value would double-encode it into a bare JSON string.
    body: definition,
  });

/** The paid submit — one vendor scan for the whole grid. */
export const createGeogridScan = (
  siteId: string,
  definition: GeogridDefinition,
): Promise<GeogridCreateResponse> =>
  apiClient<GeogridCreateResponse>(`/sites/${siteId}/geogrid/scans`, {
    method: 'POST',
    body: definition,
  });

export const fetchGeogridScans = (
  siteId: string,
  query: { keywordId?: string; limit?: number } = {},
): Promise<{ scans: GeogridScanSummary[] }> => {
  const params = new URLSearchParams();
  if (query.keywordId) params.set('keywordId', query.keywordId);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return apiClient<{ scans: GeogridScanSummary[] }>(
    `/sites/${siteId}/geogrid/scans${suffix}`,
  );
};

/** Free reopen of a stored scan — no metric, readable with the flag off. */
export const fetchGeogridScan = (
  siteId: string,
  scanId: string,
): Promise<GeogridScanDetail> =>
  apiClient<GeogridScanDetail>(`/sites/${siteId}/geogrid/scans/${scanId}`);

/**
 * The keyword picker's options. Reads the SHIPPED tracked-keyword list
 * endpoint (`/sites/:siteId/keywords`) and narrows it to the two fields the
 * picker needs — no keyword logic is duplicated here.
 */
export interface GeogridKeywordOption {
  id: string;
  phrase: string;
}

export const fetchGeogridKeywordOptions = async (
  siteId: string,
): Promise<GeogridKeywordOption[]> => {
  const page = await apiClient<{ keywords: Array<{ id: string; phrase: string }> }>(
    `/sites/${siteId}/keywords`,
  );
  return page.keywords.map((keyword) => ({ id: keyword.id, phrase: keyword.phrase }));
};
