import { apiClient } from '@shared/api/client';
import type { SupportedLocale } from '@shared/i18n';
import type {
  InternalLinkPreview,
  InternalLinkRunDetail,
  InternalLinkRunSummary,
} from './types';

export const previewInternalLinkRun = (siteId: string): Promise<InternalLinkPreview> =>
  apiClient<InternalLinkPreview>(`/sites/${siteId}/internal-link-runs/preview`, {
    method: 'POST',
    body: {},
  });

export const startInternalLinkRun = (
  siteId: string,
  locale: SupportedLocale,
): Promise<InternalLinkRunDetail> =>
  apiClient<InternalLinkRunDetail>(`/sites/${siteId}/internal-link-runs`, {
    method: 'POST',
    body: { locale },
  });

export const fetchInternalLinkRuns = (
  siteId: string,
  signal?: AbortSignal,
): Promise<{ items: InternalLinkRunSummary[] }> =>
  apiClient<{ items: InternalLinkRunSummary[] }>(
    `/sites/${siteId}/internal-link-runs`,
    signal ? { signal } : {},
  );

export const fetchInternalLinkRun = (
  runId: string,
  signal?: AbortSignal,
): Promise<InternalLinkRunDetail> =>
  apiClient<InternalLinkRunDetail>(
    `/internal-link-runs/${runId}`,
    signal ? { signal } : {},
  );

export const fetchInternalLinkCsv = (runId: string): Promise<string> =>
  apiClient<string>(`/internal-link-runs/${runId}/export.csv`, {
    localeMode: 'artifact',
    allowLegacyNullContentLanguage: true,
    headers: { Accept: 'text/csv' },
  });
