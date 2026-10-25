import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { vendorMockServer } from '../../testing/fixtures/mock-vendor.js';
import { createDataForSeoOnPageAuditProvider } from './onpage.js';

const envelope = (result: object) => ({ status_code: 20000,
  tasks: [{ id: 'TASK_ID', status_code: 20000, result: [result] }] });
const provider = createDataForSeoOnPageAuditProvider({ login: 'sandbox-login', password: 'sandbox-password',
  baseUrl: 'https://dataforseo.mock/v3', timeoutMs: 100, maxRetries: 0, backoffBaseMs: 1,
  random: () => 0, pagesPerRequest: 100 });

const row = (url: string, status: number, extra: Record<string, unknown> = {}) =>
  ({ url, status_code: status, meta: {}, checks: {}, onpage_score: 80, ...extra });

function wire(items: object[], nonIndexable: object[] = []): void {
  vendorMockServer.use(
    http.get('*/on_page/summary/*', () => HttpResponse.json(envelope({ crawl_progress: 'finished',
      crawl_status: { pages_crawled: items.length }, domain_info: { checks: {} } }))),
    http.post('*/on_page/pages', () => HttpResponse.json(envelope({ items, total_items_count: items.length }))),
    http.post('*/on_page/links', () => HttpResponse.json(envelope({ items: [] }))),
    http.post('*/on_page/non_indexable', () => HttpResponse.json(envelope({ items: nonIndexable }))),
    http.post('*/on_page/duplicate_tags', () => HttpResponse.json(envelope({ items: [] }))),
    http.post('*/on_page/redirect_chains', () => HttpResponse.json(envelope({ items: [] }))),
  );
}

describe('crawler fetch evidence', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  it('records the redirect target, media type and error status the crawler row carries', async () => {
    wire([
      row('https://example.com/old', 301, { location: '/new', media_type: 'text/html' }),
      row('https://example.com/odd', 302, { location: 'http://[invalid' }),
      row('https://example.com/nowhere', 307),
      row('https://example.com/gone', 404, { media_type: 'text/html; charset=utf-8' }),
      row('https://example.com/file.pdf', 200, { media_type: 'application/pdf' }),
      row('https://example.com/ok', 200, { media_type: 'Text/HTML; charset=utf-8' }),
      row('https://example.com/xhtml', 200, { media_type: 'application/xhtml+xml' }),
      row('https://example.com/plain', 200),
    ]);
    const { pages } = await provider.getAuditResult('TASK_ID');
    const byUrl = new Map(pages.map((page) => [page.url, page]));
    expect(byUrl.get('https://example.com/old')).toMatchObject({
      finalUrl: 'https://example.com/new',
      redirectChain: [{ url: 'https://example.com/old', status: 301 }],
      contentType: 'text/html',
    });
    expect(byUrl.get('https://example.com/old')).not.toHaveProperty('fetchFailure');
    // A redirect with no usable location records no target.
    expect(byUrl.get('https://example.com/odd')).not.toHaveProperty('finalUrl');
    expect(byUrl.get('https://example.com/nowhere')).not.toHaveProperty('finalUrl');
    expect(byUrl.get('https://example.com/gone')).toMatchObject({
      contentType: 'text/html',
      fetchFailure: { kind: 'http_error', statusCode: 404 },
    });
    expect(byUrl.get('https://example.com/file.pdf')).toMatchObject({
      contentType: 'application/pdf',
      fetchFailure: { kind: 'non_html', contentType: 'application/pdf' },
    });
    for (const url of ['https://example.com/ok', 'https://example.com/xhtml', 'https://example.com/plain']) {
      expect(byUrl.get(url)).not.toHaveProperty('fetchFailure');
    }
    expect(byUrl.get('https://example.com/plain')).not.toHaveProperty('contentType');
  });

  it('keeps a robots.txt exclusion as the recorded cause without overwriting another failure', async () => {
    wire(
      [
        row('https://example.com/private', 200),
        row('https://example.com/blocked-and-missing', 404),
        row('https://example.com/noindex', 200),
      ],
      [
        { url: 'https://example.com/private', reason: 'robots_txt' },
        { url: 'https://example.com/blocked-and-missing', reason: 'Blocked by robots.txt' },
        { url: 'https://example.com/noindex', reason: 'noindex_tag' },
      ],
    );
    const { pages } = await provider.getAuditResult('TASK_ID');
    const byUrl = new Map(pages.map((page) => [page.url, page]));
    expect(byUrl.get('https://example.com/private')).toMatchObject({
      isIndexable: false,
      fetchFailure: { kind: 'robots_blocked' },
    });
    expect(byUrl.get('https://example.com/blocked-and-missing')?.fetchFailure).toEqual({
      kind: 'http_error',
      statusCode: 404,
    });
    expect(byUrl.get('https://example.com/noindex')).toMatchObject({ isIndexable: false });
    expect(byUrl.get('https://example.com/noindex')).not.toHaveProperty('fetchFailure');
  });
});
