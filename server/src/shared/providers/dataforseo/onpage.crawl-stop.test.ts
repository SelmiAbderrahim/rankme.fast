/**
 * The crawl result carries why the vendor stopped
 * crawling, mapped from the documented `/on_page/summary` `crawl_stop_reason`
 * values into vendor-neutral terms. Anything undocumented is left out rather
 * than guessed.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { vendorMockServer } from '../../testing/fixtures/mock-vendor.js';
import {
  createDataForSeoOnPageAuditProvider,
  type DataForSeoOnPageProviderConfig,
} from './onpage.js';

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

function wireSummary(stopReason: unknown) {
  vendorMockServer.use(
    http.get('*/on_page/summary/*', () =>
      HttpResponse.json(
        envelope({
          crawl_progress: 'finished',
          ...(stopReason === undefined ? {} : { crawl_stop_reason: stopReason }),
          crawl_status: { max_crawl_pages: 100, pages_crawled: 1, pages_in_queue: 0 },
          domain_info: { checks: { robots_txt: true, sitemap: false } },
        }),
      ),
    ),
    http.post('*/on_page/pages', () =>
      HttpResponse.json(
        envelope({
          total_items_count: 1,
          items_count: 1,
          items: [
            {
              url: 'https://example.com/',
              status_code: 200,
              onpage_score: 80,
              meta: { title: 'Welcome', description: 'd', canonical: null, htags: { h1: ['h'] } },
              checks: { is_broken: false },
            },
          ],
        }),
      ),
    ),
    http.post('*/on_page/links', () =>
      HttpResponse.json(envelope({ total_items_count: 0, items_count: 0, items: [] })),
    ),
    http.post('*/on_page/non_indexable', () =>
      HttpResponse.json(envelope({ total_items_count: 0, items_count: 0, items: [] })),
    ),
    http.post('*/on_page/microdata', () =>
      HttpResponse.json({
        status_code: 20000,
        tasks: [{ id: 'TASK_ID', status_code: 40406, status_message: 'Not available', result: null }],
      }),
    ),
  );
}

describe('DataForSeoOnPageAuditProvider — crawl stop reason', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  // The free deep-crawl reads run after every page list; answer them empty.
  beforeEach(() => {
    const empty = () =>
      HttpResponse.json({ status_code: 20000, tasks: [{ id: 'TASK_ID', status_code: 20000, result: [{ items: [] }] }] });
    vendorMockServer.use(http.post('*/on_page/duplicate_tags', empty), http.post('*/on_page/redirect_chains', empty));
  });
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  it.each([
    ['limit_exceeded', 'page_limit'],
    ['empty_queue', 'no_more_links'],
    ['force_stopped', 'stopped'],
    ['unexpected_exception', 'crawler_error'],
  ])('maps %s to %s', async (vendor, reason) => {
    wireSummary(vendor);
    const result = await createDataForSeoOnPageAuditProvider(cfg).getAuditResult('TASK_ID');
    expect(result.crawlStopReason).toBe(reason);
    expect(result.vendorPagesCrawled).toBe(1);
  });

  it.each([
    ['not reported', undefined],
    ['null while running', null],
    ['an undocumented value', 'site_was_tired'],
    ['an inherited object key', 'constructor'],
  ])('leaves the reason out when it is %s', async (_label, vendor) => {
    wireSummary(vendor);
    const result = await createDataForSeoOnPageAuditProvider(cfg).getAuditResult('TASK_ID');
    expect(result).not.toHaveProperty('crawlStopReason');
  });
});
