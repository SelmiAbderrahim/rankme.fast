/**
 * The owned-page stage requests the page itself first, follows up
 * to five redirects, scrapes the FINAL address, and fails with a real cause
 * (redirect loop/limit, non-HTML, HTTP status, robots) instead of "could not
 * be read". Redirect hops and addresses are validated by the shared SSRF
 * authority inside the prober; the prober is injected here.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ContentDocument } from '../../shared/providers/content-source.js';
import { VendorTimeoutError, VendorUnavailableError } from '../../shared/providers/errors.js';
import type { PageProber, PageProbeResult } from '../../shared/security/site-probe.js';
import { runOwnedStage, type PipelineDeps, type StageContext } from './content-analysis.pipeline.js';

const ctx: StageContext = {
  accountId: 'acct-1',
  siteId: 'site-1',
  analysisId: 'analysis-1',
  ownedUrl: 'https://example.com/',
  keyword: 'seo audits',
  locale: 'en',
  ownedDomain: 'example.com',
  correlationId: 'corr-1',
};

const document = (overrides: Partial<ContentDocument> = {}): ContentDocument => ({
  sourceUrl: 'https://example.com/en',
  statusCode: 200,
  title: 'A reasonable page title',
  description: 'A description.',
  canonical: 'https://example.com/en',
  robots: [],
  language: 'en',
  markdown: 'Words about seo audits for readers who want help. '.repeat(10),
  text: 'Words about seo audits.',
  headings: [{ level: 2, text: 'One' }],
  links: [],
  structuredData: [],
  contentHash: 'hash-1',
  capturedAt: new Date('2026-07-15T00:00:00Z'),
  ...overrides,
});

const probe = (overrides: Partial<PageProbeResult> = {}): PageProbeResult => ({
  url: 'https://example.com/',
  statusCode: 200,
  finalUrl: 'https://example.com/',
  redirectChain: [],
  contentType: 'text/html',
  failure: null,
  ...overrides,
});

function deps(options: {
  probeResult?: PageProbeResult;
  scrape?: () => Promise<unknown>;
  withProber?: boolean;
}) {
  const scrapePage = vi.fn(
    options.scrape ??
      (async () => ({
        document: document(),
        usage: { credits: 1, estimatedCostMicros: 1_000n, estimated: true as const },
      })),
  );
  const prober: PageProber = { probe: vi.fn(async () => options.probeResult ?? probe()) };
  const pipeline = {
    contentSource: { scrapePage, crawlSite: vi.fn() },
    ...(options.withProber === false ? {} : { pageProber: prober }),
    now: () => new Date('2026-07-15T12:00:00Z'),
    aiProviderOrder: ['fake'],
  } as unknown as PipelineDeps;
  return { pipeline, scrapePage, prober };
}

describe('runOwnedStage with a first-party request', () => {
  it('reads a root that redirects to a locale at its final address and records the chain', async () => {
    const { pipeline, scrapePage } = deps({
      probeResult: probe({
        finalUrl: 'https://example.com/en',
        redirectChain: [{ url: 'https://example.com/', status: 301 }],
      }),
    });
    const outcome = await runOwnedStage(ctx, pipeline);
    expect(scrapePage).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://example.com/en' }));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.artifact).toMatchObject({
        url: 'https://example.com/',
        finalUrl: 'https://example.com/en',
        redirectChain: [{ url: 'https://example.com/', status: 301 }],
      });
    }
  });

  it('scrapes the entry address when the redirect chain also hit a non-conclusive failure', async () => {
    const { pipeline, scrapePage } = deps({
      probeResult: probe({
        finalUrl: 'https://example.com/en',
        redirectChain: [{ url: 'https://example.com/', status: 301 }],
        failure: { kind: 'robots_blocked' },
      }),
    });
    await runOwnedStage(ctx, pipeline);
    expect(scrapePage).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://example.com/' }));
  });

  it('scrapes the entry address, with no redirect evidence, when the page does not redirect', async () => {
    const { pipeline, scrapePage } = deps({});
    const outcome = await runOwnedStage(ctx, pipeline);
    expect(scrapePage).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://example.com/' }));
    expect(outcome.ok && outcome.artifact).not.toHaveProperty('finalUrl');
  });

  it('behaves exactly as before when no prober is wired', async () => {
    const { pipeline, scrapePage } = deps({ withProber: false });
    const outcome = await runOwnedStage(ctx, pipeline);
    expect(outcome.ok).toBe(true);
    expect(scrapePage).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ kind: 'redirect_loop' }, 'redirect_loop', undefined],
    [{ kind: 'redirect_limit' }, 'redirect_limit', undefined],
    [{ kind: 'unsafe_redirect' }, 'unsafe_redirect', undefined],
    [{ kind: 'non_html', contentType: 'application/pdf' }, 'non_html', undefined],
    [{ kind: 'http_error', statusCode: 404 }, 'http_error', 404],
    [{ kind: 'http_error', statusCode: 410 }, 'http_error', 410],
  ] as const)('fails early on %j without spending a scrape', async (failure, reason, httpStatus) => {
    const chain = [{ url: 'https://example.com/', status: 301 }];
    const { pipeline, scrapePage } = deps({
      probeResult: probe({
        statusCode: failure.kind === 'http_error' ? failure.statusCode : null,
        finalUrl: null,
        redirectChain: chain,
        contentType: failure.kind === 'non_html' ? 'application/pdf' : null,
        failure,
      }),
    });
    const outcome = await runOwnedStage(ctx, pipeline);
    expect(scrapePage).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({
      ok: false,
      code: 'owned_page_unusable',
      failureReason: reason,
      fetchEvidence: { redirectChain: chain },
    });
    expect(outcome.ok === false && outcome.httpStatus).toBe(httpStatus);
  });

  it('records the media type of a non-HTML address without a redirect chain', async () => {
    const { pipeline } = deps({
      probeResult: probe({
        contentType: 'application/pdf',
        failure: { kind: 'non_html', contentType: 'application/pdf' },
      }),
    });
    const outcome = await runOwnedStage(ctx, pipeline);
    expect(outcome).toMatchObject({ ok: false, fetchEvidence: { contentType: 'application/pdf' } });
    expect(outcome.ok === false && outcome.fetchEvidence).not.toHaveProperty('redirectChain');
  });

  it.each([
    [403, { kind: 'http_error', statusCode: 403 }],
    [503, { kind: 'http_error', statusCode: 503 }],
  ] as const)('lets the scraper try a page our request got HTTP %i for (bot protection may differ)', async (statusCode, failure) => {
    const { pipeline, scrapePage } = deps({ probeResult: probe({ statusCode, failure }) });
    const outcome = await runOwnedStage(ctx, pipeline);
    expect(scrapePage).toHaveBeenCalledTimes(1);
    expect(outcome.ok).toBe(true);
  });

  it('does not fail a page just because robots.txt, a timeout, or a dead connection hit our own request', async () => {
    for (const failure of [{ kind: 'robots_blocked' }, { kind: 'timeout' }, { kind: 'unreachable' }] as const) {
      const { pipeline, scrapePage } = deps({ probeResult: probe({ statusCode: null, finalUrl: null, failure }) });
      const outcome = await runOwnedStage(ctx, pipeline);
      expect(scrapePage).toHaveBeenCalledTimes(1);
      expect(outcome.ok).toBe(true);
    }
  });

  it('explains an unreadable page with what our request saw: robots.txt, an HTTP status, or a timeout', async () => {
    const unreadable = async () => {
      throw new Error('could not extract content');
    };
    const robots = await runOwnedStage(
      ctx,
      deps({ probeResult: probe({ failure: { kind: 'robots_blocked' } }), scrape: unreadable }).pipeline,
    );
    expect(robots).toMatchObject({ ok: false, failureReason: 'robots_blocked' });

    const http = await runOwnedStage(
      ctx,
      deps({
        probeResult: probe({ statusCode: 403, failure: { kind: 'http_error', statusCode: 403 } }),
        scrape: unreadable,
      }).pipeline,
    );
    expect(http).toMatchObject({ ok: false, failureReason: 'http_error', httpStatus: 403 });

    const slow = await runOwnedStage(
      ctx,
      deps({ probeResult: probe({ statusCode: null, failure: { kind: 'timeout' } }), scrape: unreadable }).pipeline,
    );
    expect(slow).toMatchObject({ ok: false, failureReason: 'timeout' });

    const statusless = await runOwnedStage(
      ctx,
      deps({ probeResult: probe({ statusCode: null, failure: { kind: 'http_error' } }), scrape: unreadable }).pipeline,
    );
    expect(statusless).toMatchObject({ ok: false, failureReason: 'http_error' });
    expect(statusless.ok === false && statusless.httpStatus).toBeUndefined();
  });

  it('keeps a specific scraper classification over the probe', async () => {
    const outcome = await runOwnedStage(
      ctx,
      deps({
        probeResult: probe({ failure: { kind: 'robots_blocked' } }),
        scrape: async () => {
          throw new VendorTimeoutError('slow', { provider: 'firecrawl', operation: 'scrape' });
        },
      }).pipeline,
    );
    expect(outcome).toMatchObject({ ok: false, code: 'owned_fetch_failed', failureReason: 'timeout' });
    const retry = await runOwnedStage(
      ctx,
      deps({
        probeResult: probe({ failure: { kind: 'robots_blocked' } }),
        scrape: async () => {
          throw new VendorUnavailableError('down', { provider: 'firecrawl', operation: 'scrape' });
        },
      }).pipeline,
    );
    expect(retry).toMatchObject({ ok: false, failureReason: 'temporarily_unavailable' });
  });

  it('refines an empty page the same way and carries the evidence on an HTTP error from the scraper', async () => {
    const empty = await runOwnedStage(
      ctx,
      deps({
        probeResult: probe({ failure: { kind: 'robots_blocked' } }),
        scrape: async () => ({
          document: document({ title: null, markdown: '', headings: [], text: '' }),
          usage: { credits: 1, estimatedCostMicros: 1n, estimated: true },
        }),
      }).pipeline,
    );
    expect(empty).toMatchObject({ ok: false, failureReason: 'robots_blocked' });

    const emptyBlocked = await runOwnedStage(
      ctx,
      deps({
        probeResult: probe({ statusCode: 403, failure: { kind: 'http_error', statusCode: 403 } }),
        scrape: async () => ({
          document: document({ title: null, markdown: '', headings: [], text: '' }),
          usage: { credits: 1, estimatedCostMicros: 1n, estimated: true },
        }),
      }).pipeline,
    );
    expect(emptyBlocked).toMatchObject({ ok: false, failureReason: 'http_error', httpStatus: 403 });

    const emptyPlain = await runOwnedStage(
      ctx,
      deps({
        scrape: async () => ({
          document: document({ title: null, markdown: '', headings: [], text: '' }),
          usage: { credits: 1, estimatedCostMicros: 1n, estimated: true },
        }),
      }).pipeline,
    );
    expect(emptyPlain).toMatchObject({ ok: false, failureReason: 'empty_content' });
    expect(emptyPlain.ok === false && emptyPlain.httpStatus).toBeUndefined();

    const status = await runOwnedStage(
      ctx,
      deps({
        probeResult: probe({
          finalUrl: 'https://example.com/en',
          redirectChain: [{ url: 'https://example.com/', status: 302 }],
        }),
        scrape: async () => ({
          document: document({ statusCode: 500 }),
          usage: { credits: 1, estimatedCostMicros: 1n, estimated: true },
        }),
      }).pipeline,
    );
    expect(status).toMatchObject({
      ok: false,
      code: 'owned_fetch_failed',
      failureReason: 'http_error',
      httpStatus: 500,
      fetchEvidence: { finalUrl: 'https://example.com/en' },
    });
  });
});
