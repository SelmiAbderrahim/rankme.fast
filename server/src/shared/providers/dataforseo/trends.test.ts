/**
 * DataForSEO Google Trends adapter contract + normalization tests.
 *
 * One-call flow (`/keywords_data/google_trends/explore/live`). Contract
 * coverage runs the four canonical paths (success / timeout / malformed /
 * quota) through the shared harness. The cost-capture case pins the
 * envelope-cost math ($0.01/task).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { captureVendorCost, usdToMicros } from '../cost-capture.js';
import { VendorMalformedError } from '../errors.js';
import { providerContractTests } from '../../testing/fixtures/contract.js';
import { loadFixture } from '../../testing/fixtures/load.js';
import { mockVendor, vendorMockServer } from '../../testing/fixtures/mock-vendor.js';
import {
  clampInterestValue,
  clampRelatedQueryText,
  containsControlChar,
  createDataForSeoTrendsProvider,
  DEFAULT_TRENDS_TIME_RANGE,
  extractYearMonth,
  isNotFutureDate,
  MAX_KEYWORDS,
  MAX_MONTHLY_POINTS_PER_SERIES,
  MAX_RELATED_QUERIES,
  MAX_RELATED_QUERY_CHARS,
  normalizeExploreResult,
  normalizeGraphSeries,
  normalizeRelatedQueries,
  trendsExploreInputSchema,
  type DataForSeoTrendsProviderConfig,
} from './trends.js';
import { clearDataForSeoClientCache } from '../http.js';

const cfg: DataForSeoTrendsProviderConfig = {
  login: 'sandbox-login',
  password: 'sandbox-password',
  baseUrl: 'https://dataforseo.mock/v3',
  timeoutMs: 60,
  maxRetries: 0,
  backoffBaseMs: 1,
  random: () => 0,
  now: () => new Date('2026-02-01T00:00:00.000Z'),
};

const provider = createDataForSeoTrendsProvider(cfg);

providerContractTests({
  title: 'DataForSeoTrendsProvider.explore',
  fixtureProvider: 'dataforseo-trends',
  fixtureOperation: 'explore',
  makeCall: () =>
    provider.explore({
      keywords: ['rankmefast', 'ahrefs'],
      locationCode: 2840,
      languageCode: 'en',
    }),
  assertSuccess: (result) => {
    expect(result.series).toHaveLength(2);
    expect(result.series[0]?.keyword).toBe('rankmefast');
    expect(result.series[0]?.points.length).toBeGreaterThan(0);
    for (const series of result.series) {
      expect(series.points.length).toBeLessThanOrEqual(MAX_MONTHLY_POINTS_PER_SERIES);
      for (const point of series.points) {
        expect(point.value).toBeGreaterThanOrEqual(0);
        expect(point.value).toBeLessThanOrEqual(100);
      }
    }
    expect(result.relatedQueries.length).toBeGreaterThan(0);
    expect(result.relatedQueries.length).toBeLessThanOrEqual(MAX_RELATED_QUERIES);
    for (const rq of result.relatedQueries) {
      expect(rq.query.length).toBeLessThanOrEqual(MAX_RELATED_QUERY_CHARS);
    }
    expect(result.locationCode).toBe(2840);
    expect(result.languageCode).toBe('en');
    expect(result.observedAt).toBe('2026-02-01T00:00:00.000Z');
  },
});

describe('DataForSeoTrendsProvider — cost capture + boundary shape', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  it('captures the envelope cost via captureVendorCost ($0.01/task)', async () => {
    clearDataForSeoClientCache();
    mockVendor('dataforseo-trends', 'explore', 'success');
    const { costMicros } = await captureVendorCost(() =>
      provider.explore({
        keywords: ['rankmefast', 'ahrefs'],
        locationCode: 2840,
        languageCode: 'en',
      }),
    );
    expect(costMicros).toBe(usdToMicros(0.01));
  });

  it('requests the five-year preset when explicit dates are absent', async () => {
    const fixture = loadFixture('dataforseo-trends', 'explore', 'success');
    let requestBody: unknown;
    vendorMockServer.use(
      http.post('*', async ({ request }) => {
        requestBody = await request.json();
        return HttpResponse.json(fixture.body as JsonBodyType, {
          status: fixture.status,
        });
      }),
    );

    await provider.explore({ keywords: ['rankmefast'] });

    expect(DEFAULT_TRENDS_TIME_RANGE).toBe('past_5_years');
    expect(requestBody).toEqual([
      expect.objectContaining({
        keywords: ['rankmefast'],
        time_range: 'past_5_years',
      }),
    ]);
  });

  it('passes explicit start/end dates through, dropping the time_range fallback', async () => {
    mockVendor('dataforseo-trends', 'explore', 'success');
    const result = await provider.explore({
      keywords: ['rankmefast'],
      startDate: '2025-01-01',
      endDate: '2025-06-30',
    });
    expect(result.window).toEqual({ startDate: '2025-01-01', endDate: '2025-06-30' });
  });

  it('normalizes languageCode to lowercase output', async () => {
    mockVendor('dataforseo-trends', 'explore', 'success');
    const result = await provider.explore({
      keywords: ['rankmefast'],
      languageCode: 'EN',
    });
    expect(result.languageCode).toBe('en');
  });

  it('boots with defaults when no clock override is supplied', async () => {
    const noClock = createDataForSeoTrendsProvider({ ...cfg, now: undefined });
    mockVendor('dataforseo-trends', 'explore', 'success');
    const result = await noClock.explore({ keywords: ['rankmefast'] });
    expect(typeof result.observedAt).toBe('string');
    expect(result.observedAt).toMatch(/T/);
  });

  it('rejects with VendorMalformedError when the envelope carries zero tasks', async () => {
    vendorMockServer.use(
      http.post('*', () =>
        HttpResponse.json({
          version: '0.1',
          status_code: 20000,
          status_message: 'Ok.',
          cost: 0,
          tasks_count: 0,
          tasks_error: 0,
          tasks: [],
        }),
      ),
    );
    await expect(
      provider.explore({ keywords: ['rankmefast'] }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('JSON round-trip preserves the interface shape (cache-serializability)', async () => {
    mockVendor('dataforseo-trends', 'explore', 'success');
    const result = await provider.explore({
      keywords: ['rankmefast', 'ahrefs'],
      locationCode: 2840,
      languageCode: 'en',
    });
    const roundTripped = JSON.parse(JSON.stringify(result));
    expect(roundTripped).toEqual(result);
  });
});

describe('DataForSeoTrendsProvider — future-date rejection (SEC-INJECT)', () => {
  it('refuses future endDate', async () => {
    await expect(
      provider.explore({ keywords: ['rankme'], endDate: '2099-01-01' }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('refuses future startDate', async () => {
    await expect(
      provider.explore({ keywords: ['rankme'], startDate: '2099-01-01' }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });
});

describe('trendsExploreInputSchema (SEC-INJECT / SEC-BOUND)', () => {
  it('accepts a well-formed input and deduplicates case-insensitively', () => {
    const parsed = trendsExploreInputSchema.parse({
      keywords: ['RankMeFast', 'rankmefast', ' ahrefs '],
    });
    expect(parsed.keywords).toEqual(['RankMeFast', 'ahrefs']);
  });

  it('rejects empty keyword arrays', () => {
    expect(
      trendsExploreInputSchema.safeParse({ keywords: [] }).success,
    ).toBe(false);
  });

  it('rejects more than 5 unique keywords', () => {
    expect(
      trendsExploreInputSchema.safeParse({ keywords: ['a', 'b', 'c', 'd', 'e', 'f'] }).success,
    ).toBe(false);
  });

  it('rejects keyword containing control characters', () => {
    expect(
      trendsExploreInputSchema.safeParse({ keywords: ['bad\nkeyword'] }).success,
    ).toBe(false);
  });

  it('rejects keyword longer than 200 characters', () => {
    expect(
      trendsExploreInputSchema.safeParse({ keywords: ['x'.repeat(201)] }).success,
    ).toBe(false);
  });

  it('rejects a non-ISO date', () => {
    expect(
      trendsExploreInputSchema.safeParse({ keywords: ['ok'], startDate: '2025/01/01' }).success,
    ).toBe(false);
  });

  it('rejects a non-ISO-639-1 language', () => {
    expect(
      trendsExploreInputSchema.safeParse({ keywords: ['ok'], languageCode: 'english' }).success,
    ).toBe(false);
  });

  it('rejects zero/negative locationCode', () => {
    expect(
      trendsExploreInputSchema.safeParse({ keywords: ['ok'], locationCode: 0 }).success,
    ).toBe(false);
  });

  it('coerces empty/whitespace entries away before the min(1) check', () => {
    const parsed = trendsExploreInputSchema.parse({
      keywords: ['ok', '   ', ''],
    });
    expect(parsed.keywords).toEqual(['ok']);
  });

  it('MAX_KEYWORDS matches the schema hard cap', () => {
    expect(MAX_KEYWORDS).toBe(5);
  });
});

describe('trends adapter — pure helpers', () => {
  it('containsControlChar spots tabs, newlines, and DEL', () => {
    expect(containsControlChar('a\tb')).toBe(true);
    expect(containsControlChar('a\nb')).toBe(true);
    expect(containsControlChar('a\x7fb')).toBe(true);
    expect(containsControlChar('safe text')).toBe(false);
  });

  it('clampInterestValue clamps into 0..100 and rejects non-finite', () => {
    expect(clampInterestValue(50.4)).toBe(50);
    expect(clampInterestValue(50.5)).toBe(51);
    expect(clampInterestValue(-3)).toBe(0);
    expect(clampInterestValue(9999)).toBe(100);
    expect(clampInterestValue(Number.NaN)).toBe(0);
    expect(clampInterestValue(null as unknown as number)).toBe(0);
    expect(clampInterestValue(100)).toBe(100);
    expect(clampInterestValue(0)).toBe(0);
  });

  it('clampRelatedQueryText trims, collapses whitespace, and clamps to 100 chars', () => {
    expect(clampRelatedQueryText('  hello   world  ')).toBe('hello world');
    expect(clampRelatedQueryText('a'.repeat(150))?.length).toBe(MAX_RELATED_QUERY_CHARS);
    expect(clampRelatedQueryText('')).toBeNull();
    expect(clampRelatedQueryText(null)).toBeNull();
    expect(clampRelatedQueryText(42)).toBeNull();
    expect(clampRelatedQueryText('   ')).toBeNull();
  });

  it('isNotFutureDate returns true for empty/undefined/non-ISO dates', () => {
    const now = new Date('2026-01-15T00:00:00Z');
    expect(isNotFutureDate(undefined, now)).toBe(true);
    expect(isNotFutureDate('nope', now)).toBe(true);
    expect(isNotFutureDate('2020-01-01', now)).toBe(true);
    expect(isNotFutureDate('2026-01-15', now)).toBe(true);
    expect(isNotFutureDate('2099-06-01', now)).toBe(false);
    expect(isNotFutureDate(42 as unknown as string, now)).toBe(true);
  });

  it('extractYearMonth honors date_from first, timestamp fallback next, null otherwise', () => {
    expect(extractYearMonth({ date_from: '2025-03-14' })).toEqual({ year: 2025, month: 3 });
    // timestamp 2024-07-01T00:00:00Z = 1719792000
    expect(extractYearMonth({ timestamp: 1719792000 })).toEqual({ year: 2024, month: 7 });
    expect(extractYearMonth({})).toBeNull();
    expect(extractYearMonth({ date_from: 'garbage' })).toBeNull();
    expect(extractYearMonth({ date_from: '2025-13-01' })).toBeNull();
    expect(extractYearMonth({ timestamp: Number.NaN })).toBeNull();
  });

  it('extractYearMonth returns null when the timestamp overflows to an invalid Date', () => {
    // Number.MAX_VALUE * 1000 → Infinity, and new Date(Infinity).getTime() → NaN.
    expect(extractYearMonth({ timestamp: Number.MAX_VALUE })).toBeNull();
  });

  it('normalizeGraphSeries returns empty series when the graph item is missing', () => {
    const out = normalizeGraphSeries(undefined, ['a', 'b']);
    expect(out).toEqual([
      { keyword: 'a', points: [] },
      { keyword: 'b', points: [] },
    ]);
  });

  it('normalizeGraphSeries caps ascending output at MAX_MONTHLY_POINTS_PER_SERIES', () => {
    const data = Array.from({ length: 80 }, (_, i) => ({
      date_from: `${2010 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`,
      values: [i, i / 2],
    }));
    const out = normalizeGraphSeries({ type: 'google_trends_graph', data }, ['a', 'b']);
    expect(out[0]!.points.length).toBe(MAX_MONTHLY_POINTS_PER_SERIES);
    const first = out[0]!.points[0]!;
    const last = out[0]!.points[out[0]!.points.length - 1]!;
    expect(first.year * 12 + first.month).toBeLessThanOrEqual(last.year * 12 + last.month);
  });

  it('normalizeGraphSeries skips buckets missing a value for a series index', () => {
    const out = normalizeGraphSeries(
      {
        type: 'google_trends_graph',
        data: [
          { date_from: '2025-01-01', values: [10, null] },
          { date_from: '2025-02-01', values: [20, 30] },
          { date_from: 'not-a-date', values: [40, 50] },
        ],
      },
      ['a', 'b'],
    );
    expect(out[0]!.points).toEqual([
      { year: 2025, month: 1, value: 10 },
      { year: 2025, month: 2, value: 20 },
    ]);
    expect(out[1]!.points).toEqual([{ year: 2025, month: 2, value: 30 }]);
  });

  it('normalizeGraphSeries averages repeated vendor buckets by calendar month', () => {
    const out = normalizeGraphSeries(
      {
        type: 'google_trends_graph',
        data: [
          { date_from: '2025-01-01', values: [10, 30] },
          { date_from: '2025-01-08', values: [21, null] },
          { date_from: '2025-02-01', values: [40, 50] },
        ],
      },
      ['a', 'b'],
    );
    expect(out[0]!.points).toEqual([
      { year: 2025, month: 1, value: 16 },
      { year: 2025, month: 2, value: 40 },
    ]);
    expect(out[1]!.points).toEqual([
      { year: 2025, month: 1, value: 30 },
      { year: 2025, month: 2, value: 50 },
    ]);
  });

  it('normalizeGraphSeries handles null data array gracefully', () => {
    const out = normalizeGraphSeries(
      { type: 'google_trends_graph', data: null },
      ['a'],
    );
    expect(out).toEqual([{ keyword: 'a', points: [] }]);
  });

  it('normalizeGraphSeries falls back to empty values when the bucket values are missing', () => {
    const out = normalizeGraphSeries(
      {
        type: 'google_trends_graph',
        data: [{ date_from: '2025-01-01', values: null }],
      },
      ['a'],
    );
    expect(out[0]!.points).toEqual([]);
  });

  it('normalizeRelatedQueries deduplicates by (query,kind) and caps at MAX', () => {
    const rows = Array.from({ length: 80 }, (_, i) => ({ query: `q${i}`, value: 40 }));
    const out = normalizeRelatedQueries([{ type: 'google_trends_queries_list', top: rows }]);
    expect(out.length).toBe(MAX_RELATED_QUERIES);
    expect(out.every((r) => r.kind === 'top')).toBe(true);
  });

  it('normalizeRelatedQueries drops empty/invalid rows and dedupes across kinds', () => {
    const out = normalizeRelatedQueries([
      {
        type: 'google_trends_queries_list',
        top: [
          { query: 'foo', value: 90 },
          { query: 'FOO', value: 91 },
          { query: '', value: 10 },
        ],
        rising: [
          { query: 'foo', value: 22 },
          { query: 'bar', value: 33 },
        ],
      },
    ]);
    expect(out.map((r) => `${r.kind}:${r.query.toLowerCase()}`)).toEqual([
      'top:foo',
      'rising:foo',
      'rising:bar',
    ]);
  });

  it('normalizeRelatedQueries breaks the outer loop after the cap fills', () => {
    const rows = Array.from({ length: MAX_RELATED_QUERIES + 10 }, (_, i) => ({
      query: `t${i}`,
      value: 40,
    }));
    const out = normalizeRelatedQueries([
      { type: 'google_trends_queries_list', top: rows },
      { type: 'google_trends_queries_list', top: [{ query: 'z', value: 1 }] },
    ]);
    expect(out.length).toBe(MAX_RELATED_QUERIES);
  });

  it('normalizeRelatedQueries breaks between top and rising when top alone fills the cap', () => {
    const rows = Array.from({ length: MAX_RELATED_QUERIES }, (_, i) => ({
      query: `t${i}`,
      value: 40,
    }));
    const rising = [{ query: 'r0', value: 10 }];
    const out = normalizeRelatedQueries([
      { type: 'google_trends_queries_list', top: rows, rising },
    ]);
    expect(out.length).toBe(MAX_RELATED_QUERIES);
    expect(out.every((r) => r.kind === 'top')).toBe(true);
  });

  it('normalizeRelatedQueries breaks outer loop after rising fills the cap', () => {
    // top (20) below cap → line 287 skips break; rising (40) drives out past
    // MAX and the post-rising `if (out.length >= MAX) break;` fires.
    const top = Array.from({ length: 20 }, (_, i) => ({ query: `t${i}`, value: 30 }));
    const rising = Array.from({ length: 40 }, (_, i) => ({ query: `r${i}`, value: 30 }));
    const out = normalizeRelatedQueries([
      { type: 'google_trends_queries_list', top, rising },
      { type: 'google_trends_queries_list', top: [{ query: 'never', value: 1 }] },
    ]);
    expect(out.length).toBe(MAX_RELATED_QUERIES);
    // Second item was never processed.
    expect(out.every((r) => r.query !== 'never')).toBe(true);
  });

  it('normalizeRelatedQueries tolerates missing top/rising arrays', () => {
    expect(normalizeRelatedQueries([{ type: 'google_trends_queries_list' }])).toEqual([]);
  });

  it('normalizeExploreResult surfaces missing locations/languages as null', () => {
    const result = normalizeExploreResult(
      [{ items: [] }],
      { keywords: ['a'], startDate: null, endDate: null },
      '2026-01-01T00:00:00.000Z',
    );
    expect(result.locationCode).toBeNull();
    expect(result.languageCode).toBeNull();
    expect(result.series).toEqual([{ keyword: 'a', points: [] }]);
    expect(result.relatedQueries).toEqual([]);
  });

  it('normalizeExploreResult handles a null vendor result payload', () => {
    const result = normalizeExploreResult(
      null,
      { keywords: ['a'], startDate: null, endDate: null },
      '2026-01-01T00:00:00.000Z',
    );
    expect(result.locationCode).toBeNull();
    expect(result.languageCode).toBeNull();
    expect(result.series).toEqual([{ keyword: 'a', points: [] }]);
  });

  it('normalizeExploreResult ignores items with a null items list', () => {
    const result = normalizeExploreResult(
      [{ items: null, location_code: 2276, language_code: 'DE' }],
      { keywords: ['a'], startDate: null, endDate: null },
      '2026-01-01T00:00:00.000Z',
    );
    expect(result.locationCode).toBe(2276);
    expect(result.languageCode).toBe('de');
  });
});
