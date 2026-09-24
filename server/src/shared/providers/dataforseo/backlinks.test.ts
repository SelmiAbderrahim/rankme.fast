/**
 * DataForSEO Backlinks adapter tests.
 *
 * Layered like the keywords adapter:
 *   1. providerContractTests over each endpoint — success/timeout/malformed/quota.
 *   2. Behavioural tests: target normalization, limit clamping, timestamp
 *      parsing, cursor round-trip, empty-summary handling, unknown-status
 *      guards, dofollow default.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { providerContractTests } from '../../testing/fixtures/contract.js';
import { mockVendor, vendorMockServer } from '../../testing/fixtures/mock-vendor.js';
import { captureVendorCost, usdToMicros } from '../cost-capture.js';
import { VendorMalformedError } from '../errors.js';
import { clearDataForSeoClientCache } from '../http.js';
import {
  BACKLINKS_ANCHOR_MAX_CHARS,
  BACKLINKS_BULK_RANK_MAX_DOMAINS,
  BACKLINKS_BULK_SPAM_SCORE_MAX_TARGETS,
  BACKLINKS_DEEP_ROW_MAX_LIMIT,
  BACKLINKS_DEFAULT_LIMIT,
  BACKLINKS_HISTORY_MAX_POINTS,
  BACKLINKS_MAX_LIMIT,
  clampAnchorText,
  clampBacklinkDeepRowLimit,
  clampBacklinkHistoryLimit,
  clampBacklinkLimit,
  createDataForSeoBacklinkProvider,
  extractHistoryYearMonth,
  normalizeBacklinkOutputDomain,
  normalizeBacklinkTarget,
  normalizeBulkRankDomains,
  normalizeBulkSpamScoreTargets,
  parseVendorDate,
  type DataForSeoBacklinkProviderConfig,
} from './backlinks.js';

const FIXTURES_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'testing',
  'fixtures',
  'dataforseo-backlinks',
);

function readFixture(operation: string, kase: string): JsonBodyType {
  return JSON.parse(
    readFileSync(join(FIXTURES_ROOT, operation, `${kase}.json`), 'utf8'),
  ) as JsonBodyType;
}

const cfg: DataForSeoBacklinkProviderConfig = {
  login: 'sandbox-login',
  password: 'sandbox-password',
  baseUrl: 'https://dataforseo.mock/v3',
  timeoutMs: 60,
  maxRetries: 0,
  backoffBaseMs: 1,
  random: () => 0,
};

const provider = createDataForSeoBacklinkProvider(cfg);

// ---------------------------------------------------------------------------
// Provider contract — one per endpoint
// ---------------------------------------------------------------------------

providerContractTests({
  title: 'DataForSeoBacklinkProvider.getSummary',
  fixtureProvider: 'dataforseo-backlinks',
  fixtureOperation: 'summary',
  makeCall: () => provider.getSummary('example.com'),
  assertSuccess: (result) => {
    expect(result.domainRank).toBe(64);
    expect(result.backlinks).toBe(1543);
    expect(result.referringDomains).toBe(208);
    expect(result.brokenBacklinks).toBe(12);
    expect(result.firstSeen).toBeInstanceOf(Date);
  },
});

providerContractTests({
  title: 'DataForSeoBacklinkProvider.getBulkSpamScores',
  fixtureProvider: 'dataforseo-backlinks',
  fixtureOperation: 'bulk-spam-score',
  makeCall: () =>
    provider.getBulkSpamScores(
      Array.from({ length: 10 }, (_, index) => `d${index}.example`),
    ),
  assertSuccess: (rows) => {
    expect(rows).toHaveLength(10);
    expect(rows[0]).toEqual({ target: 'd0.example', spamScore: 5 });
    expect(rows[9]).toEqual({ target: 'd9.example', spamScore: 95 });
  },
});

providerContractTests({
  title: 'DataForSeoBacklinkProvider.listBacklinks',
  fixtureProvider: 'dataforseo-backlinks',
  fixtureOperation: 'backlinks-list',
  makeCall: () => provider.listBacklinks('example.com', { limit: 100 }),
  assertSuccess: (result) => {
    expect(result.rows).toHaveLength(2);
    const first = result.rows[0];
    if (!first) throw new Error('expected first row');
    expect(first.urlFrom).toBe('https://blog.example.net/best-tools');
    expect(first.dofollow).toBe(true);
    expect(first.isBroken).toBe(false);
    expect(first.domainFrom).toBe('blog.example.net');
    expect(first.backlinkSpamScore).toBe(70);
    expect(first.urlToSpamScore).toBe(2);
    expect(first.firstSeen).toBeInstanceOf(Date);
    expect(result.nextCursor).toBe('next-token-page-2');
  },
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('normalizeBacklinkTarget', () => {
  it('lowercases and strips scheme + trailing slash', () => {
    expect(normalizeBacklinkTarget('HTTPS://Example.COM/')).toBe('example.com');
    expect(normalizeBacklinkTarget('http://example.com')).toBe('example.com');
  });
  it('handles bare domains untouched', () => {
    expect(normalizeBacklinkTarget('example.com')).toBe('example.com');
  });
  it('trims whitespace', () => {
    expect(normalizeBacklinkTarget('  example.com  ')).toBe('example.com');
  });
});

describe('clampBacklinkLimit', () => {
  it('honours the default when input is missing / non-numeric / non-finite', () => {
    expect(clampBacklinkLimit(undefined)).toBe(BACKLINKS_DEFAULT_LIMIT);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(clampBacklinkLimit('nan' as any)).toBe(BACKLINKS_DEFAULT_LIMIT);
    expect(clampBacklinkLimit(Number.POSITIVE_INFINITY)).toBe(BACKLINKS_DEFAULT_LIMIT);
  });
  it('clamps to the vendor ceiling', () => {
    expect(clampBacklinkLimit(50_000)).toBe(BACKLINKS_MAX_LIMIT);
  });
  it('floors at 1', () => {
    expect(clampBacklinkLimit(0)).toBe(1);
    expect(clampBacklinkLimit(-5)).toBe(1);
  });
  it('rounds down fractional input', () => {
    expect(clampBacklinkLimit(50.9)).toBe(50);
  });
});

describe('parseVendorDate', () => {
  it('parses valid vendor timestamp', () => {
    const d = parseVendorDate('2024-05-14 08:31:04 +00:00');
    expect(d).toBeInstanceOf(Date);
    expect(d?.getUTCFullYear()).toBe(2024);
  });
  it('returns null for missing / non-string / empty / unparseable', () => {
    expect(parseVendorDate(null)).toBeNull();
    expect(parseVendorDate(undefined)).toBeNull();
    expect(parseVendorDate('')).toBeNull();
    expect(parseVendorDate('not a date')).toBeNull();
  });
});

describe('extractHistoryYearMonth date fallback', () => {
  it('accepts a valid date month and rejects an invalid one', () => {
    expect(extractHistoryYearMonth({ date: '2024-05-10' })).toEqual({ year: 2024, month: 5 });
    expect(extractHistoryYearMonth({ date: '2024-19-10' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getSummary — end-to-end behaviour
// ---------------------------------------------------------------------------

describe('DataForSeoBacklinkProvider — getSummary', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  it('sends normalized target + rank_scale=one_hundred + include_subdomains', async () => {
    let capturedBody: unknown = null;
    let capturedPath = '';
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', async ({ request }) => {
        capturedBody = await request.json();
        capturedPath = new URL(request.url).pathname;
        return HttpResponse.json(readFixture('summary', 'success') as JsonBodyType);
      }),
    );
    await provider.getSummary('HTTPS://Example.com/');
    expect(capturedPath).toBe('/v3/backlinks/summary/live');
    expect(capturedBody).toEqual([
      expect.objectContaining({
        target: 'example.com',
        include_subdomains: true,
        backlinks_status_type: 'live',
        rank_scale: 'one_hundred',
      }),
    ]);
  });

  it('returns zeros/null when the vendor returns an empty result array', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json({
          version: '0.1.20260101',
          status_code: 20000,
          status_message: 'Ok.',
          tasks_count: 1,
          tasks_error: 0,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20000,
              status_message: 'Ok.',
              cost: 0.02,
              result: [],
            },
          ],
        }),
      ),
    );
    const result = await provider.getSummary('example.com');
    expect(result).toEqual({
      domainRank: null,
      backlinks: 0,
      referringDomains: 0,
      brokenBacklinks: 0,
      firstSeen: null,
    });
  });

  it('handles a null result field defensively', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json({
          version: '0.1.20260101',
          status_code: 20000,
          status_message: 'Ok.',
          tasks_count: 1,
          tasks_error: 0,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20000,
              status_message: 'Ok.',
              cost: 0.02,
              result: null,
            },
          ],
        }),
      ),
    );
    const result = await provider.getSummary('example.com');
    expect(result.backlinks).toBe(0);
  });

  it('reports null / zeros when vendor fields are non-numeric', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json({
          version: '0.1.20260101',
          status_code: 20000,
          status_message: 'Ok.',
          tasks_count: 1,
          tasks_error: 0,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20000,
              status_message: 'Ok.',
              cost: 0.02,
              result: [
                {
                  rank: null,
                  backlinks: null,
                  referring_domains: null,
                  broken_backlinks: null,
                  first_seen: null,
                },
              ],
            },
          ],
        }),
      ),
    );
    const result = await provider.getSummary('example.com');
    expect(result).toEqual({
      domainRank: null,
      backlinks: 0,
      referringDomains: 0,
      brokenBacklinks: 0,
      firstSeen: null,
    });
  });

  it('treats an unknown task status as malformed', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json({
          version: '0.1.20260101',
          status_code: 20000,
          status_message: 'Ok.',
          tasks_count: 1,
          tasks_error: 0,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 40602,
              status_message: 'Task In Queue.',
              cost: 0,
              result: null,
            },
          ],
        }),
      ),
    );
    await expect(provider.getSummary('example.com')).rejects.toBeInstanceOf(
      VendorMalformedError,
    );
  });
});

// ---------------------------------------------------------------------------
// listBacklinks — end-to-end behaviour
// ---------------------------------------------------------------------------

describe('DataForSeoBacklinkProvider — listBacklinks', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  it('sends mode=one_per_domain + clamped limit + optional cursor as search_after_token', async () => {
    let capturedBody: unknown = null;
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(readFixture('backlinks-list', 'success') as JsonBodyType);
      }),
    );
    await provider.listBacklinks('example.com', {
      limit: 999_999,
      cursor: 'cursor-abc',
    });
    expect(capturedBody).toEqual([
      expect.objectContaining({
        target: 'example.com',
        mode: 'one_per_domain',
        limit: BACKLINKS_MAX_LIMIT,
        search_after_token: 'cursor-abc',
        include_subdomains: true,
        backlinks_status_type: 'live',
      }),
    ]);
  });

  it('omits search_after_token on the first page', async () => {
    let capturedBody: Record<string, unknown> = {};
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', async ({ request }) => {
        const arr = (await request.json()) as Record<string, unknown>[];
        capturedBody = arr[0] ?? {};
        return HttpResponse.json(readFixture('backlinks-list', 'success') as JsonBodyType);
      }),
    );
    await provider.listBacklinks('example.com', { limit: 100 });
    expect(capturedBody).not.toHaveProperty('search_after_token');
  });

  it('omits search_after_token when cursor is empty string', async () => {
    let capturedBody: Record<string, unknown> = {};
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', async ({ request }) => {
        const arr = (await request.json()) as Record<string, unknown>[];
        capturedBody = arr[0] ?? {};
        return HttpResponse.json(readFixture('backlinks-list', 'success') as JsonBodyType);
      }),
    );
    await provider.listBacklinks('example.com', { limit: 100, cursor: '' });
    expect(capturedBody).not.toHaveProperty('search_after_token');
  });

  it('maps vendor items to BacklinkRow shape (anchor null default, dofollow default false, is_broken default false)', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json({
          version: '0.1.20260101',
          status_code: 20000,
          status_message: 'Ok.',
          tasks_count: 1,
          tasks_error: 0,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20000,
              status_message: 'Ok.',
              cost: 0.02,
              result: [
                {
                  items: [
                    {
                      url_from: 'https://x.example/a',
                      url_to: 'https://example.com/',
                    },
                  ],
                  search_after_token: null,
                },
              ],
            },
          ],
        }),
      ),
    );
    const page = await provider.listBacklinks('example.com', { limit: 100 });
    expect(page.rows).toHaveLength(1);
    const row = page.rows[0];
    if (!row) throw new Error('expected row');
    expect(row.anchor).toBeNull();
    expect(row.dofollow).toBe(false);
    expect(row.isBroken).toBe(false);
    expect(row.firstSeen).toBeNull();
    expect(row.lastSeen).toBeNull();
    expect(page.nextCursor).toBeUndefined();
  });

  it('returns an empty page when vendor items is null', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json({
          version: '0.1.20260101',
          status_code: 20000,
          status_message: 'Ok.',
          tasks_count: 1,
          tasks_error: 0,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20000,
              status_message: 'Ok.',
              cost: 0.02,
              result: [{ items: null }],
            },
          ],
        }),
      ),
    );
    const page = await provider.listBacklinks('example.com', { limit: 100 });
    expect(page.rows).toEqual([]);
    expect(page.nextCursor).toBeUndefined();
  });

  it('treats an unknown task status as malformed', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json({
          version: '0.1.20260101',
          status_code: 20000,
          status_message: 'Ok.',
          tasks_count: 1,
          tasks_error: 0,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 40602,
              status_message: 'Task In Queue.',
              cost: 0,
              result: null,
            },
          ],
        }),
      ),
    );
    await expect(
      provider.listBacklinks('example.com', { limit: 10 }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });
});

// ---------------------------------------------------------------------------
// Deep-op helpers — pure clamp/normalize coverage
// ---------------------------------------------------------------------------

describe('clampBacklinkDeepRowLimit', () => {
  it('defaults to BACKLINKS_DEEP_ROW_MAX_LIMIT on missing/garbage input', () => {
    expect(clampBacklinkDeepRowLimit(undefined)).toBe(BACKLINKS_DEEP_ROW_MAX_LIMIT);
    expect(clampBacklinkDeepRowLimit(Number.POSITIVE_INFINITY)).toBe(
      BACKLINKS_DEEP_ROW_MAX_LIMIT,
    );
    expect(clampBacklinkDeepRowLimit(Number.NaN)).toBe(BACKLINKS_DEEP_ROW_MAX_LIMIT);
  });
  it('clamps to the 1..500 window', () => {
    expect(clampBacklinkDeepRowLimit(9999)).toBe(BACKLINKS_DEEP_ROW_MAX_LIMIT);
    expect(clampBacklinkDeepRowLimit(0)).toBe(1);
    expect(clampBacklinkDeepRowLimit(-3)).toBe(1);
    expect(clampBacklinkDeepRowLimit(200)).toBe(200);
  });
  it('floors fractional values', () => {
    expect(clampBacklinkDeepRowLimit(12.9)).toBe(12);
  });
});

describe('clampBacklinkHistoryLimit', () => {
  it('defaults to BACKLINKS_HISTORY_MAX_POINTS on missing/garbage input', () => {
    expect(clampBacklinkHistoryLimit(undefined)).toBe(BACKLINKS_HISTORY_MAX_POINTS);
    expect(clampBacklinkHistoryLimit(Number.POSITIVE_INFINITY)).toBe(
      BACKLINKS_HISTORY_MAX_POINTS,
    );
  });
  it('clamps to the 1..24 window', () => {
    expect(clampBacklinkHistoryLimit(50)).toBe(BACKLINKS_HISTORY_MAX_POINTS);
    expect(clampBacklinkHistoryLimit(0)).toBe(1);
    expect(clampBacklinkHistoryLimit(-1)).toBe(1);
  });
});

describe('normalizeBacklinkOutputDomain', () => {
  it('lowercases and strips scheme, www., and trailing slash', () => {
    expect(normalizeBacklinkOutputDomain('HTTPS://WWW.Example.COM/')).toBe('example.com');
    expect(normalizeBacklinkOutputDomain('http://sub.example.com')).toBe('sub.example.com');
    expect(normalizeBacklinkOutputDomain('example.com')).toBe('example.com');
    expect(normalizeBacklinkOutputDomain('  example.com  ')).toBe('example.com');
  });
});

describe('normalizeBulkRankDomains', () => {
  it('dedupes case-insensitively after scheme/www. strip', () => {
    expect(
      normalizeBulkRankDomains([
        'example.com',
        'https://Example.com',
        'www.example.com',
        'other.example',
      ]),
    ).toEqual(['example.com', 'other.example']);
  });
  it('drops empties and non-strings', () => {
    expect(
      normalizeBulkRankDomains([
        '',
        '   ',
        'valid.example',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        null as any,
      ]),
    ).toEqual(['valid.example']);
  });
  it('clamps to the bulk-rank ceiling', () => {
    const many = Array.from({ length: BACKLINKS_BULK_RANK_MAX_DOMAINS + 20 }, (_, i) => `d${i}.example`);
    expect(normalizeBulkRankDomains(many)).toHaveLength(BACKLINKS_BULK_RANK_MAX_DOMAINS);
  });
  it('returns [] when nothing survives', () => {
    expect(normalizeBulkRankDomains(['', '  '])).toEqual([]);
  });
});

describe('normalizeBulkSpamScoreTargets', () => {
  it('normalizes domains and absolute URLs, dedupes, and drops invalid values', () => {
    expect(
      normalizeBulkSpamScoreTargets([
        ' HTTPS://Example.com/path#fragment ',
        'https://example.com/path',
        'WWW.Example.org/',
        '',
        'https://[invalid',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        null as any,
      ]),
    ).toEqual(['https://example.com/path', 'example.org']);
  });

  it('clamps to the vendor maximum and rejects non-http URL schemes', () => {
    const many = Array.from(
      { length: BACKLINKS_BULK_SPAM_SCORE_MAX_TARGETS + 2 },
      (_, index) => `d${index}.example`,
    );
    expect(normalizeBulkSpamScoreTargets(many)).toHaveLength(
      BACKLINKS_BULK_SPAM_SCORE_MAX_TARGETS,
    );
    expect(normalizeBulkSpamScoreTargets(['javascript:alert(1)'])).toEqual([]);
  });
});

describe('clampAnchorText', () => {
  it('trims + collapses whitespace + drops control chars (SEC-OUT)', () => {
    expect(clampAnchorText('  hello\nworld\t ')).toBe('helloworld');
    expect(clampAnchorText('multi   spaces')).toBe('multi spaces');
  });
  it('caps at BACKLINKS_ANCHOR_MAX_CHARS', () => {
    const long = 'a'.repeat(BACKLINKS_ANCHOR_MAX_CHARS + 50);
    expect(clampAnchorText(long).length).toBe(BACKLINKS_ANCHOR_MAX_CHARS);
  });
  it('returns empty string for non-string / empty input', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(clampAnchorText(null as any)).toBe('');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(clampAnchorText(undefined as any)).toBe('');
    expect(clampAnchorText('   ')).toBe('');
  });
});

describe('extractHistoryYearMonth', () => {
  it('prefers explicit year/month numeric fields', () => {
    expect(extractHistoryYearMonth({ year: 2025, month: 3 })).toEqual({ year: 2025, month: 3 });
  });
  it('falls back to date string YYYY-MM', () => {
    expect(extractHistoryYearMonth({ date: '2024-08' })).toEqual({ year: 2024, month: 8 });
    expect(extractHistoryYearMonth({ date: '2024-08-15' })).toEqual({ year: 2024, month: 8 });
  });
  it('returns null on invalid month/date', () => {
    expect(extractHistoryYearMonth({ year: 2025, month: 13 })).toBeNull();
    expect(extractHistoryYearMonth({ date: 'not-a-date' })).toBeNull();
    expect(extractHistoryYearMonth({})).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Provider contracts — one per new deep op
// ---------------------------------------------------------------------------

providerContractTests({
  title: 'DataForSeoBacklinkProvider.getReferringDomains',
  fixtureProvider: 'dataforseo-backlinks',
  fixtureOperation: 'referring-domains',
  makeCall: () => provider.getReferringDomains('example.com', { limit: 500 }),
  assertSuccess: (rows) => {
    expect(rows).toHaveLength(3);
    expect(rows[0]?.domain).toBe('blog.example.net');
    // scheme + case + trailing slash normalized on output
    expect(rows[1]?.domain).toBe('partners.example.org');
    expect(rows[1]?.domainRank).toBe(48);
    expect(rows[2]?.domainRank).toBeNull();
    expect(rows[2]?.firstSeen).toBeNull();
  },
});

providerContractTests({
  title: 'DataForSeoBacklinkProvider.getAnchors',
  fixtureProvider: 'dataforseo-backlinks',
  fixtureOperation: 'anchors',
  makeCall: () => provider.getAnchors('example.com', { limit: 500 }),
  assertSuccess: (rows) => {
    expect(rows).toHaveLength(3);
    expect(rows[0]?.anchor).toBe('example tool');
    expect(rows[0]?.backlinks).toBe(210);
    expect(rows[0]?.referringDomains).toBe(84);
  },
});

providerContractTests({
  title: 'DataForSeoBacklinkProvider.getHistory',
  fixtureProvider: 'dataforseo-backlinks',
  fixtureOperation: 'history',
  makeCall: () => provider.getHistory('example.com', { limit: 24 }),
  assertSuccess: (points) => {
    expect(points).toHaveLength(3);
    expect(points[0]).toMatchObject({ year: 2024, month: 10, backlinks: 1200 });
    expect(points[2]).toMatchObject({ year: 2024, month: 12, referringDomains: 208 });
  },
});

providerContractTests({
  title: 'DataForSeoBacklinkProvider.getBulkRanks',
  fixtureProvider: 'dataforseo-backlinks',
  fixtureOperation: 'bulk-ranks',
  makeCall: () =>
    provider.getBulkRanks(['example.com', 'rival-one.example', 'no-rank.example']),
  assertSuccess: (rows) => {
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ domain: 'example.com', rank: 64 });
    expect(rows[2]).toEqual({ domain: 'no-rank.example', rank: null });
  },
});

providerContractTests({
  title: 'DataForSeoBacklinkProvider.getBacklinkCompetitors',
  fixtureProvider: 'dataforseo-backlinks',
  fixtureOperation: 'competitors',
  makeCall: () => provider.getBacklinkCompetitors('example.com', { limit: 500 }),
  assertSuccess: (rows) => {
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ domain: 'rival-one.example', intersections: 118, rank: 55 });
    expect(rows[2]?.rank).toBeNull();
  },
});

// ---------------------------------------------------------------------------
// Deep-op behaviour + cost capture
// ---------------------------------------------------------------------------

describe('DataForSeoBacklinkProvider — deep-op behaviour', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  it('getReferringDomains: sends normalized target + clamped limit + one_hundred + include_subdomains', async () => {
    let capturedBody: unknown = null;
    let capturedPath = '';
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', async ({ request }) => {
        capturedBody = await request.json();
        capturedPath = new URL(request.url).pathname;
        return HttpResponse.json(
          readFixture('referring-domains', 'success') as JsonBodyType,
        );
      }),
    );
    await provider.getReferringDomains('HTTPS://Example.com/', { limit: 9_999 });
    expect(capturedPath).toBe('/v3/backlinks/referring_domains/live');
    expect(capturedBody).toEqual([
      expect.objectContaining({
        target: 'example.com',
        limit: BACKLINKS_DEEP_ROW_MAX_LIMIT,
        include_subdomains: true,
        backlinks_status_type: 'live',
        rank_scale: 'one_hundred',
      }),
    ]);
  });

  it('getReferringDomains: drops rows missing a domain', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json({
          version: '0.1.20260101',
          status_code: 20000,
          status_message: 'Ok.',
          tasks_count: 1,
          tasks_error: 0,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20000,
              status_message: 'Ok.',
              cost: 0.02,
              result: [
                {
                  items: [
                    { domain: null, backlinks: 10, rank: 20 },
                    { domain: 'kept.example', backlinks: 5, rank: 30 },
                  ],
                },
              ],
            },
          ],
        }),
      ),
    );
    const rows = await provider.getReferringDomains('example.com', { limit: 100 });
    expect(rows).toEqual([
      { domain: 'kept.example', backlinks: 5, domainRank: 30, firstSeen: null, lastSeen: null },
    ]);
  });

  it('getReferringDomains: unknown task status → VendorMalformedError', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json({
          version: '0.1.20260101',
          status_code: 20000,
          status_message: 'Ok.',
          tasks_count: 1,
          tasks_error: 0,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 40602,
              status_message: 'In queue.',
              cost: 0,
              result: null,
            },
          ],
        }),
      ),
    );
    await expect(
      provider.getReferringDomains('example.com', { limit: 10 }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('getAnchors: clamps untrusted anchor text at boundary (SEC-OUT)', async () => {
    const longAnchor = 'x'.repeat(BACKLINKS_ANCHOR_MAX_CHARS + 100);
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json({
          version: '0.1.20260101',
          status_code: 20000,
          status_message: 'Ok.',
          tasks_count: 1,
          tasks_error: 0,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20000,
              status_message: 'Ok.',
              cost: 0.02,
              result: [
                {
                  items: [
                    { anchor: longAnchor, backlinks: 1, referring_domains: 1 },
                    { anchor: 'ok', backlinks: 5, referring_domains: 2 },
                    { anchor: null, backlinks: 8, referring_domains: 3 },
                    { anchor: '   ', backlinks: 1, referring_domains: 1 },
                  ],
                },
              ],
            },
          ],
        }),
      ),
    );
    const rows = await provider.getAnchors('example.com', { limit: 100 });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.anchor.length).toBe(BACKLINKS_ANCHOR_MAX_CHARS);
    expect(rows[1]?.anchor).toBe('ok');
  });

  it('getAnchors: unknown task status → VendorMalformedError', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json({
          version: '0.1.20260101',
          status_code: 20000,
          status_message: 'Ok.',
          tasks_count: 1,
          tasks_error: 0,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 40602,
              status_message: 'In queue.',
              cost: 0,
              result: null,
            },
          ],
        }),
      ),
    );
    await expect(
      provider.getAnchors('example.com', { limit: 10 }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('getHistory: caps to newest `limit` points, ascending order', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json({
          version: '0.1.20260101',
          status_code: 20000,
          status_message: 'Ok.',
          tasks_count: 1,
          tasks_error: 0,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20000,
              status_message: 'Ok.',
              cost: 0.02,
              result: [
                {
                  items: [
                    { year: 2024, month: 6, backlinks: 100, referring_domains: 10 },
                    { year: 2024, month: 7, backlinks: 110, referring_domains: 12 },
                    { year: 2024, month: 8, backlinks: 130, referring_domains: 15 },
                    { year: 2024, month: 9, backlinks: 150, referring_domains: 18 },
                    { date: 'garbage' },
                  ],
                },
              ],
            },
          ],
        }),
      ),
    );
    const points = await provider.getHistory('example.com', { limit: 2 });
    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({ year: 2024, month: 8 });
    expect(points[1]).toMatchObject({ year: 2024, month: 9 });
  });

  it('getHistory: unknown task status → VendorMalformedError', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json({
          version: '0.1.20260101',
          status_code: 20000,
          status_message: 'Ok.',
          tasks_count: 1,
          tasks_error: 0,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 40602,
              status_message: 'In queue.',
              cost: 0,
              result: null,
            },
          ],
        }),
      ),
    );
    await expect(
      provider.getHistory('example.com', { limit: 10 }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('getBulkRanks: refuses empty input after normalization', async () => {
    await expect(provider.getBulkRanks([])).rejects.toBeInstanceOf(VendorMalformedError);
    await expect(provider.getBulkRanks(['', '  '])).rejects.toBeInstanceOf(
      VendorMalformedError,
    );
  });

  it('getBulkRanks: sends deduplicated normalized targets', async () => {
    let capturedBody: unknown = null;
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(readFixture('bulk-ranks', 'success') as JsonBodyType);
      }),
    );
    await provider.getBulkRanks([
      'https://WWW.Example.com/',
      'example.com',
      'Rival-One.Example',
    ]);
    expect(capturedBody).toEqual([
      expect.objectContaining({
        targets: ['example.com', 'rival-one.example'],
        rank_scale: 'one_hundred',
      }),
    ]);
  });

  it('getBulkSpamScores: sends deduplicated normalized targets to the live operation', async () => {
    let capturedBody: unknown = null;
    let capturedPath = '';
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', async ({ request }) => {
        capturedBody = await request.json();
        capturedPath = new URL(request.url).pathname;
        return HttpResponse.json(
          readFixture('bulk-spam-score', 'success') as JsonBodyType,
        );
      }),
    );
    await provider.getBulkSpamScores([
      'https://Example.com/path#fragment',
      'https://example.com/path',
      'WWW.Other.example/',
    ]);
    expect(capturedPath).toBe('/v3/backlinks/bulk_spam_score/live');
    expect(capturedBody).toEqual([
      { targets: ['https://example.com/path', 'other.example'] },
    ]);
  });

  it('getBulkSpamScores: rejects empty input and drops rows without targets', async () => {
    await expect(provider.getBulkSpamScores([])).rejects.toBeInstanceOf(
      VendorMalformedError,
    );
    vendorMockServer.use(
      http.post('*', () =>
        HttpResponse.json({
          status_code: 20000,
          tasks: [
            {
              status_code: 20000,
              result: [
                {
                  items: [
                    { target: null, spam_score: 1 },
                    { target: 'kept.example', spam_score: null },
                  ],
                },
              ],
            },
          ],
        }),
      ),
    );
    await expect(provider.getBulkSpamScores(['kept.example'])).resolves.toEqual([
      { target: 'kept.example', spamScore: null },
    ]);
  });

  it('getBulkSpamScores: treats an unknown task status as malformed and tolerates null results', async () => {
    vendorMockServer.use(
      http.post('*', () =>
        HttpResponse.json({
          status_code: 20000,
          tasks: [{ status_code: 40602, result: null }],
        }),
      ),
    );
    await expect(
      provider.getBulkSpamScores(['one.example']),
    ).rejects.toBeInstanceOf(VendorMalformedError);
    vendorMockServer.resetHandlers();
    vendorMockServer.use(
      http.post('*', () =>
        HttpResponse.json({
          status_code: 20000,
          tasks: [{ status_code: 20000, result: null }],
        }),
      ),
    );
    await expect(provider.getBulkSpamScores(['one.example'])).resolves.toEqual([]);
  });

  it('getBulkRanks: unknown task status → VendorMalformedError', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json({
          version: '0.1.20260101',
          status_code: 20000,
          status_message: 'Ok.',
          tasks_count: 1,
          tasks_error: 0,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 40602,
              status_message: 'In queue.',
              cost: 0,
              result: null,
            },
          ],
        }),
      ),
    );
    await expect(provider.getBulkRanks(['example.com'])).rejects.toBeInstanceOf(
      VendorMalformedError,
    );
  });

  it('getBulkRanks: drops rows missing target', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json({
          version: '0.1.20260101',
          status_code: 20000,
          status_message: 'Ok.',
          tasks_count: 1,
          tasks_error: 0,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20000,
              status_message: 'Ok.',
              cost: 0.02,
              result: [
                {
                  items: [
                    { target: null, rank: 50 },
                    { target: 'kept.example', rank: 42 },
                  ],
                },
              ],
            },
          ],
        }),
      ),
    );
    const rows = await provider.getBulkRanks(['example.com']);
    expect(rows).toEqual([{ domain: 'kept.example', rank: 42 }]);
  });

  it('getBacklinkCompetitors: falls back to item.domain when item.target is absent', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json({
          version: '0.1.20260101',
          status_code: 20000,
          status_message: 'Ok.',
          tasks_count: 1,
          tasks_error: 0,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20000,
              status_message: 'Ok.',
              cost: 0.02,
              result: [
                {
                  items: [
                    { target: '', domain: 'alt-source.example', rank: 60, intersections: 40 },
                    { target: null, domain: null, rank: 10, intersections: 1 },
                  ],
                },
              ],
            },
          ],
        }),
      ),
    );
    const rows = await provider.getBacklinkCompetitors('example.com', { limit: 100 });
    expect(rows).toEqual([
      { domain: 'alt-source.example', intersections: 40, rank: 60 },
    ]);
  });

  it('getBacklinkCompetitors: unknown task status → VendorMalformedError', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json({
          version: '0.1.20260101',
          status_code: 20000,
          status_message: 'Ok.',
          tasks_count: 1,
          tasks_error: 0,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 40602,
              status_message: 'In queue.',
              cost: 0,
              result: null,
            },
          ],
        }),
      ),
    );
    await expect(
      provider.getBacklinkCompetitors('example.com', { limit: 10 }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('deep operations tolerate missing result arrays', async () => {
    const emptyEnvelope = { status_code: 20000, tasks: [{ status_code: 20000, result: null }] };
    const calls = [
      () => provider.getReferringDomains('example.com', { limit: 1 }),
      () => provider.getAnchors('example.com', { limit: 1 }),
      () => provider.getHistory('example.com', { limit: 1 }),
      () => provider.getBulkRanks(['example.com']),
      () => provider.getBacklinkCompetitors('example.com', { limit: 1 }),
    ];
    for (const call of calls) {
      vendorMockServer.use(http.post('*', () => HttpResponse.json(emptyEnvelope)));
      await expect(call()).resolves.toEqual([]);
      vendorMockServer.resetHandlers();
    }
  });

  it('deep operations apply numeric defaults and stop at the requested limit', async () => {
    const useItems = (items: unknown[]) => vendorMockServer.use(
      http.post('*', () => HttpResponse.json({
        status_code: 20000,
        tasks: [{ status_code: 20000, result: [{ items }] }],
      })),
    );

    useItems([
      { domain: 'first.example', backlinks: null, rank: null },
      { domain: 'second.example', backlinks: 2, rank: 3 },
    ]);
    await expect(provider.getReferringDomains('example.com', { limit: 1 })).resolves.toEqual([
      { domain: 'first.example', backlinks: 0, domainRank: null, firstSeen: null, lastSeen: null },
    ]);

    useItems([
      { anchor: 'first', backlinks: null, referring_domains: null },
      { anchor: 'second', backlinks: 2, referring_domains: 3 },
    ]);
    await expect(provider.getAnchors('example.com', { limit: 1 })).resolves.toEqual([
      { anchor: 'first', backlinks: 0, referringDomains: 0 },
    ]);

    useItems([{ year: 2025, month: 1, backlinks: null, referring_domains: null }]);
    await expect(provider.getHistory('example.com', { limit: 1 })).resolves.toEqual([
      { year: 2025, month: 1, backlinks: 0, referringDomains: 0 },
    ]);

    useItems([{ target: 'rankless.example', rank: null }]);
    await expect(provider.getBulkRanks(['rankless.example'])).resolves.toEqual([
      { domain: 'rankless.example', rank: null },
    ]);

    useItems([
      { target: 'first.example', backlinks_intersections: null, intersections: null, rank: null },
      { target: 'second.example', backlinks_intersections: 2, rank: 3 },
    ]);
    await expect(provider.getBacklinkCompetitors('example.com', { limit: 1 })).resolves.toEqual([
      { domain: 'first.example', intersections: 0, rank: null },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Cost capture — task + row/point/domain micros
// ---------------------------------------------------------------------------

describe('DataForSeoBacklinkProvider — cost capture', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  it('getReferringDomains: envelope cost sums task + 72 micros/row (3 rows)', async () => {
    clearDataForSeoClientCache();
    mockVendor('dataforseo-backlinks', 'referring-domains', 'success');
    const { costMicros } = await captureVendorCost(() =>
      provider.getReferringDomains('example.com', { limit: 500 }),
    );
    // Fixture envelope cost 0.022216 USD → 22_216 micros. Structural sanity:
    // 22_216 = 22_000 task base + 72 * 3 rows (row-billed math per spec).
    expect(costMicros).toBe(usdToMicros(0.022216));
    expect(costMicros).toBe(22_000n + 72n * 3n);
  });

  it('getAnchors: envelope cost sums task + 72 micros/row (3 rows)', async () => {
    mockVendor('dataforseo-backlinks', 'anchors', 'success');
    const { costMicros } = await captureVendorCost(() =>
      provider.getAnchors('example.com', { limit: 500 }),
    );
    expect(costMicros).toBe(usdToMicros(0.022216));
    expect(costMicros).toBe(22_000n + 72n * 3n);
  });

  it('getHistory: envelope cost sums task + 400 micros/point (3 points)', async () => {
    mockVendor('dataforseo-backlinks', 'history', 'success');
    const { costMicros } = await captureVendorCost(() =>
      provider.getHistory('example.com', { limit: 24 }),
    );
    // Fixture envelope cost 0.03 USD → 30_000 micros. Structural sanity:
    // 30_000 = 28_800 base + 400 * 3 points (point-billed math per spec).
    expect(costMicros).toBe(usdToMicros(0.03));
    expect(costMicros).toBe(28_800n + 400n * 3n);
  });

  it('getBulkRanks: envelope cost sums task + 400 micros/domain (3 domains)', async () => {
    mockVendor('dataforseo-backlinks', 'bulk-ranks', 'success');
    const { costMicros } = await captureVendorCost(() =>
      provider.getBulkRanks(['example.com', 'rival-one.example', 'no-rank.example']),
    );
    // Fixture envelope cost 0.0212 USD → 21_200 micros. Structural sanity:
    // 21_200 = 20_000 base + 400 * 3 domains (domain-billed math per spec).
    expect(costMicros).toBe(usdToMicros(0.0212));
    expect(costMicros).toBe(20_000n + 400n * 3n);
  });

  it('getBulkSpamScores: envelope cost is 20,000 base + 30 micros × 10 targets', async () => {
    mockVendor('dataforseo-backlinks', 'bulk-spam-score', 'success');
    const { costMicros } = await captureVendorCost(() =>
      provider.getBulkSpamScores(
        Array.from({ length: 10 }, (_, index) => `d${index}.example`),
      ),
    );
    expect(costMicros).toBe(usdToMicros(0.0203));
    expect(costMicros).toBe(20_000n + 30n * 10n);
  });

  it('getBacklinkCompetitors: envelope cost sums task + 400 micros/row (3 rows)', async () => {
    mockVendor('dataforseo-backlinks', 'competitors', 'success');
    const { costMicros } = await captureVendorCost(() =>
      provider.getBacklinkCompetitors('example.com', { limit: 500 }),
    );
    // Fixture envelope cost 0.03 USD → 30_000 micros. Structural sanity:
    // 30_000 = 28_800 base + 400 * 3 rows (row-billed math per spec).
    expect(costMicros).toBe(usdToMicros(0.03));
    expect(costMicros).toBe(28_800n + 400n * 3n);
  });
});

// ---------------------------------------------------------------------------
// JSON round-trip — cache-serializability of every deep-op result shape
// ---------------------------------------------------------------------------

describe('DataForSeoBacklinkProvider — JSON round-trip', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  it('referring-domains result JSON round-trips', async () => {
    mockVendor('dataforseo-backlinks', 'referring-domains', 'success');
    const rows = await provider.getReferringDomains('example.com', { limit: 500 });
    // Date -> ISO string via JSON.stringify; rebuild for equality on the shape.
    const trip = JSON.parse(JSON.stringify(rows));
    expect(trip).toEqual(
      rows.map((r) => ({
        ...r,
        firstSeen: r.firstSeen === null ? null : r.firstSeen.toISOString(),
        lastSeen: r.lastSeen === null ? null : r.lastSeen.toISOString(),
      })),
    );
  });

  it('anchors / history / bulk-ranks / competitors results JSON round-trip', async () => {
    mockVendor('dataforseo-backlinks', 'anchors', 'success');
    const anchors = await provider.getAnchors('example.com', { limit: 500 });
    expect(JSON.parse(JSON.stringify(anchors))).toEqual(anchors);

    mockVendor('dataforseo-backlinks', 'history', 'success');
    const history = await provider.getHistory('example.com', { limit: 24 });
    expect(JSON.parse(JSON.stringify(history))).toEqual(history);

    mockVendor('dataforseo-backlinks', 'bulk-ranks', 'success');
    const ranks = await provider.getBulkRanks(['example.com']);
    expect(JSON.parse(JSON.stringify(ranks))).toEqual(ranks);

    mockVendor('dataforseo-backlinks', 'competitors', 'success');
    const competitors = await provider.getBacklinkCompetitors('example.com', { limit: 500 });
    expect(JSON.parse(JSON.stringify(competitors))).toEqual(competitors);
  });
});
