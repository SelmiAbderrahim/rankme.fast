/**
 * Deep crawl extra reads.
 *
 * 1. providerContractTests for each new operation (success / timeout /
 *    malformed / quota from recorded fixtures).
 * 2. The recorded sandbox shapes parse.
 * 3. Orchestration: bounds, budget, per-signal degradation, the
 *    resource scan, and log hygiene.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import type { Logger } from 'pino';
import { providerContractTests } from '../../testing/fixtures/contract.js';
import { mockVendor, vendorMockServer } from '../../testing/fixtures/mock-vendor.js';
import { MAX_AUDIT_RESOURCES, type AuditPage } from '../types.js';
import {
  DEFAULT_EXTRA_READS_BUDGET_MS,
  MAX_PER_URL_READS,
  MAX_RESOURCE_PAGE_LOOKUPS,
  fetchDuplicateTagGroups,
  fetchRedirectChains,
  fetchResources,
  readDuplicateContent,
  readExtraSignals,
  readPagesByResource,
  readWaterfall,
  type ExtraReadsConfig,
} from './onpage-extras.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'testing', 'fixtures', 'dataforseo-onpage');
const fixture = (operation: string, kase: string): JsonBodyType =>
  JSON.parse(readFileSync(join(FIXTURES, operation, `${kase}.json`), 'utf8')) as JsonBodyType;

const cfg: ExtraReadsConfig = {
  login: 'sandbox-login',
  password: 'sandbox-password',
  baseUrl: 'https://dataforseo.mock/v3',
  timeoutMs: 60,
  maxRetries: 0,
  backoffBaseMs: 1,
  random: () => 0,
};

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

providerContractTests({
  title: 'DataForSeoOnPage.duplicateTags',
  fixtureProvider: 'dataforseo-onpage',
  fixtureOperation: 'duplicate-tags',
  makeCall: () => fetchDuplicateTagGroups(cfg, 'TASK_ID', 1000),
  assertSuccess: (groups) => {
    expect(groups).toContainEqual({
      kind: 'title',
      urls: ['https://example.com/blog/a?id=7', 'https://example.com/blog/b'],
    });
  },
});

providerContractTests({
  title: 'DataForSeoOnPage.redirectChains',
  fixtureProvider: 'dataforseo-onpage',
  fixtureOperation: 'redirect-chains',
  makeCall: () => fetchRedirectChains(cfg, 'TASK_ID', 1000),
  assertSuccess: (chains) => {
    expect(chains).toEqual([
      {
        from: 'https://example.com/old',
        hops: [
          { url: 'https://example.com/older', status: 301 },
          { url: 'https://example.com/new', status: 200 },
        ],
        isLoop: false,
      },
      {
        from: 'https://example.com/loop-a',
        hops: [
          { url: 'https://example.com/loop-b', status: 302 },
          { url: 'https://example.com/loop-a', status: 302 },
        ],
        isLoop: true,
      },
    ]);
  },
});

providerContractTests({
  title: 'DataForSeoOnPage.duplicateContent',
  fixtureProvider: 'dataforseo-onpage',
  fixtureOperation: 'duplicate-content',
  makeCall: () => readDuplicateContent(cfg, 'TASK_ID', 'https://example.com/blog/a?id=7'),
  assertSuccess: (matches) => {
    expect(matches).toEqual([{ url: 'https://example.com/blog/b', similarity: 8 }]);
  },
});

providerContractTests({
  title: 'DataForSeoOnPage.waterfall',
  fixtureProvider: 'dataforseo-onpage',
  fixtureOperation: 'waterfall',
  makeCall: () => readWaterfall(cfg, 'TASK_ID', 'https://example.com/blog/a?id=7'),
  assertSuccess: (ms) => {
    expect(ms).toBe(2400);
  },
});

providerContractTests({
  title: 'DataForSeoOnPage.resources',
  fixtureProvider: 'dataforseo-onpage',
  fixtureOperation: 'resources',
  makeCall: () => fetchResources(cfg, 'TASK_ID', 1000),
  assertSuccess: ({ resources }) => {
    expect(resources.map((resource) => [resource.url, resource.type, resource.isBroken])).toEqual([
      ['https://example.com/img/missing.png', 'image', true],
      ['https://example.com/js/app.js', 'script', false],
      ['https://example.com/img/hero.jpg', 'image', false],
      ['https://example.com/css/site.css', 'stylesheet', false],
    ]);
  },
});

providerContractTests({
  title: 'DataForSeoOnPage.pagesByResource',
  fixtureProvider: 'dataforseo-onpage',
  fixtureOperation: 'pages-by-resource',
  makeCall: () => readPagesByResource(cfg, 'TASK_ID', 'https://example.com/img/missing.png'),
  assertSuccess: (found) => {
    expect(found).toEqual({ urls: ['https://example.com/', 'https://example.com/new'], count: 2 });
  },
});

// ---------------------------------------------------------------------------
// Recorded sandbox shapes + operation-specific cases
// ---------------------------------------------------------------------------

describe('deep crawl reads — recorded shapes and edge cases', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  it.each([
    ['duplicate-tags', () => fetchDuplicateTagGroups(cfg, 'TASK_ID', 1000)],
    ['redirect-chains', () => fetchRedirectChains(cfg, 'TASK_ID', 1000)],
    ['duplicate-content', () => readDuplicateContent(cfg, 'TASK_ID', 'https://example.com/')],
    ['waterfall', () => readWaterfall(cfg, 'TASK_ID', 'https://example.com/')],
    ['resources', () => fetchResources(cfg, 'TASK_ID', 1000)],
    ['pages-by-resource', () => readPagesByResource(cfg, 'TASK_ID', 'https://example.com/a.js')],
  ] as const)('%s: the recorded sandbox response parses', async (operation, call) => {
    mockVendor('dataforseo-onpage', operation, 'sandbox-shape');
    await expect(call()).resolves.toBeDefined();
  });

  it.each([
    ['duplicate-tags', () => fetchDuplicateTagGroups(cfg, 'TASK_ID', 1000), []],
    ['redirect-chains', () => fetchRedirectChains(cfg, 'TASK_ID', 1000), []],
    ['duplicate-content', () => readDuplicateContent(cfg, 'TASK_ID', 'https://example.com/'), []],
    ['waterfall', () => readWaterfall(cfg, 'TASK_ID', 'https://example.com/'), null],
    ['pages-by-resource', () => readPagesByResource(cfg, 'TASK_ID', 'https://example.com/a.js'), { urls: [], count: 0 }],
  ] as const)('%s: an empty answer is an empty result', async (operation, call, expected) => {
    mockVendor('dataforseo-onpage', operation, 'empty');
    await expect(call()).resolves.toEqual(expected);
  });

  it('a non-ok task is malformed, not an empty answer', async () => {
    vendorMockServer.use(
      http.post('*/on_page/duplicate_tags', () => HttpResponse.json({ status_code: 20000, tasks: [] })),
    );
    await expect(fetchDuplicateTagGroups(cfg, 'TASK_ID', 1000)).rejects.toThrow(/duplicate_tags not ok/u);
  });

  it('duplicate tags: pages one group across requests and drops single-page values', async () => {
    const offsets: number[] = [];
    vendorMockServer.use(
      http.post('*/on_page/duplicate_tags', async ({ request }) => {
        const [task] = (await request.json()) as [{ type: string; offset: number }];
        if (task.type === 'duplicate_description') return HttpResponse.json(fixture('duplicate-tags', 'empty'));
        offsets.push(task.offset);
        const rows = [
          [{ accumulator: 'Same', pages: [{ url: 'https://example.com/a' }] }, { accumulator: null, pages: [{ url: 'https://example.com/x' }] }],
          [{ accumulator: 'Same', pages: [{ url: 'https://example.com/b' }] }, { accumulator: 'Alone', pages: null }],
        ][offsets.length - 1] ?? [];
        return HttpResponse.json({
          status_code: 20000,
          tasks: [{ id: 'TASK_ID', status_code: 20000, result: [{ total_pages_count: 3, items: rows }] }],
        });
      }),
    );
    const groups = await fetchDuplicateTagGroups(cfg, 'TASK_ID', 2);
    expect(groups).toEqual([{ kind: 'title', urls: ['https://example.com/a', 'https://example.com/b'] }]);
    expect(offsets).toEqual([0, 2]);
  });

  it('redirect chains: skips empty chains, defaults a missing loop flag and hop status', async () => {
    vendorMockServer.use(
      http.post('*/on_page/redirect_chains', () =>
        HttpResponse.json({
          status_code: 20000,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20000,
              result: [
                {
                  total_items_count: 2,
                  items: [
                    { is_redirect_loop: null, chain: null },
                    { chain: [{ link_from: 'https://example.com/a', link_to: 'https://example.com/b' }] },
                  ],
                },
              ],
            },
          ],
        }),
      ),
    );
    await expect(fetchRedirectChains(cfg, 'TASK_ID', 1000)).resolves.toEqual([
      { from: 'https://example.com/a', hops: [{ url: 'https://example.com/b', status: 0 }], isLoop: false },
    ]);
  });

  it('duplicate content: defaults a missing similarity and tolerates empty match lists', async () => {
    vendorMockServer.use(
      http.post('*/on_page/duplicate_content', () =>
        HttpResponse.json({
          status_code: 20000,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20000,
              result: [{ items: [{ url: 'https://example.com/a', pages: [{ page: [{ url: 'https://example.com/b' }] }, { similarity: 9, page: null }] }, { url: null, pages: null }] }],
            },
          ],
        }),
      ),
    );
    await expect(readDuplicateContent(cfg, 'TASK_ID', 'https://example.com/a')).resolves.toEqual([
      { url: 'https://example.com/b', similarity: 0 },
    ]);
  });

  it('waterfall: an untimed first byte is null, a fractional one is rounded', async () => {
    let waiting: number | null = 0;
    vendorMockServer.use(
      http.post('*/on_page/waterfall', () =>
        HttpResponse.json({
          status_code: 20000,
          tasks: [{ id: 'TASK_ID', status_code: 20000, result: [{ items: [{ waiting_time: waiting }] }] }],
        }),
      ),
    );
    await expect(readWaterfall(cfg, 'TASK_ID', 'https://example.com/')).resolves.toBeNull();
    waiting = 1499.6;
    await expect(readWaterfall(cfg, 'TASK_ID', 'https://example.com/')).resolves.toBe(1500);
  });

  it('pages by resource: keeps ten pages and the full count', async () => {
    vendorMockServer.use(
      http.post('*/on_page/pages_by_resource', async ({ request }) => {
        const [task] = (await request.json()) as [{ limit: number }];
        expect(task.limit).toBe(10);
        const urls = Array.from({ length: 12 }, (_, i) => ({ url: `https://example.com/p${i}` }));
        return HttpResponse.json({
          status_code: 20000,
          tasks: [{ id: 'TASK_ID', status_code: 20000, result: [{ total_items_count: null, items: urls }] }],
        });
      }),
    );
    const found = await readPagesByResource(cfg, 'TASK_ID', 'https://example.com/a.js');
    expect(found.urls).toHaveLength(10);
    expect(found.count).toBe(10);
  });

  describe('resources', () => {
    const resourcesEnvelope = (items: unknown[], total?: number | null) =>
      HttpResponse.json({
        status_code: 20000,
        tasks: [{ id: 'TASK_ID', status_code: 20000, result: [{ total_items_count: total, items }] }],
      });

    it('trusts successful HTTP responses over stale broken flags (issue #54)', async () => {
      vendorMockServer.use(http.post('*/on_page/resources', () => resourcesEnvelope([
        { url: 'https://example.com/app.js', resource_type: 'broken', accept_type: 'script', status_code: 200, checks: { is_broken: true } },
        { url: 'https://example.com/app.css', resource_type: 'stylesheet', status_code: 200, checks: { is_broken: true } },
        { url: 'https://example.com/missing.png', resource_type: 'image', status_code: 404, checks: { is_broken: false } },
        { url: 'https://example.com/down.js', resource_type: 'script', status_code: 0 },
      ], 4)));
      const { resources } = await fetchResources(cfg, 'TASK_ID', 1000);
      expect(resources.map(({ url, isBroken }) => ({ url, isBroken }))).toEqual([
        { url: 'https://example.com/app.js', isBroken: false },
        { url: 'https://example.com/app.css', isBroken: false },
        { url: 'https://example.com/missing.png', isBroken: true },
        { url: 'https://example.com/down.js', isBroken: true },
      ]);
    });

    it('asks for broken resources first, then fills the bound with the largest ones', async () => {
      const bodies: Record<string, unknown>[] = [];
      vendorMockServer.use(
        http.post('*/on_page/resources', async ({ request }) => {
          const [task] = (await request.json()) as [Record<string, unknown>];
          bodies.push(task);
          if (task.order_by) {
            return resourcesEnvelope(
              [
                { url: 'https://example.com/broken.png', resource_type: 'broken', status_code: 404 },
                { url: 'https://example.com/font.woff', resource_type: 'font', accept_type: 'font', status_code: 200, size: 10 },
                { url: 'https://example.com/big.js', resource_type: 'broken', accept_type: 'script', status_code: 0 },
              ],
              2_000,
            );
          }
          return resourcesEnvelope([{ url: 'https://example.com/broken.png', resource_type: 'broken', status_code: 404, size: -1 }], 1);
        }),
      );
      const { resources, total } = await fetchResources(cfg, 'TASK_ID', 1000);
      expect(bodies[0]).toMatchObject({ offset: 0, filters: expect.arrayContaining(['or']) });
      expect(bodies[1]).toMatchObject({ order_by: ['size,desc'], limit: MAX_AUDIT_RESOURCES - 1 });
      expect(total).toBe(2_000);
      expect(resources).toEqual([
        { url: 'https://example.com/broken.png', type: 'other', statusCode: 404, isBroken: true, usedOn: [] },
        { url: 'https://example.com/font.woff', type: 'other', statusCode: 200, isBroken: false, sizeBytes: 10, usedOn: [] },
        { url: 'https://example.com/big.js', type: 'script', statusCode: null, isBroken: true, usedOn: [] },
      ]);
    });

    it('skips the largest read when broken resources already fill the bound', async () => {
      let largestReads = 0;
      vendorMockServer.use(
        http.post('*/on_page/resources', async ({ request }) => {
          const [task] = (await request.json()) as [{ order_by?: unknown; offset: number }];
          if (task.order_by) largestReads += 1;
          const items = Array.from({ length: 1000 }, (_, i) => ({
            url: `https://example.com/broken-${task.offset + i}.png`,
            resource_type: 'broken',
            status_code: 404,
          }));
          return resourcesEnvelope(items, 5_000);
        }),
      );
      const { resources, total } = await fetchResources(cfg, 'TASK_ID', 1000);
      expect(resources).toHaveLength(MAX_AUDIT_RESOURCES);
      expect(largestReads).toBe(0);
      expect(total).toBeUndefined();
    });

    it('stops filling at the bound when the largest read overshoots it', async () => {
      vendorMockServer.use(
        http.post('*/on_page/resources', async ({ request }) => {
          const [task] = (await request.json()) as [{ order_by?: unknown }];
          if (!task.order_by) return resourcesEnvelope([], 0);
          const items = Array.from({ length: MAX_AUDIT_RESOURCES + 5 }, (_, i) => ({
            url: `https://example.com/img-${i}.jpg`,
            resource_type: 'image',
            status_code: 200,
            cache_control: { cachable: false },
          }));
          return resourcesEnvelope(items, null);
        }),
      );
      const { resources, total } = await fetchResources(cfg, 'TASK_ID', 1000);
      expect(resources).toHaveLength(MAX_AUDIT_RESOURCES);
      expect(resources[0]).toMatchObject({ type: 'image', cacheable: false, isBroken: false });
      expect(total).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

function page(url: string, overrides: Partial<AuditPage> = {}): AuditPage {
  return {
    url,
    statusCode: 200,
    title: 'Title',
    metaDescription: 'Description',
    h1: ['Heading'],
    h2: [],
    canonical: url,
    hasStructuredData: true,
    structuredDataErrors: [],
    isIndexable: true,
    brokenLinks: [],
    onPageScore: 90,
    ...overrides,
  };
}

function fakeLogger(warn: ReturnType<typeof vi.fn>): Logger {
  const noop = () => undefined;
  return { warn, info: noop, debug: noop, error: noop } as unknown as Logger;
}

function wireAll(overrides: Partial<Record<string, () => Response | Promise<Response>>> = {}) {
  const calls: Record<string, number> = {};
  const route = (endpoint: string, operation: string) =>
    http.post(`*/on_page/${endpoint}`, () => {
      calls[endpoint] = (calls[endpoint] ?? 0) + 1;
      const override = overrides[endpoint];
      return override ? override() : HttpResponse.json(fixture(operation, 'success'));
    });
  vendorMockServer.use(
    route('duplicate_tags', 'duplicate-tags'),
    route('redirect_chains', 'redirect-chains'),
    route('duplicate_content', 'duplicate-content'),
    route('waterfall', 'waterfall'),
    route('resources', 'resources'),
    route('pages_by_resource', 'pages-by-resource'),
  );
  return calls;
}

const quota = () => HttpResponse.json(fixture('duplicate-tags', 'quota'));

describe('readExtraSignals', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  const flaggedPages = () => [
    page('https://example.com/blog/a?id=7', { checks: { duplicateContent: true, slowServerResponse: true } }),
    page('https://example.com/blog/b', { checks: { duplicateContent: true, slowLoad: true } }),
    page('https://example.com/hidden', { isIndexable: false, checks: { duplicateContent: true } }),
    page('https://example.com/gone', { statusCode: 404, checks: { slowLoad: true } }),
    page('https://example.com/', { checks: {} }),
  ];

  it('without the resource scan: free reads only, evidence folded into the result and pages', async () => {
    const calls = wireAll();
    const pages = flaggedPages();
    const out = await readExtraSignals(cfg, 'TASK_ID', pages, { pagesPerRequest: 1000, resourceScan: false });
    expect(calls).toEqual({ duplicate_tags: 2, redirect_chains: 1, duplicate_content: 2, waterfall: 2 });
    expect(out.duplicateGroups).toEqual(
      expect.arrayContaining([
        { kind: 'title', urls: ['https://example.com/blog/a?id=7', 'https://example.com/blog/b'] },
        { kind: 'content', urls: ['https://example.com/blog/a?id=7', 'https://example.com/blog/b'], similarity: 8 },
      ]),
    );
    expect(out.redirectChains).toHaveLength(2);
    expect(out.resources).toBeUndefined();
    expect(out.unavailableSignals).toBeUndefined();
    expect(out.unverified).toBeUndefined();
    expect(pages[0]!.serverResponseMs).toBe(2400);
    expect(pages[1]!.serverResponseMs).toBe(2400);
  });

  it('with the resource scan: reads resources and where the broken and image ones are used', async () => {
    const calls = wireAll();
    const out = await readExtraSignals(cfg, 'TASK_ID', [page('https://example.com/')], {
      pagesPerRequest: 1000,
      resourceScan: true,
    });
    expect(calls.resources).toBe(2);
    // Broken image + two images; the script and stylesheet are not looked up.
    expect(calls.pages_by_resource).toBe(2);
    expect(out.resources?.find((r) => r.url === 'https://example.com/img/missing.png')).toMatchObject({
      usedOn: ['https://example.com/', 'https://example.com/new'],
      usedOnCount: 2,
    });
    expect(out.resources?.find((r) => r.url === 'https://example.com/js/app.js')?.usedOn).toEqual([]);
    expect(out.resourceTotal).toBeUndefined();
  });

  it('records the vendor total when more resources exist than were kept', async () => {
    wireAll({
      resources: () =>
        HttpResponse.json({
          status_code: 20000,
          tasks: [{ id: 'TASK_ID', status_code: 20000, result: [{ total_items_count: 9_000, items: [{ url: 'https://example.com/x.png', resource_type: 'image', status_code: 200 }] }] }],
        }),
    });
    const out = await readExtraSignals(cfg, 'TASK_ID', [], { pagesPerRequest: 1000, resourceScan: true });
    expect(out.resourceTotal).toBe(9_000);
  });

  it('each signal fails alone: the others still answer, and only the class name is logged', async () => {
    wireAll({ duplicate_tags: quota, redirect_chains: quota, resources: quota });
    const warn = vi.fn();
    const out = await readExtraSignals({ ...cfg, logger: fakeLogger(warn) }, 'TASK_ID', flaggedPages(), {
      pagesPerRequest: 1000,
      resourceScan: true,
    });
    expect(out.unavailableSignals).toEqual([
      { signal: 'duplicate-tags', cause: 'vendor-error' },
      { signal: 'redirect-chains', cause: 'vendor-error' },
      { signal: 'resources', cause: 'vendor-error' },
    ]);
    // Content groups from the per-URL read survive a failed tag read.
    expect(out.duplicateGroups).toEqual([
      { kind: 'content', urls: ['https://example.com/blog/a?id=7', 'https://example.com/blog/b'], similarity: 8 },
    ]);
    expect(out.redirectChains).toBeUndefined();
    expect(out.resources).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(3);
    expect(warn.mock.calls[0]![0]).toEqual({
      provider: 'dataforseo',
      operation: 'on-page-duplicate-tags',
      vendorTaskId: 'TASK_ID',
      cause: 'vendor-error',
      error: 'VendorQuotaError',
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain(cfg.password);
  });

  it('a failed per-URL read keeps what it read and counts the rest as unverified', async () => {
    let reads = 0;
    wireAll({
      duplicate_content: () => {
        reads += 1;
        return reads === 1 ? HttpResponse.json(fixture('duplicate-content', 'success')) : quota();
      },
      waterfall: quota,
    });
    const warn = vi.fn();
    const out = await readExtraSignals({ ...cfg, logger: fakeLogger(warn) }, 'TASK_ID', flaggedPages(), {
      pagesPerRequest: 1000,
      resourceScan: false,
    });
    expect(out.unverified).toEqual({ duplicateContent: 1, slowPages: 2 });
    expect(out.unavailableSignals).toEqual([
      { signal: 'duplicate-content', cause: 'vendor-error' },
      { signal: 'waterfall', cause: 'vendor-error' },
    ]);
    // A per-URL stop carries no error object.
    expect(warn.mock.calls[0]![0]).not.toHaveProperty('error');
  });

  it('bounds each per-URL read to fifty flagged pages', async () => {
    const calls = wireAll({ duplicate_content: () => HttpResponse.json(fixture('duplicate-content', 'empty')) });
    const pages = Array.from({ length: MAX_PER_URL_READS + 7 }, (_, i) =>
      page(`https://example.com/p${i}`, { checks: { duplicateContent: true } }),
    );
    const out = await readExtraSignals(cfg, 'TASK_ID', pages, { pagesPerRequest: 1000, resourceScan: false });
    expect(calls.duplicate_content).toBe(MAX_PER_URL_READS);
    expect(out.unverified).toEqual({ duplicateContent: 7 });
    expect(out.unavailableSignals).toBeUndefined();
    // Read pages without matches form no group.
    expect(out.duplicateGroups?.filter((group) => group.kind === 'content')).toEqual([]);
  });

  it('stops the per-URL reads and the resource lookups when the budget runs out', async () => {
    let clock = 0;
    const calls = wireAll({
      duplicate_content: () => {
        clock += DEFAULT_EXTRA_READS_BUDGET_MS;
        return HttpResponse.json(fixture('duplicate-content', 'success'));
      },
    });
    const out = await readExtraSignals({ ...cfg, now: () => clock }, 'TASK_ID', flaggedPages(), {
      pagesPerRequest: 1000,
      resourceScan: true,
    });
    expect(calls.duplicate_content).toBe(1);
    expect(calls.waterfall).toBeUndefined();
    expect(calls.pages_by_resource).toBeUndefined();
    expect(out.unverified).toEqual({ duplicateContent: 1, slowPages: 2 });
    expect(out.unavailableSignals).toEqual([
      { signal: 'duplicate-content', cause: 'budget' },
      { signal: 'waterfall', cause: 'budget' },
    ]);
    expect(out.resources).toHaveLength(4);
  });

  it('a failed resource lookup leaves the resource rows and stops further lookups', async () => {
    const calls = wireAll({ pages_by_resource: quota });
    const out = await readExtraSignals(cfg, 'TASK_ID', [], { pagesPerRequest: 1000, resourceScan: true });
    expect(calls.pages_by_resource).toBe(1);
    expect(out.resources).toHaveLength(4);
    expect(out.unavailableSignals).toBeUndefined();
  });

  it('looks up at most the bounded number of resources, broken and largest images first', async () => {
    const images = Array.from({ length: MAX_RESOURCE_PAGE_LOOKUPS + 5 }, (_, i) => ({
      url: `https://example.com/img-${i}.jpg`,
      resource_type: 'image',
      status_code: 200,
      size: i,
    }));
    const looked: string[] = [];
    vendorMockServer.use(
      http.post('*/on_page/duplicate_tags', () => HttpResponse.json(fixture('duplicate-tags', 'empty'))),
      http.post('*/on_page/redirect_chains', () => HttpResponse.json(fixture('redirect-chains', 'empty'))),
      http.post('*/on_page/resources', async ({ request }) => {
        const [task] = (await request.json()) as [{ order_by?: unknown }];
        return HttpResponse.json({
          status_code: 20000,
          tasks: [{ id: 'TASK_ID', status_code: 20000, result: [{ items: task.order_by ? images : [] }] }],
        });
      }),
      http.post('*/on_page/pages_by_resource', async ({ request }) => {
        const [task] = (await request.json()) as [{ url: string }];
        looked.push(task.url);
        return HttpResponse.json(fixture('pages-by-resource', 'empty'));
      }),
    );
    await readExtraSignals(cfg, 'TASK_ID', [], { pagesPerRequest: 1000, resourceScan: true });
    expect(looked).toHaveLength(MAX_RESOURCE_PAGE_LOOKUPS);
    expect(looked[0]).toBe(`https://example.com/img-${MAX_RESOURCE_PAGE_LOOKUPS + 4}.jpg`);
  });

  it('tolerates null item lists on every bounded read', async () => {
    const nullItems = () =>
      HttpResponse.json({
        status_code: 20000,
        tasks: [{ id: 'TASK_ID', status_code: 20000, result: [{ total_items_count: 3, items: null }] }],
      });
    wireAll({ duplicate_content: nullItems, resources: nullItems, pages_by_resource: nullItems });
    const out = await readExtraSignals(cfg, 'TASK_ID', flaggedPages(), { pagesPerRequest: 1000, resourceScan: true });
    expect(out.resources).toEqual([]);
    expect(out.duplicateGroups?.some((group) => group.kind === 'content')).toBe(false);
    await expect(readPagesByResource(cfg, 'TASK_ID', 'https://example.com/a.js')).resolves.toEqual({ urls: [], count: 3 });
  });

  it('leaves duplicate groups out when the tag read failed and no page was flagged', async () => {
    wireAll({ duplicate_tags: quota });
    const out = await readExtraSignals(cfg, 'TASK_ID', [page('https://example.com/')], {
      pagesPerRequest: 1000,
      resourceScan: false,
    });
    expect(out.duplicateGroups).toBeUndefined();
    expect(out.unavailableSignals).toEqual([{ signal: 'duplicate-tags', cause: 'vendor-error' }]);
  });

  it('orders unsized lookups after sized ones', async () => {
    const looked: string[] = [];
    vendorMockServer.use(
      http.post('*/on_page/duplicate_tags', () => HttpResponse.json(fixture('duplicate-tags', 'empty'))),
      http.post('*/on_page/redirect_chains', () => HttpResponse.json(fixture('redirect-chains', 'empty'))),
      http.post('*/on_page/resources', async ({ request }) => {
        const [task] = (await request.json()) as [{ order_by?: unknown }];
        const items = [
          { url: 'https://example.com/a.png', resource_type: 'image', status_code: 200 },
          { url: 'https://example.com/b.png', resource_type: 'image', status_code: 200, size: 5 },
          { url: 'https://example.com/c.png', resource_type: 'image', status_code: 200 },
        ];
        return HttpResponse.json({
          status_code: 20000,
          tasks: [{ id: 'TASK_ID', status_code: 20000, result: [{ items: task.order_by ? items : [] }] }],
        });
      }),
      http.post('*/on_page/pages_by_resource', async ({ request }) => {
        const [task] = (await request.json()) as [{ url: string }];
        looked.push(task.url);
        return HttpResponse.json(fixture('pages-by-resource', 'empty'));
      }),
    );
    await readExtraSignals(cfg, 'TASK_ID', [], { pagesPerRequest: 1000, resourceScan: true });
    expect(looked).toEqual(['https://example.com/b.png', 'https://example.com/a.png', 'https://example.com/c.png']);
  });

  it('merges symmetric content matches into one group with the highest similarity', async () => {
    vendorMockServer.use(
      http.post('*/on_page/duplicate_tags', () => HttpResponse.json(fixture('duplicate-tags', 'empty'))),
      http.post('*/on_page/redirect_chains', () => HttpResponse.json(fixture('redirect-chains', 'empty'))),
      http.post('*/on_page/duplicate_content', async ({ request }) => {
        const [task] = (await request.json()) as [{ url: string }];
        const other = task.url.endsWith('/a') ? 'https://example.com/b' : 'https://example.com/a';
        const similarity = task.url.endsWith('/a') ? 7 : 9;
        return HttpResponse.json({
          status_code: 20000,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20000,
              result: [{ items: [{ url: task.url, pages: [{ similarity, page: [{ url: other }, { url: task.url }] }] }] }],
            },
          ],
        });
      }),
    );
    const pages = [
      page('https://example.com/a', { checks: { duplicateContent: true } }),
      page('https://example.com/b', { checks: { duplicateContent: true } }),
      page('https://example.com/c', { checks: { duplicateContent: true } }),
    ];
    const out = await readExtraSignals(cfg, 'TASK_ID', pages.slice(0, 2), { pagesPerRequest: 1000, resourceScan: false });
    expect(out.duplicateGroups).toEqual([
      { kind: 'content', urls: ['https://example.com/a', 'https://example.com/b'], similarity: 9 },
    ]);
  });
});
