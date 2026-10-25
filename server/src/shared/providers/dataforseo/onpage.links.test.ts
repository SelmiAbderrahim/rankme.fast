/**
 * A locale page with a self-referencing canonical is its own
 * page, and hreflang/canonical/redirect references are not broken links a
 * visitor can click.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { vendorMockServer } from '../../testing/fixtures/mock-vendor.js';
import { createDataForSeoOnPageAuditProvider, type DataForSeoOnPageProviderConfig } from './onpage.js';

const cfg: DataForSeoOnPageProviderConfig = {
  login: 'sandbox-login',
  password: 'sandbox-password',
  baseUrl: 'https://dataforseo.mock/v3',
  timeoutMs: 200,
  maxRetries: 0,
  backoffBaseMs: 1,
  random: () => 0,
  pagesPerRequest: 1000,
};

const BASE = 'https://episodebrief.example';

function envelope(result: unknown) {
  return {
    version: '0.1.20260101',
    status_code: 20000,
    status_message: 'Ok.',
    time: '0.01 sec.',
    cost: 0,
    tasks_count: 1,
    tasks_error: 0,
    tasks: [{ id: 'TASK_ID', status_code: 20000, status_message: 'Ok.', result: [result] }],
  };
}

const page = (url: string, canonical: string | null) => ({
  url,
  status_code: 200,
  onpage_score: 80,
  meta: { title: url, description: 'd', canonical, htags: { h1: ['h'] } },
  checks: { is_broken: false },
});

function wire() {
  const pages = [
    page(`${BASE}/ar/`, `${BASE}/ar`),
    page(`${BASE}/`, `${BASE}`),
    page(`${BASE}/de`, `https://WWW.episodebrief.example/de/`),
    page(`${BASE}/fr`, `${BASE}/en`),
    page(`${BASE}/es`, 'http://[broken'),
    page(`${BASE}/ru`, null),
    page(`${BASE}/zh`, null),
  ];
  const link = (to: string, type: string | undefined) => ({
    link_from: `${BASE}/ar/`,
    link_to: to,
    direction: 'internal',
    is_broken: true,
    ...(type ? { type } : {}),
  });
  vendorMockServer.use(
    http.get('*/on_page/summary/*', () =>
      HttpResponse.json(
        envelope({
          crawl_progress: 'finished',
          crawl_status: { max_crawl_pages: 100, pages_crawled: pages.length, pages_in_queue: 0 },
          domain_info: { checks: { robots_txt: true, sitemap: true } },
        }),
      ),
    ),
    http.post('*/on_page/pages', () =>
      HttpResponse.json(envelope({ total_items_count: pages.length, items_count: pages.length, items: pages })),
    ),
    http.post('*/on_page/links', () => {
      const items = [
        link(`${BASE}/zh/`, 'alternate'),
        link(`${BASE}/ar`, 'canonical'),
        link(`${BASE}/pricing`, 'redirect'),
        link(`${BASE}/old-style`, 'link'),
        link(`${BASE}/refresh`, 'meta'),
        link(`${BASE}/en/gone`, 'anchor'),
        link(`${BASE}/logo-404.png`, 'image'),
        link(`${BASE}/untyped-404`, undefined),
      ];
      return HttpResponse.json(envelope({ total_items_count: items.length, items_count: items.length, items }));
    }),
    http.post('*/on_page/non_indexable', () => {
      const items = [
        { url: `${BASE}/ar/`, reason: 'canonical' },
        { url: `${BASE}/`, reason: 'canonical' },
        { url: `${BASE}/de`, reason: 'canonical' },
        { url: `${BASE}/fr`, reason: 'canonical' },
        { url: `${BASE}/es`, reason: 'canonical' },
        { url: `${BASE}/ru`, reason: 'meta_tag' },
        { url: `${BASE}/zh`, reason: 'canonical' },
      ];
      return HttpResponse.json(envelope({ total_items_count: items.length, items_count: items.length, items }));
    }),
    http.post('*/on_page/microdata', () =>
      HttpResponse.json({
        status_code: 20000,
        tasks: [{ id: 'TASK_ID', status_code: 40406, status_message: 'Not available', result: null }],
      }),
    ),
  );
}

describe('DataForSEO on-page — self canonicals and visitor links', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  // The free deep-crawl reads run after every page list; answer them empty.
  beforeEach(() => {
    const empty = () =>
      HttpResponse.json({ status_code: 20000, tasks: [{ id: 'TASK_ID', status_code: 20000, result: [{ items: [] }] }] });
    vendorMockServer.use(http.post('*/on_page/duplicate_tags', empty), http.post('*/on_page/redirect_chains', empty));
  });
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  it('keeps self-canonical locale pages indexable and counts only visitor links as broken', async () => {
    wire();
    const result = await createDataForSeoOnPageAuditProvider(cfg).getAuditResult('TASK_ID');
    const byUrl = new Map(result.pages.map((row) => [row.url, row]));
    // Self-referencing canonicals (slash, case, www differences) stay pages.
    expect(byUrl.get(`${BASE}/ar/`)?.isIndexable).toBe(true);
    expect(byUrl.get(`${BASE}/de`)?.isIndexable).toBe(true);
    expect(byUrl.get(`${BASE}/`)?.isIndexable).toBe(true);
    // A canonical that names another page, an unparseable one, or another reason still applies.
    expect(byUrl.get(`${BASE}/fr`)).toMatchObject({ isIndexable: false, nonIndexableReason: 'canonical' });
    expect(byUrl.get(`${BASE}/es`)?.isIndexable).toBe(false);
    expect(byUrl.get(`${BASE}/ru`)).toMatchObject({ isIndexable: false, nonIndexableReason: 'meta_tag' });
    expect(byUrl.get(`${BASE}/zh`)?.isIndexable).toBe(false);
    expect(byUrl.get(`${BASE}/ar/`)?.brokenLinks).toEqual([
      `${BASE}/en/gone`,
      `${BASE}/logo-404.png`,
      `${BASE}/untyped-404`,
    ]);
  });
});
