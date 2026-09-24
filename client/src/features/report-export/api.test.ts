import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@shared/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/api/client')>();
  return {
    ...actual,
    apiClient: vi.fn(),
    apiFetch: vi.fn(),
  };
});

import { ApiError, apiClient, apiFetch } from '@shared/api/client';
import {
  createReportShare,
  createReportSnapshot,
  deleteReportSnapshot,
  fetchReportSnapshotBlob,
  getReportExportCapabilities,
  listAllReportShares,
  listReportShares,
  listReportSnapshots,
  revokeReportShare,
} from './api';

const mockedApiClient = vi.mocked(apiClient);
const mockedApiFetch = vi.mocked(apiFetch);

beforeEach(() => {
  mockedApiClient.mockReset();
  mockedApiFetch.mockReset();
  vi.restoreAllMocks();
});

describe('report-export API', () => {
  it('uses encoded management paths, bounded pagination defaults, and default branding', async () => {
    const snapshot = { id: 'snapshot/one' };
    const share = { id: 'share/one' };
    mockedApiClient
      .mockResolvedValueOnce({ enabled: true, kinds: [] })
      .mockResolvedValueOnce({ snapshot })
      .mockResolvedValueOnce({ items: [], nextCursor: null })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ items: [], nextCursor: null })
      .mockResolvedValueOnce({ share })
      .mockResolvedValueOnce({ shares: [share] })
      .mockResolvedValueOnce({ share });

    await getReportExportCapabilities();
    await createReportSnapshot({
      kind: 'audit.run',
      format: 'json',
      target: { scope: 'site_resource', siteId: 'site', resourceId: 'audit' },
      selection: {},
    });
    await listReportSnapshots();
    await deleteReportSnapshot('snapshot/one');
    await listAllReportShares({ cursor: 'cursor/+=', limit: 10 });
    await createReportShare('snapshot/one', {
      expiresInDays: 7,
      formats: ['view', 'pdf'],
    });
    await listReportShares('snapshot/one');
    await revokeReportShare('snapshot/one', 'share/one');

    expect(mockedApiClient.mock.calls).toEqual([
      ['/report-exports/capabilities'],
      [
        '/report-exports',
        {
          method: 'POST',
          localeMode: 'artifact',
          body: expect.objectContaining({ brandingMode: 'rankmefast' }),
        },
      ],
      ['/report-exports?limit=25', { localeMode: 'artifact' }],
      ['/report-exports/snapshot%2Fone', { method: 'DELETE', localeMode: 'artifact' }],
      ['/report-exports/shares?limit=10&cursor=cursor%2F%2B%3D', { localeMode: 'artifact' }],
      [
        '/report-exports/snapshot%2Fone/shares',
        { method: 'POST', body: { expiresInDays: 7, formats: ['view', 'pdf'] }, localeMode: 'artifact' },
      ],
      ['/report-exports/snapshot%2Fone/shares', { localeMode: 'artifact' }],
      ['/report-exports/snapshot%2Fone/shares/share%2Fone/revoke', { method: 'POST', localeMode: 'artifact' }],
    ]);
  });

  it('preserves an explicit white-label request and optional snapshot cursor', async () => {
    mockedApiClient
      .mockResolvedValueOnce({ snapshot: { id: 'one' } })
      .mockResolvedValueOnce({ items: [], nextCursor: null })
      .mockResolvedValueOnce({ items: [], nextCursor: null });
    await createReportSnapshot({
      kind: 'audit.run',
      format: 'pdf',
      target: { scope: 'site', siteId: 'site' },
      selection: {},
      brandingMode: 'white_label',
    });
    await listReportSnapshots({ cursor: 'next', limit: 1 });
    await listAllReportShares();
    expect(mockedApiClient).toHaveBeenNthCalledWith(
      1,
      '/report-exports',
      expect.objectContaining({
        body: expect.objectContaining({ brandingMode: 'white_label' }),
      }),
    );
    expect(mockedApiClient).toHaveBeenNthCalledWith(2, '/report-exports?limit=1&cursor=next', {
      localeMode: 'artifact',
    });
    expect(mockedApiClient).toHaveBeenNthCalledWith(3, '/report-exports/shares?limit=25', {
      localeMode: 'artifact',
    });
  });
});

describe('report-export blob download', () => {
  it('sends only cookie/context headers and returns the opaque blob and safe filename header', async () => {
    const blob = new Blob(['report'], { type: 'application/pdf' });
    mockedApiFetch.mockResolvedValue(
      new Response(blob, {
        status: 200,
        headers: { 'content-disposition': 'attachment; filename="report.pdf"' },
      }),
    );
    const result = await fetchReportSnapshotBlob('id/one');
    expect(result.contentDisposition).toBe('attachment; filename="report.pdf"');
    expect(result.blob.size).toBeGreaterThan(0);
    expect(mockedApiFetch).toHaveBeenCalledWith('/report-exports/id%2Fone/download', {
      localeMode: 'artifact',
      timeoutMs: 30_000,
      headers: { Accept: 'application/octet-stream' },
    });
  });

  it.each([
    [new Error('offline'), 'network'],
    [new DOMException('late', 'TimeoutError'), 'timeout'],
    [new DOMException('aborted', 'AbortError'), 'timeout'],
  ] as const)('maps %s before any response bytes are trusted', async (failure, code) => {
    mockedApiFetch.mockRejectedValue(failure);
    await expect(fetchReportSnapshotBlob('id')).rejects.toMatchObject({
      name: 'ApiError',
      status: 0,
      code,
    });
  });

  it('preserves an ApiError already normalized by the shared transport', async () => {
    const failure = new ApiError('localized', 404, { error: 'missing' });
    mockedApiFetch.mockRejectedValue(failure);

    await expect(fetchReportSnapshotBlob('id')).rejects.toBe(failure);
  });

  it('preserves JSON and inert text error payloads without parsing successful bytes', async () => {
    mockedApiFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'Localized' } }), {
          status: 422,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response('safe plain failure', {
          status: 503,
          headers: { 'content-type': 'text/plain' },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 500 }));
    await expect(fetchReportSnapshotBlob('json-error')).rejects.toMatchObject({
      status: 422,
      data: { error: { message: 'Localized' } },
    });
    await expect(fetchReportSnapshotBlob('text-error')).rejects.toMatchObject({
      status: 503,
      data: 'safe plain failure',
    });
    await expect(fetchReportSnapshotBlob('empty-error')).rejects.toMatchObject({
      status: 500,
      data: '',
    });
  });

  it('uses the concrete ApiError contract', () => {
    expect(new ApiError('failure', 500, null)).toMatchObject({
      name: 'ApiError',
      code: 'http',
    });
  });
});
