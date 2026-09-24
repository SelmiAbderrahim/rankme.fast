import { ApiError, apiClient, apiFetch } from '@shared/api/client';
import type {
  CreatedReportShare,
  CreateReportSnapshotInput,
  PublicReportFormat,
  ReportExportCapabilities,
  ReportShareCenterPage,
  ReportShareSummary,
  ReportSnapshotPage,
  ReportSnapshotSummary,
} from './types';

const ROOT = '/report-exports';
const snapshotPath = (snapshotId: string) =>
  `${ROOT}/${encodeURIComponent(snapshotId)}`;
const sharePath = (snapshotId: string) => `${snapshotPath(snapshotId)}/shares`;

export function getReportExportCapabilities(): Promise<ReportExportCapabilities> {
  return apiClient<ReportExportCapabilities>(`${ROOT}/capabilities`);
}

export async function createReportSnapshot(
  input: CreateReportSnapshotInput,
): Promise<ReportSnapshotSummary> {
  const result = await apiClient<{ snapshot: ReportSnapshotSummary }>(ROOT, {
    method: 'POST',
    localeMode: 'artifact',
    body: { ...input, brandingMode: input.brandingMode ?? 'rankmefast' },
  });
  return result.snapshot;
}

export function listReportSnapshots(input: {
  cursor?: string;
  limit?: number;
} = {}): Promise<ReportSnapshotPage> {
  const params = new URLSearchParams({ limit: String(input.limit ?? 25) });
  if (input.cursor) params.set('cursor', input.cursor);
  return apiClient<ReportSnapshotPage>(`${ROOT}?${params.toString()}`, {
    localeMode: 'artifact',
  });
}

export function deleteReportSnapshot(snapshotId: string): Promise<void> {
  return apiClient<void>(snapshotPath(snapshotId), {
    method: 'DELETE',
    localeMode: 'artifact',
  });
}

export function listAllReportShares(input: {
  cursor?: string;
  limit?: number;
} = {}): Promise<ReportShareCenterPage> {
  const params = new URLSearchParams({ limit: String(input.limit ?? 25) });
  if (input.cursor) params.set('cursor', input.cursor);
  return apiClient<ReportShareCenterPage>(`${ROOT}/shares?${params.toString()}`, {
    localeMode: 'artifact',
  });
}

export async function createReportShare(
  snapshotId: string,
  input: { expiresInDays: number; formats: PublicReportFormat[] },
): Promise<CreatedReportShare> {
  const result = await apiClient<{ share: CreatedReportShare }>(
    sharePath(snapshotId),
    { method: 'POST', body: input, localeMode: 'artifact' },
  );
  return result.share;
}

export async function listReportShares(
  snapshotId: string,
): Promise<ReportShareSummary[]> {
  const result = await apiClient<{ shares: ReportShareSummary[] }>(sharePath(snapshotId), {
    localeMode: 'artifact',
  });
  return result.shares;
}

export async function revokeReportShare(
  snapshotId: string,
  shareId: string,
): Promise<ReportShareSummary> {
  const result = await apiClient<{ share: ReportShareSummary }>(
    `${sharePath(snapshotId)}/${encodeURIComponent(shareId)}/revoke`,
    { method: 'POST', localeMode: 'artifact' },
  );
  return result.share;
}

export async function fetchReportSnapshotBlob(snapshotId: string): Promise<{
  blob: Blob;
  contentDisposition: string | null;
}> {
  const path = `${snapshotPath(snapshotId)}/download`;
  let response: Response;
  try {
    response = await apiFetch(path, {
      localeMode: 'artifact',
      timeoutMs: 30_000,
      headers: { Accept: 'application/octet-stream' },
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const timeout = error instanceof DOMException &&
      (error.name === 'TimeoutError' || error.name === 'AbortError');
    throw new ApiError(
      timeout ? 'Request timed out' : 'Network request failed',
      0,
      null,
      timeout ? 'timeout' : 'network',
    );
  }
  if (!response.ok) {
    const contentType = response.headers.get('content-type') ?? '';
    const data: unknown = contentType.includes('application/json')
      ? await response.json()
      : await response.text();
    throw new ApiError(`Download failed with status ${response.status}`, response.status, data);
  }
  return {
    blob: await response.blob(),
    contentDisposition: response.headers.get('content-disposition'),
  };
}
