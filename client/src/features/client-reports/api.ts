import {
  ApiError,
  apiFetch,
  apiClient,
  fetchCsrfToken,
} from '@shared/api/client';
import type { SupportedLocale } from '@shared/i18n';
import type {
  ClientPortalLink,
  ClientReportSections,
  ClientReportsOverview,
  CreatedClientPortalLink,
  DeliveriesPage,
  ScheduledReport,
  ScheduledReportInput,
} from './types';

const sitePath = (siteId: string): string =>
  `/client-reports/sites/${encodeURIComponent(siteId)}`;

export function getClientReportsOverview(siteId: string): Promise<ClientReportsOverview> {
  return apiClient<ClientReportsOverview>(sitePath(siteId));
}

export function createScheduledReport(
  siteId: string,
  input: ScheduledReportInput,
): Promise<ScheduledReport> {
  return apiClient<ScheduledReport>(`${sitePath(siteId)}/schedules`, {
    method: 'POST',
    body: input,
  });
}

export function updateScheduledReport(
  siteId: string,
  scheduleId: string,
  input: ScheduledReportInput,
): Promise<ScheduledReport> {
  return apiClient<ScheduledReport>(
    `${sitePath(siteId)}/schedules/${encodeURIComponent(scheduleId)}`,
    { method: 'PUT', body: input },
  );
}

export function deleteScheduledReport(siteId: string, scheduleId: string): Promise<void> {
  return apiClient<void>(
    `${sitePath(siteId)}/schedules/${encodeURIComponent(scheduleId)}`,
    { method: 'DELETE' },
  );
}

export function getScheduledReportDeliveries(
  siteId: string,
  cursor?: string,
): Promise<DeliveriesPage> {
  const params = new URLSearchParams({ limit: '20' });
  if (cursor) params.set('cursor', cursor);
  return apiClient<DeliveriesPage>(`${sitePath(siteId)}/deliveries?${params.toString()}`);
}

export function createClientPortalLink(
  siteId: string,
  input: {
    clientLabel: string;
    locale: SupportedLocale;
    sections: ClientReportSections;
    expiresInDays: number;
  },
): Promise<CreatedClientPortalLink> {
  return apiClient<CreatedClientPortalLink>(`${sitePath(siteId)}/portals`, {
    method: 'POST',
    localeMode: 'artifact',
    locale: input.locale,
    body: input,
  });
}

export function revokeClientPortalLink(
  siteId: string,
  portalId: string,
): Promise<ClientPortalLink> {
  return apiClient<ClientPortalLink>(
    `${sitePath(siteId)}/portals/${encodeURIComponent(portalId)}/revoke`,
    { method: 'POST' },
  );
}

async function responseData(response: Response): Promise<unknown> {
  const type = response.headers.get('content-type') ?? '';
  try {
    return type.includes('application/json') ? await response.json() : await response.text();
  } catch {
    return null;
  }
}

export async function downloadClientReport(
  siteId: string,
  input: { locale: SupportedLocale; sections: ClientReportSections },
): Promise<Blob> {
  const csrfToken = await fetchCsrfToken();
  const path = `${sitePath(siteId)}/pdf`;
  let response: Response;
  try {
    response = await apiFetch(path, {
      method: 'POST',
      localeMode: 'artifact',
      locale: input.locale,
      headers: {
        Accept: 'application/pdf',
        'Content-Type': 'application/json',
        'x-csrf-token': csrfToken,
      },
      body: JSON.stringify(input),
      timeoutMs: 30_000,
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
    throw new ApiError(
      `PDF request failed with status ${response.status}`,
      response.status,
      await responseData(response),
    );
  }
  return response.blob();
}
