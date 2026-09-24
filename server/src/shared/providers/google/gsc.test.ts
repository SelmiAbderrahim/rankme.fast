/**
 * Google Search Console adapter tests.
 *
 * Uses `fetchImpl` injection instead of the shared vendorMockServer so token
 * refresh + revoke stay hermetic (no OAuth roundtrip in tests).
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
  createGoogleGscProvider,
  DEFAULT_GSC_TIMEOUT_MS,
  expandSiteUrlTemplate,
  normalizeInspection,
  normalizeSearchAnalytics,
  normalizeSitemaps,
  SEARCH_ANALYTICS_URL_TEMPLATE,
} from './gsc.js';

const BASE = {
  clientId: 'id',
  clientSecret: 'secret',
  timeoutMs: 200,
  sitesUrl: 'https://sc.test/sites',
  inspectUrl: 'https://sc.test/inspect',
  tokenUrl: 'https://oauth.test/token',
  revokeUrl: 'https://oauth.test/revoke',
  searchAnalyticsUrlTemplate:
    'https://sc.test/v1/sites/{siteUrl}/searchAnalytics/query',
  sitemapsUrlTemplate: 'https://sc.test/v3/sites/{siteUrl}/sitemaps',
};

/** Recorded, redacted vendor fixture. */
function gscFixture(operation: string, kase: string): unknown {
  return JSON.parse(
    readFileSync(
      join(FIXTURES_ROOT, 'google-gsc', operation, `${kase}.json`),
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

function makeInspection(overrides: {
  verdict: 'PASS' | 'PARTIAL' | 'FAIL' | 'NEUTRAL';
  rrVerdict?: 'PASS' | 'PARTIAL' | 'FAIL' | 'NEUTRAL';
  detectedItems?: Array<{
    richResultType?: string;
    items?: Array<{ issues?: unknown[] }>;
  }>;
  lastCrawlTime?: string;
}) {
  return {
    inspectionResult: {
      indexStatusResult: {
        verdict: overrides.verdict,
        coverageState:
          overrides.verdict === 'PASS'
            ? 'Submitted and indexed'
            : 'URL is unknown to Google',
        robotsTxtState: 'ALLOWED',
        pageFetchState: 'SUCCESSFUL',
        googleCanonical: 'https://example.com/',
        ...(overrides.lastCrawlTime
          ? { lastCrawlTime: overrides.lastCrawlTime }
          : {}),
      },
      richResultsResult: {
        verdict: overrides.rrVerdict ?? 'PASS',
        detectedItems: overrides.detectedItems ?? [],
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Sites list
// ---------------------------------------------------------------------------

describe('GoogleGscProvider.listProperties', () => {
  it('parses siteEntry into GscProperty[]', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        siteEntry: [
          { siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' },
          { siteUrl: 'https://example.com/', permissionLevel: 'siteFullUser' },
        ],
      }),
    ) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    const props = await provider.listProperties({ accessToken: 'a' });
    expect(props).toEqual([
      { siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' },
      { siteUrl: 'https://example.com/', permissionLevel: 'siteFullUser' },
    ]);
  });

  it('empty siteEntry list returns []', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({})) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    expect(await provider.listProperties({ accessToken: 'a' })).toEqual([]);
  });

  it('malformed sites payload → VendorMalformedError', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ siteEntry: [{ nope: 1 }] }),
    ) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    await expect(
      provider.listProperties({ accessToken: 'a' }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('401 → GscReconnectRequiredError', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: 'unauthorized' }, 401),
    ) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    await expect(
      provider.listProperties({ accessToken: 'a' }),
    ).rejects.toBeInstanceOf(GscReconnectRequiredError);
  });

  it('429 → VendorQuotaError', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({}, 429),
    ) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    await expect(
      provider.listProperties({ accessToken: 'a' }),
    ).rejects.toBeInstanceOf(VendorQuotaError);
  });

  it('403 → VendorAuthError', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { code: 403, status: 'PERMISSION_DENIED' } }, 403),
    ) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    await expect(
      provider.listProperties({ accessToken: 'a' }),
    ).rejects.toBeInstanceOf(VendorAuthError);
  });

  it('5xx → VendorUnavailableError', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({}, 503),
    ) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    await expect(
      provider.listProperties({ accessToken: 'a' }),
    ).rejects.toBeInstanceOf(VendorUnavailableError);
  });

  it('unexpected 418 → VendorMalformedError', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ err: 'teapot' }, 418),
    ) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    await expect(
      provider.listProperties({ accessToken: 'a' }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('timeout → VendorTimeoutError', async () => {
    const fetchImpl = vi.fn(
      (_url: string | URL, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    ) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({
      ...BASE,
      fetchImpl,
      timeoutMs: 10,
    });
    await expect(
      provider.listProperties({ accessToken: 'a' }),
    ).rejects.toBeInstanceOf(VendorTimeoutError);
  });

  it('network error → VendorUnavailableError', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('ECONNRESET');
    }) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    await expect(
      provider.listProperties({ accessToken: 'a' }),
    ).rejects.toBeInstanceOf(VendorUnavailableError);
  });

  it('sends bearer token + accept header', async () => {
    let captured: RequestInit | undefined;
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      captured = init;
      return jsonResponse({ siteEntry: [] });
    }) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    await provider.listProperties({ accessToken: 'a-token' });
    const headers = captured?.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer a-token');
    expect(headers.accept).toBe('application/json');
  });

  it('logs when a logger is provided', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ siteEntry: [] }),
    ) as unknown as typeof fetch;
    const info = vi.fn();
    const logger = {
      info,
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      fatal: vi.fn(),
      trace: vi.fn(),
    } as never;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl, logger });
    await provider.listProperties({ accessToken: 'a' });
    expect(info).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// URL inspection
// ---------------------------------------------------------------------------

describe('GoogleGscProvider.inspectUrl', () => {
  it('normalizes a PASS verdict with rich results', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        makeInspection({
          verdict: 'PASS',
          rrVerdict: 'PASS',
          detectedItems: [
            { richResultType: 'FAQ', items: [{ issues: [] }] },
          ],
          lastCrawlTime: '2026-05-01T00:00:00Z',
        }),
      ),
    ) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    const out = await provider.inspectUrl(
      { accessToken: 'a' },
      { inspectionUrl: 'https://example.com/', siteUrl: 'sc-domain:example.com' },
    );
    expect(out.indexVerdict).toBe('PASS');
    expect(out.richResults.verdict).toBe('PASS');
    expect(out.richResults.items).toEqual([{ type: 'FAQ', issues: 0 }]);
    expect(out.lastCrawlTime).toBeInstanceOf(Date);
    expect(out.pageFetchState).toBe('SUCCESSFUL');
    expect(out.googleCanonical).toBe('https://example.com/');
  });

  it('normalizes a FAIL verdict', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(makeInspection({ verdict: 'FAIL' })),
    ) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    const out = await provider.inspectUrl(
      { accessToken: 'a' },
      { inspectionUrl: 'https://example.com/x', siteUrl: 'sc-domain:example.com' },
    );
    expect(out.indexVerdict).toBe('FAIL');
    expect(out.lastCrawlTime).toBeNull();
  });

  it('normalizes a PARTIAL verdict with issue counts', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        makeInspection({
          verdict: 'PARTIAL',
          rrVerdict: 'PARTIAL',
          detectedItems: [
            {
              richResultType: 'Product',
              items: [{ issues: [{ a: 1 }, { b: 2 }] }, { issues: [{ c: 3 }] }],
            },
          ],
        }),
      ),
    ) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    const out = await provider.inspectUrl(
      { accessToken: 'a' },
      { inspectionUrl: 'https://example.com/p', siteUrl: 'sc-domain:example.com' },
    );
    expect(out.indexVerdict).toBe('PARTIAL');
    expect(out.richResults.items).toEqual([{ type: 'Product', issues: 3 }]);
  });

  it('normalizes a NEUTRAL verdict (no rich results block)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        inspectionResult: {
          indexStatusResult: {
            verdict: 'NEUTRAL',
            coverageState: 'URL is unknown to Google',
            robotsTxtState: 'UNKNOWN',
          },
        },
      }),
    ) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    const out = await provider.inspectUrl(
      { accessToken: 'a' },
      { inspectionUrl: 'https://example.com/n', siteUrl: 'sc-domain:example.com' },
    );
    expect(out.indexVerdict).toBe('NEUTRAL');
    expect(out.richResults.verdict).toBe('NEUTRAL');
    expect(out.richResults.items).toEqual([]);
    expect(out.pageFetchState).toBeNull();
    expect(out.googleCanonical).toBeNull();
  });

  it('malformed inspection → VendorMalformedError', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ inspectionResult: { indexStatusResult: { verdict: 'NOPE' } } }),
    ) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    await expect(
      provider.inspectUrl(
        { accessToken: 'a' },
        { inspectionUrl: 'https://example.com/', siteUrl: 'sc-domain:example.com' },
      ),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('non-JSON success body → VendorMalformedError', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('not json', { status: 200 }),
    ) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    await expect(
      provider.inspectUrl(
        { accessToken: 'a' },
        { inspectionUrl: 'https://example.com/', siteUrl: 'sc-domain:example.com' },
      ),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('drops an unparseable lastCrawlTime to null', async () => {
    const inspection = makeInspection({ verdict: 'PASS' });
    inspection.inspectionResult.indexStatusResult.lastCrawlTime = 'garbage';
    const fetchImpl = vi.fn(async () =>
      jsonResponse(inspection),
    ) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    const out = await provider.inspectUrl(
      { accessToken: 'a' },
      { inspectionUrl: 'https://example.com/', siteUrl: 'sc-domain:example.com' },
    );
    expect(out.lastCrawlTime).toBeNull();
  });

  it('POSTs the inspection body with JSON content-type', async () => {
    let captured: RequestInit | undefined;
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      captured = init;
      return jsonResponse(makeInspection({ verdict: 'PASS' }));
    }) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    await provider.inspectUrl(
      { accessToken: 'a' },
      { inspectionUrl: 'https://example.com/', siteUrl: 'sc-domain:example.com' },
    );
    expect(captured?.method).toBe('POST');
    const headers = captured?.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
    expect(captured?.body).toContain('inspectionUrl');
  });

  it('normalizeInspection surfaces "unknown" richResultType when the vendor omits it', () => {
    const payload = {
      inspectionResult: {
        indexStatusResult: { verdict: 'PASS' },
        richResultsResult: {
          verdict: 'PASS',
          detectedItems: [{ items: [{ issues: [{ x: 1 }] }] }],
        },
      },
    };
    const out = normalizeInspection(payload, { provider: 'google', operation: 'test' });
    expect(out.richResults.items).toEqual([{ type: 'unknown', issues: 1 }]);
  });

  it('normalizeInspection counts zero issues on an entry without items[]', () => {
    const payload = {
      inspectionResult: {
        indexStatusResult: { verdict: 'PASS' },
        richResultsResult: {
          verdict: 'PASS',
          detectedItems: [{ richResultType: 'Article' }],
        },
      },
    };
    const out = normalizeInspection(payload, { provider: 'google', operation: 'test' });
    expect(out.richResults.items).toEqual([{ type: 'Article', issues: 0 }]);
  });

  it('normalizeInspection treats an item without an `issues` field as zero issues', () => {
    // Covers the `it.issues?.length ?? 0` fallback branch — vendor omits
    // `issues` entirely on a passing entry.
    const payload = {
      inspectionResult: {
        indexStatusResult: { verdict: 'PASS' },
        richResultsResult: {
          verdict: 'PASS',
          detectedItems: [
            {
              richResultType: 'Recipe',
              items: [{ /* no issues field */ }, { issues: [{ x: 1 }] }],
            },
          ],
        },
      },
    };
    const out = normalizeInspection(payload, { provider: 'google', operation: 'test' });
    expect(out.richResults.items).toEqual([{ type: 'Recipe', issues: 1 }]);
  });
});

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

describe('GoogleGscProvider.refreshAccessToken', () => {
  it('parses access_token + expires_in', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ access_token: 'new-token', expires_in: 3600 }),
    ) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    const out = await provider.refreshAccessToken('refresh');
    expect(out).toEqual({ accessToken: 'new-token', expiresIn: 3600 });
  });

  it('invalid_grant → GscReconnectRequiredError', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        { error: 'invalid_grant', error_description: 'Token expired' },
        400,
      ),
    ) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    await expect(
      provider.refreshAccessToken('dead-token'),
    ).rejects.toBeInstanceOf(GscReconnectRequiredError);
  });

  it('generic 400 → VendorMalformedError', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: 'invalid_request' }, 400),
    ) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    await expect(
      provider.refreshAccessToken('token'),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('malformed token body → VendorMalformedError', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ access_token: 42 }),
    ) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    await expect(
      provider.refreshAccessToken('token'),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('sends form-encoded client_id + client_secret + refresh_token + grant_type', async () => {
    let captured: RequestInit | undefined;
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      captured = init;
      return jsonResponse({ access_token: 't', expires_in: 3600 });
    }) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    await provider.refreshAccessToken('refresh');
    const headers = captured?.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/x-www-form-urlencoded');
    const params = new URLSearchParams(captured?.body as string);
    expect(params.get('client_id')).toBe('id');
    expect(params.get('client_secret')).toBe('secret');
    expect(params.get('refresh_token')).toBe('refresh');
    expect(params.get('grant_type')).toBe('refresh_token');
  });
});

// ---------------------------------------------------------------------------
// Revoke
// ---------------------------------------------------------------------------

describe('GoogleGscProvider.revokeToken', () => {
  it('sends form-encoded token=<token>', async () => {
    let captured: RequestInit | undefined;
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      captured = init;
      return new Response('', { status: 200 });
    }) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    await provider.revokeToken('a-token');
    const params = new URLSearchParams(captured?.body as string);
    expect(params.get('token')).toBe('a-token');
  });

  it('treats 400 invalid_token as idempotent revoke success', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: 'invalid_token' }, 400),
    ) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    await expect(provider.revokeToken('token')).resolves.toBeUndefined();
  });

  it('still surfaces an unrelated 400 as VendorMalformedError', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: 'invalid_request' }, 400),
    ) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    await expect(provider.revokeToken('token')).rejects.toBeInstanceOf(
      VendorMalformedError,
    );
  });
});

// ---------------------------------------------------------------------------
// Construction guards + defaults
// ---------------------------------------------------------------------------

describe('createGoogleGscProvider construction', () => {
  it('empty clientId throws', () => {
    expect(() =>
      createGoogleGscProvider({ clientId: '', clientSecret: 's' }),
    ).toThrow(/GOOGLE_CLIENT_ID/);
  });

  it('empty clientSecret throws', () => {
    expect(() =>
      createGoogleGscProvider({ clientId: 'i', clientSecret: '' }),
    ).toThrow(/GOOGLE_CLIENT_ID/);
  });

  it('exports a reasonable default timeout', () => {
    expect(DEFAULT_GSC_TIMEOUT_MS).toBe(15_000);
  });

  it('uses defaults for URLs when overrides omitted (smoke)', () => {
    const provider = createGoogleGscProvider({
      clientId: 'id',
      clientSecret: 'secret',
    });
    expect(typeof provider.listProperties).toBe('function');
    expect(typeof provider.inspectUrl).toBe('function');
    expect(typeof provider.refreshAccessToken).toBe('function');
    expect(typeof provider.revokeToken).toBe('function');
  });

  it('defaults Search Analytics to the webmasters/v3 endpoint (regression: v1 404s)', async () => {
    // Google's Search Analytics query method only exists at webmasters/v3 —
    // a v1 path 404s, which the collector silently swallows (no rows ever
    // persist). Every other test injects a mock searchAnalyticsUrlTemplate,
    // so this pins the DEFAULT constant that actually ships to Google.
    expect(SEARCH_ANALYTICS_URL_TEMPLATE).toContain('/webmasters/v3/');
    expect(SEARCH_ANALYTICS_URL_TEMPLATE).toContain('searchAnalytics/query');

    const fetchImpl = vi.fn(async () =>
      jsonResponse({ rows: [] }),
    ) as unknown as typeof fetch;
    // Build WITHOUT a searchAnalyticsUrlTemplate override → exercises the default.
    const provider = createGoogleGscProvider({
      clientId: 'id',
      clientSecret: 'secret',
      fetchImpl,
    });
    await provider.querySearchAnalytics({ accessToken: 'tok' }, SA_INPUT);
    const [url] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
    ];
    expect(url).toBe(
      'https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Aexample.com/searchAnalytics/query',
    );
  });
});

// ---------------------------------------------------------------------------
// Search Analytics
// ---------------------------------------------------------------------------

const SA_INPUT = {
  siteUrl: 'sc-domain:example.com',
  startDate: '2026-06-07',
  endDate: '2026-07-04',
  dimensions: ['query'],
};

describe('GoogleGscProvider.querySearchAnalytics', () => {
  it('parses the recorded multi-row fixture and echoes the window', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(gscFixture('search-analytics', 'success')),
    ) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    const result = await provider.querySearchAnalytics(
      { accessToken: 'a' },
      SA_INPUT,
    );
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]).toEqual({
      keys: ['seo audit tool'],
      clicks: 182,
      impressions: 5421,
      ctr: 0.0335731,
      position: 4.18,
    });
    expect(result.sampled).toBe(true);
    expect(result.startDate).toBe('2026-06-07');
    expect(result.endDate).toBe('2026-07-04');
    expect(result.dimensions).toEqual(['query']);
  });

  it('single-row payload parses', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        rows: [
          { keys: ['a'], clicks: 1, impressions: 2, ctr: 0.5, position: 1.0 },
        ],
      }),
    ) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    const result = await provider.querySearchAnalytics(
      { accessToken: 'a' },
      SA_INPUT,
    );
    expect(result.rows).toHaveLength(1);
  });

  it('empty fixture (rows absent) → empty rows array', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(gscFixture('search-analytics', 'empty')),
    ) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    const result = await provider.querySearchAnalytics(
      { accessToken: 'a' },
      SA_INPUT,
    );
    expect(result.rows).toEqual([]);
    expect(result.sampled).toBe(true);
  });

  it('missing keys on a row defaults to []', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        rows: [{ clicks: 3, impressions: 9, ctr: 1 / 3, position: 2.5 }],
      }),
    ) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    const result = await provider.querySearchAnalytics(
      { accessToken: 'a' },
      SA_INPUT,
    );
    expect(result.rows[0]!.keys).toEqual([]);
  });

  it('malformed fixture (clicks wrong type) → VendorMalformedError', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(gscFixture('search-analytics', 'malformed')),
    ) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    await expect(
      provider.querySearchAnalytics({ accessToken: 'a' }, SA_INPUT),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('rows with wrong container type → VendorMalformedError', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ rows: 'nope' }),
    ) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    await expect(
      provider.querySearchAnalytics({ accessToken: 'a' }, SA_INPUT),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('POSTs the query body with defaults and URL-encodes siteUrl', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ rows: [] }),
    ) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    await provider.querySearchAnalytics({ accessToken: 'tok' }, SA_INPUT);
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      'https://sc.test/v1/sites/sc-domain%3Aexample.com/searchAnalytics/query',
    );
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe(
      'Bearer tok',
    );
    expect(JSON.parse(init.body as string)).toEqual({
      startDate: '2026-06-07',
      endDate: '2026-07-04',
      dimensions: ['query'],
      type: 'web',
      rowLimit: 1000,
    });
  });

  it('honours explicit rowLimit and type', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ rows: [] }),
    ) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    await provider.querySearchAnalytics(
      { accessToken: 'tok' },
      { ...SA_INPUT, rowLimit: 25, type: 'image' },
    );
    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(init.body as string)).toMatchObject({
      rowLimit: 25,
      type: 'image',
    });
  });

  it('401 → GscReconnectRequiredError', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({}, 401),
    ) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    await expect(
      provider.querySearchAnalytics({ accessToken: 'a' }, SA_INPUT),
    ).rejects.toBeInstanceOf(GscReconnectRequiredError);
  });

  it('429 → VendorQuotaError', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({}, 429),
    ) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    await expect(
      provider.querySearchAnalytics({ accessToken: 'a' }, SA_INPUT),
    ).rejects.toBeInstanceOf(VendorQuotaError);
  });

  it('timeout → VendorTimeoutError', async () => {
    const fetchImpl = vi.fn(
      (_url: string | URL, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    ) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({
      ...BASE,
      fetchImpl,
      timeoutMs: 10,
    });
    await expect(
      provider.querySearchAnalytics({ accessToken: 'a' }, SA_INPUT),
    ).rejects.toBeInstanceOf(VendorTimeoutError);
  });

  it('network drop → VendorUnavailableError', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('ECONNRESET');
    }) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    await expect(
      provider.querySearchAnalytics({ accessToken: 'a' }, SA_INPUT),
    ).rejects.toBeInstanceOf(VendorUnavailableError);
  });
});

// ---------------------------------------------------------------------------
// Search Appearance (GSC generative-AI appearance)
// ---------------------------------------------------------------------------

const SA_APPEARANCE_INPUT = {
  siteUrl: 'sc-domain:example.com',
  startDate: '2026-06-21',
  endDate: '2026-07-16',
  dimensions: ['searchAppearance'],
};

describe('GoogleGscProvider.querySearchAnalytics (searchAppearance dimension)', () => {
  it('parses success-generative-recognized fixture verbatim (keys carry the raw appearance label)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(gscFixture('search-appearance', 'success-generative-recognized')),
    ) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    const result = await provider.querySearchAnalytics(
      { accessToken: 'a' },
      SA_APPEARANCE_INPUT,
    );
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]).toEqual({
      keys: ['AI_OVERVIEWS'],
      clicks: 42,
      impressions: 1580,
      ctr: 0.0265822784,
      position: 4.3,
    });
    expect(result.rows[1]!.keys).toEqual(['AI_MODE']);
    expect(result.rows[2]!.keys).toEqual(['FAQ_RICH_RESULTS']);
    expect(result.dimensions).toEqual(['searchAppearance']);
    expect(result.startDate).toBe('2026-06-21');
    expect(result.endDate).toBe('2026-07-16');
  });

  it('success-empty fixture (rows absent) → empty rows array (no zero-fill)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(gscFixture('search-appearance', 'success-empty')),
    ) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    const result = await provider.querySearchAnalytics(
      { accessToken: 'a' },
      SA_APPEARANCE_INPUT,
    );
    expect(result.rows).toEqual([]);
  });

  it('success-unknown-value fixture is preserved verbatim (never silently reclassified)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(gscFixture('search-appearance', 'success-unknown-value')),
    ) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    const result = await provider.querySearchAnalytics(
      { accessToken: 'a' },
      SA_APPEARANCE_INPUT,
    );
    expect(result.rows[0]!.keys).toEqual(['FUTURE_GENERATIVE_SURFACE_V2']);
    expect(result.rows[1]!.keys).toEqual(['VIDEO']);
  });

  it('malformed searchAppearance fixture → VendorMalformedError', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(gscFixture('search-appearance', 'malformed')),
    ) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    await expect(
      provider.querySearchAnalytics({ accessToken: 'a' }, SA_APPEARANCE_INPUT),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('POSTs the query body with dimensions=[searchAppearance] and encoded siteUrl', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ rows: [] }),
    ) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    await provider.querySearchAnalytics(
      { accessToken: 'tok' },
      SA_APPEARANCE_INPUT,
    );
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      'https://sc.test/v1/sites/sc-domain%3Aexample.com/searchAnalytics/query',
    );
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      startDate: '2026-06-21',
      endDate: '2026-07-16',
      dimensions: ['searchAppearance'],
      type: 'web',
      rowLimit: 1000,
    });
  });

  it('401 during a searchAppearance query → GscReconnectRequiredError', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({}, 401),
    ) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    await expect(
      provider.querySearchAnalytics({ accessToken: 'a' }, SA_APPEARANCE_INPUT),
    ).rejects.toBeInstanceOf(GscReconnectRequiredError);
  });

  it('403 during a searchAppearance query → VendorAuthError', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({}, 403),
    ) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    await expect(
      provider.querySearchAnalytics({ accessToken: 'a' }, SA_APPEARANCE_INPUT),
    ).rejects.toBeInstanceOf(VendorAuthError);
  });

  it('429 during a searchAppearance query → VendorQuotaError', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({}, 429),
    ) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    await expect(
      provider.querySearchAnalytics({ accessToken: 'a' }, SA_APPEARANCE_INPUT),
    ).rejects.toBeInstanceOf(VendorQuotaError);
  });

  it('5xx during a searchAppearance query → VendorUnavailableError', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({}, 503),
    ) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    await expect(
      provider.querySearchAnalytics({ accessToken: 'a' }, SA_APPEARANCE_INPUT),
    ).rejects.toBeInstanceOf(VendorUnavailableError);
  });

  it('timeout during a searchAppearance query → VendorTimeoutError', async () => {
    const fetchImpl = vi.fn(
      (_url: string | URL, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    ) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({
      ...BASE,
      fetchImpl,
      timeoutMs: 10,
    });
    await expect(
      provider.querySearchAnalytics(
        { accessToken: 'a' },
        SA_APPEARANCE_INPUT,
      ),
    ).rejects.toBeInstanceOf(VendorTimeoutError);
  });
});

// ---------------------------------------------------------------------------
// Sitemaps list
// ---------------------------------------------------------------------------

describe('GoogleGscProvider.listSitemaps', () => {
  it('parses the recorded fixture (singular `sitemap` key, string counts)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(gscFixture('sitemaps', 'success')),
    ) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    const entries = await provider.listSitemaps(
      { accessToken: 'a' },
      { siteUrl: 'https://example.com/' },
    );
    expect(entries).toEqual([
      {
        path: 'https://example.com/sitemap.xml',
        type: 'sitemap',
        lastSubmitted: new Date('2026-06-20T09:12:00.000Z'),
        lastDownloaded: new Date('2026-07-01T04:30:00.000Z'),
        isPending: false,
        isSitemapsIndex: false,
        errors: 0,
        warnings: 0,
        processed: 128,
      },
    ]);
  });

  it('with-errors fixture surfaces error/warning counts', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(gscFixture('sitemaps', 'with-errors')),
    ) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    const entries = await provider.listSitemaps(
      { accessToken: 'a' },
      { siteUrl: 'https://example.com/' },
    );
    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatchObject({
      path: 'https://example.com/sitemap-products.xml',
      errors: 2,
      warnings: 1,
      processed: 0,
      lastDownloaded: null,
    });
  });

  it('empty fixture (no `sitemap` key) → []', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(gscFixture('sitemaps', 'empty')),
    ) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    expect(
      await provider.listSitemaps(
        { accessToken: 'a' },
        { siteUrl: 'https://example.com/' },
      ),
    ).toEqual([]);
  });

  it('malformed payload (path missing) → VendorMalformedError', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ sitemap: [{ type: 'sitemap' }] }),
    ) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    await expect(
      provider.listSitemaps(
        { accessToken: 'a' },
        { siteUrl: 'https://example.com/' },
      ),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('GETs the encoded property URL with the bearer token', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ sitemap: [] }),
    ) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    await provider.listSitemaps(
      { accessToken: 'tok' },
      { siteUrl: 'sc-domain:example.com' },
    );
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://sc.test/v3/sites/sc-domain%3Aexample.com/sitemaps');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).authorization).toBe(
      'Bearer tok',
    );
  });

  it('401 → GscReconnectRequiredError', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({}, 401),
    ) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    await expect(
      provider.listSitemaps(
        { accessToken: 'a' },
        { siteUrl: 'https://example.com/' },
      ),
    ).rejects.toBeInstanceOf(GscReconnectRequiredError);
  });

  it('429 → VendorQuotaError', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({}, 429),
    ) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    await expect(
      provider.listSitemaps(
        { accessToken: 'a' },
        { siteUrl: 'https://example.com/' },
      ),
    ).rejects.toBeInstanceOf(VendorQuotaError);
  });

  it('timeout → VendorTimeoutError', async () => {
    const fetchImpl = vi.fn(
      (_url: string | URL, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    ) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({
      ...BASE,
      fetchImpl,
      timeoutMs: 10,
    });
    await expect(
      provider.listSitemaps(
        { accessToken: 'a' },
        { siteUrl: 'https://example.com/' },
      ),
    ).rejects.toBeInstanceOf(VendorTimeoutError);
  });

  it('network drop → VendorUnavailableError', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('ECONNRESET');
    }) as unknown as typeof fetch;
    const provider = createGoogleGscProvider({ ...BASE, fetchImpl });
    await expect(
      provider.listSitemaps(
        { accessToken: 'a' },
        { siteUrl: 'https://example.com/' },
      ),
    ).rejects.toBeInstanceOf(VendorUnavailableError);
  });
});

// ---------------------------------------------------------------------------
// Pure normalizers
// ---------------------------------------------------------------------------

const CTX = { provider: 'google', operation: 'test' };

describe('normalizeSearchAnalytics', () => {
  it('non-object payload → VendorMalformedError', () => {
    expect(() =>
      normalizeSearchAnalytics('nope', CTX, {
        startDate: '2026-06-07',
        endDate: '2026-07-04',
        dimensions: ['query'],
      }),
    ).toThrow(VendorMalformedError);
  });

  it('echoes the request window and always marks sampled', () => {
    const result = normalizeSearchAnalytics(
      { rows: [] },
      CTX,
      { startDate: '2026-06-07', endDate: '2026-07-04', dimensions: ['page'] },
    );
    expect(result).toEqual({
      rows: [],
      sampled: true,
      startDate: '2026-06-07',
      endDate: '2026-07-04',
      dimensions: ['page'],
    });
  });
});

describe('normalizeSitemaps', () => {
  it('non-object payload → VendorMalformedError', () => {
    expect(() => normalizeSitemaps([], CTX)).toThrow(VendorMalformedError);
  });

  it('defaults optional fields (type, flags, counts, dates)', () => {
    const entries = normalizeSitemaps(
      { sitemap: [{ path: 'https://example.com/s.xml' }] },
      CTX,
    );
    expect(entries).toEqual([
      {
        path: 'https://example.com/s.xml',
        type: 'sitemap',
        lastSubmitted: null,
        lastDownloaded: null,
        isPending: false,
        isSitemapsIndex: false,
        errors: 0,
        warnings: 0,
        processed: 0,
      },
    ]);
  });

  it('coerces numeric counts given as numbers and ignores unparseable strings', () => {
    const entries = normalizeSitemaps(
      {
        sitemap: [
          {
            path: 'https://example.com/s.xml',
            errors: 3,
            warnings: 'zzz',
            processed: '42',
          },
        ],
      },
      CTX,
    );
    expect(entries[0]).toMatchObject({ errors: 3, warnings: 0, processed: 42 });
  });

  it('unparseable dates become null', () => {
    const entries = normalizeSitemaps(
      {
        sitemap: [
          {
            path: 'https://example.com/s.xml',
            lastSubmitted: 'not-a-date',
            lastDownloaded: '2026-07-01T04:30:00.000Z',
          },
        ],
      },
      CTX,
    );
    expect(entries[0]!.lastSubmitted).toBeNull();
    expect(entries[0]!.lastDownloaded).toEqual(
      new Date('2026-07-01T04:30:00.000Z'),
    );
  });
});

describe('expandSiteUrlTemplate', () => {
  it('URL-encodes the property into the template', () => {
    expect(
      expandSiteUrlTemplate('https://x.test/{siteUrl}/y', 'https://example.com/'),
    ).toBe('https://x.test/https%3A%2F%2Fexample.com%2F/y');
  });
});
