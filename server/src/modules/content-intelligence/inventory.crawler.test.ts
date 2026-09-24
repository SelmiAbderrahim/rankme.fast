/**
 * Content inventory crawler tests.
 *
 * Pure in-memory: a controllable `ContentSourceProvider` fake + an injected
 * `assertPublicUrlSafe` resolver (no live DNS). Covers URL safety, same-origin +
 * allow/exclude + default-denylist policy, canonical dedupe, per-page failure
 * tolerance, budget/quota/cancel/deadline stops, seed scraping, and the derived-
 * facts / excerpt-sanitization mapping.
 */
import { describe, expect, it } from 'vitest';
import {
  ProviderError,
  VendorQuotaError,
} from '../../shared/providers/errors.js';
import type { PublicUrlResolver } from '../../shared/security/url-safety.js';
import type {
  ContentDocument,
  ContentSourceProvider,
  CrawlSiteResult,
  ScrapePageResult,
} from '../../shared/providers/content-source.js';
import { crawlInventory, type CrawledInventoryPage } from './inventory.crawler.js';

const ORIGIN = 'https://example.com';

const resolver: PublicUrlResolver = async (hostname: string) =>
  hostname.startsWith('private.') || hostname === '127.0.0.1'
    ? [{ address: '127.0.0.1', family: 4 }]
    : [{ address: '93.184.216.34', family: 4 }];

function doc(url: string, over: Partial<ContentDocument> = {}): ContentDocument {
  return {
    sourceUrl: url,
    statusCode: 200,
    title: 'Example page',
    description: 'A description',
    canonical: url,
    robots: ['index', 'follow'],
    language: 'en',
    markdown: '# Example page',
    text: 'Example page body with several words here for counting.',
    headings: [
      { level: 1, text: 'Example page heading' },
      { level: 2, text: 'Deterministic content section' },
    ],
    links: [{ url: `${ORIGIN}/related`, external: false }],
    structuredData: [{ type: 'Article', property: 'headline', value: 'Example page' }],
    contentHash: `hash-${url}`,
    capturedAt: new Date('2026-07-20T00:00:00Z'),
    ...over,
  };
}

interface FakeOpts {
  crawl?: Partial<CrawlSiteResult>;
  crawlThrow?: unknown;
  scrape?: (url: string) => ScrapePageResult;
  scrapeThrow?: unknown;
}

function makeSource(opts: FakeOpts = {}): ContentSourceProvider {
  return {
    async crawlSite(): Promise<CrawlSiteResult> {
      if (opts.crawlThrow) throw opts.crawlThrow;
      return {
        documents: opts.crawl?.documents ?? [doc(`${ORIGIN}/`), doc(`${ORIGIN}/guides`)],
        failures: opts.crawl?.failures ?? [],
        completion: opts.crawl?.completion ?? 'complete',
        usage: opts.crawl?.usage ?? {
          credits: 2,
          estimatedCostMicros: 2_000n,
          estimated: true,
        },
      };
    },
    async scrapePage(input): Promise<ScrapePageResult> {
      if (opts.scrapeThrow) throw opts.scrapeThrow;
      const scraped = opts.scrape?.(input.url) ?? {
        document: doc(input.url),
        usage: { credits: 1, estimatedCostMicros: 1_000n, estimated: true },
      };
      return scraped;
    },
  };
}

const BOUNDS = {
  maxCharacters: 50_000,
  timeoutMs: 120_000,
  costCeilingMicros: 1_000_000,
  depth: 2,
  concurrency: 3,
};

function input(over: Partial<Parameters<typeof crawlInventory>[0]> = {}) {
  return {
    origin: ORIGIN,
    pageLimit: 100,
    allowedPaths: [],
    excludedPaths: [],
    sitemapSeeds: [],
    ...over,
  };
}

describe('crawlInventory', () => {
  it('crawls the origin and persists each admitted page incrementally', async () => {
    const persisted: CrawledInventoryPage[] = [];
    const result = await crawlInventory(input(), BOUNDS, {
      contentSource: makeSource(),
      resolver,
      onPage: async (p) => {
        persisted.push(p);
      },
    });
    expect(result.completion).toBe('complete');
    expect(result.pagesProcessed).toBe(2);
    expect(result.pagesFailed).toBe(0);
    expect(persisted).toHaveLength(2);
    expect(result.costMicros).toBe(2_000);
    // Facts are derived, never raw HTML.
    expect(persisted[0]!.facts.hasSchemaOrgArticle).toBe(true);
    expect(persisted[0]!.facts.wordCount).toBeGreaterThan(0);
  });

  it('works without an onPage callback', async () => {
    const result = await crawlInventory(input(), BOUNDS, {
      contentSource: makeSource(),
      resolver,
    });
    expect(result.pages).toHaveLength(2);
  });

  it('marks the run partial when the provider reports page failures', async () => {
    const result = await crawlInventory(input(), BOUNDS, {
      contentSource: makeSource({
        crawl: {
          documents: [doc(`${ORIGIN}/`)],
          failures: [{ url: `${ORIGIN}/blocked`, reason: 'robots', message: 'robots' }],
          completion: 'partial',
          usage: { credits: 1, estimatedCostMicros: 1_000n, estimated: true },
        },
      }),
      resolver,
    });
    expect(result.completion).toBe('partial');
    expect(result.pagesFailed).toBe(1);
  });

  it('skips default-denylisted paths (login/admin/cart/…)', async () => {
    const result = await crawlInventory(input(), BOUNDS, {
      contentSource: makeSource({
        crawl: { documents: [doc(`${ORIGIN}/admin/panel`), doc(`${ORIGIN}/guides`)] },
      }),
      resolver,
    });
    expect(result.pagesProcessed).toBe(1);
    expect(result.pagesSkipped).toBe(1);
    expect(result.pages[0]!.facts.url).toBe(`${ORIGIN}/guides`);
  });

  it('honours excluded path prefixes', async () => {
    const result = await crawlInventory(input({ excludedPaths: ['/private'] }), BOUNDS, {
      contentSource: makeSource({
        crawl: { documents: [doc(`${ORIGIN}/private/x`), doc(`${ORIGIN}/public`)] },
      }),
      resolver,
    });
    expect(result.pages.map((p) => p.facts.url)).toEqual([`${ORIGIN}/public`]);
  });

  it('honours an allowlist (glob) and rejects everything outside it', async () => {
    const result = await crawlInventory(input({ allowedPaths: ['/blog*'] }), BOUNDS, {
      contentSource: makeSource({
        crawl: { documents: [doc(`${ORIGIN}/blog/post`), doc(`${ORIGIN}/pricing`)] },
      }),
      resolver,
    });
    expect(result.pages.map((p) => p.facts.url)).toEqual([`${ORIGIN}/blog/post`]);
  });

  it('dedupes on the canonical URL', async () => {
    const canonical = `${ORIGIN}/canonical`;
    const result = await crawlInventory(input(), BOUNDS, {
      contentSource: makeSource({
        crawl: {
          documents: [
            doc(`${ORIGIN}/a`, { canonical }),
            doc(`${ORIGIN}/b`, { canonical }),
          ],
        },
      }),
      resolver,
    });
    expect(result.pagesProcessed).toBe(1);
    expect(result.pagesSkipped).toBe(1);
  });

  it('counts an unsafe (private-resolving) discovered URL as a failure and continues', async () => {
    const result = await crawlInventory(input(), BOUNDS, {
      contentSource: makeSource({
        crawl: {
          documents: [doc(`https://private.example.com/x`), doc(`${ORIGIN}/ok`)],
        },
      }),
      resolver,
    });
    expect(result.pagesFailed).toBe(1);
    expect(result.pagesProcessed).toBe(1);
    expect(result.pages[0]!.facts.url).toBe(`${ORIGIN}/ok`);
  });

  it('skips a safe but off-origin document', async () => {
    const result = await crawlInventory(input(), BOUNDS, {
      contentSource: makeSource({
        crawl: { documents: [doc(`https://other.com/x`), doc(`${ORIGIN}/ok`)] },
      }),
      resolver,
    });
    expect(result.pagesSkipped).toBe(1);
    expect(result.pagesProcessed).toBe(1);
  });

  it('stops on the hard cost budget', async () => {
    const result = await crawlInventory(input(), { ...BOUNDS, costCeilingMicros: 1_500 }, {
      contentSource: makeSource({
        crawl: {
          documents: [doc(`${ORIGIN}/a`), doc(`${ORIGIN}/b`)],
          usage: { credits: 2, estimatedCostMicros: 2_000n, estimated: true },
        },
      }),
      resolver,
    });
    // perPageCost = ceil(2000/2) = 1000; first page ok (1000 <= 1500), second
    // would push to 2000 > 1500 → budget stop.
    expect(result.completion).toBe('budget');
    expect(result.pagesProcessed).toBe(1);
  });

  it('stops with completion "complete" once the page limit is reached', async () => {
    const result = await crawlInventory(input({ pageLimit: 1 }), BOUNDS, {
      contentSource: makeSource({
        crawl: { documents: [doc(`${ORIGIN}/a`), doc(`${ORIGIN}/b`)] },
      }),
      resolver,
    });
    expect(result.pagesProcessed).toBe(1);
    expect(result.completion).toBe('complete');
  });

  it('returns cancelled when the provider reports a cancelled crawl', async () => {
    const result = await crawlInventory(input(), BOUNDS, {
      contentSource: makeSource({ crawl: { completion: 'cancelled', documents: [] } }),
      resolver,
    });
    expect(result.completion).toBe('cancelled');
  });

  it('returns cancelled when the abort signal fires before a page is admitted', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await crawlInventory(input(), BOUNDS, {
      contentSource: makeSource(),
      resolver,
      signal: controller.signal,
    });
    expect(result.completion).toBe('cancelled');
    expect(result.pagesProcessed).toBe(0);
  });

  it('returns quota when the provider raises a quota error', async () => {
    const result = await crawlInventory(input(), BOUNDS, {
      contentSource: makeSource({
        crawlThrow: new VendorQuotaError('quota', {
          provider: 'fake',
          operation: 'crawl',
          retryAfterSeconds: 60,
        }),
      }),
      resolver,
    });
    expect(result.completion).toBe('quota');
    expect(result.pagesProcessed).toBe(0);
  });

  it('rethrows a non-quota provider error (processor maps it to crawl_failed)', async () => {
    await expect(
      crawlInventory(input(), BOUNDS, {
        contentSource: makeSource({
          crawlThrow: new ProviderError('boom', false, { provider: 'fake', operation: 'crawl' }),
        }),
        resolver,
      }),
    ).rejects.toThrow(ProviderError);
  });

  it('stops partial when the deadline is exceeded mid-crawl', async () => {
    let calls = 0;
    // First call computes the deadline; subsequent calls jump past it.
    const now = () => {
      calls += 1;
      return calls <= 1 ? 0 : 10_000_000;
    };
    const result = await crawlInventory(input(), { ...BOUNDS, timeoutMs: 1 }, {
      contentSource: makeSource(),
      resolver,
      now,
    });
    expect(result.completion).toBe('partial');
    expect(result.pagesProcessed).toBe(0);
  });

  it('scrapes explicit sitemap seeds via scrapePage and admits them', async () => {
    const result = await crawlInventory(
      input({ sitemapSeeds: [`${ORIGIN}/seeded`] }),
      BOUNDS,
      {
        contentSource: makeSource({ crawl: { documents: [doc(`${ORIGIN}/`)] } }),
        resolver,
      },
    );
    expect(result.pages.map((p) => p.facts.url)).toContain(`${ORIGIN}/seeded`);
  });

  it('counts an unsafe seed as a failure and a denylisted seed as skipped', async () => {
    const result = await crawlInventory(
      input({
        sitemapSeeds: [
          'https://private.example.com/sitemap',
          `${ORIGIN}/admin/secret`,
          `${ORIGIN}/keep`,
        ],
      }),
      BOUNDS,
      { contentSource: makeSource({ crawl: { documents: [] } }), resolver },
    );
    expect(result.pagesFailed).toBe(1);
    expect(result.pagesSkipped).toBe(1);
    expect(result.pages.map((p) => p.facts.url)).toEqual([`${ORIGIN}/keep`]);
  });

  it('stops with quota when a seed scrape raises a quota error', async () => {
    const result = await crawlInventory(
      input({ sitemapSeeds: [`${ORIGIN}/seed`] }),
      BOUNDS,
      {
        contentSource: makeSource({
          crawl: { documents: [] },
          scrapeThrow: new VendorQuotaError('quota', {
            provider: 'fake',
            operation: 'scrape',
            retryAfterSeconds: 30,
          }),
        }),
        resolver,
      },
    );
    expect(result.completion).toBe('quota');
  });

  it('counts a non-quota seed scrape error as a page failure and continues', async () => {
    let call = 0;
    const source = makeSource({ crawl: { documents: [] } });
    const original = source.scrapePage.bind(source);
    source.scrapePage = async (i) => {
      call += 1;
      if (call === 1) throw new ProviderError('nope', false, { provider: 'fake', operation: 'scrape' });
      return original(i);
    };
    const result = await crawlInventory(
      input({ sitemapSeeds: [`${ORIGIN}/bad`, `${ORIGIN}/good`] }),
      BOUNDS,
      { contentSource: source, resolver },
    );
    expect(result.pagesFailed).toBe(1);
    expect(result.pages.map((p) => p.facts.url)).toEqual([`${ORIGIN}/good`]);
  });

  it('stops cancelled when the signal aborts before the seed phase', async () => {
    const controller = new AbortController();
    const source = makeSource({ crawl: { documents: [doc(`${ORIGIN}/`)] } });
    const result = await crawlInventory(
      input({ sitemapSeeds: [`${ORIGIN}/seed`] }),
      BOUNDS,
      {
        contentSource: source,
        resolver,
        signal: controller.signal,
        onPage: async () => {
          controller.abort();
        },
      },
    );
    // First (crawl) page admitted, then the seed phase sees the aborted signal.
    expect(result.completion).toBe('cancelled');
  });

  it('stops partial when the deadline is exceeded before the seed phase', async () => {
    let calls = 0;
    const now = () => {
      calls += 1;
      // deadline compute (1) + crawl-page handleDoc deadline check (2) stay
      // under; the seed-phase deadline check (3) jumps past it.
      return calls <= 2 ? 0 : 10_000_000;
    };
    const result = await crawlInventory(
      input({ sitemapSeeds: [`${ORIGIN}/seed`] }),
      { ...BOUNDS, timeoutMs: 1 },
      { contentSource: makeSource({ crawl: { documents: [doc(`${ORIGIN}/`)] } }), resolver, now },
    );
    expect(result.completion).toBe('partial');
    expect(result.pagesProcessed).toBe(1);
  });

  it('runs without an injected resolver when no URL needs validation (empty crawl)', async () => {
    const result = await crawlInventory(input(), BOUNDS, {
      contentSource: makeSource({ crawl: { documents: [], completion: 'complete' } }),
    });
    expect(result.completion).toBe('complete');
    expect(result.pagesProcessed).toBe(0);
  });

  it('caps derived term sets and the out-link list at their schema ceilings', async () => {
    // Over-long title (> 1024 chars) exercises the length-cap slice; the many
    // distinct words exercise the tokenize maxTerms break.
    const longTitle = Array.from({ length: 300 }, (_, i) => `word${i}`).join(' ');
    const manyLinks = Array.from({ length: 501 }, (_, i) => ({
      url: `${ORIGIN}/link-${i}`,
      external: false,
    }));
    const result = await crawlInventory(input(), BOUNDS, {
      contentSource: makeSource({
        crawl: { documents: [doc(`${ORIGIN}/x`, { title: longTitle, links: manyLinks })] },
      }),
      resolver,
    });
    const facts = result.pages[0]!.facts;
    expect(facts.title!.length).toBe(1_024);
    // primaryTopics capped at 5 (maxTerms break).
    expect(facts.primaryTopics).toHaveLength(5);
    // internalOutLinks capped at 500 (the >= 500 break).
    expect(facts.internalOutLinks).toHaveLength(500);
    expect(facts.internalLinkCount).toBe(501);
  });

  it('stops at the page limit during the seed phase', async () => {
    const result = await crawlInventory(
      input({ pageLimit: 1, sitemapSeeds: [`${ORIGIN}/seed`] }),
      BOUNDS,
      { contentSource: makeSource({ crawl: { documents: [doc(`${ORIGIN}/`)] } }), resolver },
    );
    // The single crawl page fills the limit; the seed hits the limit guard.
    expect(result.pagesProcessed).toBe(1);
    expect(result.completion).toBe('complete');
    expect(result.pages.map((p) => p.facts.url)).toEqual([`${ORIGIN}/`]);
  });

  it('derives facts: missing title, noindex, non-article schema, filtered out-links', async () => {
    const result = await crawlInventory(input(), BOUNDS, {
      contentSource: makeSource({
        crawl: {
          documents: [
            doc(`${ORIGIN}/x`, {
              title: null,
              canonical: null,
              robots: ['noindex'],
              structuredData: [{ type: 'WebPage', property: 'name', value: 'x' }],
              links: [
                { url: `${ORIGIN}/inside`, external: false },
                { url: 'https://other.com/out', external: false },
                { url: 'not-a-url', external: false },
                { url: 'https://cdn.example.net/asset', external: true },
              ],
            }),
          ],
        },
      }),
      resolver,
    });
    const facts = result.pages[0]!.facts;
    expect(facts.title).toBeNull();
    expect(facts.canonical).toBeNull();
    expect(facts.qualityFlags).toEqual(expect.arrayContaining(['noindex', 'missing_title']));
    expect(facts.hasSchemaOrgArticle).toBe(false);
    expect(facts.internalOutLinks).toEqual([`${ORIGIN}/inside`]);
    expect(facts.externalLinkCount).toBe(1);
  });

  it('sanitizes the excerpt: strips control chars, HTML markers, and neutralizes deep nesting', async () => {
    const depth = 8;
    const nested = `${'<!doc'.repeat(depth)}<!doctype${'type'.repeat(depth)}`;
    const rawText = `clean \u0007 text <script>evil</script> ${nested}`;
    const result = await crawlInventory(input(), BOUNDS, {
      contentSource: makeSource({ crawl: { documents: [doc(`${ORIGIN}/x`, { text: rawText })] } }),
      resolver,
    });
    const excerpt = result.pages[0]!.excerpt;
    expect(excerpt).not.toMatch(/<script|<!doctype/i);
    expect(excerpt).not.toContain('\u0007');
    expect(excerpt).not.toContain('<');
    expect(excerpt).not.toContain('>');
  });
});
