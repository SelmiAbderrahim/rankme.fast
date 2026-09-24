import { apiClient } from '@shared/api/client';
import type {
  BrandRadarMentionListResponse,
  BrandRadarPreview,
  BrandRadarScanCreated,
  BrandRadarScanDetail,
  BrandRadarScanInput,
  BrandRadarScanListResponse,
} from './types';

/** Stored-scan reads stay flat; the paid paths are nested under the site. */
const ROOT = '/brand-radar';
const siteRoot = (siteId: string): string => `/sites/${siteId}/brand-radar`;

export const previewBrandRadarScan = (
  siteId: string,
  body: BrandRadarScanInput,
): Promise<BrandRadarPreview> =>
  // `apiClient` stringifies the body itself — pass the raw object.
  apiClient<BrandRadarPreview>(`${siteRoot(siteId)}/preview`, {
    method: 'POST',
    body,
  });

export const createBrandRadarScan = (
  siteId: string,
  body: BrandRadarScanInput,
): Promise<BrandRadarScanCreated> =>
  apiClient<BrandRadarScanCreated>(`${siteRoot(siteId)}/scans`, {
    method: 'POST',
    body,
  });

export interface FetchBrandRadarScansOptions {
  limit?: number;
  cursor?: string;
  signal?: AbortSignal;
}

export const fetchBrandRadarScans = (
  siteId: string,
  options: FetchBrandRadarScansOptions = {},
): Promise<BrandRadarScanListResponse> => {
  const params = new URLSearchParams();
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  if (options.cursor) params.set('cursor', options.cursor);
  const query = params.toString();
  const base = `${siteRoot(siteId)}/scans`;
  const path = query ? `${base}?${query}` : base;
  return options.signal
    ? apiClient<BrandRadarScanListResponse>(path, { signal: options.signal })
    : apiClient<BrandRadarScanListResponse>(path);
};

/** `GET /brand-radar/scans/:id` — stored aggregates + digest, no mention rows. */
export const fetchBrandRadarScan = (
  scanId: string,
  init: { signal?: AbortSignal } = {},
): Promise<BrandRadarScanDetail> =>
  init.signal
    ? apiClient<BrandRadarScanDetail>(`${ROOT}/scans/${scanId}`, {
        signal: init.signal,
      })
    : apiClient<BrandRadarScanDetail>(`${ROOT}/scans/${scanId}`);

export interface FetchBrandRadarMentionsOptions {
  limit?: number;
  cursor?: string;
  signal?: AbortSignal;
}

/**
 * `GET /brand-radar/scans/:id/mentions` — a FREE stored-data read of
 * rows the account already paid for. No metering, no vendor call.
 */
export const fetchBrandRadarMentions = (
  scanId: string,
  options: FetchBrandRadarMentionsOptions = {},
): Promise<BrandRadarMentionListResponse> => {
  const params = new URLSearchParams();
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  if (options.cursor) params.set('cursor', options.cursor);
  const query = params.toString();
  const base = `${ROOT}/scans/${scanId}/mentions`;
  const path = query ? `${base}?${query}` : base;
  return options.signal
    ? apiClient<BrandRadarMentionListResponse>(path, { signal: options.signal })
    : apiClient<BrandRadarMentionListResponse>(path);
};
