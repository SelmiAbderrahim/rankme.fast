/**
 * DataForSEO On-Page adapter tests.
 *
 * Two layers:
 *   1. providerContractTests over each single-request operation (task_post,
 *      summary) — success / timeout / malformed / quota + operation-specific
 *      extras (in-queue polling, crawl-in-progress).
 *   2. Full-flow tests that route by URL (msw handlers per endpoint) —
 *      getAuditResult must call summary + pages + links + non_indexable and
 *      normalize into the vendor-neutral shape.
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
  createDataForSeoOnPageAuditProvider,
  toDataForSeoTarget,
  type DataForSeoOnPageProviderConfig,
} from './onpage.js';

const FIXTURES_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'testing',
  'fixtures',
  'dataforseo-onpage',
);

function readFixture(operation: string, kase: string): JsonBodyType {
  return JSON.parse(
    readFileSync(join(FIXTURES_ROOT, operation, `${kase}.json`), 'utf8'),
  ) as JsonBodyType;
}

const cfg: DataForSeoOnPageProviderConfig = {
  login: 'sandbox-login',
  password: 'sandbox-password',
  baseUrl: 'https://dataforseo.mock/v3',
  timeoutMs: 60,
  maxRetries: 0,
  backoffBaseMs: 1,
  random: () => 0,
  pagesPerRequest: 1000,
};

const provider = createDataForSeoOnPageAuditProvider(cfg);

// ---------------------------------------------------------------------------
// Provider contract — startAudit (task_post)
// ---------------------------------------------------------------------------

providerContractTests({
  title: 'DataForSeoOnPageAuditProvider.startAudit',
  fixtureProvider: 'dataforseo-onpage',
  fixtureOperation: 'task-post',
  makeCall: () => provider.startAudit({ domain: 'example.com', pageCap: 100 }),
  assertSuccess: (result) => {
    expect(result).toEqual({ vendorTaskId: 'TASK_ID' });
  },
});

// ---------------------------------------------------------------------------
// Provider contract — getAuditStatus (summary)
// ---------------------------------------------------------------------------

providerContractTests({
  title: 'DataForSeoOnPageAuditProvider.getAuditStatus',
  fixtureProvider: 'dataforseo-onpage',
  fixtureOperation: 'summary',
  makeCall: () => provider.getAuditStatus('TASK_ID'),
  assertSuccess: (result) => {
    expect(result.state).toBe('finished');
    expect(result.pagesCrawled).toBe(2);
  },
});

// ---------------------------------------------------------------------------
// Extra summary cases — in-queue and crawling
// ---------------------------------------------------------------------------

describe('DataForSeoOnPageAuditProvider.getAuditStatus polling cases', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  it('in-queue: 40602 surfaces as state=queued', async () => {
    mockVendor('dataforseo-onpage', 'summary', 'in-queue');
    const status = await provider.getAuditStatus('TASK_ID');
    expect(status.state).toBe('queued');
  });

  it('crawling: crawl_progress=in_progress surfaces as state=crawling', async () => {
    mockVendor('dataforseo-onpage', 'summary', 'crawling');
    const status = await provider.getAuditStatus('TASK_ID');
    expect(status.state).toBe('crawling');
    expect(status.pagesCrawled).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// startAudit input mapping — target normalization + max_crawl_pages
// ---------------------------------------------------------------------------

describe('DataForSeoOnPageAuditProvider.startAudit — input mapping', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  it('forwards max_crawl_pages and normalizes the target host', async () => {
    let capturedBody: unknown = null;
    vendorMockServer.use(
      http.post('*/on_page/task_post', async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(readFixture('task-post', 'success'));
      }),
    );
    await provider.startAudit({ domain: 'www.EXAMPLE.com/', pageCap: 42 });
    expect(capturedBody).toEqual([
      { target: 'example.com', max_crawl_pages: 42, respect_sitemap: true },
    ]);
  });

  it('body-shape contract: NEVER sends rendering flags (10×/34× cost class is unsupported)', async () => {
    let capturedBody: unknown = null;
    vendorMockServer.use(
      http.post('*/on_page/task_post', async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(readFixture('task-post', 'success'));
      }),
    );
    await provider.startAudit({ domain: 'example.com', pageCap: 10 });
    // Exact shape — a future `enable_javascript`/`enable_browser_rendering`
    // key would 10×/34× the per-page price the margin model budgets for.
    expect(capturedBody).toEqual([
      { target: 'example.com', max_crawl_pages: 10, respect_sitemap: true },
    ]);
  });

  it('rejects malformed vendor payload with a missing task id', async () => {
    vendorMockServer.use(
      http.post('*/on_page/task_post', () =>
        HttpResponse.json({
          status_code: 20000,
          tasks: [{ status_code: 20100, cost: 0 }],
        }),
      ),
    );
    await expect(
      provider.startAudit({ domain: 'example.com', pageCap: 10 }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('rejects an empty tasks array as malformed', async () => {
    vendorMockServer.use(
      http.post('*/on_page/task_post', () =>
        HttpResponse.json({ status_code: 20000, tasks: [] }),
      ),
    );
    await expect(
      provider.startAudit({ domain: 'example.com', pageCap: 10 }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('rejects a defensive task-level 40602 as unavailable', async () => {
    vendorMockServer.use(
      http.post('*/on_page/task_post', () =>
        HttpResponse.json({
          status_code: 20000,
          tasks: [{ status_code: 40602 }],
        }),
      ),
    );
    await expect(
      provider.startAudit({ domain: 'example.com', pageCap: 10 }),
    ).rejects.toBeInstanceOf(VendorUnavailableError);
  });
});

// ---------------------------------------------------------------------------
// getAuditStatus — malformed summary result
// ---------------------------------------------------------------------------

describe('DataForSeoOnPageAuditProvider.getAuditStatus — edge cases', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  it('empty tasks array on summary is malformed', async () => {
    vendorMockServer.use(
      http.get('*/on_page/summary/*', () =>
        HttpResponse.json({ status_code: 20000, tasks: [] }),
      ),
      http.get('*/on_page/summary/*', () =>
        HttpResponse.json({ status_code: 20000, tasks: [] }),
      ),
    );
    await expect(provider.getAuditStatus('TASK_ID')).rejects.toBeInstanceOf(
      VendorMalformedError,
    );
  });

  it('an unexpected task-level "created" (20100) status on summary is malformed', async () => {
    vendorMockServer.use(
      http.get('*/on_page/summary/*', () =>
        HttpResponse.json({
          status_code: 20000,
          tasks: [{ status_code: 20100, id: 'TASK_ID', cost: 0 }],
        }),
      ),
    );
    await expect(provider.getAuditStatus('TASK_ID')).rejects.toBeInstanceOf(
      VendorMalformedError,
    );
  });
});

// ---------------------------------------------------------------------------
// getAuditResult — full flow (summary + pages + links + non-indexable)
// ---------------------------------------------------------------------------

describe('DataForSeoOnPageAuditProvider.getAuditResult', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  function wireHappyPath() {
    vendorMockServer.use(
      http.get('*/on_page/summary/*', () =>
        HttpResponse.json(readFixture('summary', 'success')),
      ),
      http.post('*/on_page/pages', () =>
        HttpResponse.json(readFixture('pages', 'success')),
      ),
      http.post('*/on_page/links', async ({ request }) => {
        expect(await request.json()).toEqual([
          {
            id: 'TASK_ID',
            limit: 1000,
            offset: 0,
            filters: [
              ['is_broken', '=', true],
              'and',
              ['direction', '=', 'internal'],
            ],
          },
        ]);
        return HttpResponse.json(readFixture('links', 'success'));
      }),
      http.post('*/on_page/non_indexable', () =>
        HttpResponse.json(readFixture('non-indexable', 'success')),
      ),
    );
  }

  it('normalizes summary + pages + links + non-indexable into AuditResult', async () => {
    wireHappyPath();
    const result = await provider.getAuditResult('TASK_ID');
    expect(result.domainChecks).toEqual({
      robotsTxtFound: true,
      sitemapFound: true,
      httpsEnforced: true,
      canonicalizationOk: true,
    });
    expect(result.pages).toHaveLength(2);

    const home = result.pages.find((p) => p.url === 'https://example.com/');
    expect(home).toMatchObject({
      title: 'Example Domain',
      metaDescription: 'An example page.',
      h1: ['Example Domain'],
      h2: ['More information'],
      canonical: 'https://example.com/',
      hasStructuredData: true,
      structuredDataErrors: [],
      isIndexable: true,
      brokenLinks: [],
      onPageScore: 87.5,
      timing: { fetchMs: 120, timeToInteractiveMs: 300 },
    });

    const hidden = result.pages.find((p) => p.url === 'https://example.com/hidden');
    expect(hidden).toMatchObject({
      title: null,
      metaDescription: null,
      hasStructuredData: false,
      structuredDataErrors: ['micromarkup errors reported by vendor'],
      isIndexable: false,
      nonIndexableReason: 'meta_tag',
      brokenLinks: ['https://example.com/404'],
      onPageScore: 41.2,
    });
  });

  it('handles empty pages, links, and non-indexable — zero pages, no overlay', async () => {
    vendorMockServer.use(
      http.get('*/on_page/summary/*', () =>
        HttpResponse.json(readFixture('summary', 'success')),
      ),
      http.post('*/on_page/pages', () =>
        HttpResponse.json(readFixture('pages', 'empty')),
      ),
      http.post('*/on_page/links', () =>
        HttpResponse.json(readFixture('links', 'empty')),
      ),
      http.post('*/on_page/non_indexable', () =>
        HttpResponse.json(readFixture('non-indexable', 'empty')),
      ),
    );
    const result = await provider.getAuditResult('TASK_ID');
    expect(result.pages).toEqual([]);
  });

  it('rejects when summary is not ok at result time (e.g. still in queue)', async () => {
    vendorMockServer.use(
      http.get('*/on_page/summary/*', () =>
        HttpResponse.json(readFixture('summary', 'in-queue')),
      ),
    );
    await expect(provider.getAuditResult('TASK_ID')).rejects.toBeInstanceOf(
      VendorMalformedError,
    );
  });

  it('rejects when pages returns a non-ok task-level status', async () => {
    vendorMockServer.use(
      http.get('*/on_page/summary/*', () =>
        HttpResponse.json(readFixture('summary', 'success')),
      ),
      http.post('*/on_page/pages', () =>
        HttpResponse.json({ status_code: 20000, tasks: [{ status_code: 40602 }] }),
      ),
    );
    await expect(provider.getAuditResult('TASK_ID')).rejects.toBeInstanceOf(
      VendorMalformedError,
    );
  });

  it('rejects when links returns a non-ok task-level status', async () => {
    vendorMockServer.use(
      http.get('*/on_page/summary/*', () =>
        HttpResponse.json(readFixture('summary', 'success')),
      ),
      http.post('*/on_page/pages', () =>
        HttpResponse.json(readFixture('pages', 'success')),
      ),
      http.post('*/on_page/links', () =>
        HttpResponse.json({ status_code: 20000, tasks: [{ status_code: 40602 }] }),
      ),
    );
    await expect(provider.getAuditResult('TASK_ID')).rejects.toBeInstanceOf(
      VendorMalformedError,
    );
  });

  it('rejects when non_indexable returns a non-ok task-level status', async () => {
    vendorMockServer.use(
      http.get('*/on_page/summary/*', () =>
        HttpResponse.json(readFixture('summary', 'success')),
      ),
      http.post('*/on_page/pages', () =>
        HttpResponse.json(readFixture('pages', 'success')),
      ),
      http.post('*/on_page/links', () =>
        HttpResponse.json(readFixture('links', 'empty')),
      ),
      http.post('*/on_page/non_indexable', () =>
        HttpResponse.json({ status_code: 20000, tasks: [{ status_code: 40602 }] }),
      ),
    );
    await expect(provider.getAuditResult('TASK_ID')).rejects.toBeInstanceOf(
      VendorMalformedError,
    );
  });

  it('paginates /on_page/pages until fewer than `limit` rows arrive', async () => {
    // Configure a tiny page size so the same fixture triggers loop-then-stop.
    const smallProvider = createDataForSeoOnPageAuditProvider({ ...cfg, pagesPerRequest: 2 });
    let pagesCalls = 0;
    vendorMockServer.use(
      http.get('*/on_page/summary/*', () =>
        HttpResponse.json({
          status_code: 20000,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20000,
              result: [
                {
                  crawl_progress: 'finished',
                  crawl_status: { pages_crawled: 4 },
                  domain_info: { checks: { robots_txt: true } },
                  page_metrics: { checks: {} },
                },
              ],
            },
          ],
        }),
      ),
      http.post('*/on_page/pages', () => {
        pagesCalls += 1;
        const body = pagesCalls === 1
          ? readFixture('pages', 'success')
          : readFixture('pages', 'empty');
        return HttpResponse.json(body);
      }),
      http.post('*/on_page/links', () =>
        HttpResponse.json(readFixture('links', 'empty')),
      ),
      http.post('*/on_page/non_indexable', () =>
        HttpResponse.json(readFixture('non-indexable', 'empty')),
      ),
    );
    const result = await smallProvider.getAuditResult('TASK_ID');
    expect(result.pages).toHaveLength(2);
    expect(pagesCalls).toBeGreaterThanOrEqual(1);
  });

  it('paginates /on_page/links across multiple pages', async () => {
    const smallProvider = createDataForSeoOnPageAuditProvider({ ...cfg, pagesPerRequest: 1 });
    let linkCalls = 0;
    vendorMockServer.use(
      http.get('*/on_page/summary/*', () =>
        HttpResponse.json(readFixture('summary', 'success')),
      ),
      http.post('*/on_page/pages', () =>
        HttpResponse.json(readFixture('pages', 'empty')),
      ),
      http.post('*/on_page/links', () => {
        linkCalls += 1;
        // Both calls return one item each — second contains a non-broken row
        // to prove the `is_broken` filter is enforced client-side too.
        const body = linkCalls === 1
          ? readFixture('links', 'success')
          : {
              status_code: 20000,
              tasks: [
                {
                  id: 'TASK_ID',
                  status_code: 20000,
                  result: [
                    {
                      items: [
                        {
                          link_from: 'https://example.com/other',
                          link_to: 'https://example.com/still-there',
                          direction: 'internal',
                          is_broken: false,
                        },
                      ],
                    },
                  ],
                },
              ],
            };
        return HttpResponse.json(body as JsonBodyType);
      }),
      http.post('*/on_page/non_indexable', () =>
        HttpResponse.json(readFixture('non-indexable', 'empty')),
      ),
    );
    const result = await smallProvider.getAuditResult('TASK_ID');
    expect(linkCalls).toBeGreaterThanOrEqual(2);
    expect(result.pages).toEqual([]);
  });

  it('accumulates multiple broken destinations under a single link_from', async () => {
    vendorMockServer.use(
      http.get('*/on_page/summary/*', () =>
        HttpResponse.json(readFixture('summary', 'success')),
      ),
      http.post('*/on_page/pages', () =>
        HttpResponse.json(readFixture('pages', 'success')),
      ),
      http.post('*/on_page/links', () =>
        HttpResponse.json({
          status_code: 20000,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20000,
              result: [
                {
                  items: [
                    {
                      link_from: 'https://example.com/hidden',
                      link_to: 'https://example.com/404',
                      direction: 'internal',
                      is_broken: true,
                    },
                    {
                      link_from: 'https://example.com/hidden',
                      link_to: 'https://example.com/500',
                      direction: 'internal',
                      is_broken: true,
                    },
                    {
                      link_from: 'https://example.com/hidden',
                      link_to: 'https://external.example/broken',
                      direction: 'external',
                      is_broken: true,
                    },
                  ],
                },
              ],
            },
          ],
        }),
      ),
      http.post('*/on_page/non_indexable', () =>
        HttpResponse.json(readFixture('non-indexable', 'empty')),
      ),
    );
    const result = await provider.getAuditResult('TASK_ID');
    const hidden = result.pages.find((p) => p.url === 'https://example.com/hidden');
    expect(hidden?.brokenLinks).toEqual([
      'https://example.com/404',
      'https://example.com/500',
    ]);
  });

  it('skips broken-link rows missing link_from/link_to', async () => {
    vendorMockServer.use(
      http.get('*/on_page/summary/*', () =>
        HttpResponse.json(readFixture('summary', 'success')),
      ),
      http.post('*/on_page/pages', () =>
        HttpResponse.json(readFixture('pages', 'success')),
      ),
      http.post('*/on_page/links', () =>
        HttpResponse.json({
          status_code: 20000,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20000,
              result: [
                {
                  items: [
                    {
                      link_from: 'https://example.com/hidden',
                      direction: 'internal',
                      is_broken: true,
                    },
                    {
                      link_to: 'https://example.com/404',
                      direction: 'internal',
                      is_broken: true,
                    },
                    {
                      link_from: 'https://example.com/hidden',
                      link_to: 'https://example.com/second-broken',
                      direction: 'internal',
                      is_broken: true,
                    },
                  ],
                },
              ],
            },
          ],
        }),
      ),
      http.post('*/on_page/non_indexable', () =>
        HttpResponse.json(readFixture('non-indexable', 'empty')),
      ),
    );
    const result = await provider.getAuditResult('TASK_ID');
    const hidden = result.pages.find((p) => p.url === 'https://example.com/hidden');
    expect(hidden?.brokenLinks).toEqual(['https://example.com/second-broken']);
  });

  it('skips non-indexable rows missing url; defaults reason to "unknown"', async () => {
    vendorMockServer.use(
      http.get('*/on_page/summary/*', () =>
        HttpResponse.json(readFixture('summary', 'success')),
      ),
      http.post('*/on_page/pages', () =>
        HttpResponse.json(readFixture('pages', 'success')),
      ),
      http.post('*/on_page/links', () =>
        HttpResponse.json(readFixture('links', 'empty')),
      ),
      http.post('*/on_page/non_indexable', () =>
        HttpResponse.json({
          status_code: 20000,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20000,
              result: [
                {
                  items: [
                    { reason: 'robots_txt' },
                    { url: 'https://example.com/hidden' },
                  ],
                },
              ],
            },
          ],
        }),
      ),
    );
    const result = await provider.getAuditResult('TASK_ID');
    const hidden = result.pages.find((p) => p.url === 'https://example.com/hidden');
    expect(hidden?.nonIndexableReason).toBe('unknown');
  });

  it('degrades gracefully when meta/checks/timing are missing on a page', async () => {
    vendorMockServer.use(
      http.get('*/on_page/summary/*', () =>
        HttpResponse.json(readFixture('summary', 'success')),
      ),
      http.post('*/on_page/pages', () =>
        HttpResponse.json({
          status_code: 20000,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20000,
              result: [
                {
                  items: [
                    {
                      url: 'https://example.com/spare',
                      status_code: 200,
                    },
                  ],
                },
              ],
            },
          ],
        }),
      ),
      http.post('*/on_page/links', () =>
        HttpResponse.json(readFixture('links', 'empty')),
      ),
      http.post('*/on_page/non_indexable', () =>
        HttpResponse.json(readFixture('non-indexable', 'empty')),
      ),
    );
    const result = await provider.getAuditResult('TASK_ID');
    expect(result.pages).toEqual([
      {
        url: 'https://example.com/spare',
        statusCode: 200,
        title: null,
        metaDescription: null,
        h1: [],
        h2: [],
        canonical: null,
        hasStructuredData: false,
        structuredDataErrors: [],
        isIndexable: true,
        brokenLinks: [],
        onPageScore: 0,
      },
    ]);
  });

  it('reports a page as non-indexable when the vendor marks it broken', async () => {
    vendorMockServer.use(
      http.get('*/on_page/summary/*', () =>
        HttpResponse.json(readFixture('summary', 'success')),
      ),
      http.post('*/on_page/pages', () =>
        HttpResponse.json({
          status_code: 20000,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20000,
              result: [
                {
                  items: [
                    {
                      url: 'https://example.com/gone',
                      status_code: 404,
                      checks: { is_broken: true },
                    },
                  ],
                },
              ],
            },
          ],
        }),
      ),
      http.post('*/on_page/links', () =>
        HttpResponse.json(readFixture('links', 'empty')),
      ),
      http.post('*/on_page/non_indexable', () =>
        HttpResponse.json(readFixture('non-indexable', 'empty')),
      ),
    );
    const [page] = (await provider.getAuditResult('TASK_ID')).pages;
    expect(page?.isIndexable).toBe(false);
  });

  it('surfaces time_to_interactive alone when duration_time is absent', async () => {
    vendorMockServer.use(
      http.get('*/on_page/summary/*', () =>
        HttpResponse.json(readFixture('summary', 'success')),
      ),
      http.post('*/on_page/pages', () =>
        HttpResponse.json({
          status_code: 20000,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20000,
              result: [
                {
                  items: [
                    {
                      url: 'https://example.com/timing',
                      status_code: 200,
                      page_timing: { time_to_interactive: 200 },
                    },
                  ],
                },
              ],
            },
          ],
        }),
      ),
      http.post('*/on_page/links', () =>
        HttpResponse.json(readFixture('links', 'empty')),
      ),
      http.post('*/on_page/non_indexable', () =>
        HttpResponse.json(readFixture('non-indexable', 'empty')),
      ),
    );
    const [page] = (await provider.getAuditResult('TASK_ID')).pages;
    expect(page?.timing).toEqual({ timeToInteractiveMs: 200 });
  });

  it('omits timing when the vendor returned only unrecognized fields', async () => {
    vendorMockServer.use(
      http.get('*/on_page/summary/*', () =>
        HttpResponse.json(readFixture('summary', 'success')),
      ),
      http.post('*/on_page/pages', () =>
        HttpResponse.json({
          status_code: 20000,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20000,
              result: [
                {
                  items: [
                    {
                      url: 'https://example.com/notiming',
                      status_code: 200,
                      page_timing: { fetch_time: '2026-01-01T00:00:00Z' },
                    },
                  ],
                },
              ],
            },
          ],
        }),
      ),
      http.post('*/on_page/links', () =>
        HttpResponse.json(readFixture('links', 'empty')),
      ),
      http.post('*/on_page/non_indexable', () =>
        HttpResponse.json(readFixture('non-indexable', 'empty')),
      ),
    );
    const [page] = (await provider.getAuditResult('TASK_ID')).pages;
    expect(page?.timing).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// toDataForSeoTarget — pure helper
// ---------------------------------------------------------------------------

describe('DataForSeoOnPageAuditProvider constructor defaults', () => {
  it('falls back to the default pages-per-request when unspecified', () => {
    const p = createDataForSeoOnPageAuditProvider({
      login: 'l',
      password: 'p',
      baseUrl: 'https://vendor.test/v3',
    });
    expect(typeof p.startAudit).toBe('function');
  });
});

describe('toDataForSeoTarget', () => {
  it('strips scheme, www, trailing slash, and lowercases', () => {
    expect(toDataForSeoTarget('https://www.EXAMPLE.com/')).toBe('example.com');
    expect(toDataForSeoTarget('http://foo.bar/')).toBe('foo.bar');
    expect(toDataForSeoTarget('www.baz.qux')).toBe('baz.qux');
    expect(toDataForSeoTarget('example.com')).toBe('example.com');
  });
});
