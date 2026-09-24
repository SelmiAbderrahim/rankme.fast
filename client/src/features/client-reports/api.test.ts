import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  apiFetch,
  apiClient,
  fetchCsrfToken,
} from '@shared/api/client';
import {
  createClientPortalLink,
  createScheduledReport,
  deleteScheduledReport,
  downloadClientReport,
  getClientReportsOverview,
  getScheduledReportDeliveries,
  revokeClientPortalLink,
  updateScheduledReport,
} from './api';
import type { ScheduledReportInput } from './types';

vi.mock('@shared/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/api/client')>()),
  apiClient: vi.fn(),
  apiFetch: vi.fn(),
  fetchCsrfToken: vi.fn(),
}));

const mockedApi = vi.mocked(apiClient);
const mockedApiFetch = vi.mocked(apiFetch);
const mockedCsrf = vi.mocked(fetchCsrfToken);

const schedule: ScheduledReportInput = {
  name: 'Monday report',
  frequency: 'weekly',
  weekdayUtc: 1,
  monthdayUtc: null,
  hourUtc: 9,
  locale: 'en',
  recipients: ['client@example.com'],
  sections: { audit: true, ranks: true, gsc: true },
  enabled: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedApi.mockResolvedValue({} as never);
  mockedApiFetch.mockReset();
  mockedCsrf.mockResolvedValue('csrf-value');
});

describe('client reports API', () => {
  it('uses the authenticated site routes for reads and all mutations', async () => {
    await getClientReportsOverview('site/a');
    expect(mockedApi).toHaveBeenLastCalledWith('/client-reports/sites/site%2Fa');

    await createScheduledReport('site/a', schedule);
    expect(mockedApi).toHaveBeenLastCalledWith('/client-reports/sites/site%2Fa/schedules', {
      method: 'POST',
      body: schedule,
    });

    await updateScheduledReport('site/a', 'schedule/a', schedule);
    expect(mockedApi).toHaveBeenLastCalledWith(
      '/client-reports/sites/site%2Fa/schedules/schedule%2Fa',
      { method: 'PUT', body: schedule },
    );

    await deleteScheduledReport('site/a', 'schedule/a');
    expect(mockedApi).toHaveBeenLastCalledWith(
      '/client-reports/sites/site%2Fa/schedules/schedule%2Fa',
      { method: 'DELETE' },
    );

    await getScheduledReportDeliveries('site/a');
    expect(mockedApi).toHaveBeenLastCalledWith(
      '/client-reports/sites/site%2Fa/deliveries?limit=20',
    );
    await getScheduledReportDeliveries('site/a', 'cursor/a');
    expect(mockedApi).toHaveBeenLastCalledWith(
      '/client-reports/sites/site%2Fa/deliveries?limit=20&cursor=cursor%2Fa',
    );

    const portal = {
      clientLabel: 'Client',
      locale: 'ar' as const,
      sections: { audit: true, ranks: false, gsc: true },
      expiresInDays: 30,
    };
    await createClientPortalLink('site/a', portal);
    expect(mockedApi).toHaveBeenLastCalledWith('/client-reports/sites/site%2Fa/portals', {
      method: 'POST',
      localeMode: 'artifact',
      locale: 'ar',
      body: portal,
    });
    await revokeClientPortalLink('site/a', 'portal/a');
    expect(mockedApi).toHaveBeenLastCalledWith(
      '/client-reports/sites/site%2Fa/portals/portal%2Fa/revoke',
      { method: 'POST' },
    );
  });

  it('downloads a PDF with a fresh CSRF token', async () => {
    mockedApiFetch.mockResolvedValue(
      new Response('pdf', { status: 200, headers: { 'Content-Type': 'application/pdf' } }),
    );
    const result = await downloadClientReport('site/a', {
      locale: 'en',
      sections: { audit: true, ranks: false, gsc: false },
    });
    // blob() may return a node:buffer Blob (has .text()) or jsdom's Blob
    // (no .text() under newer Node); read whichever came back.
    const text =
      typeof result.text === 'function'
        ? await result.text()
        : await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.readAsText(result);
          });
    expect(text).toBe('pdf');
    const call = mockedApiFetch.mock.calls[0]!;
    expect(call[0]).toBe('/client-reports/sites/site%2Fa/pdf');
    expect(call[1]).toEqual(expect.objectContaining({
      method: 'POST',
      localeMode: 'artifact',
      locale: 'en',
    }));
    expect(call[1]?.headers).toMatchObject({ 'x-csrf-token': 'csrf-value' });
  });

  it('preserves JSON and text failure bodies in ApiError', async () => {
    mockedApiFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'No data' } }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }));
    await expect(downloadClientReport('s', {
      locale: 'en', sections: { audit: true, ranks: false, gsc: false },
    })).rejects.toMatchObject({ status: 409, data: { error: { message: 'No data' } } });
    await expect(downloadClientReport('s', {
      locale: 'en', sections: { audit: true, ranks: false, gsc: false },
    })).rejects.toMatchObject({ status: 503, data: 'unavailable' });
  });

  it('uses null when a failure body cannot be parsed', async () => {
    const response = {
      ok: false,
      status: 500,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: vi.fn().mockRejectedValue(new Error('bad json')),
      text: vi.fn(),
    } as unknown as Response;
    mockedApiFetch.mockResolvedValue(response);
    await expect(downloadClientReport('s', {
      locale: 'en', sections: { audit: true, ranks: false, gsc: false },
    })).rejects.toMatchObject({ status: 500, data: null });
  });

  it('treats a response without a content-type as plain text', async () => {
    const response = {
      ok: false,
      status: 502,
      headers: { get: vi.fn(() => null) },
      json: vi.fn(),
      text: vi.fn().mockResolvedValue('gateway unavailable'),
    } as unknown as Response;
    mockedApiFetch.mockResolvedValue(response);
    await expect(downloadClientReport('s', {
      locale: 'en', sections: { audit: true, ranks: false, gsc: false },
    })).rejects.toMatchObject({ status: 502, data: 'gateway unavailable' });
  });

  it.each([
    [new TypeError('offline'), 'network'],
    [new DOMException('late', 'TimeoutError'), 'timeout'],
    [new DOMException('aborted', 'AbortError'), 'timeout'],
  ] as const)('classifies raw fetch failure %#', async (failure, code) => {
    mockedApiFetch.mockRejectedValue(failure);
    const promise = downloadClientReport('s', {
      locale: 'en', sections: { audit: true, ranks: false, gsc: false },
    });
    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await expect(promise).rejects.toMatchObject({ status: 0, code });
  });

  it('preserves an ApiError already normalized by the shared transport', async () => {
    const failure = new ApiError('localized', 404, { error: 'missing' });
    mockedApiFetch.mockRejectedValue(failure);

    await expect(downloadClientReport('s', {
      locale: 'en', sections: { audit: true, ranks: false, gsc: false },
    })).rejects.toBe(failure);
  });
});
