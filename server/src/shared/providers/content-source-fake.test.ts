import { describe, expect, it } from 'vitest';
import { UnsafeUrlError } from '../security/url-safety.js';
import {
  createFakeContentSourceProvider,
  fakeContentSourceInjection,
  type FakeContentSourceMode,
} from './content-source-fake.js';
import {
  createContentHash,
  crawlSiteInputSchema,
  scrapePageInputSchema,
} from './content-source.js';
import {
  ProviderError,
  VendorMalformedError,
  VendorQuotaError,
  VendorTimeoutError,
} from './errors.js';

const scrapeInput = {
  url: 'https://example.com/',
  formats: ['markdown', 'metadata'] as Array<'markdown' | 'metadata'>,
  timeoutMs: 1_000,
  maxCharacters: 1_000,
};

const crawlInput = {
  origin: 'https://example.com/',
  allowlistedPaths: [] as string[],
  maxPages: 2,
  depth: 2,
  concurrency: 2,
  timeoutMs: 2_000,
};

describe('content-source input contract and hash', () => {
  it('accepts only bounded public-operation shapes and hashes deterministically', () => {
    expect(scrapePageInputSchema.safeParse(scrapeInput).success).toBe(true);
    expect(scrapePageInputSchema.safeParse({ ...scrapeInput, formats: ['html'] }).success).toBe(false);
    expect(crawlSiteInputSchema.safeParse(crawlInput).success).toBe(true);
    expect(crawlSiteInputSchema.safeParse({ ...crawlInput, allowlistedPaths: ['not/absolute'] }).success).toBe(false);
    expect(createContentHash('u', 'm', 't')).toBe(createContentHash('u', 'm', 't'));
    expect(createContentHash('u', 'm', 't')).not.toBe(createContentHash('u', 'different', 't'));
  });
});

describe('createFakeContentSourceProvider', () => {
  it('returns deterministic owned and competitor documents with configurable variations', async () => {
    const provider = createFakeContentSourceProvider({
      clock: () => new Date('2026-07-15T00:00:00.000Z'),
      language: 'fr',
      metadataKeywords: ['résumé de podcast'],
      headings: [{ level: 3, text: 'Configured' }],
      links: [{ url: 'https://outside.example/', external: true }],
      structuredData: [{ type: 'Product', property: 'name', value: 'Synthetic' }],
      costMicrosPerCredit: 25n,
    });
    const owned = await provider.scrapePage({ ...scrapeInput, maxCharacters: 20, freshnessKey: 'v1' });
    expect(owned.document).toMatchObject({
      title: 'Owned example 1',
      language: 'fr',
      metadataKeywords: ['résumé de podcast'],
      headings: [{ level: 3, text: 'Configured' }],
      capturedAt: new Date('2026-07-15T00:00:00.000Z'),
    });
    expect(owned.document.markdown.length).toBeLessThanOrEqual(20);
    expect(owned.usage).toEqual({ credits: 1, estimatedCostMicros: 25n, estimated: true });

    const competitor = await provider.scrapePage({
      ...scrapeInput,
      url: 'https://competitor.example/page',
    });
    expect(competitor.document.title).toBe('Competitor example 1');
    expect(competitor.document.contentHash).toHaveLength(64);
  });

  it('bounds crawl pages, filters allowlisted paths, and computes usage', async () => {
    const provider = createFakeContentSourceProvider();
    const bounded = await provider.crawlSite(crawlInput);
    expect(bounded.documents).toHaveLength(2);
    expect(bounded.completion).toBe('complete');
    expect(bounded.usage.estimatedCostMicros).toBe(2_000n);

    const filtered = await provider.crawlSite({
      ...crawlInput,
      maxPages: 3,
      allowlistedPaths: ['/guides*'],
    });
    expect(filtered.documents.map((document) => new URL(document.sourceUrl).pathname)).toEqual(['/guides']);
  });

  it('returns deterministic partial and cancelled crawl states', async () => {
    const partial = await createFakeContentSourceProvider(fakeContentSourceInjection('partial')).crawlSite(crawlInput);
    expect(partial.completion).toBe('partial');
    expect(partial.failures).toEqual([
      { url: 'https://example.com/blocked', reason: 'robots', message: 'blocked by robots.txt' },
    ]);

    const cancelled = await createFakeContentSourceProvider({ mode: 'cancelled' }).crawlSite(crawlInput);
    expect(cancelled).toEqual({
      documents: [],
      failures: [],
      completion: 'cancelled',
      usage: { credits: 0, estimatedCostMicros: 0n, estimated: true },
    });

    const controller = new AbortController();
    controller.abort();
    await expect(
      createFakeContentSourceProvider().crawlSite({ ...crawlInput, signal: controller.signal }),
    ).resolves.toMatchObject({ completion: 'cancelled' });
  });

  it.each([
    ['timeout', VendorTimeoutError.name],
    ['malformed', VendorMalformedError.name],
    ['quota', VendorQuotaError.name],
    ['robots', ProviderError.name],
  ] satisfies Array<[FakeContentSourceMode, string]>)('injects %s failures', async (mode, errorName) => {
    await expect(
      createFakeContentSourceProvider(fakeContentSourceInjection(mode)).scrapePage(scrapeInput),
    ).rejects.toMatchObject({ name: errorName });
  });

  it('injects cancellation and SEC-URL redirect rejection', async () => {
    await expect(
      createFakeContentSourceProvider({ mode: 'cancelled' }).scrapePage(scrapeInput),
    ).rejects.toMatchObject({ retryable: false });
    await expect(
      createFakeContentSourceProvider({ mode: 'redirect-rejection' }).scrapePage(scrapeInput),
    ).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(
      createFakeContentSourceProvider({ mode: 'redirect-rejection' }).crawlSite(crawlInput),
    ).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it('maps invalid operation input to the shared malformed error', async () => {
    await expect(
      createFakeContentSourceProvider().scrapePage({ ...scrapeInput, maxCharacters: 0 }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
    await expect(
      createFakeContentSourceProvider().crawlSite({ ...crawlInput, concurrency: 0 }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });
});
