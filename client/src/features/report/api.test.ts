import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { changeLanguage, initI18n } from '@shared/i18n';
import { ApiError, __resetCsrfTokenCacheForTests } from '@shared/api/client';
import {
  downloadReportPdfRequest,
  fetchAiSummaryStateRequest,
  fetchAuditRunsRequest,
  fetchLatestRunRequest,
  fetchReportRequest,
  fetchRunRequest,
  generateAiSummaryRequest,
  startAuditRequest,
} from './api';

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });

const captureHeaders = (call: [unknown, RequestInit | undefined]): Headers => {
  return new Headers(call[1]?.headers);
};

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('report api', () => {
  it('fetchReportRequest calls /audits/:runId/report with x-lang', async () => {
    const spy = vi.fn().mockResolvedValue(jsonResponse({ runId: 'r1' }));
    vi.stubGlobal('fetch', spy);
    await fetchReportRequest('r1');
    const call = spy.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toContain('/audits/r1/report');
    expect(captureHeaders(call).get('x-lang')).toBe('en');
  });

  it('fetchLatestRunRequest asks for limit=1', async () => {
    const spy = vi
      .fn()
      .mockResolvedValue(jsonResponse({ runs: [], nextCursor: null }));
    vi.stubGlobal('fetch', spy);
    await fetchLatestRunRequest('site-1');
    const call = spy.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toContain('/sites/site-1/audits?limit=1');
    expect(captureHeaders(call).get('x-lang')).toBe('en');
  });

  it('fetchAuditRunsRequest defaults to limit=10 and honours an explicit limit', async () => {
    // Fresh Response per call — a shared instance fails "Body already read".
    const spy = vi.fn(async () => jsonResponse({ runs: [], nextCursor: null }));
    vi.stubGlobal('fetch', spy);
    await fetchAuditRunsRequest('site-1');
    const first = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(first[0]).toContain('/sites/site-1/audits?limit=10');
    expect(captureHeaders(first).get('x-lang')).toBe('en');
    await fetchAuditRunsRequest('site-1', 25);
    const second = spy.mock.calls[1] as unknown as [string, RequestInit];
    expect(second[0]).toContain('/sites/site-1/audits?limit=25');
  });

  it('fetchRunRequest calls /audits/:runId', async () => {
    const spy = vi.fn().mockResolvedValue(
      jsonResponse({
        run: {
          id: 'r1',
          siteId: 's1',
          status: 'succeeded',
          pageCap: 100,
          pagesCrawled: 0,
          vendorTaskId: null,
          startedAt: null,
          finishedAt: null,
          error: null,
          createdAt: '',
          updatedAt: '',
        },
      }),
    );
    vi.stubGlobal('fetch', spy);
    await fetchRunRequest('r1');
    const call = spy.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toContain('/audits/r1');
    expect(captureHeaders(call).get('x-lang')).toBe('en');
  });

  it('startAuditRequest posts a start-audit body', async () => {
    // Auto-CSRF makes 2 fetch calls (token, then POST). Use mockImplementation
    // so each call returns a fresh Response — a shared instance would fail
    // "Body already read" on the second consumer.
    const buildRun = () => ({
      run: {
        id: 'r2',
        siteId: 's1',
        status: 'queued',
        pageCap: 100,
        pagesCrawled: 0,
        vendorTaskId: null,
        startedAt: null,
        finishedAt: null,
        error: null,
        createdAt: '',
        updatedAt: '',
      },
      message: 'Audit started.',
    });
    const spy = vi.fn(async (...args: unknown[]) => {
      const url = args[0];
      if (String(url).includes('/security/csrf-token')) {
        return jsonResponse({ csrfToken: 'tok' });
      }
      return jsonResponse(buildRun());
    });
    vi.stubGlobal('fetch', spy);
    await startAuditRequest('s1');
    // Auto-CSRF inserts a token fetch first; skip to index 1.
    const call = spy.mock.calls[1] as unknown as [string, RequestInit];
    expect(call[0]).toContain('/sites/s1/audits');
    expect(call[1]?.method).toBe('POST');
    expect(call[1]?.body).toBe('{}');
    expect(captureHeaders(call).get('x-lang')).toBe('en');
  });

  it('startAuditRequest includes requestedPageCap only when provided', async () => {
    const spy = vi.fn().mockResolvedValue(
      jsonResponse({
        run: {
          id: 'r3',
          siteId: 's1',
          status: 'queued',
          pageCap: 1000,
          pagesCrawled: 0,
          vendorTaskId: null,
          startedAt: null,
          finishedAt: null,
          error: null,
          createdAt: '',
          updatedAt: '',
        },
        message: 'Audit started.',
      }),
    );
    vi.stubGlobal('fetch', spy);
    await startAuditRequest('s1', 1000);
    const call = spy.mock.calls[0] as [string, RequestInit];
    expect(call[1]?.body).toBe(JSON.stringify({ requestedPageCap: 1000 }));
  });

  it('generateAiSummaryRequest posts to /audits/:runId/summary with x-lang', async () => {
    const spy = vi.fn().mockResolvedValue(
      jsonResponse({
        status: 'succeeded',
        aiSummary: {
          text: 'ok',
          locale: 'en',
          model: 'claude-haiku-4-5',
          truncated: false,
          createdAt: '2026-07-03T00:00:00.000Z',
        },
      }),
    );
    vi.stubGlobal('fetch', spy);
    const res = await generateAiSummaryRequest('r1', 'en');
    const call = spy.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toContain('/audits/r1/summary');
    expect(call[1]?.method).toBe('POST');
    expect(call[1]?.body).toBe('{}');
    expect(captureHeaders(call).get('x-lang')).toBe('en');
    expect(res.aiSummary?.text).toBe('ok');
  });

  it('fetchAiSummaryStateRequest polls with x-lang and forwards AbortSignal', async () => {
    const spy = vi.fn().mockResolvedValue(
      jsonResponse({ status: 'running', aiSummary: null }),
    );
    vi.stubGlobal('fetch', spy);
    const controller = new AbortController();
    const result = await fetchAiSummaryStateRequest('r1', 'en', { signal: controller.signal });
    const call = spy.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toContain('/audits/r1/summary');
    expect(call[1]?.method).toBe('GET');
    expect(call[1]?.signal).toBeInstanceOf(AbortSignal);
    controller.abort();
    expect(call[1]?.signal?.aborted).toBe(true);
    expect(captureHeaders(call).get('x-lang')).toBe('en');
    expect(result.status).toBe('running');
  });

  it('falls back to English when i18n has no resolved language', async () => {
    const spy = vi.fn().mockResolvedValue(jsonResponse({ runId: 'r1' }));
    vi.stubGlobal('fetch', spy);
    // stub i18n to expose no language.
    const i18n = (await import('i18next')).default;
    const original = i18n.resolvedLanguage;
    const originalLanguage = i18n.language;
    Object.defineProperty(i18n, 'resolvedLanguage', {
      value: undefined,
      configurable: true,
    });
    Object.defineProperty(i18n, 'language', {
      value: undefined,
      configurable: true,
    });
    try {
      await fetchReportRequest('r1');
      const call = spy.mock.calls[0] as [string, RequestInit];
      expect(captureHeaders(call).get('x-lang')).toBe('en');
    } finally {
      Object.defineProperty(i18n, 'resolvedLanguage', {
        value: original,
        configurable: true,
      });
      Object.defineProperty(i18n, 'language', {
        value: originalLanguage,
        configurable: true,
      });
    }
  });

  it('downloadReportPdfRequest returns the PDF Blob with cookies + x-lang', async () => {
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
    const spy = vi.fn().mockResolvedValue(
      new Response(pdfBytes, {
        status: 200,
        headers: { 'Content-Type': 'application/pdf' },
      }),
    );
    vi.stubGlobal('fetch', spy);
    const blob = await downloadReportPdfRequest('r1');
    // jsdom's global Blob differs from undici's Response blob — assert shape.
    expect(blob.size).toBe(5);
    expect(blob.type).toBe('application/pdf');
    const call = spy.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toContain('/audits/r1/report.pdf');
    expect(call[1]?.credentials).toBe('include');
    expect(captureHeaders(call).get('x-lang')).toBe('en');
  });

  it('downloadReportPdfRequest falls back to /api when no API base URL is configured', async () => {
    vi.stubEnv('VITE_API_BASE_URL', undefined);
    const spy = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([0x25]), {
        status: 200,
        headers: { 'Content-Type': 'application/pdf' },
      }),
    );
    vi.stubGlobal('fetch', spy);

    await downloadReportPdfRequest('r1');

    const call = spy.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe('/api/audits/r1/report.pdf');
  });

  it('downloadReportPdfRequest throws ApiError with the parsed JSON body on failure', async () => {
    const spy = vi.fn().mockResolvedValue(
      jsonResponse(
        { error: { message: 'Report unavailable.', details: { runId: 'r1' } } },
        { status: 404 },
      ),
    );
    vi.stubGlobal('fetch', spy);
    const err = await downloadReportPdfRequest('r1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
    expect((err as ApiError).data).toMatchObject({
      error: { message: 'Report unavailable.' },
    });
  });

  it('downloadReportPdfRequest tolerates a missing Content-Type on failure', async () => {
    const spy = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));
    vi.stubGlobal('fetch', spy);
    const err = await downloadReportPdfRequest('r1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(500);
  });

  it('downloadReportPdfRequest carries a text body for non-JSON failures', async () => {
    const spy = vi.fn().mockResolvedValue(
      new Response('gateway timeout', {
        status: 504,
        headers: { 'Content-Type': 'text/plain' },
      }),
    );
    vi.stubGlobal('fetch', spy);
    const err = await downloadReportPdfRequest('r1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(504);
    expect((err as ApiError).data).toBe('gateway timeout');
  });
});
