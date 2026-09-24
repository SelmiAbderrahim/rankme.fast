import { apiClient } from '@shared/api/client';
import type {
  CannibalizationReportDetail,
  CannibalizationReportSummary,
  CannibalizationSpendPreview,
  CannibalizationWindow,
} from './types';

interface GoogleConnectionPage {
  configuration: {
    connection: {
      status: 'connected' | 'needs_reconnect' | 'revoked';
      scopes?: string[];
    } | null;
    gsc: { propertyUrl: string | null };
  };
}

const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

/**
 * The only prerequisite left: the site comes from
 * the workspace route, so this reads the Search Console link alone.
 */
export async function fetchCannibalizationPrerequisites(siteId: string): Promise<{
  gscConnected: boolean;
}> {
  const google = await apiClient<GoogleConnectionPage>(
    `/sites/${encodeURIComponent(siteId)}/google/configuration`,
  );
  const connection = google.configuration.connection;
  const hasGscScope =
    connection?.scopes === undefined || connection.scopes.includes(GSC_SCOPE);
  return {
    gscConnected: Boolean(
      connection?.status === 'connected' &&
        google.configuration.gsc.propertyUrl &&
        hasGscScope,
    ),
  };
}

export const previewCannibalizationReport = (
  siteId: string,
  windowDays: CannibalizationWindow,
): Promise<CannibalizationSpendPreview> =>
  apiClient<CannibalizationSpendPreview>(
    `/sites/${siteId}/cannibalization-reports/preview`,
    { method: 'POST', body: { windowDays } },
  );

export const generateCannibalizationReport = (
  siteId: string,
  windowDays: CannibalizationWindow,
): Promise<CannibalizationReportDetail> =>
  apiClient<CannibalizationReportDetail>(
    `/sites/${siteId}/cannibalization-reports`,
    { method: 'POST', body: { windowDays } },
  );

export interface FetchReportsOptions {
  windowDays?: CannibalizationWindow;
  signal?: AbortSignal;
}

export const fetchCannibalizationReports = (
  siteId: string,
  options: FetchReportsOptions = {},
): Promise<{ items: CannibalizationReportSummary[] }> => {
  const params = new URLSearchParams();
  if (options.windowDays !== undefined) {
    params.set('windowDays', String(options.windowDays));
  }
  const query = params.toString();
  const path = `/sites/${siteId}/cannibalization-reports${query ? `?${query}` : ''}`;
  return apiClient<{ items: CannibalizationReportSummary[] }>(
    path,
    options.signal ? { signal: options.signal } : {},
  );
};

export const fetchCannibalizationReport = (
  reportId: string,
  init: { signal?: AbortSignal } = {},
): Promise<CannibalizationReportDetail> =>
  apiClient<CannibalizationReportDetail>(
    `/cannibalization-reports/${reportId}`,
    init.signal ? { signal: init.signal } : {},
  );
