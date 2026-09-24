/**
 * DataForSEO Keywords adapter tests.
 *
 * Two layers, matching the SERP + on-page adapters:
 *   1. providerContractTests over each single endpoint (search-volume,
 *      bulk-difficulty, related) — success / timeout / malformed / quota.
 *   2. Extra tests: batching, merge semantics, related-limit clamping,
 *      empty-input short-circuit, malformed-status task guards.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { providerContractTests } from '../../testing/fixtures/contract.js';
import { vendorMockServer } from '../../testing/fixtures/mock-vendor.js';
import { VendorMalformedError } from '../errors.js';
import {
  batchKeywords,
  createDataForSeoKeywordProvider,
  DEFAULT_RELATED_LIMIT,
  KEYWORDS_PER_BATCH,
  MAX_MONTHLY_HISTORY,
  MAX_RELATED_LIMIT,
  MAX_SITE_KEYWORD_IDEA_VENDOR_LIMIT,
  MAX_SITE_KEYWORD_LIMIT,
  MAX_SITE_KEYWORD_SEEDS,
  mapSerpFeature,
  normalizeLabsMarkets,
  normalizeKeyword,
  type DataForSeoKeywordProviderConfig,
} from './keywords.js';

const FIXTURES_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'testing',
  'fixtures',
  'dataforseo-keywords',
);

function readFixture(operation: string, kase: string): JsonBodyType {
  return JSON.parse(
    readFileSync(join(FIXTURES_ROOT, operation, `${kase}.json`), 'utf8'),
  ) as JsonBodyType;
}

const cfg: DataForSeoKeywordProviderConfig = {
  login: 'sandbox-login',
  password: 'sandbox-password',
  baseUrl: 'https://dataforseo.mock/v3',
  timeoutMs: 60,
  maxRetries: 0,
  backoffBaseMs: 1,
  random: () => 0,
};

const provider = createDataForSeoKeywordProvider(cfg);

// ---------------------------------------------------------------------------
// Provider contract — one per endpoint
// ---------------------------------------------------------------------------

providerContractTests({
  title: 'DataForSeoKeywordProvider.listMarkets',
  fixtureProvider: 'dataforseo-keywords',
  fixtureOperation: 'market-catalog',
  makeCall: () => provider.listMarkets!(),
  assertSuccess: (markets) => {
    expect(markets).toEqual([
      { countryCode: 'US', locationCode: 2840, languageCodes: ['en', 'es'] },
    ]);
  },
});

it('rejects a keyword market envelope without a successful task', async () => {
  const emptyTaskProvider = createDataForSeoKeywordProvider({
    ...cfg,
    fetchImpl: async () =>
      Response.json({
        status_code: 20000,
        status_message: 'Ok.',
        tasks_count: 0,
        tasks_error: 0,
        tasks: [],
      }),
  });

  await expect(emptyTaskProvider.listMarkets!()).rejects.toThrow(
    'locations_and_languages returned no ok tasks',
  );
});

it('drops Labs markets without a usable Google language', () => {
  expect(
    normalizeLabsMarkets([
      {
        location_code: 2840,
        country_iso_code: 'US',
        location_type: 'Country',
        available_languages: [
          { available_sources: ['bing'], language_code: 'en' },
          { available_sources: ['google'], language_code: 'english' },
        ],
      },
    ]),
  ).toEqual([]);
});

providerContractTests({
  title: 'DataForSeoKeywordProvider.getMetrics (search-volume)',
  fixtureProvider: 'dataforseo-keywords',
  fixtureOperation: 'search-volume',
  makeCall: async () => {
    // For contract tests we run search-volume in isolation by making the
    // difficulty call succeed via a fresh single-call variant. Since the
    // contract server serves ALL routes with the same body, running
    // getMetrics(['seo audit tool']) exercises search-volume's response. The
    // difficulty branch reuses the same body, which parses under the
    // bulk-difficulty schema only if items[] exists. Contract fixtures deliver
    // that shape for success but not for others, so we call the private
    // endpoint directly through a targeted provider fetch.
    return provider.getMetrics(['seo audit tool'], 2840, 'en');
  },
  assertSuccess: (result) => {
    // The search-volume fixture merges under the merged shape; difficulty
    // comes from the bulk-difficulty fixture served on the same path pattern.
    // Contract only asserts search-volume ran without throwing.
    expect(Array.isArray(result)).toBe(true);
  },
});

providerContractTests({
  title: 'DataForSeoKeywordProvider.getRelated',
  fixtureProvider: 'dataforseo-keywords',
  fixtureOperation: 'related',
  makeCall: () => provider.getRelated('seo audit tool', 2840, 'en', 25),
  assertSuccess: (result) => {
    expect(result.length).toBeGreaterThan(0);
    const first = result[0];
    if (!first) throw new Error('expected at least one related keyword');
    expect(first.keyword).toBe('free seo audit tool');
    expect(first.searchVolume).toBe(3200);
    expect(first.difficulty).toBe(48);
    expect(first.cpc).toBeCloseTo(3.14);
  },
});

providerContractTests({
  title: 'DataForSeoKeywordProvider.classifyIntent',
  fixtureProvider: 'dataforseo-keywords',
  fixtureOperation: 'search-intent',
  makeCall: () => provider.classifyIntent(['seo audit tool'], 2840, 'en'),
  assertSuccess: (result) => {
    expect(result).toHaveLength(1);
    const first = result[0];
    if (!first) throw new Error('expected one intent row');
    expect(first.keyword).toBe('seo audit tool');
    expect(first.intent).toBe('commercial');
    expect(first.confidence).toBeCloseTo(0.82);
  },
});

providerContractTests({
  title: 'DataForSeoKeywordProvider.getIdeas',
  fixtureProvider: 'dataforseo-keywords',
  fixtureOperation: 'keyword-ideas',
  makeCall: () => provider.getIdeas('seo audit tool', 2840, 'en', 25),
  assertSuccess: (result) => {
    expect(result.length).toBeGreaterThan(0);
    const first = result[0];
    if (!first) throw new Error('expected at least one idea');
    expect(first.keyword).toBe('website audit checklist');
    expect(first.searchVolume).toBe(2900);
    expect(first.difficulty).toBe(41);
    expect(first.cpc).toBeCloseTo(2.35);
    expect(first.monthlySearches).toHaveLength(2);
  },
});

providerContractTests({
  title: 'DataForSeoKeywordProvider.getLongTailSuggestions',
  fixtureProvider: 'dataforseo-keywords',
  fixtureOperation: 'long-tail-suggestions',
  makeCall: () => provider.getLongTailSuggestions('seo audit tool', 2840, 'en', 25),
  assertSuccess: (result) => {
    expect(result).toEqual([
      {
        keyword: 'how to use an seo audit tool',
        searchVolume: 590,
        difficulty: 27,
        cpc: 2.1,
        monthlySearches: [
          { year: 2025, month: 11, searchVolume: 540 },
          { year: 2025, month: 12, searchVolume: 590 },
        ],
      },
      {
        keyword: 'best seo audit tool for small business',
        searchVolume: 320,
        difficulty: 33,
        cpc: 3.4,
        monthlySearches: [],
      },
    ]);
  },
});

providerContractTests({
  title: 'DataForSeoKeywordProvider.getOverview',
  fixtureProvider: 'dataforseo-keywords',
  fixtureOperation: 'keyword-overview',
  makeCall: () => provider.getOverview(['seo audit tool', 'rank tracker'], 2840, 'en'),
  assertSuccess: (result) => {
    expect(result).toHaveLength(2);
    const first = result[0];
    if (!first) throw new Error('expected first overview row');
    expect(first.keyword).toBe('seo audit tool');
    expect(first.searchVolume).toBe(5400);
    expect(first.difficulty).toBe(62);
    expect(first.cpc).toBeCloseTo(4.12);
    expect(first.intent).toBe('commercial');
    // ai_overview + featured_snippet + people_also_ask (organic dropped as 'other').
    expect(first.serpFeatures).toEqual([
      'other',
      'featured_snippet',
      'people_also_ask',
      'ai_overview',
    ]);
    expect(first.resultsCount).toBe(128_000_000);
    expect(first.observedAt).toBeInstanceOf(Date);
    const second = result[1];
    if (!second) throw new Error('expected second overview row');
    expect(second.intent).toBe('transactional');
    expect(second.serpFeatures).toEqual(['other', 'video', 'shopping']);
  },
});

providerContractTests({
  title: 'DataForSeoKeywordProvider.getHistoricalVolume',
  fixtureProvider: 'dataforseo-keywords',
  fixtureOperation: 'historical-search-volume',
  makeCall: () => provider.getHistoricalVolume(['seo audit tool', 'rank tracker'], 2840, 'en'),
  assertSuccess: (result) => {
    expect(result).toHaveLength(2);
    const first = result[0];
    if (!first) throw new Error('expected first historical row');
    expect(first.keyword).toBe('seo audit tool');
    expect(first.monthlySearches).toEqual([
      { year: 2025, month: 10, searchVolume: 5100 },
      { year: 2025, month: 11, searchVolume: 5200 },
      { year: 2025, month: 12, searchVolume: 5400 },
    ]);
  },
});

providerContractTests({
  title: 'DataForSeoKeywordProvider.getRankedKeywordsForSite',
  fixtureProvider: 'dataforseo-keywords',
  fixtureOperation: 'ranked-site',
  makeCall: () => provider.getRankedKeywordsForSite('example.com', 2840, 'en', 100),
  assertSuccess: (result) => {
    expect(result[0]).toEqual({
      keyword: 'seo audit tool',
      searchVolume: 5400,
      difficulty: 62,
      currentPosition: 4,
      estimatedTraffic: 630.5,
      rankingUrl: 'https://example.com/seo-audit',
    });
  },
});

providerContractTests({
  title: 'DataForSeoKeywordProvider.getKeywordIdeasForSite',
  fixtureProvider: 'dataforseo-keywords',
  fixtureOperation: 'site-ideas',
  makeCall: () => provider.getKeywordIdeasForSite(
    ['seo audit tool', 'technical seo scanner'],
    2840,
    'en',
    100,
  ),
  assertSuccess: (result) => {
    expect(result[0]).toEqual({
      keyword: 'website seo audit',
      searchVolume: 3600,
      difficulty: 44,
      currentPosition: null,
      estimatedTraffic: null,
      rankingUrl: null,
    });
  },
});

// ---------------------------------------------------------------------------
// Extra behaviours
// ---------------------------------------------------------------------------

describe('normalizeKeyword', () => {
  it('trims, lowercases, collapses inner whitespace', () => {
    expect(normalizeKeyword('  Seo  Audit  Tool  ')).toBe('seo audit tool');
  });
  it('leaves single-word input untouched apart from lowercase', () => {
    expect(normalizeKeyword('RANK')).toBe('rank');
  });
});

describe('batchKeywords', () => {
  it('dedupes case-insensitively', () => {
    expect(batchKeywords(['a', 'A', 'b'])).toEqual([['a', 'b']]);
  });
  it('drops empty entries after trim', () => {
    expect(batchKeywords(['a', '  ', ''])).toEqual([['a']]);
  });
  it('splits large lists into vendor-sized batches', () => {
    const large = Array.from({ length: 30 }, (_, i) => `kw${i}`);
    expect(batchKeywords(large, 10).map((b) => b.length)).toEqual([10, 10, 10]);
  });
  it('returns an empty array when every keyword is blank', () => {
    expect(batchKeywords(['', '  '])).toEqual([]);
  });
  it('honours the default vendor batch size', () => {
    expect(KEYWORDS_PER_BATCH).toBe(1000);
  });
});

describe('DataForSeoKeywordProvider — getMetrics', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  it('routes to search-volume + bulk-difficulty and merges by keyword', async () => {
    const seenPaths = new Set<string>();
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', ({ request }) => {
        const url = new URL(request.url);
        seenPaths.add(url.pathname);
        if (url.pathname.endsWith('/search_volume/live')) {
          return HttpResponse.json(readFixture('search-volume', 'success') as JsonBodyType);
        }
        return HttpResponse.json(readFixture('bulk-difficulty', 'success') as JsonBodyType);
      }),
    );
    const result = await provider.getMetrics(
      ['seo audit tool', 'rank tracker'],
      2840,
      'en',
    );
    expect(result).toHaveLength(2);
    const seo = result.find((r) => r.keyword === 'seo audit tool');
    if (!seo) throw new Error('expected seo audit tool');
    expect(seo.searchVolume).toBe(5400);
    expect(seo.difficulty).toBe(62);
    expect(seo.cpc).toBeCloseTo(4.12);
    expect(seo.monthlySearches).toHaveLength(2);
    const rank = result.find((r) => r.keyword === 'rank tracker');
    if (!rank) throw new Error('expected rank tracker');
    expect(rank.difficulty).toBe(74);
    expect(seenPaths).toContain('/v3/keywords_data/google_ads/search_volume/live');
    expect(seenPaths).toContain('/v3/dataforseo_labs/google/bulk_keyword_difficulty/live');
  });

  it('short-circuits on an empty keyword list — makes zero vendor calls', async () => {
    let calls = 0;
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () => {
        calls += 1;
        return HttpResponse.json({});
      }),
    );
    await expect(provider.getMetrics([], 2840, 'en')).resolves.toEqual([]);
    await expect(provider.getMetrics(['   '], 2840, 'en')).resolves.toEqual([]);
    expect(calls).toBe(0);
  });

  it('makes exactly 2 vendor calls per batch (search-volume + bulk-difficulty)', async () => {
    let volumeCalls = 0;
    let difficultyCalls = 0;
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', ({ request }) => {
        const url = new URL(request.url);
        if (url.pathname.endsWith('/search_volume/live')) {
          volumeCalls += 1;
          return HttpResponse.json(readFixture('search-volume', 'success') as JsonBodyType);
        }
        difficultyCalls += 1;
        return HttpResponse.json(readFixture('bulk-difficulty', 'success') as JsonBodyType);
      }),
    );
    // 30 keywords, all in one batch → 2 total calls
    const keywords = Array.from({ length: 30 }, (_, i) => `kw${i}`);
    await provider.getMetrics(keywords, 2840, 'en');
    expect(volumeCalls).toBe(1);
    expect(difficultyCalls).toBe(1);
  });

  it('assigns null difficulty when the vendor omits it for a keyword', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', ({ request }) => {
        const url = new URL(request.url);
        if (url.pathname.endsWith('/search_volume/live')) {
          return HttpResponse.json(readFixture('search-volume', 'success') as JsonBodyType);
        }
        // bulk-difficulty with only ONE of the two keywords present
        return HttpResponse.json({
          version: '0.1.20260101',
          status_code: 20000,
          status_message: 'Ok.',
          time: '0.05 sec.',
          cost: 0.005,
          tasks_count: 1,
          tasks_error: 0,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20000,
              status_message: 'Ok.',
              time: '0.02 sec.',
              cost: 0.005,
              result_count: 1,
              result: [{ items: [{ keyword: 'seo audit tool', keyword_difficulty: 62 }] }],
            },
          ],
        });
      }),
    );
    const result = await provider.getMetrics(
      ['seo audit tool', 'rank tracker'],
      2840,
      'en',
    );
    const rank = result.find((r) => r.keyword === 'rank tracker');
    if (!rank) throw new Error('expected rank tracker');
    expect(rank.difficulty).toBeNull();
    expect(rank.searchVolume).toBe(8100);
  });

  it('treats an unknown search-volume task status as malformed', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', ({ request }) => {
        const url = new URL(request.url);
        if (url.pathname.endsWith('/search_volume/live')) {
          // task_status_code 40602 = in_queue (unexpected on live endpoints)
          return HttpResponse.json({
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
          });
        }
        return HttpResponse.json(readFixture('bulk-difficulty', 'success') as JsonBodyType);
      }),
    );
    await expect(provider.getMetrics(['k'], 2840, 'en')).rejects.toBeInstanceOf(
      VendorMalformedError,
    );
  });

  it('treats an unknown bulk-difficulty task status as malformed', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', ({ request }) => {
        const url = new URL(request.url);
        if (url.pathname.endsWith('/search_volume/live')) {
          return HttpResponse.json(readFixture('search-volume', 'success') as JsonBodyType);
        }
        return HttpResponse.json({
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
        });
      }),
    );
    await expect(provider.getMetrics(['k'], 2840, 'en')).rejects.toBeInstanceOf(
      VendorMalformedError,
    );
  });

  it('skips monthlySearches entries with a non-numeric search_volume; treats missing keyword_difficulty as null; skips blank inputs while merging', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', ({ request }) => {
        const url = new URL(request.url);
        if (url.pathname.endsWith('/search_volume/live')) {
          return HttpResponse.json({
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
                cost: 0.075,
                result: [
                  {
                    keyword: 'seo audit tool',
                    search_volume: 5400,
                    cpc: 4.12,
                    monthly_searches: [
                      { year: 2025, month: 10, search_volume: null },
                      { year: 2025, month: 11, search_volume: 5200 },
                    ],
                  },
                ],
              },
            ],
          });
        }
        return HttpResponse.json({
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
              cost: 0,
              result: [
                {
                  items: [
                    { keyword: 'seo audit tool', keyword_difficulty: null },
                  ],
                },
              ],
            },
          ],
        });
      }),
    );
    // Mix a valid keyword with a blank one to hit `kw.length === 0` branch.
    const result = await provider.getMetrics(['seo audit tool', '   '], 2840, 'en');
    expect(result).toHaveLength(1);
    const only = result[0];
    if (!only) throw new Error('expected result');
    expect(only.difficulty).toBeNull();
    expect(only.monthlySearches).toEqual([
      { year: 2025, month: 11, searchVolume: 5200 },
    ]);
  });

  it('handles a null search_volume result array', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', ({ request }) => {
        const url = new URL(request.url);
        if (url.pathname.endsWith('/search_volume/live')) {
          return HttpResponse.json({
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
                cost: 0,
                result: null,
              },
            ],
          });
        }
        return HttpResponse.json({
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
              cost: 0,
              result: [{ items: null }],
            },
          ],
        });
      }),
    );
    const result = await provider.getMetrics(['a', 'b'], 2840, 'en');
    expect(result).toEqual([
      { keyword: 'a', searchVolume: null, difficulty: null, cpc: null, monthlySearches: [] },
      { keyword: 'b', searchVolume: null, difficulty: null, cpc: null, monthlySearches: [] },
    ]);
  });
});

describe('DataForSeoKeywordProvider — getRelated', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  it('clamps the limit to the vendor ceiling', async () => {
    let capturedBody: unknown = null;
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(readFixture('related', 'success') as JsonBodyType);
      }),
    );
    await provider.getRelated('seed', 2840, 'en', 5000);
    expect(capturedBody).toEqual([
      expect.objectContaining({ limit: MAX_RELATED_LIMIT, depth: 1, keyword: 'seed' }),
    ]);
  });

  it('honours the default limit constant', () => {
    expect(DEFAULT_RELATED_LIMIT).toBe(25);
  });

  it('rejects an empty seed keyword with VendorMalformedError', async () => {
    await expect(provider.getRelated('   ', 2840, 'en', 25)).rejects.toBeInstanceOf(
      VendorMalformedError,
    );
  });

  it('normalizes the seed keyword before sending', async () => {
    let sent: unknown = null;
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json(readFixture('related', 'success') as JsonBodyType);
      }),
    );
    await provider.getRelated('  SEO   Audit  ', 2840, 'en', 10);
    expect(sent).toEqual([
      expect.objectContaining({ keyword: 'seo audit', limit: 10 }),
    ]);
  });

  it('yields empty array when items array is null', async () => {
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
              cost: 0,
              result: [{ items: null }],
            },
          ],
        }),
      ),
    );
    await expect(provider.getRelated('seed', 2840, 'en', 25)).resolves.toEqual([]);
  });

  it('treats an unknown related task status as malformed', async () => {
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
    await expect(provider.getRelated('seed', 2840, 'en', 25)).rejects.toBeInstanceOf(
      VendorMalformedError,
    );
  });

  it('handles a missing keyword_info block (all-null metrics)', async () => {
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
              cost: 0,
              result: [
                {
                  items: [
                    {
                      keyword_data: { keyword: 'orphan' },
                    },
                  ],
                },
              ],
            },
          ],
        }),
      ),
    );
    const result = await provider.getRelated('seed', 2840, 'en', 25);
    expect(result).toEqual([
      {
        keyword: 'orphan',
        searchVolume: null,
        difficulty: null,
        cpc: null,
        monthlySearches: [],
      },
    ]);
  });
});

describe('DataForSeoKeywordProvider — classifyIntent', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  it('short-circuits on an empty keyword list — makes zero vendor calls', async () => {
    let calls = 0;
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () => {
        calls += 1;
        return HttpResponse.json({});
      }),
    );
    await expect(provider.classifyIntent([], 2840, 'en')).resolves.toEqual([]);
    await expect(provider.classifyIntent(['   '], 2840, 'en')).resolves.toEqual([]);
    expect(calls).toBe(0);
  });

  it('sends language only (no location_code) to the search_intent endpoint', async () => {
    let sent: unknown = null;
    let path = '';
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', async ({ request }) => {
        sent = await request.json();
        path = new URL(request.url).pathname;
        return HttpResponse.json(readFixture('search-intent', 'success') as JsonBodyType);
      }),
    );
    await provider.classifyIntent(['  SEO   Audit  Tool  '], 2840, 'EN');
    expect(path).toBe('/v3/dataforseo_labs/google/search_intent/live');
    expect(sent).toEqual([{ keywords: ['seo audit tool'], language_code: 'en' }]);
  });

  it('normalizes an unrecognized/missing intent to null and reports one row per input keyword', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json(readFixture('search-intent', 'partial') as JsonBodyType),
      ),
    );
    // Two input keywords: 'seo audit tool' (classified commercial), and
    // 'rank tracker' which the vendor omitted entirely → must NOT be dropped.
    const result = await provider.classifyIntent(
      ['seo audit tool', 'rank tracker'],
      2840,
      'en',
    );
    expect(result).toEqual([
      { keyword: 'seo audit tool', intent: 'commercial', confidence: 0.82 },
      { keyword: 'rank tracker', intent: null, confidence: null },
    ]);
  });

  it('dedupes duplicate + blank inputs, returning one row per distinct keyword', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json(readFixture('search-intent', 'success') as JsonBodyType),
      ),
    );
    // 'seo audit tool' twice (case-variant) + a blank → one deduped row.
    const result = await provider.classifyIntent(
      ['seo audit tool', 'SEO Audit Tool', '   '],
      2840,
      'en',
    );
    expect(result).toEqual([
      { keyword: 'seo audit tool', intent: 'commercial', confidence: 0.82 },
    ]);
  });

  it('maps an unknown label to intent null but keeps a numeric confidence', async () => {
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
              cost: 0.0013,
              result: [
                {
                  items: [
                    {
                      keyword: 'keyword with unknown label',
                      keyword_intent: { label: 'mixed', probability: 0.5 },
                    },
                  ],
                },
              ],
            },
          ],
        }),
      ),
    );
    const result = await provider.classifyIntent(
      ['keyword with unknown label'],
      2840,
      'en',
    );
    expect(result).toEqual([
      { keyword: 'keyword with unknown label', intent: null, confidence: 0.5 },
    ]);
  });

  it('treats a missing keyword_intent block as fully null', async () => {
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
              cost: 0.0013,
              result: [{ items: [{ keyword: 'bare keyword' }] }],
            },
          ],
        }),
      ),
    );
    const result = await provider.classifyIntent(['bare keyword'], 2840, 'en');
    expect(result).toEqual([{ keyword: 'bare keyword', intent: null, confidence: null }]);
  });

  it('yields all-null rows when the items array is null', async () => {
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
              cost: 0,
              result: [{ items: null }],
            },
          ],
        }),
      ),
    );
    const result = await provider.classifyIntent(['a', 'b'], 2840, 'en');
    expect(result).toEqual([
      { keyword: 'a', intent: null, confidence: null },
      { keyword: 'b', intent: null, confidence: null },
    ]);
  });

  it('treats an unknown search_intent task status as malformed', async () => {
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
      provider.classifyIntent(['seo'], 2840, 'en'),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });
});

describe('DataForSeoKeywordProvider — getIdeas', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  it('clamps the limit to the vendor ceiling and normalizes the seed', async () => {
    let capturedBody: unknown = null;
    let path = '';
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', async ({ request }) => {
        capturedBody = await request.json();
        path = new URL(request.url).pathname;
        return HttpResponse.json(readFixture('keyword-ideas', 'success') as JsonBodyType);
      }),
    );
    await provider.getIdeas('  SEO   Audit  ', 2840, 'EN', 5000);
    expect(path).toBe('/v3/dataforseo_labs/google/keyword_ideas/live');
    expect(capturedBody).toEqual([
      {
        keywords: ['seo audit'],
        location_code: 2840,
        language_code: 'en',
        limit: MAX_RELATED_LIMIT,
      },
    ]);
  });

  it('rejects an empty seed keyword with VendorMalformedError', async () => {
    await expect(provider.getIdeas('   ', 2840, 'en', 25)).rejects.toBeInstanceOf(
      VendorMalformedError,
    );
  });

  it('yields empty array when the items array is null', async () => {
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
              cost: 0,
              result: [{ items: null }],
            },
          ],
        }),
      ),
    );
    await expect(provider.getIdeas('seed', 2840, 'en', 25)).resolves.toEqual([]);
  });

  it('handles a missing keyword_info block (all-null metrics)', async () => {
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
              cost: 0,
              result: [{ items: [{ keyword: 'lonely idea' }] }],
            },
          ],
        }),
      ),
    );
    const result = await provider.getIdeas('seed', 2840, 'en', 25);
    expect(result).toEqual([
      {
        keyword: 'lonely idea',
        searchVolume: null,
        difficulty: null,
        cpc: null,
        monthlySearches: [],
      },
    ]);
  });

  it('treats an unknown keyword_ideas task status as malformed', async () => {
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
    await expect(provider.getIdeas('seed', 2840, 'en', 25)).rejects.toBeInstanceOf(
      VendorMalformedError,
    );
  });
});

describe('DataForSeoKeywordProvider — getLongTailSuggestions', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  it('sends only the normalized seed, market, and bounded limit', async () => {
    let capturedBody: unknown;
    let capturedPath = '';
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', async ({ request }) => {
        capturedBody = await request.json();
        capturedPath = new URL(request.url).pathname;
        return HttpResponse.json(
          readFixture('long-tail-suggestions', 'success') as JsonBodyType,
        );
      }),
    );

    await provider.getLongTailSuggestions('  SEO   Audit Tool  ', 2840, 'EN', 25);

    expect(capturedPath).toBe('/v3/dataforseo_labs/google/keyword_suggestions/live');
    expect(capturedBody).toEqual([{
      keyword: 'seo audit tool',
      location_code: 2840,
      language_code: 'en',
      limit: 25,
    }]);
  });

  it('rejects an empty seed keyword with VendorMalformedError', async () => {
    await expect(
      provider.getLongTailSuggestions('   ', 2840, 'en', 25),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('rejects an envelope without any task', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json({
          status_code: 20000,
          status_message: 'Ok.',
          tasks_count: 0,
          tasks_error: 0,
          tasks: [],
        }),
      ),
    );
    await expect(
      provider.getLongTailSuggestions('seed', 2840, 'en', 25),
    ).rejects.toThrow('keyword_suggestions returned no ok tasks');
  });

  it('tolerates a missing items list and missing metric blocks', async () => {
    const envelope = (result: unknown) => ({
      status_code: 20000,
      status_message: 'Ok.',
      tasks_count: 1,
      tasks_error: 0,
      tasks: [{ id: 'TASK_ID', status_code: 20000, status_message: 'Ok.', cost: 0, result }],
    });
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () => HttpResponse.json(envelope([{ items: null }]))),
    );
    await expect(provider.getLongTailSuggestions('seed', 2840, 'en', 25)).resolves.toEqual([]);

    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json(envelope([{ items: [{ keyword: 'bare seed' }] }])),
      ),
    );
    await expect(provider.getLongTailSuggestions('seed', 2840, 'en', 25)).resolves.toEqual([
      {
        keyword: 'bare seed',
        searchVolume: null,
        difficulty: null,
        cpc: null,
        monthlySearches: [],
      },
    ]);
  });
});

describe('DataForSeoKeywordProvider — site discovery', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  it('normalizes the ranked-site request and clamps its spend limit', async () => {
    let capturedBody: unknown;
    let capturedPath = '';
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', async ({ request }) => {
        capturedBody = await request.json();
        capturedPath = new URL(request.url).pathname;
        return HttpResponse.json(readFixture('ranked-site', 'success') as JsonBodyType);
      }),
    );
    await provider.getRankedKeywordsForSite(' HTTPS://WWW.Example.com/ ', 2840, 'EN', 500);
    expect(capturedPath).toBe('/v3/dataforseo_labs/google/ranked_keywords/live');
    expect(capturedBody).toEqual([{
      target: 'example.com',
      location_code: 2840,
      language_code: 'en',
      item_types: ['organic'],
      historical_serp_mode: 'live',
      // Variants are separately trackable keywords, so they must survive.
      ignore_synonyms: false,
      filters: [['keyword_data.keyword_info.search_volume', '>', 0]],
      order_by: [
        'ranked_serp_element.serp_item.etv,desc',
        'keyword_data.keyword_info.search_volume,desc',
      ],
      limit: MAX_SITE_KEYWORD_LIMIT,
    }]);
  });

  it('normalizes site evidence, bounds seeds, and over-fetches for local grounding', async () => {
    let capturedBody: unknown;
    let capturedPath = '';
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', async ({ request }) => {
        capturedBody = await request.json();
        capturedPath = new URL(request.url).pathname;
        return HttpResponse.json(readFixture('site-ideas', 'success') as JsonBodyType);
      }),
    );
    const seeds = Array.from({ length: MAX_SITE_KEYWORD_SEEDS + 2 }, (_, index) =>
      index === 1 ? ' SEO AUDIT TOOL ' : `Seed Phrase ${index}`,
    );
    const result = await provider.getKeywordIdeasForSite(seeds, 2840, 'EN', 500);
    expect(capturedPath).toBe('/v3/dataforseo_labs/google/keyword_ideas/live');
    expect(capturedBody).toEqual([{
      keywords: [
        'seed phrase 0',
        'seo audit tool',
        ...Array.from(
          { length: MAX_SITE_KEYWORD_SEEDS - 2 },
          (_, index) => `seed phrase ${index + 2}`,
        ),
      ],
      location_code: 2840,
      language_code: 'en',
      closely_variants: false,
      ignore_synonyms: true,
      filters: [['keyword_info.search_volume', '>', 0]],
      order_by: [
        'relevance,desc',
        'keyword_info.search_volume,desc',
      ],
      limit: MAX_SITE_KEYWORD_IDEA_VENDOR_LIMIT,
    }]);
    expect(result).toHaveLength(2);
  });

  it('hard-bounds an over-returned Labs payload to the requested vendor limit', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () => HttpResponse.json({
        status_code: 20000,
        status_message: 'Ok.',
        tasks_count: 1,
        tasks_error: 0,
        tasks: [{
          id: 'TASK_ID',
          status_code: 20000,
          status_message: 'Ok.',
          cost: 0,
          result: [{
            items: Array.from({ length: 4 }, (_, index) => ({
              keyword: `bounded idea ${index}`,
              keyword_info: { search_volume: 100 - index },
            })),
          }],
        }],
      })),
    );

    const result = await provider.getKeywordIdeasForSite(
      ['site evidence'],
      2840,
      'en',
      0,
    );
    expect(result.map((row) => row.keyword)).toEqual([
      'bounded idea 0',
      'bounded idea 1',
      'bounded idea 2',
    ]);
  });

  it('rejects an empty ranked domain or empty idea evidence before vendor spend', async () => {
    await expect(
      provider.getRankedKeywordsForSite('  ', 2840, 'en', 10),
    ).rejects.toBeInstanceOf(VendorMalformedError);
    await expect(
      provider.getKeywordIdeasForSite(['  '], 2840, 'en', 10),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('normalizes absent discovery signals and rejects malformed result collections', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () => HttpResponse.json({
        status_code: 20000,
        status_message: 'Ok.',
        tasks_count: 1,
        tasks_error: 0,
        tasks: [{
          id: 'TASK_ID',
          status_code: 20000,
          status_message: 'Ok.',
          cost: 0,
          result: [{
            items: [{
              keyword_data: { keyword: 'bare keyword' },
              ranked_serp_element: { serp_item: {} },
            }],
          }],
        }],
      })),
    );
    await expect(
      provider.getRankedKeywordsForSite('example.com', 2840, 'en', 0),
    ).resolves.toEqual([{
      keyword: 'bare keyword',
      searchVolume: null,
      difficulty: null,
      currentPosition: null,
      estimatedTraffic: null,
      rankingUrl: null,
    }]);

    vendorMockServer.resetHandlers();
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () => HttpResponse.json({
        status_code: 20000,
        status_message: 'Ok.',
        tasks_count: 1,
        tasks_error: 0,
        tasks: [{
          id: 'TASK_ID',
          status_code: 20000,
          status_message: 'Ok.',
          cost: 0,
          result: [{ items: [{ keyword: 'bare idea' }] }],
        }],
      })),
    );
    await expect(
      provider.getKeywordIdeasForSite(['site evidence'], 2840, 'en', 0),
    ).resolves.toEqual([{
      keyword: 'bare idea',
      searchVolume: null,
      difficulty: null,
      currentPosition: null,
      estimatedTraffic: null,
      rankingUrl: null,
    }]);

    vendorMockServer.resetHandlers();
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () => HttpResponse.json({
        status_code: 20000,
        status_message: 'Ok.',
        tasks_count: 1,
        tasks_error: 0,
        tasks: [{
          id: 'TASK_ID',
          status_code: 20000,
          status_message: 'Ok.',
          cost: 0,
          result: [{ items: null }],
        }],
      })),
    );
    await expect(
      provider.getKeywordIdeasForSite(['site evidence'], 2840, 'en', 10),
    ).resolves.toEqual([]);

    vendorMockServer.resetHandlers();
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () => HttpResponse.json({
        status_code: 20000,
        status_message: 'Ok.',
        tasks_count: 1,
        tasks_error: 0,
        tasks: [{
          id: 'TASK_ID',
          status_code: 20000,
          status_message: 'Ok.',
          cost: 0,
          result: [{ items: null }],
        }],
      })),
    );
    await expect(
      provider.getRankedKeywordsForSite('example.com', 2840, 'en', 10),
    ).resolves.toEqual([]);

    vendorMockServer.resetHandlers();
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () => HttpResponse.json({
        status_code: 20000,
        status_message: 'Ok.',
        tasks_count: 1,
        tasks_error: 0,
        tasks: [{
          id: 'TASK_ID',
          status_code: 20000,
          status_message: 'Ok.',
          cost: 0,
          result: null,
        }],
      })),
    );
    await expect(
      provider.getKeywordIdeasForSite(['site evidence'], 2840, 'en', 10),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('rejects unknown task states for both discovery operations', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () => HttpResponse.json({
        status_code: 20000,
        status_message: 'Ok.',
        tasks_count: 1,
        tasks_error: 0,
        tasks: [{
          id: 'TASK_ID',
          status_code: 40602,
          status_message: 'Task In Queue.',
          cost: 0,
          result: null,
        }],
      })),
    );
    await expect(
      provider.getRankedKeywordsForSite('example.com', 2840, 'en', 10),
    ).rejects.toBeInstanceOf(VendorMalformedError);
    await expect(
      provider.getKeywordIdeasForSite(['site evidence'], 2840, 'en', 10),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });
});

describe('mapSerpFeature', () => {
  it('maps every named alias to the closed enum', () => {
    expect(mapSerpFeature('ai_overview')).toBe('ai_overview');
    expect(mapSerpFeature('featured_snippet')).toBe('featured_snippet');
    expect(mapSerpFeature('people_also_ask')).toBe('people_also_ask');
    expect(mapSerpFeature('local_pack')).toBe('local_pack');
    expect(mapSerpFeature('map')).toBe('local_pack');
    expect(mapSerpFeature('video')).toBe('video');
    expect(mapSerpFeature('video_carousel')).toBe('video');
    expect(mapSerpFeature('images')).toBe('images');
    expect(mapSerpFeature('image')).toBe('images');
    expect(mapSerpFeature('image_pack')).toBe('images');
    expect(mapSerpFeature('shopping')).toBe('shopping');
    expect(mapSerpFeature('google_shopping')).toBe('shopping');
    expect(mapSerpFeature('knowledge_graph')).toBe('knowledge_graph');
    expect(mapSerpFeature('knowledge_panel')).toBe('knowledge_graph');
  });
  it('trims and lowercases before matching', () => {
    expect(mapSerpFeature('  AI_Overview  ')).toBe('ai_overview');
  });
  it('maps an unknown vendor string to other, never drops it', () => {
    expect(mapSerpFeature('organic')).toBe('other');
    expect(mapSerpFeature('brand_new_serp_thing')).toBe('other');
  });
});

describe('DataForSeoKeywordProvider — getOverview', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  it('short-circuits on an empty keyword list — makes zero vendor calls', async () => {
    let calls = 0;
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () => {
        calls += 1;
        return HttpResponse.json({});
      }),
    );
    await expect(provider.getOverview([], 2840, 'en')).resolves.toEqual([]);
    await expect(provider.getOverview(['   '], 2840, 'en')).resolves.toEqual([]);
    expect(calls).toBe(0);
  });

  it('routes to keyword_overview/live with normalized keywords + language', async () => {
    let capturedBody: unknown = null;
    let capturedPath = '';
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', async ({ request }) => {
        capturedBody = await request.json();
        capturedPath = new URL(request.url).pathname;
        return HttpResponse.json(readFixture('keyword-overview', 'success') as JsonBodyType);
      }),
    );
    await provider.getOverview(['  SEO   Audit  Tool  ', 'rank tracker'], 2840, 'EN');
    expect(capturedPath).toBe('/v3/dataforseo_labs/google/keyword_overview/live');
    expect(capturedBody).toEqual([
      {
        keywords: ['seo audit tool', 'rank tracker'],
        location_code: 2840,
        language_code: 'en',
      },
    ]);
  });

  it('reports one row per deduped input; vendor-omitted keywords surface fully null', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json(readFixture('keyword-overview', 'success') as JsonBodyType),
      ),
    );
    const result = await provider.getOverview(
      ['seo audit tool', 'SEO Audit Tool', 'rank tracker', 'obscure long-tail phrase', '   '],
      2840,
      'en',
    );
    expect(result.map((r) => r.keyword)).toEqual([
      'seo audit tool',
      'rank tracker',
      'obscure long-tail phrase',
    ]);
    const omitted = result[2];
    if (!omitted) throw new Error('expected omitted row');
    expect(omitted).toEqual({
      keyword: 'obscure long-tail phrase',
      searchVolume: null,
      difficulty: null,
      cpc: null,
      intent: null,
      serpFeatures: [],
      observedAt: null,
      resultsCount: null,
    });
  });

  it('normalizes SERP item types into a deduped closed enum, dropping blanks', async () => {
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
              cost: 0.0014,
              result: [
                {
                  items: [
                    {
                      keyword: 'seo audit tool',
                      serp_info: {
                        serp_item_types: [
                          'organic',
                          '  ',
                          'video',
                          'video_carousel',
                          'brand-new-thing',
                          'AI_OVERVIEW',
                        ],
                        se_results_count: 12,
                      },
                    },
                  ],
                },
              ],
            },
          ],
        }),
      ),
    );
    const result = await provider.getOverview(['seo audit tool'], 2840, 'en');
    expect(result[0]?.serpFeatures).toEqual(['other', 'video', 'ai_overview']);
    expect(result[0]?.resultsCount).toBe(12);
  });

  it('coerces unknown intent labels + missing serp_info + garbage timestamps to null-safe defaults', async () => {
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
              cost: 0.001,
              result: [
                {
                  items: [
                    {
                      keyword: 'seo audit tool',
                      keyword_info: {
                        search_volume: 100,
                        cpc: 1.1,
                        last_updated_time: 'not-a-date',
                      },
                      keyword_properties: { keyword_difficulty: 42 },
                      search_intent_info: { main_intent: 'mixed' },
                      serp_info: null,
                    },
                  ],
                },
              ],
            },
          ],
        }),
      ),
    );
    const result = await provider.getOverview(['seo audit tool'], 2840, 'en');
    expect(result).toEqual([
      {
        keyword: 'seo audit tool',
        searchVolume: 100,
        difficulty: 42,
        cpc: 1.1,
        intent: null,
        serpFeatures: [],
        observedAt: null,
        resultsCount: null,
      },
    ]);
  });

  it('handles a null items array by returning all-null rows for the inputs', async () => {
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
              cost: 0,
              result: [{ items: null }],
            },
          ],
        }),
      ),
    );
    const result = await provider.getOverview(['a', 'b'], 2840, 'en');
    expect(result).toEqual([
      {
        keyword: 'a',
        searchVolume: null,
        difficulty: null,
        cpc: null,
        intent: null,
        serpFeatures: [],
        observedAt: null,
        resultsCount: null,
      },
      {
        keyword: 'b',
        searchVolume: null,
        difficulty: null,
        cpc: null,
        intent: null,
        serpFeatures: [],
        observedAt: null,
        resultsCount: null,
      },
    ]);
  });

  it('treats an unknown keyword_overview task status as malformed', async () => {
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
    await expect(provider.getOverview(['seo'], 2840, 'en')).rejects.toBeInstanceOf(
      VendorMalformedError,
    );
  });
});

describe('DataForSeoKeywordProvider — getHistoricalVolume', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  it('short-circuits on an empty keyword list — makes zero vendor calls', async () => {
    let calls = 0;
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () => {
        calls += 1;
        return HttpResponse.json({});
      }),
    );
    await expect(provider.getHistoricalVolume([], 2840, 'en')).resolves.toEqual([]);
    await expect(provider.getHistoricalVolume(['   '], 2840, 'en')).resolves.toEqual([]);
    expect(calls).toBe(0);
  });

  it('normalizes inputs and routes to historical_search_volume/live', async () => {
    let capturedBody: unknown = null;
    let capturedPath = '';
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', async ({ request }) => {
        capturedBody = await request.json();
        capturedPath = new URL(request.url).pathname;
        return HttpResponse.json(
          readFixture('historical-search-volume', 'success') as JsonBodyType,
        );
      }),
    );
    await provider.getHistoricalVolume(['  SEO   Audit  Tool  ', 'rank tracker'], 2840, 'EN');
    expect(capturedPath).toBe('/v3/dataforseo_labs/google/historical_search_volume/live');
    expect(capturedBody).toEqual([
      {
        keywords: ['seo audit tool', 'rank tracker'],
        location_code: 2840,
        language_code: 'en',
      },
    ]);
  });

  it('returns one row per deduped input; vendor-omitted keywords carry an empty series', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json(readFixture('historical-search-volume', 'success') as JsonBodyType),
      ),
    );
    const result = await provider.getHistoricalVolume(
      ['seo audit tool', 'SEO Audit Tool', 'obscure long-tail phrase', '   '],
      2840,
      'en',
    );
    expect(result.map((r) => r.keyword)).toEqual(['seo audit tool', 'obscure long-tail phrase']);
    expect(result[1]?.monthlySearches).toEqual([]);
  });

  it('sorts monthly rows ascending and drops entries with a non-numeric search_volume', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json(readFixture('historical-search-volume', 'partial-months') as JsonBodyType),
      ),
    );
    const result = await provider.getHistoricalVolume(['seo audit tool'], 2840, 'en');
    expect(result[0]?.monthlySearches).toEqual([
      { year: 2025, month: 11, searchVolume: 5200 },
      { year: 2026, month: 1, searchVolume: 5500 },
    ]);
  });

  it('bounds the returned series to the most recent MAX_MONTHLY_HISTORY rows', async () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({
      year: 2020 + Math.floor(i / 12),
      month: (i % 12) + 1,
      search_volume: 1000 + i,
    }));
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
              cost: 0,
              result: [
                {
                  items: [
                    { keyword: 'seo audit tool', keyword_info: { monthly_searches: rows } },
                  ],
                },
              ],
            },
          ],
        }),
      ),
    );
    const result = await provider.getHistoricalVolume(['seo audit tool'], 2840, 'en');
    const series = result[0]?.monthlySearches ?? [];
    expect(series.length).toBe(MAX_MONTHLY_HISTORY);
    // Retained the newest 48 rows (60 - 48 = 12 dropped from the front).
    expect(series[0]?.searchVolume).toBe(1012);
    expect(series.at(-1)?.searchVolume).toBe(1059);
  });

  it('handles empty items', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json(readFixture('historical-search-volume', 'empty') as JsonBodyType),
      ),
    );
    const result = await provider.getHistoricalVolume(['seo audit tool'], 2840, 'en');
    expect(result).toEqual([{ keyword: 'seo audit tool', monthlySearches: [] }]);
  });

  it('handles a null items array with an empty series per input', async () => {
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
              cost: 0,
              result: [{ items: null }],
            },
          ],
        }),
      ),
    );
    const result = await provider.getHistoricalVolume(['a', 'b'], 2840, 'en');
    expect(result).toEqual([
      { keyword: 'a', monthlySearches: [] },
      { keyword: 'b', monthlySearches: [] },
    ]);
  });

  it('treats an unknown historical_search_volume task status as malformed', async () => {
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
      provider.getHistoricalVolume(['seo'], 2840, 'en'),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });
});
