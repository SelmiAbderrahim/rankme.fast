import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vendorMockServer } from '../../testing/fixtures/mock-vendor.js';
import { createDataForSeoOnPageAuditProvider } from './onpage.js';

const base = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'testing', 'fixtures', 'dataforseo-onpage');
const fixture = (operation: string, name: string) => JSON.parse(readFileSync(join(base, operation, `${name}.json`), 'utf8')) as object;
const envelope = (result: object) => ({ status_code: 20000,
  tasks: [{ id: 'TASK_ID', status_code: 20000, result: [result] }] });
const provider = createDataForSeoOnPageAuditProvider({ login: 'sandbox-login', password: 'sandbox-password',
  baseUrl: 'https://dataforseo.mock/v3', timeoutMs: 100, maxRetries: 0, backoffBaseMs: 1,
  random: () => 0, pagesPerRequest: 100 });

describe('deep crawl provider integration', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  it('loads resources only when this run requests them', async () => {
    const bodies: unknown[] = [];
    vendorMockServer.use(http.post('*/on_page/task_post', async ({ request }) => {
      bodies.push(await request.json());
      return HttpResponse.json(fixture('task-post', 'success'));
    }));
    await provider.startAudit({ domain: 'example.com', pageCap: 100, resourceScan: true });
    await provider.startAudit({ domain: 'example.com', pageCap: 100, resourceScan: false });
    expect(bodies[0]).toEqual([{ target: 'example.com', max_crawl_pages: 100,
      respect_sitemap: true, load_resources: true }]);
    expect(bodies[1]).toEqual([{ target: 'example.com', max_crawl_pages: 100,
      respect_sitemap: true }]);
    // Rendering (about 10x and 34x the base price), custom scripts, content
    // parsing, raw HTML storage, spell checks, keyword density and
    // screenshots are never sent, whatever the run asks for.
    for (const flag of ['enable_javascript', 'enable_browser_rendering', 'custom_js', 'enable_content_parsing',
      'store_raw_html', 'check_spell', 'calculate_keyword_density', 'page_screenshot']) {
      for (const body of bodies as Array<Array<Record<string, unknown>>>) expect(body[0]).not.toHaveProperty(flag);
    }
  });

  it('returns normalized page checks and extra evidence without losing the base page', async () => {
    const deep = fixture('pages', 'deep-signals') as { tasks: Array<{ result: Array<{ items: object[] }> }> };
    const items = deep.tasks[0]!.result[0]!.items;
    vendorMockServer.use(
      http.get('*/on_page/summary/*', () => HttpResponse.json(envelope({ crawl_progress: 'finished',
        crawl_status: { pages_crawled: items.length }, domain_info: { checks: {} } }))),
      http.post('*/on_page/pages', () => HttpResponse.json(envelope({ items, total_items_count: items.length }))),
      http.post('*/on_page/links', () => HttpResponse.json(envelope({ items: [] }))),
      http.post('*/on_page/non_indexable', () => HttpResponse.json(envelope({ items: [] }))),
      ...(['duplicate-tags', 'redirect-chains', 'duplicate-content', 'waterfall', 'resources', 'pages-by-resource'] as const)
        .map((operation) => http.post(`*/on_page/${operation.replaceAll('-', '_')}`, () =>
          HttpResponse.json(fixture(operation, 'success')))),
    );
    const result = await provider.getAuditResult('TASK_ID', { resourceScan: true });
    expect(result.pages.length).toBe(items.length);
    expect(result.pages.some((page) => page.checks?.orphan === true)).toBe(true);
    expect(result.duplicateGroups?.length).toBeGreaterThan(0);
    expect(result.redirectChains?.length).toBeGreaterThan(0);
    expect(result.resources?.length).toBeGreaterThan(0);
    expect(result.capabilities).toEqual({ resourceScan: true });
  });

  function wireFinishedCrawl(calls: Record<string, number>): void {
    const deep = fixture('pages', 'deep-signals') as { tasks: Array<{ result: Array<{ items: object[] }> }> };
    const items = deep.tasks[0]!.result[0]!.items;
    const count = (endpoint: string, body: () => object) => http.post(`*/on_page/${endpoint}`, () => {
      calls[endpoint] = (calls[endpoint] ?? 0) + 1;
      return HttpResponse.json(body());
    });
    vendorMockServer.use(
      http.get('*/on_page/summary/*', () => HttpResponse.json(envelope({ crawl_progress: 'finished',
        crawl_status: { pages_crawled: items.length }, domain_info: { checks: {} } }))),
      count('pages', () => envelope({ items, total_items_count: items.length })),
      count('links', () => envelope({ items: [] })),
      count('non_indexable', () => envelope({ items: [] })),
      count('duplicate_tags', () => fixture('duplicate-tags', 'success')),
      count('redirect_chains', () => fixture('redirect-chains', 'success')),
      count('duplicate_content', () => fixture('duplicate-content', 'success')),
      count('waterfall', () => fixture('waterfall', 'success')),
      count('resources', () => fixture('resources', 'success')),
      count('pages_by_resource', () => fixture('pages-by-resource', 'success')),
    );
  }

  it('runs only the free reads when the resource scan is off', async () => {
    const calls: Record<string, number> = {};
    wireFinishedCrawl(calls);
    const result = await provider.getAuditResult('TASK_ID');
    expect(result.capabilities).toEqual({ resourceScan: false });
    expect(calls.resources).toBeUndefined();
    expect(calls.pages_by_resource).toBeUndefined();
    expect(result.resources).toBeUndefined();
    expect(result.unavailableSignals).toBeUndefined();
    expect(result.redirectChains).toHaveLength(2);
  });

  it('a failed extra read degrades that signal only; the audit result still arrives', async () => {
    wireFinishedCrawl({});
    vendorMockServer.use(http.post('*/on_page/redirect_chains', () =>
      HttpResponse.json(fixture('redirect-chains', 'quota'))));
    const result = await provider.getAuditResult('TASK_ID');
    expect(result.pages.length).toBeGreaterThan(0);
    expect(result.redirectChains).toBeUndefined();
    expect(result.unavailableSignals).toEqual([{ signal: 'redirect-chains', cause: 'vendor-error' }]);
  });

  it('continues core page pagination when a vendor page is shorter than requested', async () => {
    const page = (url: string) => ({ url, status_code: 200, meta: {}, checks: {}, onpage_score: 80 });
    const offsets: number[] = [];
    vendorMockServer.use(
      http.get('*/on_page/summary/*', () => HttpResponse.json(envelope({ crawl_progress: 'finished',
        crawl_status: { pages_crawled: 2 }, domain_info: { checks: {} } }))),
      http.post('*/on_page/pages', async ({ request }) => {
        const [{ offset }] = await request.json() as [{ offset: number }];
        offsets.push(offset);
        const items = offset === 0 ? [page('https://example.com/one')] :
          offset === 1 ? [page('https://example.com/two')] : [];
        return HttpResponse.json(envelope({ items, total_items_count: 2 }));
      }),
      http.post('*/on_page/links', () => HttpResponse.json(envelope({ items: [] }))),
      http.post('*/on_page/non_indexable', () => HttpResponse.json(envelope({ items: [] }))),
      http.post('*/on_page/duplicate_tags', () => HttpResponse.json(envelope({ items: [] }))),
      http.post('*/on_page/redirect_chains', () => HttpResponse.json(envelope({ items: [] }))),
    );
    const result = await provider.getAuditResult('TASK_ID');
    expect(result.pages.map((item) => item.url)).toEqual(['https://example.com/one', 'https://example.com/two']);
    expect(offsets).toEqual([0, 1]);
  });

  it('finishes when the vendor reports neither a crawl total nor a page total', async () => {
    const page = { url: 'https://example.com/one', status_code: 200, meta: {}, checks: {}, onpage_score: 80 };
    vendorMockServer.use(
      http.get('*/on_page/summary/*', () => HttpResponse.json(envelope({ crawl_progress: 'finished',
        crawl_status: {}, domain_info: { checks: {} } }))),
      http.post('*/on_page/pages', async ({ request }) => {
        const [{ offset }] = await request.json() as [{ offset: number }];
        return HttpResponse.json(envelope(offset === 0 ? { items: [page] } : { items: null }));
      }),
      http.post('*/on_page/links', () => HttpResponse.json(envelope({ items: [] }))),
      http.post('*/on_page/non_indexable', () => HttpResponse.json(envelope({ items: [] }))),
      http.post('*/on_page/duplicate_tags', () => HttpResponse.json(envelope({ items: [] }))),
      http.post('*/on_page/redirect_chains', () => HttpResponse.json(envelope({ items: [] }))),
    );
    const result = await provider.getAuditResult('TASK_ID');
    expect(result.pages.map((item) => item.url)).toEqual(['https://example.com/one']);
    expect(result).not.toHaveProperty('vendorPagesCrawled');
  });
});
