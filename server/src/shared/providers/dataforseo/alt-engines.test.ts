/**
 * DataForSEO alt-engine adapter tests.
 *
 * Two layers, matching the sibling SERP adapter file:
 *   1. providerContractTests over each of the three operations — success /
 *      timeout / malformed / quota, all from recorded fixtures.
 *   2. Normalization, match-semantics, bound, and honesty tests.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { providerContractTests } from '../../testing/fixtures/contract.js';
import { mockVendor, vendorMockServer } from '../../testing/fixtures/mock-vendor.js';
import { VendorMalformedError, VendorUnavailableError } from '../errors.js';
import {
  AMAZON_DEPTH,
  AMAZON_PRIORITY,
  BING_DEPTH,
  MAX_ALT_ENGINE_ROWS,
  YOUTUBE_BLOCK_DEPTH,
  buildAltEngineObservationMeta,
  createDataForSeoAltEngineProvider,
  extractAmazonRows,
  extractBingRows,
  extractYouTubeRows,
  matchHostInRows,
  matchTokenInRows,
  normalizeAsin,
  normalizeChannelHandle,
  type DataForSeoAltEngineProviderConfig,
} from './alt-engines.js';
import type { AltEngineRankInput, AltEngineRankRow } from '../types.js';

const FIXTURES_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'testing',
  'fixtures',
  'dataforseo-alt-engines',
);

const FIXTURE_PROVIDER = 'dataforseo-alt-engines';

function readFixture(operation: string, kase: string): JsonBodyType {
  return JSON.parse(
    readFileSync(join(FIXTURES_ROOT, operation, `${kase}.json`), 'utf8'),
  ) as JsonBodyType;
}

const cfg: DataForSeoAltEngineProviderConfig = {
  login: 'sandbox-login',
  password: 'sandbox-password',
  baseUrl: 'https://dataforseo.mock/v3',
  timeoutMs: 60,
  maxRetries: 0,
  backoffBaseMs: 1,
  random: () => 0,
  wait: async () => undefined,
  maxPollAttempts: 2,
  pollIntervalMs: 0,
};

const provider = createDataForSeoAltEngineProvider(cfg);

/** No optional knobs at all — pins the shipped polling defaults. */
const bareProvider = createDataForSeoAltEngineProvider({
  login: 'sandbox-login',
  password: 'sandbox-password',
  baseUrl: 'https://dataforseo.mock/v3',
  timeoutMs: 60,
  maxRetries: 0,
  backoffBaseMs: 1,
  random: () => 0,
});

/** Real `setTimeout` back-off (no injected `wait`), driven at a zero interval. */
const realWaitProvider = createDataForSeoAltEngineProvider({
  login: 'sandbox-login',
  password: 'sandbox-password',
  baseUrl: 'https://dataforseo.mock/v3',
  timeoutMs: 60,
  maxRetries: 0,
  backoffBaseMs: 1,
  random: () => 0,
  pollIntervalMs: 0,
});

const BING_INPUT: AltEngineRankInput = {
  engine: 'bing',
  keyword: 'seo audit tool',
  domain: 'example.com',
  engineTarget: null,
  locationCode: 2840,
  languageCode: 'en',
  device: 'desktop',
};

const YOUTUBE_INPUT: AltEngineRankInput = {
  engine: 'youtube',
  keyword: 'seo audit tutorial',
  domain: 'example.com',
  engineTarget: 'acmechannel',
  locationCode: 2840,
  languageCode: 'en',
  device: 'desktop',
};

const AMAZON_INPUT: AltEngineRankInput = {
  engine: 'amazon',
  keyword: 'seo audit book',
  domain: 'example.com',
  engineTarget: 'B0TRACKED1',
  locationCode: 2840,
  languageCode: 'en',
  device: 'desktop',
};

/** Serve one fixture per HTTP verb so the Amazon two-step flow can be driven. */
function mockAmazon(getCase: string, postCase = 'post-success'): void {
  vendorMockServer.use(
    http.all('*', ({ request }) =>
      HttpResponse.json(
        request.method === 'POST'
          ? readFixture('amazon-products', postCase)
          : readFixture('amazon-products', getCase),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Provider contract — one enrollment per shipped operation
// ---------------------------------------------------------------------------

providerContractTests({
  title: 'DataForSeoAltEngineProvider.checkAltEngineRank(bing)',
  fixtureProvider: FIXTURE_PROVIDER,
  fixtureOperation: 'bing-organic',
  makeCall: () => provider.checkAltEngineRank(BING_INPUT),
  assertSuccess: (result) => {
    expect(result.engine).toBe('bing');
    expect(result.position).toBe(2);
    expect(result.foundUrl).toBe('https://example.com/audit');
    // The answer_box block and the URL-less row are both dropped.
    expect(result.rows).toHaveLength(3);
    expect(result.observationMeta.sourceKind).toBe('provider_observation');
    expect(result.observationMeta.coverageNoteKey).toBeNull();
  },
});

providerContractTests({
  title: 'DataForSeoAltEngineProvider.checkAltEngineRank(youtube)',
  fixtureProvider: FIXTURE_PROVIDER,
  fixtureOperation: 'youtube-organic',
  makeCall: () => provider.checkAltEngineRank(YOUTUBE_INPUT),
  assertSuccess: (result) => {
    expect(result.engine).toBe('youtube');
    // rank_group 2 — the paid block and the channel card are both dropped.
    expect(result.position).toBe(2);
    expect(result.foundUrl).toBe('https://www.youtube.com/watch?v=ORGANIC0002');
    expect(result.rows).toHaveLength(3);
    expect(result.rows.map((r) => r.matchToken)).toEqual([
      'otherchannel',
      'acmechannel',
      null,
    ]);
  },
});

providerContractTests({
  title: 'DataForSeoAltEngineProvider.checkAltEngineRank(amazon)',
  fixtureProvider: FIXTURE_PROVIDER,
  fixtureOperation: 'amazon-products',
  makeCall: () => provider.checkAltEngineRank(AMAZON_INPUT),
  assertSuccess: (result) => {
    expect(result.engine).toBe('amazon');
    expect(result.position).toBe(2);
    // The sponsored row and the URL-less row are both dropped.
    expect(result.rows).toHaveLength(2);
  },
  mockCase: (kase) => {
    if (kase === 'success') {
      mockAmazon('success');
      return;
    }
    // timeout / malformed / quota all fail at the charged task_post step.
    mockVendor(FIXTURE_PROVIDER, 'amazon-products', kase);
  },
});

// ---------------------------------------------------------------------------
// Behaviour beyond the four contract paths
// ---------------------------------------------------------------------------

describe('DataForSeoAltEngineProvider — request bounds', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  it('bing requests exactly one billed SERP page', async () => {
    let body: unknown;
    vendorMockServer.use(
      http.all('*', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(readFixture('bing-organic', 'success'));
      }),
    );
    await provider.checkAltEngineRank(BING_INPUT);
    expect(body).toEqual([
      {
        keyword: 'seo audit tool',
        location_code: 2840,
        language_code: 'en',
        device: 'desktop',
        depth: BING_DEPTH,
      },
    ]);
  });

  it('youtube requests exactly one billed block depth and sends no device', async () => {
    let body: unknown;
    vendorMockServer.use(
      http.all('*', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(readFixture('youtube-organic', 'success'));
      }),
    );
    await provider.checkAltEngineRank(YOUTUBE_INPUT);
    expect(body).toEqual([
      {
        keyword: 'seo audit tutorial',
        location_code: 2840,
        language_code: 'en',
        block_depth: YOUTUBE_BLOCK_DEPTH,
      },
    ]);
  });

  it('amazon posts the normal-priority queue only — never priority 2 or live', async () => {
    let body: unknown;
    let getPath = '';
    vendorMockServer.use(
      http.all('*', async ({ request }) => {
        if (request.method === 'POST') {
          body = await request.json();
          expect(new URL(request.url).pathname).toContain('/merchant/amazon/products/task_post');
          return HttpResponse.json(readFixture('amazon-products', 'post-success'));
        }
        getPath = new URL(request.url).pathname;
        return HttpResponse.json(readFixture('amazon-products', 'success'));
      }),
    );
    await provider.checkAltEngineRank(AMAZON_INPUT);
    expect(body).toEqual([
      {
        keyword: 'seo audit book',
        location_code: 2840,
        language_code: 'en',
        depth: AMAZON_DEPTH,
        priority: AMAZON_PRIORITY,
      },
    ]);
    expect(getPath).toContain('/merchant/amazon/products/task_get/advanced/TASK_ID');
  });

  it('bing reports "checked, not found" as a null position — never a guess', async () => {
    mockVendor(FIXTURE_PROVIDER, 'bing-organic', 'success-not-found');
    const result = await provider.checkAltEngineRank(BING_INPUT);
    expect(result.position).toBeNull();
    expect(result.foundUrl).toBeNull();
    expect(result.rows).toHaveLength(2);
  });

  it('youtube with no tracked handle can never match a row', async () => {
    mockVendor(FIXTURE_PROVIDER, 'youtube-organic', 'success');
    const result = await provider.checkAltEngineRank({
      ...YOUTUBE_INPUT,
      engineTarget: null,
    });
    expect(result.position).toBeNull();
    expect(result.foundUrl).toBeNull();
  });

  it.each([
    ['bing', 'bing-organic', BING_INPUT],
    ['youtube', 'youtube-organic', YOUTUBE_INPUT],
  ] as const)('%s: an empty task list is malformed', async (_engine, op, input) => {
    mockVendor(FIXTURE_PROVIDER, op, 'no-tasks');
    await expect(provider.checkAltEngineRank(input)).rejects.toBeInstanceOf(
      VendorMalformedError,
    );
  });

  it.each([
    ['bing', 'bing-organic', BING_INPUT],
    ['youtube', 'youtube-organic', YOUTUBE_INPUT],
  ] as const)(
    '%s: a live endpoint that only acknowledges the task is unavailable',
    async (_engine, op, input) => {
      mockVendor(FIXTURE_PROVIDER, op, 'created');
      await expect(provider.checkAltEngineRank(input)).rejects.toBeInstanceOf(
        VendorUnavailableError,
      );
    },
  );

  it('amazon: an empty task_post task list is malformed', async () => {
    mockVendor(FIXTURE_PROVIDER, 'amazon-products', 'post-no-tasks');
    await expect(provider.checkAltEngineRank(AMAZON_INPUT)).rejects.toBeInstanceOf(
      VendorMalformedError,
    );
  });

  it('amazon: an in-queue task_post is unavailable', async () => {
    mockVendor(FIXTURE_PROVIDER, 'amazon-products', 'post-in-queue');
    await expect(provider.checkAltEngineRank(AMAZON_INPUT)).rejects.toBeInstanceOf(
      VendorUnavailableError,
    );
  });

  it('amazon: a task_post without an id is malformed', async () => {
    mockVendor(FIXTURE_PROVIDER, 'amazon-products', 'post-missing-id');
    await expect(provider.checkAltEngineRank(AMAZON_INPUT)).rejects.toBeInstanceOf(
      VendorMalformedError,
    );
  });

  it('amazon: an empty task_get task list is malformed', async () => {
    mockAmazon('get-no-tasks');
    await expect(provider.checkAltEngineRank(AMAZON_INPUT)).rejects.toBeInstanceOf(
      VendorMalformedError,
    );
  });

  it('amazon: an unexpected task_get status is malformed', async () => {
    mockAmazon('get-created');
    await expect(provider.checkAltEngineRank(AMAZON_INPUT)).rejects.toBeInstanceOf(
      VendorMalformedError,
    );
  });

  it('amazon: polls, then gives up as unavailable while still in queue', async () => {
    let gets = 0;
    vendorMockServer.use(
      http.all('*', ({ request }) => {
        if (request.method === 'POST') {
          return HttpResponse.json(readFixture('amazon-products', 'post-success'));
        }
        gets += 1;
        return HttpResponse.json(readFixture('amazon-products', 'in-queue'));
      }),
    );
    await expect(provider.checkAltEngineRank(AMAZON_INPUT)).rejects.toBeInstanceOf(
      VendorUnavailableError,
    );
    expect(gets).toBe(2);
  });

  it('backs off with the shipped defaults when no wait seam is injected', async () => {
    let gets = 0;
    vendorMockServer.use(
      http.all('*', ({ request }) => {
        if (request.method === 'POST') {
          return HttpResponse.json(readFixture('amazon-products', 'post-success'));
        }
        gets += 1;
        return HttpResponse.json(
          readFixture('amazon-products', gets === 1 ? 'in-queue' : 'success'),
        );
      }),
    );
    expect(typeof bareProvider.checkAltEngineRank).toBe('function');
    const result = await realWaitProvider.checkAltEngineRank(AMAZON_INPUT);
    expect(result.position).toBe(2);
    expect(gets).toBe(2);
  });

  it('amazon: a queued task that completes on a later poll returns rows', async () => {
    let gets = 0;
    vendorMockServer.use(
      http.all('*', ({ request }) => {
        if (request.method === 'POST') {
          return HttpResponse.json(readFixture('amazon-products', 'post-success'));
        }
        gets += 1;
        return HttpResponse.json(
          readFixture('amazon-products', gets === 1 ? 'in-queue' : 'success'),
        );
      }),
    );
    const result = await provider.checkAltEngineRank(AMAZON_INPUT);
    expect(result.position).toBe(2);
    expect(gets).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('normalizeChannelHandle', () => {
  it.each([
    ['https://www.youtube.com/@acmechannel', 'acmechannel'],
    ['https://www.youtube.com/channel/UCabc123', 'ucabc123'],
    ['https://www.youtube.com/', null],
    // Passes the scheme test but has no host — the WHATWG parser rejects it.
    ['https://', null],
    ['@Acme.Channel_1', 'acme.channel_1'],
    ['Acme Channel', 'acmechannel'],
    ['   ', null],
    ['', null],
    ['!!!', null],
    [null, null],
    [undefined, null],
  ])('normalizes %s', (raw, expected) => {
    expect(normalizeChannelHandle(raw)).toBe(expected);
  });
});

describe('normalizeAsin', () => {
  it.each([
    ['b0tracked1', null, 'B0TRACKED1'],
    [null, 'https://www.amazon.com/dp/B0TRACKED1', 'B0TRACKED1'],
    [null, 'https://www.amazon.com/gp/product/B0TRACKED1?ref=sr', 'B0TRACKED1'],
    ['too-short', 'https://www.amazon.com/s?k=books', null],
    [undefined, null, null],
  ])('normalizes (%s, %s)', (asin, url, expected) => {
    expect(normalizeAsin(asin, url)).toBe(expected);
  });
});

describe('match helpers', () => {
  const rows: AltEngineRankRow[] = [
    { domain: 'other.test', url: 'https://other.test/a', rankGroup: 4, rankAbsolute: 4, matchToken: 'x' },
    { domain: 'example.com', url: 'https://example.com/late', rankGroup: 3, rankAbsolute: 3, matchToken: 'acme' },
    { domain: 'example.com', url: 'https://example.com/early', rankGroup: 1, rankAbsolute: 1, matchToken: 'acme' },
    // Deliberately AFTER the winner and ranked worse — proves the scan keeps
    // the best hit instead of the last one it saw.
    { domain: 'example.com', url: 'https://example.com/worst', rankGroup: 9, rankAbsolute: 9, matchToken: 'acme' },
  ];

  it('matchTokenInRows takes the smallest rank among equal tokens', () => {
    expect(matchTokenInRows(rows, 'acme')).toEqual({
      position: 1,
      foundUrl: 'https://example.com/early',
    });
  });

  it('matchTokenInRows refuses to match a null or empty target', () => {
    expect(matchTokenInRows(rows, null)).toEqual({ position: null, foundUrl: null });
    expect(matchTokenInRows(rows, '')).toEqual({ position: null, foundUrl: null });
  });

  it('matchTokenInRows returns null when nothing carries the token', () => {
    expect(matchTokenInRows(rows, 'nobody')).toEqual({ position: null, foundUrl: null });
  });

  it('matchHostInRows takes the smallest rank on the tracked host', () => {
    expect(matchHostInRows(rows, 'https://www.example.com/')).toEqual({
      position: 1,
      foundUrl: 'https://example.com/early',
    });
  });

  it('matchHostInRows returns null for an untracked host', () => {
    expect(matchHostInRows(rows, 'absent.test')).toEqual({ position: null, foundUrl: null });
  });
});

describe('row extraction bounds', () => {
  const manyBing = {
    items: Array.from({ length: MAX_ALT_ENGINE_ROWS + 5 }, (_unused, index) => ({
      type: 'organic',
      rank_group: index + 1,
      rank_absolute: index + 1,
      domain: `r${index}.example.test`,
      url: `https://r${index}.example.test/`,
    })),
  };

  it('caps stored rows at MAX_ALT_ENGINE_ROWS on every engine', () => {
    expect(extractBingRows([manyBing])).toHaveLength(MAX_ALT_ENGINE_ROWS);
    expect(
      extractYouTubeRows([
        {
          items: manyBing.items.map((item) => ({
            ...item,
            type: 'youtube_video',
            url: `https://www.youtube.com/watch?v=V${item.rank_group}`,
          })),
        },
      ]),
    ).toHaveLength(MAX_ALT_ENGINE_ROWS);
    expect(
      extractAmazonRows([
        {
          items: manyBing.items.map((item) => ({
            ...item,
            type: 'amazon_serp',
            url: `https://www.amazon.com/dp/B0PRODUCT${item.rank_group}`,
          })),
        },
      ]),
    ).toHaveLength(MAX_ALT_ENGINE_ROWS);
  });

  it('drops rows the vendor returned without an ordinal', () => {
    expect(
      extractBingRows([
        {
          items: [
            { type: 'organic', rank_group: null, domain: 'a.test', url: 'https://a.test/' },
          ],
        },
      ]),
    ).toEqual([]);
    expect(
      extractYouTubeRows([
        { items: [{ type: 'youtube_video', rank_group: null, url: 'https://y.test/' }] },
      ]),
    ).toEqual([]);
    expect(
      extractAmazonRows([
        { items: [{ type: 'amazon_serp', rank_group: null, url: 'https://a.test/' }] },
      ]),
    ).toEqual([]);
  });

  it('falls back to the engine host when a row exposes no domain', () => {
    expect(
      extractAmazonRows([
        {
          items: [
            {
              type: 'amazon_serp',
              rank_group: 1,
              rank_absolute: 1,
              url: 'https://www.amazon.co.uk/dp/B0TRACKED1',
              asin: 'B0TRACKED1',
            },
          ],
        },
      ]),
    ).toEqual([
      {
        domain: 'amazon.co.uk',
        url: 'https://www.amazon.co.uk/dp/B0TRACKED1',
        rankGroup: 1,
        rankAbsolute: 1,
        matchToken: 'B0TRACKED1',
      },
    ]);
    expect(
      extractYouTubeRows([
        {
          items: [
            {
              type: 'youtube_video',
              rank_group: 1,
              rank_absolute: 1,
              url: 'not-a-url',
              channel_url: 'https://www.youtube.com/@acmechannel',
            },
          ],
        },
      ])[0]?.domain,
    ).toBe('not-a-url');
  });

  it('falls back to rank_group when the vendor omits rank_absolute', () => {
    expect(
      extractBingRows([
        {
          items: [
            {
              type: 'organic',
              rank_group: 7,
              domain: 'a.test',
              url: 'https://a.test/',
            },
          ],
        },
      ]),
    ).toEqual([
      { domain: 'a.test', url: 'https://a.test/', rankGroup: 7, rankAbsolute: 7, matchToken: null },
    ]);
  });

  it('drops rows the vendor returned without a usable URL', () => {
    expect(
      extractYouTubeRows([
        {
          items: [
            { type: 'youtube_video', rank_group: 1, rank_absolute: 1, url: null },
          ],
        },
      ]),
    ).toEqual([]);
  });

  it('reads an empty bucket as no rows', () => {
    expect(extractBingRows([{}])).toEqual([]);
    expect(extractYouTubeRows([{}])).toEqual([]);
    expect(extractAmazonRows([{}])).toEqual([]);
  });
});

describe('observation honesty', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  it('labels EVERY amazon result as a provider-index ranking', async () => {
    mockAmazon('success');
    const result = await provider.checkAltEngineRank(AMAZON_INPUT);
    expect(result.observationMeta.coverageNoteKey).toBe(
      'observations.coverage.providerIndexRanking',
    );
    expect(result.observationMeta.sourceKind).toBe('provider_observation');
    expect(result.observationMeta.sourceLabel).toBe('dataforseo');
  });

  it('never applies the provider-index note to bing or youtube', () => {
    for (const engine of ['bing', 'youtube'] as const) {
      expect(
        buildAltEngineObservationMeta(engine, new Date('2026-01-01T00:00:00.000Z'), 3)
          .coverageNoteKey,
      ).toBeNull();
    }
  });

  it('counts an empty result page as one observation, never zero', () => {
    expect(
      buildAltEngineObservationMeta('amazon', new Date('2026-01-01T00:00:00.000Z'), 0)
        .sampleCount,
    ).toBe(1);
  });
});
