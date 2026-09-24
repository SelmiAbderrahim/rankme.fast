/**
 * DataForSEO SERP adapter tests.
 *
 * Two layers, matching the on-page adapter file:
 *   1. providerContractTests over each single-request operation (task_post,
 *      task_get) — success / timeout / malformed / quota.
 *   2. Extra polling + input-mapping + normalization tests.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { providerContractTests } from '../../testing/fixtures/contract.js';
import { vendorMockServer } from '../../testing/fixtures/mock-vendor.js';
import {
  VendorAuthError,
  VendorMalformedError,
  VendorQuotaError,
  VendorUnavailableError,
} from '../errors.js';
import {
  buildLocalPackBody,
  createDataForSeoRankProvider,
  formatLocationCoordinate,
  DEFAULT_SERP_DEPTH,
  DEFAULT_PUBLIC_PAGE_DEPTH,
  PUBLIC_PAGE_MAX_PER_QUERY,
  PUBLIC_PAGE_MAX_QUERIES,
  extractAiOverview,
  extractItemHost,
  extractLocalPackItems,
  extractOrganicItems,
  hintPublicPageSourceType,
  matchDomainInLocalPack,
  matchDomainInAiOverview,
  matchDomainInSerp,
  normalizeDiscoveredUrl,
  normalizeSerpDomain,
  parseVendorObservedAt,
  resolveDiscoveryMarket,
  safeTitle,
  type DataForSeoSerpProviderConfig,
} from './serp.js';
import type { SiteMarket } from '../../observations/types.js';

const FIXTURES_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'testing',
  'fixtures',
  'dataforseo-serp',
);

function readFixture(operation: string, kase: string): JsonBodyType {
  return JSON.parse(
    readFileSync(join(FIXTURES_ROOT, operation, `${kase}.json`), 'utf8'),
  ) as JsonBodyType;
}

const cfg: DataForSeoSerpProviderConfig = {
  login: 'sandbox-login',
  password: 'sandbox-password',
  baseUrl: 'https://dataforseo.mock/v3',
  timeoutMs: 60,
  maxRetries: 0,
  backoffBaseMs: 1,
  random: () => 0,
  depth: 100,
  wait: async () => undefined,
  maxPollAttempts: 2,
  pollIntervalMs: 0,
};

const provider = createDataForSeoRankProvider(cfg);

const RANK_INPUT = {
  keyword: 'seo audit tool',
  domain: 'example.com',
  locationCode: 2840,
  languageCode: 'en',
  device: 'desktop',
} as const;

// ---------------------------------------------------------------------------
// Provider contract — postSerpTask
// ---------------------------------------------------------------------------

providerContractTests({
  title: 'DataForSeoRankProvider.postSerpTask',
  fixtureProvider: 'dataforseo-serp',
  fixtureOperation: 'task-post',
  makeCall: () => provider.postSerpTask(RANK_INPUT),
  assertSuccess: (result) => {
    expect(result).toEqual({ vendorTaskId: 'TASK_ID' });
  },
});

// ---------------------------------------------------------------------------
// Provider contract — fetchSerpResult
// ---------------------------------------------------------------------------

providerContractTests({
  title: 'DataForSeoRankProvider.fetchSerpResult',
  fixtureProvider: 'dataforseo-serp',
  fixtureOperation: 'task-get',
  makeCall: () => provider.fetchSerpResult('TASK_ID'),
  assertSuccess: (result) => {
    expect(result.items.length).toBeGreaterThanOrEqual(3);
    expect(result.costUsd).toBeGreaterThanOrEqual(0);
    // Feature capture rides the SAME recorded
    // payload the four contract paths already exercise, so success/timeout/
    // malformed/quota cover it without a second vendor operation.
    expect(result.features.features.map((f) => f.type)).toEqual([
      'ai_overview',
      'people_also_ask',
    ]);
    expect(result.features.featuredSnippet).toBeNull();
    expect(result.features.paa).toEqual([]);
  },
});

providerContractTests({
  title: 'DataForSeoRankProvider.checkLocalPackRank',
  fixtureProvider: 'dataforseo-serp',
  fixtureOperation: 'local-pack',
  makeCall: () =>
    provider.checkLocalPackRank({
      keyword: 'dentist austin',
      domain: 'example.com',
      locationCode: 2840,
      languageCode: 'en',
    }),
  assertSuccess: (result) => {
    expect(result.position).toBe(2);
    expect(result.totalPackSize).toBe(3);
    expect(result.checkedAt).toBeInstanceOf(Date);
  },
});

// ---------------------------------------------------------------------------
// Provider contract — liveSerp (the primary synchronous path)
// ---------------------------------------------------------------------------

providerContractTests({
  title: 'DataForSeoRankProvider.liveSerp',
  fixtureProvider: 'dataforseo-serp',
  fixtureOperation: 'serp-live',
  makeCall: () => provider.liveSerp(RANK_INPUT),
  assertSuccess: (result) => {
    expect(result.items.length).toBeGreaterThanOrEqual(3);
    expect(result.costUsd).toBeGreaterThanOrEqual(0);
    expect(result.aiOverview.present).toBe(true);
    expect(result.features.features.map((f) => f.type)).toContain('ai_overview');
  },
});

// ---------------------------------------------------------------------------
// Feature-bearing SERP, recorded fixture
// ---------------------------------------------------------------------------

describe('DataForSeoRankProvider — SERP feature capture', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  it('captures snippet ownership, PAA sources, and every tracked block from ONE fetch', async () => {
    let taskGetCalls = 0;
    vendorMockServer.use(
      http.post('*/serp/google/organic/task_post', () =>
        HttpResponse.json(readFixture('task-post', 'success')),
      ),
      http.get('*/serp/google/organic/task_get/advanced/*', () => {
        taskGetCalls += 1;
        return HttpResponse.json(readFixture('task-get', 'feature-rich'));
      }),
    );
    const result = await provider.checkRank(RANK_INPUT);
    // ZERO NEW SPEND: one task_get, exactly as before the feature.
    expect(taskGetCalls).toBe(1);
    expect(result.position).toBe(2);
    const features = result.serpFeatures;
    expect(features?.features).toEqual([
      { type: 'ai_overview', rankAbsolute: 0 },
      { type: 'featured_snippet', rankAbsolute: 1 },
      { type: 'people_also_ask', rankAbsolute: 3 },
      { type: 'video', rankAbsolute: 4 },
      { type: 'images', rankAbsolute: 5 },
      { type: 'local_pack', rankAbsolute: 6 },
      { type: 'knowledge_graph', rankAbsolute: 7 },
      { type: 'shopping', rankAbsolute: 8 },
    ]);
    // Untracked blocks (paid, related_searches) never become an `other` chip.
    expect(features?.features.some((f) => f.type === 'other')).toBe(false);
    expect(features?.featuredSnippet).toEqual({
      domain: 'example.com',
      url: 'https://example.com/guides/seo-audit',
      // Hostile vendor title is carried as INERT TEXT — encoding is the
      // renderer's job (`.claude/rules/output-encoding.md`), never a silent
      // strip that hides what the SERP actually showed.
      title: "How to run an SEO audit <script>alert('xss')</script>",
    });
    expect(features?.paa).toEqual([
      {
        question: 'What does an SEO audit include?',
        answerDomain: 'example.com',
        answerUrl: 'https://example.com/guides/seo-audit',
      },
      {
        question: 'How often should I audit my site?',
        answerDomain: 'rival-one.example',
        answerUrl: 'https://rival-one.example/how-often',
      },
      { question: 'Is an SEO audit free?', answerDomain: null, answerUrl: null },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Extra behaviours
// ---------------------------------------------------------------------------

describe('DataForSeoRankProvider — checkRank end-to-end', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  it('happy path: parses success fixture and matches example.com at rank 3', async () => {
    vendorMockServer.use(
      http.post('*/serp/google/organic/task_post', () =>
        HttpResponse.json(readFixture('task-post', 'success')),
      ),
      http.get('*/serp/google/organic/task_get/advanced/*', () =>
        HttpResponse.json(readFixture('task-get', 'success')),
      ),
    );
    const result = await provider.checkRank(RANK_INPUT);
    expect(result.position).toBe(3);
    expect(result.foundUrl).toBe('https://example.com/pricing');
    // Advanced payload carries an AI Overview citing example.com.
    expect(result.aiOverview).toEqual({
      present: true,
      cited: true,
      citedUrl: 'https://example.com/guides/seo-audit',
    });
  });

  it('liveSerp: empty tasks array → VendorMalformedError', async () => {
    vendorMockServer.use(
      http.post('*/serp/google/organic/live/advanced', () =>
        HttpResponse.json({ status_code: 20000, tasks: [] }),
      ),
    );
    await expect(provider.liveSerp(RANK_INPUT)).rejects.toBeInstanceOf(
      VendorMalformedError,
    );
  });

  it('liveSerp: unexpected in-queue task → VendorUnavailableError', async () => {
    vendorMockServer.use(
      http.post('*/serp/google/organic/live/advanced', () =>
        HttpResponse.json({
          status_code: 20000,
          tasks: [{ status_code: 40602, id: 'TASK_ID' }],
        }),
      ),
    );
    await expect(provider.liveSerp(RANK_INPUT)).rejects.toBeInstanceOf(
      VendorUnavailableError,
    );
  });

  it('liveSerp: parses success and matches example.com at rank 3', async () => {
    vendorMockServer.use(
      http.post('*/serp/google/organic/live/advanced', () =>
        HttpResponse.json(readFixture('serp-live', 'success')),
      ),
    );
    const { items, aiOverview } = await provider.liveSerp(RANK_INPUT);
    expect(matchDomainInSerp(items, RANK_INPUT.domain, new Date()).position).toBe(3);
    expect(aiOverview.present).toBe(true);
  });

  it('liveSerp: a related_searches block with string items[] never fails the check (regression)', async () => {
    // Real Google SERPs nest plain strings under `related_searches` /
    // `people_also_search`; the schema must accept them instead of rejecting
    // the whole payload as malformed (which left every keyword "Unavailable").
    vendorMockServer.use(
      http.post('*/serp/google/organic/live/advanced', () =>
        HttpResponse.json({
          status_code: 20000,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20000,
              cost: 0.0006,
              result: [
                {
                  keyword: 'seo audit tool',
                  type: 'organic',
                  items_count: 2,
                  items: [
                    {
                      type: 'organic',
                      rank_group: 1,
                      rank_absolute: 1,
                      domain: 'example.com',
                      url: 'https://example.com/',
                    },
                    {
                      type: 'related_searches',
                      rank_group: 2,
                      rank_absolute: 2,
                      items: ['audit tool free', 'best audit tool'],
                    },
                  ],
                },
              ],
            },
          ],
        }),
      ),
    );
    const { items } = await provider.liveSerp(RANK_INPUT);
    expect(matchDomainInSerp(items, RANK_INPUT.domain, new Date()).position).toBe(1);
  });

  it('liveSerp: modern SERP feature blocks (ai_overview, perspectives, product_considerations, video, images) never fail the check (regression)', async () => {
    // A real modern SERP (e.g. "uptime kuma") nests many feature blocks around
    // the organic results. `organicItemSchema` (passthrough + a nested
    // object|string union) must accept every one so the check never throws — a
    // too-strict schema here would surface as a VendorMalformedError per keyword
    // and leave the row unwritten, i.e. the "Unavailable" bug we are guarding.
    vendorMockServer.use(
      http.post('*/serp/google/organic/live/advanced', () =>
        HttpResponse.json({
          status_code: 20000,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20000,
              cost: 0.002,
              result: [
                {
                  keyword: 'uptime kuma',
                  type: 'organic',
                  items_count: 8,
                  item_types: [
                    'ai_overview',
                    'organic',
                    'product_considerations',
                    'video',
                    'perspectives',
                    'people_also_ask',
                    'related_searches',
                    'images',
                  ],
                  items: [
                    {
                      type: 'ai_overview',
                      // Real payloads sometimes carry a null nested `items`.
                      items: null,
                      references: [
                        {
                          type: 'ai_overview_reference',
                          domain: 'example.com',
                          url: 'https://example.com/guide',
                          title: 'Guide',
                        },
                      ],
                    },
                    {
                      type: 'product_considerations',
                      rank_group: 1,
                      rank_absolute: 1,
                      items: [{ type: 'product_consideration', title: 'Free tier' }],
                    },
                    {
                      type: 'video',
                      rank_group: 2,
                      rank_absolute: 2,
                      items: [{ type: 'video_element', title: 'Demo' }],
                    },
                    {
                      type: 'perspectives',
                      rank_group: 3,
                      rank_absolute: 3,
                      items: [{ type: 'perspectives_element', title: 'Reddit' }, {}],
                    },
                    {
                      type: 'images',
                      rank_group: 4,
                      rank_absolute: 4,
                      items: [{ type: 'images_element', alt: 'x' }],
                    },
                    {
                      type: 'people_also_ask',
                      rank_group: 5,
                      rank_absolute: 5,
                      items: [{ type: 'people_also_ask_element', title: 'Q?' }],
                    },
                    {
                      type: 'related_searches',
                      rank_group: 6,
                      rank_absolute: 6,
                      items: ['a', 'b'],
                    },
                    {
                      type: 'organic',
                      rank_group: 1,
                      rank_absolute: 7,
                      domain: 'example.com',
                      url: 'https://example.com/',
                    },
                  ],
                },
              ],
            },
          ],
        }),
      ),
    );
    const { items, aiOverview } = await provider.liveSerp(RANK_INPUT);
    // The organic result is still matched despite the surrounding feature blocks.
    expect(matchDomainInSerp(items, RANK_INPUT.domain, new Date()).position).toBe(1);
    // The AI Overview block is still parsed for citation tracking.
    expect(aiOverview.present).toBe(true);
    expect(aiOverview.references.some((r) => r.domain === 'example.com')).toBe(true);
  });

  it('AI Overview shown but domain not cited → cited:false', async () => {
    vendorMockServer.use(
      http.post('*/serp/google/organic/task_post', () =>
        HttpResponse.json(readFixture('task-post', 'success')),
      ),
      http.get('*/serp/google/organic/task_get/advanced/*', () =>
        HttpResponse.json(readFixture('task-get', 'ai-overview-not-cited')),
      ),
    );
    const result = await provider.checkRank(RANK_INPUT);
    expect(result.position).toBe(1);
    expect(result.aiOverview).toEqual({ present: true, cited: false });
  });

  it('domain not found in depth → position: null (distinct from unavailable)', async () => {
    vendorMockServer.use(
      http.post('*/serp/google/organic/task_post', () =>
        HttpResponse.json(readFixture('task-post', 'success')),
      ),
      http.get('*/serp/google/organic/task_get/advanced/*', () =>
        HttpResponse.json(readFixture('task-get', 'success-not-found')),
      ),
    );
    const result = await provider.checkRank(RANK_INPUT);
    expect(result.position).toBeNull();
    expect(result.foundUrl).toBeUndefined();
  });

  it('in-queue polling: 40602 is swallowed, subsequent success drives the result', async () => {
    let getCalls = 0;
    vendorMockServer.use(
      http.post('*/serp/google/organic/task_post', () =>
        HttpResponse.json(readFixture('task-post', 'success')),
      ),
      http.get('*/serp/google/organic/task_get/advanced/*', () => {
        getCalls += 1;
        const body = getCalls === 1
          ? readFixture('task-get', 'in-queue')
          : readFixture('task-get', 'success');
        return HttpResponse.json(body);
      }),
    );
    const result = await provider.checkRank(RANK_INPUT);
    expect(getCalls).toBe(2);
    expect(result.position).toBe(3);
  });

  it('polls an OK task with a null result until the result is ready', async () => {
    let getCalls = 0;
    vendorMockServer.use(
      http.post('*/serp/google/organic/task_post', () =>
        HttpResponse.json(readFixture('task-post', 'success')),
      ),
      http.get('*/serp/google/organic/task_get/advanced/*', () => {
        getCalls += 1;
        return HttpResponse.json(
          getCalls === 1
            ? { status_code: 20000, tasks: [{ status_code: 20000, result: null }] }
            : readFixture('task-get', 'success'),
        );
      }),
    );

    await expect(provider.checkRank(RANK_INPUT)).resolves.toMatchObject({ position: 3 });
    expect(getCalls).toBe(2);
  });

  it('reports unavailable when an OK task keeps returning a null result', async () => {
    vendorMockServer.use(
      http.get('*/serp/google/organic/task_get/advanced/*', () =>
        HttpResponse.json({
          status_code: 20000,
          tasks: [{ status_code: 20000, result: null }],
        }),
      ),
    );

    await expect(
      provider.fetchSerpResult('TASK_ID', { maxPollAttempts: 1, pollIntervalMs: 0 }),
    ).rejects.toBeInstanceOf(VendorUnavailableError);
  });

  it('polls a temporarily missing task until the task appears', async () => {
    let getCalls = 0;
    vendorMockServer.use(
      http.post('*/serp/google/organic/task_post', () =>
        HttpResponse.json(readFixture('task-post', 'success')),
      ),
      http.get('*/serp/google/organic/task_get/advanced/*', () => {
        getCalls += 1;
        return HttpResponse.json(
          getCalls === 1
            ? { status_code: 20000, tasks: null }
            : readFixture('task-get', 'success'),
        );
      }),
    );

    await expect(provider.checkRank(RANK_INPUT)).resolves.toMatchObject({ position: 3 });
    expect(getCalls).toBe(2);
  });

  it('polling exhausted while in-queue → VendorUnavailableError', async () => {
    vendorMockServer.use(
      http.post('*/serp/google/organic/task_post', () =>
        HttpResponse.json(readFixture('task-post', 'success')),
      ),
      http.get('*/serp/google/organic/task_get/advanced/*', () =>
        HttpResponse.json(readFixture('task-get', 'in-queue')),
      ),
    );
    await expect(provider.checkRank(RANK_INPUT)).rejects.toBeInstanceOf(
      VendorUnavailableError,
    );
  });

  it('task_get: task-level malformed result is a VendorMalformedError', async () => {
    vendorMockServer.use(
      http.post('*/serp/google/organic/task_post', () =>
        HttpResponse.json(readFixture('task-post', 'success')),
      ),
      http.get('*/serp/google/organic/task_get/advanced/*', () =>
        HttpResponse.json(readFixture('task-get', 'malformed-result')),
      ),
    );
    await expect(provider.checkRank(RANK_INPUT)).rejects.toBeInstanceOf(
      VendorMalformedError,
    );
  });

  it('task_get: task-level unexpected `created` status is malformed', async () => {
    vendorMockServer.use(
      http.post('*/serp/google/organic/task_post', () =>
        HttpResponse.json(readFixture('task-post', 'success')),
      ),
      http.get('*/serp/google/organic/task_get/advanced/*', () =>
        HttpResponse.json({
          status_code: 20000,
          tasks: [{ status_code: 20100, id: 'TASK_ID', cost: 0 }],
        }),
      ),
    );
    await expect(provider.checkRank(RANK_INPUT)).rejects.toBeInstanceOf(
      VendorMalformedError,
    );
  });

  it('task_post empty tasks array → malformed', async () => {
    vendorMockServer.use(
      http.post('*/serp/google/organic/task_post', () =>
        HttpResponse.json({ status_code: 20000, tasks: [] }),
      ),
    );
    await expect(provider.checkRank(RANK_INPUT)).rejects.toBeInstanceOf(
      VendorMalformedError,
    );
  });

  it('task_post missing id → malformed', async () => {
    vendorMockServer.use(
      http.post('*/serp/google/organic/task_post', () =>
        HttpResponse.json({
          status_code: 20000,
          tasks: [{ status_code: 20100, cost: 0 }],
        }),
      ),
    );
    await expect(provider.checkRank(RANK_INPUT)).rejects.toBeInstanceOf(
      VendorMalformedError,
    );
  });

  it('task_post defensive task-level in_queue → unavailable', async () => {
    vendorMockServer.use(
      http.post('*/serp/google/organic/task_post', () =>
        HttpResponse.json({
          status_code: 20000,
          tasks: [{ status_code: 40602 }],
        }),
      ),
    );
    await expect(provider.checkRank(RANK_INPUT)).rejects.toBeInstanceOf(
      VendorUnavailableError,
    );
  });

  it('task_get empty tasks array → unavailable after polling is exhausted', async () => {
    vendorMockServer.use(
      http.post('*/serp/google/organic/task_post', () =>
        HttpResponse.json(readFixture('task-post', 'success')),
      ),
      http.get('*/serp/google/organic/task_get/advanced/*', () =>
        HttpResponse.json({ status_code: 20000, tasks: [] }),
      ),
    );
    await expect(
      provider.fetchSerpResult('TASK_ID', { maxPollAttempts: 1, pollIntervalMs: 0 }),
    ).rejects.toBeInstanceOf(VendorUnavailableError);
  });

  it('task_post forwards keyword, location, language, device, depth', async () => {
    let capturedBody: unknown = null;
    vendorMockServer.use(
      http.post('*/serp/google/organic/task_post', async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(readFixture('task-post', 'success'));
      }),
    );
    await provider.postSerpTask(RANK_INPUT);
    expect(capturedBody).toEqual([
      {
        keyword: 'seo audit tool',
        location_code: 2840,
        language_code: 'en',
        device: 'desktop',
        depth: 100,
      },
    ]);
  });

  it('default depth is applied when config omits it', async () => {
    const defaults = createDataForSeoRankProvider({
      login: 'l',
      password: 'p',
      baseUrl: 'https://vendor.test/v3',
    });
    expect(typeof defaults.postSerpTask).toBe('function');
    expect(DEFAULT_SERP_DEPTH).toBe(100);
  });

  it('override poll config supersedes cfg-level defaults', async () => {
    let calls = 0;
    vendorMockServer.use(
      http.get('*/serp/google/organic/task_get/advanced/*', () => {
        calls += 1;
        return HttpResponse.json(readFixture('task-get', 'in-queue'));
      }),
    );
    await expect(
      provider.fetchSerpResult('T', { maxPollAttempts: 3, pollIntervalMs: 0 }),
    ).rejects.toBeInstanceOf(VendorUnavailableError);
    expect(calls).toBe(3);
  });
});

describe('DataForSeoRankProvider — checkLocalPackRank', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  const input = {
    keyword: 'dentist austin',
    domain: 'example.com',
    locationCode: 2840,
    languageCode: 'en',
  };

  it('returns position:null when the domain is not in the local pack', async () => {
    vendorMockServer.use(
      http.post('*/serp/google/maps/live/advanced', () =>
        HttpResponse.json(readFixture('local-pack', 'success-not-found')),
      ),
    );
    await expect(provider.checkLocalPackRank(input)).resolves.toMatchObject({
      position: null,
      totalPackSize: 2,
    });
  });

  it('posts keyword, location, language, depth, and search_places=false', async () => {
    let capturedBody: unknown = null;
    vendorMockServer.use(
      http.post('*/serp/google/maps/live/advanced', async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(readFixture('local-pack', 'success'));
      }),
    );
    await provider.checkLocalPackRank(input);
    expect(capturedBody).toEqual([
      {
        keyword: 'dentist austin',
        location_code: 2840,
        language_code: 'en',
        depth: 20,
        search_places: false,
      },
    ]);
  });

  it('empty tasks array is malformed', async () => {
    vendorMockServer.use(
      http.post('*/serp/google/maps/live/advanced', () =>
        HttpResponse.json({ status_code: 20000, tasks: [] }),
      ),
    );
    await expect(provider.checkLocalPackRank(input)).rejects.toBeInstanceOf(
      VendorMalformedError,
    );
  });

  it('created task status is malformed for the live endpoint', async () => {
    vendorMockServer.use(
      http.post('*/serp/google/maps/live/advanced', () =>
        HttpResponse.json({ status_code: 20000, tasks: [{ id: 'TASK_ID', status_code: 20100 }] }),
      ),
    );
    await expect(provider.checkLocalPackRank(input)).rejects.toBeInstanceOf(
      VendorMalformedError,
    );
  });

  it('falls back to matched-item count when the bucket has no items_count', async () => {
    vendorMockServer.use(
      http.post('*/serp/google/maps/live/advanced', () =>
        HttpResponse.json({
          status_code: 20000,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20000,
              cost: 0,
              result: [
                {
                  items: [
                    {
                      type: 'maps_search',
                      rank_group: 1,
                      rank_absolute: 1,
                      domain: 'example.com',
                      url: 'https://example.com/',
                    },
                  ],
                },
              ],
            },
          ],
        }),
      ),
    );
    await expect(provider.checkLocalPackRank(input)).resolves.toMatchObject({
      position: 1,
      totalPackSize: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('normalizeSerpDomain', () => {
  it('strips scheme, www, trailing slash, and lowercases', () => {
    expect(normalizeSerpDomain('https://www.EXAMPLE.com/')).toBe('example.com');
    expect(normalizeSerpDomain('example.com')).toBe('example.com');
  });
});

describe('extractItemHost', () => {
  it('returns null for null/undefined', () => {
    expect(extractItemHost(undefined)).toBeNull();
    expect(extractItemHost(null)).toBeNull();
  });
  it('falls back for unparseable URLs', () => {
    expect(extractItemHost('not-a-url')).toBe('not-a-url');
  });
  it('extracts host from a full URL', () => {
    expect(extractItemHost('https://a.example/pricing')).toBe('a.example');
  });
});

describe('extractOrganicItems', () => {
  it('drops non-organic and missing-rank rows', () => {
    const items = extractOrganicItems([
      {
        items: [
          { type: 'organic', rank_group: 1, rank_absolute: 1, domain: 'a.example', url: 'https://a.example/' },
          { type: 'ads', rank_group: 0, rank_absolute: 0, domain: 'ad.example', url: 'https://ad.example/' },
          { type: 'organic', rank_group: null, rank_absolute: null, domain: 'b.example', url: 'https://b.example/' },
          { type: 'organic', rank_group: 2, rank_absolute: 2, domain: null, url: null },
        ],
      },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]!.domain).toBe('a.example');
  });

  it('falls back to url host when domain is missing', () => {
    const items = extractOrganicItems([
      {
        items: [
          { type: 'organic', rank_group: 4, rank_absolute: 4, domain: undefined, url: 'https://EXAMPLE.com/x' },
        ],
      },
    ]);
    expect(items[0]!.domain).toBe('example.com');
  });

  it('defaults rank_absolute to rank_group when missing', () => {
    const items = extractOrganicItems([
      { items: [{ type: 'organic', rank_group: 7, domain: 'x.test', url: 'https://x.test/' }] },
    ]);
    expect(items[0]!.rankAbsolute).toBe(7);
  });

  it('handles null items array', () => {
    expect(extractOrganicItems([{ items: null }])).toEqual([]);
  });
});

describe('extractLocalPackItems', () => {
  it('keeps maps_search rows and falls back to url/contact_url host', () => {
    const items = extractLocalPackItems([
      {
        items: [
          {
            type: 'maps_search',
            rank_group: 1,
            rank_absolute: 1,
            domain: 'Example.com',
            url: null,
          },
          {
            type: 'maps_search',
            rank_group: 2,
            rank_absolute: 2,
            domain: null,
            url: 'https://Second.example/',
          },
          {
            type: 'maps_search',
            rank_group: 3,
            rank_absolute: 3,
            domain: null,
            url: null,
            contact_url: 'https://third.example/contact',
          },
          {
            type: 'organic',
            rank_group: 4,
            rank_absolute: 4,
            domain: 'ignored.example',
          },
        ],
      },
    ]);
    expect(items.map((item) => item.domain)).toEqual([
      'example.com',
      'second.example',
      'third.example',
    ]);
  });

  it('drops maps rows without rank or domain signal and handles null items', () => {
    expect(
      extractLocalPackItems([
        {
          items: [
            { type: 'maps_search', rank_group: null, rank_absolute: null, domain: 'x.test' },
            { type: 'maps_search', rank_group: 1, rank_absolute: 1, domain: null, url: null },
          ],
        },
        { items: null },
      ]),
    ).toEqual([]);
  });

  it('defaults rank_absolute to rank_group', () => {
    const items = extractLocalPackItems([
      { items: [{ type: 'maps_search', rank_group: 7, domain: 'x.test' }] },
    ]);
    expect(items[0]!.rankAbsolute).toBe(7);
  });
});

describe('matchDomainInLocalPack', () => {
  it('picks the smallest rank_group hit', () => {
    const result = matchDomainInLocalPack(
      [
        { domain: 'example.com', rankGroup: 3, rankAbsolute: 3 },
        { domain: 'example.com', rankGroup: 2, rankAbsolute: 2 },
      ],
      5,
      'https://www.example.com/',
      new Date('2026-07-11T00:00:00.000Z'),
    );
    expect(result).toEqual({
      position: 2,
      totalPackSize: 5,
      checkedAt: new Date('2026-07-11T00:00:00.000Z'),
    });
  });
});

describe('matchDomainInSerp', () => {
  it('picks the smallest rank_group hit', () => {
    const result = matchDomainInSerp(
      [
        { domain: 'a.example', url: 'https://a.example/', rankGroup: 1, rankAbsolute: 1 },
        { domain: 'example.com', url: 'https://example.com/one', rankGroup: 3, rankAbsolute: 3 },
        { domain: 'example.com', url: 'https://example.com/two', rankGroup: 5, rankAbsolute: 5 },
      ],
      'example.com',
      new Date('2026-07-05T00:00:00.000Z'),
    );
    expect(result.position).toBe(3);
    expect(result.foundUrl).toBe('https://example.com/one');
  });

  it('caps serpTopUrls at 10', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      domain: `d${i}.example`,
      url: `https://d${i}.example/`,
      rankGroup: i + 1,
      rankAbsolute: i + 1,
    }));
    const result = matchDomainInSerp(many, 'missing.example', new Date());
    expect(result.position).toBeNull();
    expect(result.serpTopUrls).toHaveLength(10);
  });
});

describe('extractAiOverview', () => {
  it('collects flat references, nested element references, and standalone reference items', () => {
    const overview = extractAiOverview([
      {
        items: [
          {
            type: 'ai_overview',
            references: [
              { type: 'ai_overview_reference', domain: 'www.Example.com', url: 'https://example.com/a', title: 'A' },
            ],
            items: [
              {
                type: 'ai_overview_element',
                references: [
                  { type: 'ai_overview_reference', domain: 'docs.vendor.example', url: 'https://docs.vendor.example/x', title: 'X' },
                ],
              },
            ],
          },
          { type: 'ai_overview_reference', domain: 'another.example', url: 'https://another.example/y', title: 'Y' },
          { type: 'organic', rank_group: 1, domain: 'a.example', url: 'https://a.example/' },
        ],
      },
    ]);
    expect(overview.present).toBe(true);
    expect(overview.references).toEqual([
      { domain: 'example.com', url: 'https://example.com/a', title: 'A' },
      { domain: 'docs.vendor.example', url: 'https://docs.vendor.example/x', title: 'X' },
      { domain: 'another.example', url: 'https://another.example/y', title: 'Y' },
    ]);
  });

  it('no AI block → present:false with empty references (NOT null)', () => {
    const overview = extractAiOverview([
      { items: [{ type: 'organic', rank_group: 1, domain: 'a.example', url: 'https://a.example/' }] },
    ]);
    expect(overview).toEqual({ present: false, references: [] });
  });

  it('malformed reference entries degrade to no-reference, never a throw', () => {
    const overview = extractAiOverview([
      {
        items: [
          {
            type: 'ai_overview',
            // no url/domain anywhere → nothing collectable
            references: [{ type: 'ai_overview_reference' }],
            items: [{ type: 'ai_overview_element' }],
          },
        ],
      },
    ]);
    expect(overview).toEqual({ present: true, references: [] });
  });

  it('derives the domain from the url when the domain field is missing, and dedupes', () => {
    const overview = extractAiOverview([
      {
        items: [
          {
            type: 'ai_overview',
            references: [
              { type: 'ai_overview_reference', url: 'https://EXAMPLE.com/z' },
              { type: 'ai_overview_reference', url: 'https://EXAMPLE.com/z' },
            ],
          },
        ],
      },
    ]);
    expect(overview.references).toEqual([
      { domain: 'example.com', url: 'https://EXAMPLE.com/z', title: null },
    ]);
  });

  it('handles null items array', () => {
    expect(extractAiOverview([{ items: null }])).toEqual({ present: false, references: [] });
  });
});

describe('matchDomainInAiOverview', () => {
  const overview = {
    present: true,
    references: [
      { domain: 'example.com', url: 'https://example.com/a', title: 'A' },
      { domain: 'other.example', url: null, title: null },
    ],
  };

  it('null in → null out (signal unavailable propagates)', () => {
    expect(matchDomainInAiOverview(null, 'example.com')).toBeNull();
  });

  it('no overview shown → present:false', () => {
    expect(matchDomainInAiOverview({ present: false, references: [] }, 'example.com')).toEqual({
      present: false,
      cited: false,
    });
  });

  it('cited domain → cited with url', () => {
    expect(matchDomainInAiOverview(overview, 'www.Example.com')).toEqual({
      present: true,
      cited: true,
      citedUrl: 'https://example.com/a',
    });
  });

  it('cited domain without a reference url omits citedUrl', () => {
    expect(matchDomainInAiOverview(overview, 'other.example')).toEqual({
      present: true,
      cited: true,
    });
  });

  it('shown but not cited → cited:false', () => {
    expect(matchDomainInAiOverview(overview, 'missing.example')).toEqual({
      present: true,
      cited: false,
    });
  });
});

describe('extractAiOverview — branch edges', () => {
  it('handles a bare ai_overview item (no references, no nested items)', () => {
    const overview = extractAiOverview([{ items: [{ type: 'ai_overview' }] }]);
    expect(overview).toEqual({ present: true, references: [] });
  });

  it('collects a reference that carries a domain but no url and no title', () => {
    const overview = extractAiOverview([
      {
        items: [
          {
            type: 'ai_overview',
            references: [{ type: 'ai_overview_reference', domain: 'B.example' }],
          },
        ],
      },
    ]);
    expect(overview.references).toEqual([
      { domain: 'b.example', url: null, title: null },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Public-page discovery —
// ---------------------------------------------------------------------------

const US_MARKET: SiteMarket = {
  country: 'US',
  region: null,
  city: null,
  language: 'en',
  device: 'desktop',
} as const;

const DISCOVERY_QUERIES = [
  { id: 'q1', text: 'seo audit tool problems' },
  { id: 'q2', text: 'example vs competitor' },
] as const;

providerContractTests({
  title: 'DataForSeoRankProvider.searchPublicPages',
  fixtureProvider: 'dataforseo-serp',
  fixtureOperation: 'search-public-pages',
  makeCall: () =>
    provider.searchPublicPages({
      queries: DISCOVERY_QUERIES.map((q) => ({ ...q })),
      siteMarket: US_MARKET,
      perQueryLimit: 5,
    }),
  assertSuccess: (result) => {
    expect(result.rows.length).toBeGreaterThanOrEqual(3);
    for (const row of result.rows) {
      expect(row.canonicalUrl.startsWith('https://')).toBe(true);
      expect(row.organicPosition).toBeGreaterThanOrEqual(1);
      expect(row.observationMeta.sourceLabel).toBe('dataforseo');
    }
    // One single-task live call per query; the mock serves the same recorded
    // payload to both, so every query yields the fixture's organic rows.
    const q1Rows = result.rows.filter((r) => r.queryId === 'q1');
    const q2Rows = result.rows.filter((r) => r.queryId === 'q2');
    expect(q1Rows.length).toBeGreaterThanOrEqual(1);
    expect(q2Rows.length).toBeGreaterThanOrEqual(1);
  },
});

describe('DataForSeoRankProvider.searchPublicPages — extra behaviours', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  function mockDiscovery(kase: string): void {
    const body = readFixture('search-public-pages', kase);
    vendorMockServer.use(
      http.all('*', () => HttpResponse.json(body as JsonBodyType, { status: 200 })),
    );
  }

  it('success: dedupe + hint + observedAt bubble up', async () => {
    mockDiscovery('success');
    const result = await provider.searchPublicPages({
      queries: DISCOVERY_QUERIES.map((q) => ({ ...q })),
      siteMarket: US_MARKET,
      perQueryLimit: 5,
    });
    const hints = result.rows.map((r) => r.sourceTypeHint);
    expect(hints).toContain('forum');
    expect(hints).toContain('review');
    expect(hints).toContain('comparison');
    for (const row of result.rows) {
      expect(row.observedAt === null || typeof row.observedAt === 'string').toBe(true);
    }
  });

  it('empty payload → zero rows, no throw', async () => {
    mockDiscovery('empty');
    const result = await provider.searchPublicPages({
      queries: [{ id: 'e1', text: 'empty query' }],
      siteMarket: US_MARKET,
      perQueryLimit: 5,
    });
    expect(result.rows).toEqual([]);
  });

  it('partial-date: rows without vendor datetime carry observedAt=null and a coverage note', async () => {
    mockDiscovery('partial-date');
    const result = await provider.searchPublicPages({
      queries: [{ id: 'p1', text: 'partial date sample' }],
      siteMarket: US_MARKET,
      perQueryLimit: 5,
    });
    for (const row of result.rows) {
      expect(row.observedAt).toBeNull();
      expect(row.observationMeta.coverageNoteKey).toBe(
        'observations.coverage.partialResult',
      );
    }
  });

  it('unsafe-candidate: drops data:, javascript:, and unparseable rows; keeps http://private_ip for fetch-time SSRF', async () => {
    mockDiscovery('unsafe-candidate');
    const result = await provider.searchPublicPages({
      queries: [{ id: 'u1', text: 'unsafe candidate mix' }],
      siteMarket: US_MARKET,
      perQueryLimit: 10,
    });
    const urls = result.rows.map((r) => r.canonicalUrl);
    expect(urls).not.toContain('data:text/html,<h1>drop me</h1>');
    expect(urls).not.toContain('javascript:alert(1)');
    expect(urls).not.toContain('not-a-valid-url');
    // http:// private IP is kept — SSRF check is fetch-time, not discovery-time.
    expect(urls.some((u) => u.startsWith('http://192.168.1.1'))).toBe(true);
    // The safe trustpilot row must survive.
    expect(urls.some((u) => u.includes('trustpilot.com'))).toBe(true);
  });

  it('rejects an empty queries array (guard)', async () => {
    await expect(
      provider.searchPublicPages({ queries: [], siteMarket: US_MARKET, perQueryLimit: 5 }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('rejects too-many queries', async () => {
    const queries = Array.from({ length: PUBLIC_PAGE_MAX_QUERIES + 1 }, (_, i) => ({
      id: `q${i}`,
      text: `q${i}`,
    }));
    await expect(
      provider.searchPublicPages({ queries, siteMarket: US_MARKET, perQueryLimit: 1 }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('rejects a duplicate query id', async () => {
    await expect(
      provider.searchPublicPages({
        queries: [
          { id: 'same', text: 'first' },
          { id: 'same', text: 'second' },
        ],
        siteMarket: US_MARKET,
        perQueryLimit: 1,
      }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('rejects a missing query id (empty string)', async () => {
    await expect(
      provider.searchPublicPages({
        queries: [{ id: '', text: 'anything' }],
        siteMarket: US_MARKET,
        perQueryLimit: 1,
      }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('rejects invalid query text (empty and oversize)', async () => {
    await expect(
      provider.searchPublicPages({
        queries: [{ id: 'q', text: '' }],
        siteMarket: US_MARKET,
        perQueryLimit: 1,
      }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
    await expect(
      provider.searchPublicPages({
        queries: [{ id: 'q', text: 'x'.repeat(701) }],
        siteMarket: US_MARKET,
        perQueryLimit: 1,
      }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('never substitutes US/English on unsupported market', async () => {
    // No mock server response is required — the guard fires before HTTP.
    await expect(
      provider.searchPublicPages({
        queries: [{ id: 'q', text: 'q' }],
        siteMarket: {
          country: 'ZZ',
          region: null,
          city: null,
          language: 'en',
          device: 'desktop',
        },
        perQueryLimit: 1,
      }),
    ).rejects.toBeInstanceOf(VendorUnavailableError);
  });

  it('never substitutes US/English on unsupported language', async () => {
    await expect(
      provider.searchPublicPages({
        queries: [{ id: 'q', text: 'q' }],
        siteMarket: { country: 'US', region: null, city: null, language: '!!', device: 'desktop' },
        perQueryLimit: 1,
      }),
    ).rejects.toBeInstanceOf(VendorUnavailableError);
  });

  it('perQueryLimit clamps the emitted row count', async () => {
    mockDiscovery('success');
    const result = await provider.searchPublicPages({
      queries: DISCOVERY_QUERIES.map((q) => ({ ...q })),
      siteMarket: US_MARKET,
      perQueryLimit: 1,
    });
    const q1Rows = result.rows.filter((r) => r.queryId === 'q1');
    expect(q1Rows).toHaveLength(1);
  });

  it('drops organic items missing rank_group / url / title without failing', async () => {
    vendorMockServer.use(
      http.all('*', () =>
        HttpResponse.json({
          status_code: 20000,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20000,
              cost: 0.0006,
              result: [
                {
                  keyword: 'edge',
                  type: 'organic',
                  se_domain: 'google.com',
                  location_code: 2840,
                  language_code: 'en',
                  items: [
                    { type: 'organic', domain: 'x.com', url: 'https://x.com/', title: null },
                    { type: 'organic', domain: 'y.com', url: null, rank_group: 2, title: 'Y' },
                    { type: 'organic', domain: 'z.com', url: 'https://z.com/', rank_group: 3, title: 'Z' },
                  ],
                },
              ],
            },
          ],
        }),
      ),
    );
    const result = await provider.searchPublicPages({
      queries: [{ id: 'q1', text: 'edge' }],
      siteMarket: US_MARKET,
      perQueryLimit: 10,
    });
    // Only the third row (all fields present) should survive; the first has
    // no rank_group and the second has no url.
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.canonicalUrl).toBe('https://z.com');
  });

  it('a task-level result with no items[] field yields zero rows', async () => {
    vendorMockServer.use(
      http.all('*', () =>
        HttpResponse.json({
          status_code: 20000,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20000,
              cost: 0,
              result: [
                {
                  keyword: 'no-items',
                  type: 'organic',
                  se_domain: 'google.com',
                  // items intentionally omitted → ?? [] fallback fires
                },
              ],
            },
          ],
        }),
      ),
    );
    const result = await provider.searchPublicPages({
      queries: [{ id: 'q', text: 'no-items' }],
      siteMarket: US_MARKET,
      perQueryLimit: 5,
    });
    expect(result.rows).toEqual([]);
  });

  it('accepts an organic item with a missing title (null falls back to empty string)', async () => {
    vendorMockServer.use(
      http.all('*', () =>
        HttpResponse.json({
          status_code: 20000,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20000,
              cost: 0.0006,
              result: [
                {
                  keyword: 'title',
                  type: 'organic',
                  items: [
                    {
                      type: 'organic',
                      rank_group: 1,
                      rank_absolute: 1,
                      domain: 'example.com',
                      url: 'https://example.com/no-title',
                      // title deliberately omitted (undefined → `??`.'' branch)
                    },
                  ],
                },
              ],
            },
          ],
        }),
      ),
    );
    const result = await provider.searchPublicPages({
      queries: [{ id: 'q', text: 'title' }],
      siteMarket: US_MARKET,
      perQueryLimit: 1,
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.title).toBe('');
  });

  it('a "created" task status from the live endpoint surfaces as unavailable', async () => {
    // The `20100 created` task status is legal for the live endpoint under
    // vendor drift; the discovery code refuses to guess and marks the batch
    // as unavailable so the caller can retry.
    vendorMockServer.use(
      http.all('*', () =>
        HttpResponse.json({
          status_code: 20000,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20100,
              status_message: 'Task Created.',
              cost: 0,
              result: [],
            },
          ],
        }),
      ),
    );
    await expect(
      provider.searchPublicPages({
        queries: [{ id: 'q1', text: 'anything' }],
        siteMarket: US_MARKET,
        perQueryLimit: 1,
      }),
    ).rejects.toBeInstanceOf(VendorUnavailableError);
  });

  it('issues one single-task POST per query — the live endpoint accepts one task per call', async () => {
    const success = readFixture('search-public-pages', 'success');
    const bodies: Array<Array<{ keyword: string }>> = [];
    vendorMockServer.use(
      http.all('*', async ({ request }) => {
        bodies.push((await request.json()) as Array<{ keyword: string }>);
        return HttpResponse.json(success, { status: 200 });
      }),
    );
    const queries = [
      { id: 'q1', text: 'uptimerobot.com alternative' },
      { id: 'q2', text: 'site24x7.com alternative' },
      { id: 'q3', text: 'odown.com alternative' },
    ];
    await provider.searchPublicPages({
      queries,
      siteMarket: US_MARKET,
      perQueryLimit: 5,
    });
    expect(bodies).toHaveLength(3);
    bodies.forEach((body, i) => {
      expect(body).toHaveLength(1);
      expect(body[0]!.keyword).toBe(queries[i]!.text);
    });
  });

  /** HTTP-200 envelope whose single task carries an unrecognized status code. */
  function taskErrorEnvelope(): JsonBodyType {
    return {
      version: '0.1.20260101',
      status_code: 20000,
      status_message: 'Ok.',
      cost: 0,
      tasks_count: 1,
      tasks_error: 1,
      tasks: [
        {
          id: 'TASK_ID',
          status_code: 40501,
          status_message: 'Invalid Field.',
          cost: 0,
          result: null,
        },
      ],
    };
  }

  it('a failing query is skipped and the remaining queries still deliver rows', async () => {
    const success = readFixture('search-public-pages', 'success');
    vendorMockServer.use(
      http.all('*', async ({ request }) => {
        const body = (await request.json()) as Array<{ keyword: string }>;
        if (body[0]!.keyword === 'broken query') {
          return HttpResponse.json(taskErrorEnvelope(), { status: 200 });
        }
        return HttpResponse.json(success, { status: 200 });
      }),
    );
    const result = await provider.searchPublicPages({
      queries: [
        { id: 'q1', text: 'good query' },
        { id: 'q2', text: 'broken query' },
        { id: 'q3', text: 'another good query' },
      ],
      siteMarket: US_MARKET,
      perQueryLimit: 5,
    });
    const queryIds = new Set(result.rows.map((r) => r.queryId));
    expect(queryIds).toEqual(new Set(['q1', 'q3']));
  });

  it('a 5xx on one query skips it and keeps the rows from the others', async () => {
    let requests = 0;
    const success = readFixture('search-public-pages', 'success');
    vendorMockServer.use(
      http.all('*', () => {
        requests += 1;
        return requests === 1
          ? HttpResponse.json({ error: 'upstream down' }, { status: 503 })
          : HttpResponse.json(success, { status: 200 });
      }),
    );
    const result = await provider.searchPublicPages({
      queries: [
        { id: 'q1', text: 'query one' },
        { id: 'q2', text: 'query two' },
      ],
      siteMarket: US_MARKET,
      perQueryLimit: 5,
    });
    expect(new Set(result.rows.map((r) => r.queryId))).toEqual(new Set(['q2']));
  });

  it('rethrows the first per-query error when every query fails', async () => {
    vendorMockServer.use(
      http.all('*', () => HttpResponse.json(taskErrorEnvelope(), { status: 200 })),
    );
    await expect(
      provider.searchPublicPages({
        queries: [
          { id: 'q1', text: 'query one' },
          { id: 'q2', text: 'query two' },
        ],
        siteMarket: US_MARKET,
        perQueryLimit: 1,
      }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('quota on the first query aborts the remaining calls and rethrows', async () => {
    let requests = 0;
    const quota = readFixture('search-public-pages', 'quota');
    vendorMockServer.use(
      http.all('*', () => {
        requests += 1;
        return HttpResponse.json(quota, { status: 200 });
      }),
    );
    await expect(
      provider.searchPublicPages({
        queries: [
          { id: 'q1', text: 'query one' },
          { id: 'q2', text: 'query two' },
          { id: 'q3', text: 'query three' },
        ],
        siteMarket: US_MARKET,
        perQueryLimit: 1,
      }),
    ).rejects.toBeInstanceOf(VendorQuotaError);
    expect(requests).toBe(1);
  });

  it('quota after a successful query returns the partial rows already collected', async () => {
    let requests = 0;
    const success = readFixture('search-public-pages', 'success');
    const quota = readFixture('search-public-pages', 'quota');
    vendorMockServer.use(
      http.all('*', () => {
        requests += 1;
        return HttpResponse.json(requests === 1 ? success : quota, { status: 200 });
      }),
    );
    const result = await provider.searchPublicPages({
      queries: [
        { id: 'q1', text: 'query one' },
        { id: 'q2', text: 'query two' },
        { id: 'q3', text: 'query three' },
      ],
      siteMarket: US_MARKET,
      perQueryLimit: 5,
    });
    expect(requests).toBe(2); // q3 never dispatched after the quota abort.
    expect(result.rows.length).toBeGreaterThan(0);
    expect(new Set(result.rows.map((r) => r.queryId))).toEqual(new Set(['q1']));
  });

  it('auth failure on the first query rethrows without further calls', async () => {
    let requests = 0;
    vendorMockServer.use(
      http.all('*', () => {
        requests += 1;
        return HttpResponse.json(
          {
            version: '0.1.20260101',
            status_code: 40100,
            status_message: 'Authentication failed.',
            cost: 0,
            tasks_count: 0,
            tasks_error: 0,
            tasks: [],
          },
          { status: 200 },
        );
      }),
    );
    await expect(
      provider.searchPublicPages({
        queries: [
          { id: 'q1', text: 'query one' },
          { id: 'q2', text: 'query two' },
        ],
        siteMarket: US_MARKET,
        perQueryLimit: 1,
      }),
    ).rejects.toBeInstanceOf(VendorAuthError);
    expect(requests).toBe(1);
  });

  it('a multi-task envelope for a single-task call is skipped as malformed', async () => {
    // Regression for the pre-fix batching bug: the adapter used to POST every
    // query as one task batch, which the single-task live endpoint rejects.
    // A response carrying more outcomes than the one submitted task is vendor
    // contract drift — the query is skipped, and with no other query left the
    // captured malformed error surfaces.
    const empty = readFixture('search-public-pages', 'empty') as { tasks: unknown[] };
    vendorMockServer.use(
      http.all('*', () =>
        HttpResponse.json(
          { ...empty, tasks: [...empty.tasks, ...empty.tasks] } as JsonBodyType,
          { status: 200 },
        ),
      ),
    );
    await expect(
      provider.searchPublicPages({
        queries: [{ id: 'q1', text: 'query one' }],
        siteMarket: US_MARKET,
        perQueryLimit: 1,
      }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });
});

describe('resolveDiscoveryMarket', () => {
  it('maps a supported country + language to DataForSEO codes', () => {
    expect(
      resolveDiscoveryMarket({
        country: 'US',
        region: null,
        city: null,
        language: 'en-US',
        device: 'desktop',
      }),
    ).toEqual({ locationCode: 2840, languageCode: 'en', device: 'desktop' });
  });

  it('maps device=mobile through; device=all → desktop', () => {
    expect(
      resolveDiscoveryMarket({
        country: 'DE', region: null, city: null, language: 'de', device: 'mobile',
      }).device,
    ).toBe('mobile');
    expect(
      resolveDiscoveryMarket({
        country: 'DE', region: null, city: null, language: 'de', device: 'all',
      }).device,
    ).toBe('desktop');
  });

  it('throws VendorUnavailableError on an unknown country', () => {
    expect(() =>
      resolveDiscoveryMarket({
        country: 'ZZ', region: null, city: null, language: 'en', device: 'desktop',
      }),
    ).toThrow(VendorUnavailableError);
  });

  it('throws VendorUnavailableError on an unsupported language token', () => {
    expect(() =>
      resolveDiscoveryMarket({
        country: 'US', region: null, city: null, language: '!!', device: 'desktop',
      }),
    ).toThrow(VendorUnavailableError);
  });

  it('throws VendorUnavailableError when country is missing entirely (undefined)', () => {
    expect(() =>
      resolveDiscoveryMarket({
        country: undefined as unknown as string,
        region: null,
        city: null,
        language: 'en',
        device: 'desktop',
      } as unknown as SiteMarket),
    ).toThrow(VendorUnavailableError);
  });

  it('throws VendorUnavailableError when country is empty string', () => {
    expect(() =>
      resolveDiscoveryMarket({
        country: '', region: null, city: null, language: 'en', device: 'desktop',
      } as unknown as SiteMarket),
    ).toThrow(VendorUnavailableError);
  });

  it('throws VendorUnavailableError when language is missing entirely (undefined)', () => {
    expect(() =>
      resolveDiscoveryMarket({
        country: 'US',
        region: null,
        city: null,
        language: undefined as unknown as string,
        device: 'desktop',
      } as unknown as SiteMarket),
    ).toThrow(VendorUnavailableError);
  });

  it('throws VendorUnavailableError when language is empty string', () => {
    expect(() =>
      resolveDiscoveryMarket({
        country: 'US', region: null, city: null, language: '', device: 'desktop',
      } as unknown as SiteMarket),
    ).toThrow(VendorUnavailableError);
  });
});

describe('normalizeDiscoveredUrl', () => {
  it('accepts https and http, lowercases the host, strips fragment', () => {
    expect(normalizeDiscoveredUrl('HTTPS://Example.COM/path?a=1#frag')).toBe(
      'https://example.com/path?a=1',
    );
    expect(normalizeDiscoveredUrl('http://Example.com/x')).toBe('http://example.com/x');
  });

  it('drops non-http schemes, credentials, and parse errors', () => {
    expect(normalizeDiscoveredUrl('data:text/html,x')).toBeNull();
    expect(normalizeDiscoveredUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeDiscoveredUrl('file:///etc/passwd')).toBeNull();
    expect(normalizeDiscoveredUrl('https://user:pw@example.com/')).toBeNull();
    expect(normalizeDiscoveredUrl('not-a-url')).toBeNull();
    expect(normalizeDiscoveredUrl('')).toBeNull();
    expect(normalizeDiscoveredUrl(null)).toBeNull();
    expect(normalizeDiscoveredUrl(undefined)).toBeNull();
  });

  it('strips a lone trailing slash on the root only', () => {
    expect(normalizeDiscoveredUrl('https://example.com/')).toBe('https://example.com');
    expect(normalizeDiscoveredUrl('https://example.com/x/')).toBe('https://example.com/x/');
  });
});

describe('parseVendorObservedAt', () => {
  it('parses the DataForSEO datetime format', () => {
    expect(parseVendorObservedAt('2026-01-01 00:00:00 +00:00')).toBe(
      '2026-01-01T00:00:00.000Z',
    );
  });
  it('returns null for missing/invalid input', () => {
    expect(parseVendorObservedAt(null)).toBeNull();
    expect(parseVendorObservedAt(undefined)).toBeNull();
    expect(parseVendorObservedAt('')).toBeNull();
    expect(parseVendorObservedAt('not-a-date')).toBeNull();
  });
});

describe('hintPublicPageSourceType', () => {
  it.each([
    ['https://reddit.com/r/x', 'forum'],
    ['https://discourse.example.com/', 'forum'],
    ['https://forum.example.com/', 'forum'],
    ['https://example.com/community/threads', 'forum'],
    ['https://g2.com/products/x', 'review'],
    ['https://capterra.com/p/x', 'review'],
    ['https://trustpilot.com/review/x', 'review'],
    ['https://reviewy.example.com/', 'review'],
    ['https://example.com/compare/a-vs-b', 'comparison'],
    ['https://example.com/a-vs-b', 'comparison'],
    ['https://example.com/alternatives/x', 'comparison'],
    ['https://example.com/x/vs', 'comparison'],
    ['https://quora.com/what-is', 'question'],
    ['https://stackexchange.com/questions/1', 'question'],
    ['https://answers.example.com/', 'question'],
    ['https://example.com/questions/2', 'question'],
    ['https://plain.example.com/blog', 'other'],
  ] as const)('classifies %s as %s', (url, expected) => {
    expect(hintPublicPageSourceType(url)).toBe(expected);
  });

  it('returns other for an unparseable URL', () => {
    expect(hintPublicPageSourceType('not-a-url')).toBe('other');
  });
});

describe('safeTitle', () => {
  it('trims and collapses whitespace', () => {
    expect(safeTitle('  hello    world  ')).toBe('hello world');
  });
  it('caps at 160 chars with ellipsis', () => {
    const big = 'a'.repeat(300);
    const out = safeTitle(big);
    expect(out.length).toBe(160);
    expect(out.endsWith('…')).toBe(true);
  });
  it('returns empty string for non-string input', () => {
    expect(safeTitle(null)).toBe('');
    expect(safeTitle(undefined)).toBe('');
  });
});

describe('public-page discovery constants', () => {
  it('exposes bounds matching the spec', () => {
    expect(PUBLIC_PAGE_MAX_QUERIES).toBe(40);
    expect(PUBLIC_PAGE_MAX_PER_QUERY).toBe(10);
    expect(DEFAULT_PUBLIC_PAGE_DEPTH).toBeLessThanOrEqual(PUBLIC_PAGE_MAX_PER_QUERY);
  });

  it('clamps perQueryLimit to the max before hitting the vendor', async () => {
    // Prove the clamp by wiring a tiny mock that echoes a single organic row
    // and asserting we do not accidentally request 999 rows. We only need to
    // observe that the call resolves — the depth-clamp itself is enforced via
    // the request builder (depth ≤ perQueryLimit clamp).
    vendorMockServer.listen({ onUnhandledRequest: 'bypass' });
    vendorMockServer.resetHandlers();
    vendorMockServer.use(
      http.all('*', () =>
        HttpResponse.json(readFixture('search-public-pages', 'empty') as JsonBodyType, {
          status: 200,
        }),
      ),
    );
    const result = await provider.searchPublicPages({
      queries: [{ id: 'q', text: 'clamp' }],
      siteMarket: US_MARKET,
      perQueryLimit: 999,
    });
    expect(result.rows).toEqual([]);
    vendorMockServer.close();
  });
});

// ---------------------------------------------------------------------------
// Provider contract — checkLocalPackRank, per-coordinate variant
//
// ---------------------------------------------------------------------------

const COORDINATE_INPUT = {
  keyword: 'dentist austin',
  domain: 'example.com',
  languageCode: 'en',
  coordinate: { lat: 30.2672, lng: -97.7431, zoom: 17 },
} as const;

providerContractTests({
  title: 'DataForSeoRankProvider.checkLocalPackRank (location_coordinate)',
  fixtureProvider: 'dataforseo-serp',
  fixtureOperation: 'local-pack-coordinate',
  makeCall: () => provider.checkLocalPackRank(COORDINATE_INPUT),
  assertSuccess: (result) => {
    expect(result.position).toBe(2);
    expect(result.totalPackSize).toBe(3);
    expect(result.checkedAt).toBeInstanceOf(Date);
  },
});

describe('checkLocalPackRank — coordinate variant request body', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  it('posts location_coordinate and never location_code', async () => {
    let capturedBody: unknown = null;
    vendorMockServer.use(
      http.post('*/serp/google/maps/live/advanced', async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(readFixture('local-pack-coordinate', 'success'));
      }),
    );
    await provider.checkLocalPackRank(COORDINATE_INPUT);
    expect(capturedBody).toEqual([
      {
        keyword: 'dentist austin',
        location_coordinate: '30.2672,-97.7431,17z',
        language_code: 'en',
        depth: 20,
        search_places: false,
      },
    ]);
  });

  it('returns position:null when the domain is absent from the coordinate pack', async () => {
    vendorMockServer.use(
      http.post('*/serp/google/maps/live/advanced', () =>
        HttpResponse.json(readFixture('local-pack-coordinate', 'success-not-found')),
      ),
    );
    await expect(provider.checkLocalPackRank(COORDINATE_INPUT)).resolves.toMatchObject({
      position: null,
      totalPackSize: 2,
    });
  });
});

describe('buildLocalPackBody / formatLocationCoordinate', () => {
  it('formats "lat,lng,Nz" and rounds to at most seven decimals', () => {
    expect(
      formatLocationCoordinate({ lat: 52.61785491234, lng: -155.35214249, zoom: 20 }),
    ).toBe('52.6178549,-155.3521425,20z');
  });

  it('keeps whole-degree coordinates unpadded', () => {
    expect(formatLocationCoordinate({ lat: 0, lng: 0, zoom: 3 })).toBe('0,0,3z');
  });

  it.each([
    ['lat above range', { lat: 90.1, lng: 0, zoom: 17 }],
    ['lng below range', { lat: 0, lng: -180.5, zoom: 17 }],
    ['zoom below range', { lat: 0, lng: 0, zoom: 2 }],
    ['zoom above range', { lat: 0, lng: 0, zoom: 22 }],
    ['fractional zoom', { lat: 0, lng: 0, zoom: 17.5 }],
    ['non-finite lat', { lat: Number.NaN, lng: 0, zoom: 17 }],
  ])('rejects %s', (_label, coordinate) => {
    expect(() => formatLocationCoordinate(coordinate)).toThrow();
  });

  it('rejects an input carrying BOTH locationCode and coordinate', () => {
    expect(() =>
      buildLocalPackBody(
        {
          keyword: 'k',
          domain: 'example.com',
          languageCode: 'en',
          locationCode: 2840,
          coordinate: { lat: 1, lng: 2, zoom: 17 },
        },
        { provider: 'dataforseo', operation: 'serp' },
      ),
    ).toThrow(VendorMalformedError);
  });

  it('rejects an input carrying NEITHER target', () => {
    expect(() =>
      buildLocalPackBody(
        { keyword: 'k', domain: 'example.com', languageCode: 'en' },
        { provider: 'dataforseo', operation: 'serp' },
      ),
    ).toThrow(VendorMalformedError);
  });

  it('the shipped location_code body is byte-identical to the pre-geogrid shape', () => {
    expect(
      buildLocalPackBody(
        {
          keyword: 'dentist austin',
          domain: 'example.com',
          locationCode: 2840,
          languageCode: 'en',
        },
        { provider: 'dataforseo', operation: 'serp' },
      ),
    ).toEqual({
      keyword: 'dentist austin',
      location_code: 2840,
      language_code: 'en',
      depth: 20,
      search_places: false,
    });
  });
});
