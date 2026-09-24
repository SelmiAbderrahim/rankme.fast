import {
  ApiError,
  apiFetch,
  apiClient,
  resolveApiUrl,
} from '@shared/api/client';
import type {
  AuditReport,
  AuditSummaryState,
  AuditRunListPage,
  PublicAuditRun,
  StartAuditResponse,
} from './types';
import { getPresentationLocale, type SupportedLocale } from '@shared/i18n';

export interface PresentationReadInit {
  signal?: AbortSignal;
  presentationLocale?: SupportedLocale;
  presentationGeneration?: number;
}

const presentationReadOptions = (init: PresentationReadInit | undefined) => ({
  ...(init?.signal ? { signal: init.signal } : {}),
  ...(init?.presentationLocale ? { locale: init.presentationLocale } : {}),
  ...(init?.presentationGeneration === undefined
    ? {}
    : { presentationGeneration: init.presentationGeneration }),
});

export const fetchReportRequest = (
  runId: string,
  init?: PresentationReadInit,
): Promise<AuditReport> =>
  apiClient<AuditReport>(`/audits/${runId}/report`, presentationReadOptions(init));

export const fetchLatestRunRequest = (
  siteId: string,
  init?: PresentationReadInit,
): Promise<AuditRunListPage> =>
  apiClient<AuditRunListPage>(
    `/sites/${siteId}/audits?limit=1`,
    presentationReadOptions(init),
  );

/** Recent audit runs for a site — read-only, owner-scoped, no vendor spend.
 *  Backs the report run-history block; each row deep-links to a run. */
export const fetchAuditRunsRequest = (
  siteId: string,
  limit = 10,
  init?: PresentationReadInit,
): Promise<AuditRunListPage> =>
  apiClient<AuditRunListPage>(
    `/sites/${siteId}/audits?limit=${limit}`,
    presentationReadOptions(init),
  );

export const fetchRunRequest = (
  runId: string,
  init?: PresentationReadInit,
): Promise<{ run: PublicAuditRun }> =>
  apiClient<{ run: PublicAuditRun }>(
    `/audits/${runId}`,
    presentationReadOptions(init),
  );

/**
 * Optional `requestedPageCap` bounds the crawl (and vendor cost) for this run;
 * the server clamps it to its configured `audit_pages` ceiling. Omitted → that ceiling.
 */
export const startAuditRequest = (
  siteId: string,
  requestedPageCap?: number,
): Promise<StartAuditResponse> =>
  apiClient<StartAuditResponse>(`/sites/${siteId}/audits`, {
    method: 'POST',
    body: requestedPageCap === undefined ? {} : { requestedPageCap },
  });

/**
 * POST /api/audits/:runId/summary — enqueue (or dedupe) AI generation.
 * Locale routing via `x-lang` matches the report call; completion is read
 * through fetchAiSummaryStateRequest rather than held open on this request.
 */
export const generateAiSummaryRequest = (
  runId: string,
  locale: SupportedLocale,
): Promise<AuditSummaryState> =>
  apiClient<AuditSummaryState>(`/audits/${runId}/summary`, {
    method: 'POST',
    body: {},
    locale,
    localeMode: 'artifact',
  });

/** Poll the durable summary job; safe to resume after a page refresh. */
export const fetchAiSummaryStateRequest = (
  runId: string,
  locale: SupportedLocale,
  init?: { signal?: AbortSignal },
): Promise<AuditSummaryState> =>
  apiClient<AuditSummaryState>(`/audits/${runId}/summary`, {
    ...init,
    locale,
    localeMode: 'artifact',
  });

/**
 * GET /api/audits/:runId/report.pdf — white-label PDF (workstream B).
 *
 * `apiClient` only decodes JSON/text bodies, so this helper drives `fetch`
 * directly with the same semantics: cookie credentials, `x-lang` locale
 * routing, and an `ApiError` carrying the parsed JSON body on non-2xx.
 */
export const downloadReportPdfRequest = async (
  runId: string,
  locale: SupportedLocale = getPresentationLocale(),
): Promise<Blob> => {
  const path = `/audits/${runId}/report.pdf`;
  const url = resolveApiUrl(path);
  const response = await apiFetch(path, {
    localeMode: 'artifact',
    locale,
    timeoutMs: null,
    headers: { Accept: 'application/pdf' },
  });
  if (!response.ok) {
    const contentType = response.headers.get('Content-Type') ?? '';
    const data: unknown = contentType.includes('application/json')
      ? await response.json()
      : await response.text();
    throw new ApiError(
      `Request to ${url} failed with status ${response.status}`,
      response.status,
      data,
      'http',
      response.headers.get('Content-Language'),
    );
  }
  return response.blob();
};
