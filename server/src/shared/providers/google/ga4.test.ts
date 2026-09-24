/**
 * GA4 adapter contract tests.
 *
 * Mirrors `gsc.test.ts`: `fetchImpl` injection instead of the shared
 * vendorMockServer so every taxonomy path stays hermetic. Fixtures are
 * recorded, redacted Analytics Data / Admin API responses under
 * `testing/fixtures/google-ga4/`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { FIXTURES_ROOT } from '../../testing/fixtures/load.js';
import {
  GscReconnectRequiredError,
  VendorAuthError,
  VendorMalformedError,
  VendorQuotaError,
  VendorTimeoutError,
  VendorUnavailableError,
} from '../errors.js';
import {
  createGoogleGa4Provider,
  DEFAULT_GA4_TIMEOUT_MS,
  expandPropertyTemplate,
  normalizeAccountSummaries,
  normalizeRunReport,
  normalizeWebDataStreams,
  RUN_REPORT_URL_TEMPLATE,
} from './ga4.js';

const BASE = {
  clientId: 'id',
  clientSecret: 'secret',
  timeoutMs: 200,
  accountSummariesUrl: 'https://ga.test/v1beta/accountSummaries',
  dataStreamsUrlTemplate: 'https://ga.test/v1beta/{property}/dataStreams',
  runReportUrlTemplate: 'https://ga.test/v1beta/{property}:runReport',
};

const CONNECTION = { accessToken: 'access' };

const REPORT_INPUT = {
  propertyId: 'properties/100000001',
  startDate: '2026-06-15',
  endDate: '2026-07-12',
  dimensions: ['date'],
  metrics: ['sessions', 'activeUsers', 'engagedSessions', 'keyEvents'],
};

/** Recorded, redacted vendor fixture. */
function ga4Fixture(operation: string, kase: string): unknown {
  return JSON.parse(
    readFileSync(
      join(FIXTURES_ROOT, 'google-ga4', operation, `${kase}.json`),
      'utf8',
    ),
  );
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('expandPropertyTemplate', () => {
  it('replaces the {property} placeholder with the resource name', () => {
    expect(
      expandPropertyTemplate(RUN_REPORT_URL_TEMPLATE, 'properties/123'),
    ).toBe(
      'https://analyticsdata.googleapis.com/v1beta/properties/123:runReport',
    );
  });
});

describe('createGoogleGa4Provider — construction', () => {
  it('throws without OAuth credentials', () => {
    expect(() =>
      createGoogleGa4Provider({ clientId: '', clientSecret: 'x' }),
    ).toThrow(/GOOGLE_CLIENT_ID/);
    expect(() =>
      createGoogleGa4Provider({ clientId: 'x', clientSecret: '' }),
    ).toThrow(/GOOGLE_CLIENT_SECRET|GOOGLE_CLIENT_ID/);
  });

  it('defaults endpoints + timeout when not overridden', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toContain('analyticsadmin.googleapis.com');
      return jsonResponse(ga4Fixture('account-summaries', 'empty'));
    }) as unknown as typeof fetch;
    const provider = createGoogleGa4Provider({
      clientId: 'id',
      clientSecret: 'secret',
      fetchImpl,
    });
    await provider.listProperties(CONNECTION);
    expect(DEFAULT_GA4_TIMEOUT_MS).toBe(15_000);
  });
});

describe('listProperties (Admin API account summaries)', () => {
  it('success: flattens property summaries across accounts (logger branch)', async () => {
    const { pino } = await import('pino');
    const fetchImpl = vi.fn(async () =>
      jsonResponse(ga4Fixture('account-summaries', 'success')),
    ) as unknown as typeof fetch;
    const provider = createGoogleGa4Provider({
      ...BASE,
      fetchImpl,
      logger: pino({ level: 'silent' }),
    });
    const properties = await provider.listProperties(CONNECTION);
    expect(properties).toEqual([
      { propertyId: 'properties/100000001', displayName: 'example.com - GA4' },
      { propertyId: 'properties/100000002', displayName: 'Example Staging' },
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      BASE.accountSummariesUrl,
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ authorization: 'Bearer access' }),
      }),
    );
  });

  it('empty: an account list without summaries yields []', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(ga4Fixture('account-summaries', 'empty')),
    ) as unknown as typeof fetch;
    const provider = createGoogleGa4Provider({ ...BASE, fetchImpl });
    await expect(provider.listProperties(CONNECTION)).resolves.toEqual([]);
  });

  it('malformed: schema drift maps to VendorMalformedError', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(ga4Fixture('account-summaries', 'malformed')),
    ) as unknown as typeof fetch;
    const provider = createGoogleGa4Provider({ ...BASE, fetchImpl });
    await expect(provider.listProperties(CONNECTION)).rejects.toBeInstanceOf(
      VendorMalformedError,
    );
  });

  it('falls back to the resource name when displayName is missing', () => {
    const properties = normalizeAccountSummaries(
      {
        accountSummaries: [
          { propertySummaries: [{ property: 'properties/9' }] },
        ],
      },
      { provider: 'google', operation: 'ga4-account-summaries' },
    );
    expect(properties).toEqual([
      { propertyId: 'properties/9', displayName: 'properties/9' },
    ]);
  });
});

describe('listWebDataStreams (Admin API data streams)', () => {
  it('success: returns web origins and ignores app streams', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(ga4Fixture('data-streams', 'success')),
    ) as unknown as typeof fetch;
    const provider = createGoogleGa4Provider({ ...BASE, fetchImpl });
    await expect(
      provider.listWebDataStreams(CONNECTION, 'properties/100000001'),
    ).resolves.toEqual([
      {
        streamId: 'properties/100000001/dataStreams/200000001',
        displayName: 'Example production web',
        defaultUri: 'https://example.com',
      },
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://ga.test/v1beta/properties/100000001/dataStreams',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('empty: a response without streams yields []', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(ga4Fixture('data-streams', 'empty')),
    ) as unknown as typeof fetch;
    const provider = createGoogleGa4Provider({ ...BASE, fetchImpl });
    await expect(
      provider.listWebDataStreams(CONNECTION, 'properties/100000001'),
    ).resolves.toEqual([]);
  });

  it('malformed: schema drift maps to VendorMalformedError', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(ga4Fixture('data-streams', 'malformed')),
    ) as unknown as typeof fetch;
    const provider = createGoogleGa4Provider({ ...BASE, fetchImpl });
    await expect(
      provider.listWebDataStreams(CONNECTION, 'properties/100000001'),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('uses resource names as labels and empty origins when optional fields are absent', () => {
    expect(
      normalizeWebDataStreams(
        { dataStreams: [{ name: 'properties/1/dataStreams/2', type: 'WEB_DATA_STREAM' }] },
        { provider: 'google', operation: 'ga4-data-streams' },
      ),
    ).toEqual([
      {
        streamId: 'properties/1/dataStreams/2',
        displayName: 'properties/1/dataStreams/2',
        defaultUri: '',
      },
    ]);
  });

  it('quota: 429 maps to VendorQuotaError', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { code: 429 } }, 429),
    ) as unknown as typeof fetch;
    const provider = createGoogleGa4Provider({ ...BASE, fetchImpl });
    await expect(
      provider.listWebDataStreams(CONNECTION, 'properties/100000001'),
    ).rejects.toBeInstanceOf(VendorQuotaError);
  });

  it('timeout: an aborted request maps to VendorTimeoutError', async () => {
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    ) as unknown as typeof fetch;
    const provider = createGoogleGa4Provider({ ...BASE, timeoutMs: 20, fetchImpl });
    await expect(
      provider.listWebDataStreams(CONNECTION, 'properties/100000001'),
    ).rejects.toBeInstanceOf(VendorTimeoutError);
  });
});

describe('runReport (Data API)', () => {
  it('success: parses rows, coerces string metric values to numbers, echoes the request', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe(
        'https://ga.test/v1beta/properties/100000001:runReport',
      );
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({
        dateRanges: [{ startDate: '2026-06-15', endDate: '2026-07-12' }],
        dimensions: [{ name: 'date' }],
        metrics: [
          { name: 'sessions' },
          { name: 'activeUsers' },
          { name: 'engagedSessions' },
          { name: 'keyEvents' },
        ],
        limit: 1000,
      });
      return jsonResponse(ga4Fixture('run-report', 'success'));
    }) as unknown as typeof fetch;
    const provider = createGoogleGa4Provider({ ...BASE, fetchImpl });
    const result = await provider.runReport(CONNECTION, REPORT_INPUT);
    expect(result.rows).toEqual([
      { dimensionValues: ['20260701'], metricValues: [42, 38, 30, 3] },
      { dimensionValues: ['20260702'], metricValues: [51, 44, 39, 5] },
    ]);
    expect(result.rowCount).toBe(2);
    expect(result.startDate).toBe('2026-06-15');
    expect(result.endDate).toBe('2026-07-12');
    expect(result.dimensions).toEqual(['date']);
    expect(result.metrics).toEqual(REPORT_INPUT.metrics);
  });

  it('honours a custom row limit', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body)).limit).toBe(25);
      return jsonResponse(ga4Fixture('run-report', 'empty'));
    }) as unknown as typeof fetch;
    const provider = createGoogleGa4Provider({ ...BASE, fetchImpl });
    await provider.runReport(CONNECTION, { ...REPORT_INPUT, limit: 25 });
  });

  it('empty: a zero-row report (rows key absent) yields [] and rowCount 0', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(ga4Fixture('run-report', 'empty')),
    ) as unknown as typeof fetch;
    const provider = createGoogleGa4Provider({ ...BASE, fetchImpl });
    const result = await provider.runReport(CONNECTION, REPORT_INPUT);
    expect(result.rows).toEqual([]);
    expect(result.rowCount).toBe(0);
  });

  it('malformed: schema drift maps to VendorMalformedError', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(ga4Fixture('run-report', 'malformed')),
    ) as unknown as typeof fetch;
    const provider = createGoogleGa4Provider({ ...BASE, fetchImpl });
    await expect(provider.runReport(CONNECTION, REPORT_INPUT)).rejects.toBeInstanceOf(
      VendorMalformedError,
    );
  });

  it('non-JSON 200 body maps to VendorMalformedError', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response('<html>gateway</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
    ) as unknown as typeof fetch;
    const provider = createGoogleGa4Provider({ ...BASE, fetchImpl });
    await expect(provider.runReport(CONNECTION, REPORT_INPUT)).rejects.toBeInstanceOf(
      VendorMalformedError,
    );
  });

  it('missing dimension/metric cells normalize to ""/0 (never NaN)', () => {
    const result = normalizeRunReport(
      {
        rows: [
          { dimensionValues: [{}], metricValues: [{ value: 'not-a-number' }, {}] },
          {},
        ],
      },
      { provider: 'google', operation: 'ga4-run-report' },
      {
        startDate: '2026-06-15',
        endDate: '2026-07-12',
        dimensions: ['date'],
        metrics: ['sessions', 'activeUsers'],
      },
    );
    expect(result.rows).toEqual([
      { dimensionValues: [''], metricValues: [0, 0] },
      { dimensionValues: [], metricValues: [] },
    ]);
    expect(result.rowCount).toBe(0);
  });
});

describe('error taxonomy (shared fetch helper)', () => {
  function providerWith(response: Response) {
    const fetchImpl = vi.fn(async () => response) as unknown as typeof fetch;
    return createGoogleGa4Provider({ ...BASE, fetchImpl });
  }

  it('401 → GscReconnectRequiredError (shared Google connection)', async () => {
    const provider = providerWith(jsonResponse({ error: { code: 401 } }, 401));
    await expect(provider.runReport(CONNECTION, REPORT_INPUT)).rejects.toBeInstanceOf(
      GscReconnectRequiredError,
    );
  });

  it('429 → VendorQuotaError', async () => {
    const provider = providerWith(jsonResponse({ error: { code: 429 } }, 429));
    await expect(provider.listProperties(CONNECTION)).rejects.toBeInstanceOf(
      VendorQuotaError,
    );
  });

  it('5xx → VendorUnavailableError', async () => {
    const provider = providerWith(jsonResponse({ error: { code: 503 } }, 503));
    await expect(provider.runReport(CONNECTION, REPORT_INPUT)).rejects.toBeInstanceOf(
      VendorUnavailableError,
    );
  });

  it('403 → VendorAuthError (PERMISSION_DENIED — scope not effective / API disabled)', async () => {
    const provider = providerWith(
      jsonResponse({ error: { code: 403, status: 'PERMISSION_DENIED' } }, 403),
    );
    await expect(provider.listProperties(CONNECTION)).rejects.toBeInstanceOf(
      VendorAuthError,
    );
  });

  it('other 4xx → VendorMalformedError (unexpected contract drift)', async () => {
    const provider = providerWith(
      jsonResponse({ error: { code: 418, status: 'IM_A_TEAPOT' } }, 418),
    );
    await expect(provider.runReport(CONNECTION, REPORT_INPUT)).rejects.toBeInstanceOf(
      VendorMalformedError,
    );
  });

  it('network drop → VendorUnavailableError', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;
    const provider = createGoogleGa4Provider({ ...BASE, fetchImpl });
    await expect(provider.listProperties(CONNECTION)).rejects.toBeInstanceOf(
      VendorUnavailableError,
    );
  });

  it('timeout → VendorTimeoutError', async () => {
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        }),
    ) as unknown as typeof fetch;
    const provider = createGoogleGa4Provider({
      ...BASE,
      timeoutMs: 20,
      fetchImpl,
    });
    await expect(provider.runReport(CONNECTION, REPORT_INPUT)).rejects.toBeInstanceOf(
      VendorTimeoutError,
    );
  });
});
