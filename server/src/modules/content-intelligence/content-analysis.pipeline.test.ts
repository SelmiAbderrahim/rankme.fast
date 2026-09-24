/**
 * Content Intelligence — pipeline stage handler tests (Phase A6).
 *
 * Every stage handler is a pure function of injected provider fakes, so each
 * outcome (ok / degraded / thrown), every sanitizer branch, the budget
 * ceilings, and every failure-reason mapping are pinned here without any
 * network, DNS, or vendor dependency. The SEC-URL authority is mocked at the
 * module seam so competitor selection is deterministic.
 */
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentDocument } from '../../shared/providers/content-source.js';
import {
  ProviderError,
  VendorAuthError,
  VendorQuotaError,
  VendorTimeoutError,
} from '../../shared/providers/errors.js';
import {
  hashInputs,
  runBriefStage,
  runCompetitorsStage,
  runDraftStage,
  runOwnedStage,
  runSerpStage,
  type PipelineDeps,
  type StageContext,
} from './content-analysis.pipeline.js';

vi.mock('../../shared/security/url-safety.js', () => ({
  assertPublicUrlSafe: vi.fn(async (url: string) => {
    if (url.includes('unsafe')) throw new Error('private address blocked');
    return url;
  }),
}));

function makeDocument(overrides: Partial<ContentDocument> = {}): ContentDocument {
  return {
    sourceUrl: 'https://example.com/p',
    statusCode: 200,
    title: 'A very reasonable page title',
    description: 'A description that is long enough to look like a real one here.',
    canonical: 'https://example.com/p',
    robots: [],
    language: 'en',
    markdown:
      'Intro words about the topic seo audits and more helpful details for readers. '.repeat(10),
    text: 'Intro words about the topic seo audits and more helpful details.',
    headings: [
      { level: 2, text: 'One' },
      { level: 2, text: 'Two' },
    ],
    links: [
      { url: 'https://example.com/a', external: false },
      { url: 'https://other.com/x', external: true },
    ],
    structuredData: [{ type: 'Article', property: 'headline', value: 'x' }],
    contentHash: 'hash-1',
    capturedAt: new Date('2026-07-15T00:00:00Z'),
    ...overrides,
  };
}

function scrapeResult(doc: ContentDocument, costMicros = 1_000n) {
  return {
    document: doc,
    usage: { credits: 1, estimatedCostMicros: costMicros, estimated: true as const },
  };
}

function aiResult(object: object, overrides: Partial<{ cost: bigint | undefined }> = {}) {
  const cost = 'cost' in overrides ? overrides.cost : 2_000n;
  return {
    trust: 'untrusted',
    status: 'complete',
    object,
    warnings: [],
    qualityFlags: ['complete'],
    provenance: {
      task: 'content_brief',
      profileVersion: '1.0.0',
      outputSchemaVersion: '1',
      promptTemplateId: 't',
      promptTemplateVersion: '1',
      provider: 'fake',
      model: 'fake-1',
      finishReason: 'stop',
      attempts: 1,
      fallbackUsed: false,
      latencyMs: 5,
      actualOrEstimatedCostMicros: cost,
    },
    classification: { generatedFields: 'untrusted', renderAs: 'text_only' },
  };
}

function makeCtx(overrides: Partial<StageContext> = {}): StageContext {
  return {
    accountId: 'acct-1',
    siteId: 'site-1',
    analysisId: 'analysis-1',
    ownedUrl: 'https://example.com/p',
    keyword: 'seo audits',
    locale: 'en',
    ownedDomain: 'example.com',
    correlationId: 'corr-1',
    ...overrides,
  };
}

function makeDeps(overrides: Partial<Record<keyof PipelineDeps, unknown>> = {}): PipelineDeps {
  return {
    contentSource: {
      scrapePage: vi.fn(async () => scrapeResult(makeDocument())),
      crawlSite: vi.fn(),
    },
    keyword: {
      getMetrics: vi.fn(async () => [
        { keyword: 'seo audits', searchVolume: 100, difficulty: 40, cpc: null, monthlySearches: [] },
      ]),
      classifyIntent: vi.fn(async () => [
        { keyword: 'seo audits', intent: 'informational', confidence: 0.9 },
      ]),
    },
    rank: {
      checkRank: vi.fn(async () => ({
        position: 4,
        serpTopUrls: [] as string[],
        checkedAt: new Date('2026-07-15T00:00:00Z'),
      })),
    },
    ai: {
      preflight: vi.fn(),
      run: vi.fn(async () =>
        aiResult({ title: 'T', audience: 'A', outline: ['o'], citations: [] }),
      ),
    },
    now: () => new Date('2026-07-15T12:00:00Z'),
    aiProviderOrder: ['fake'],
    ...overrides,
  } as PipelineDeps;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('hashInputs', () => {
  it('is a sha256 over the pipe-joined parts, order-sensitive', () => {
    expect(hashInputs('a', 'b')).toBe(
      createHash('sha256').update('a|b').digest('hex'),
    );
    expect(hashInputs('a', 'b')).not.toBe(hashInputs('b', 'a'));
    expect(hashInputs()).toBe(createHash('sha256').update('').digest('hex'));
  });
});

describe('runOwnedStage', () => {
  it('returns parsed facts, sanitized excerpt, and the scrape cost on success', async () => {
    const deps = makeDeps();
    const outcome = await runOwnedStage(makeCtx(), deps);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.costMicros).toBe(1_000);
    expect(outcome.artifact).toMatchObject({
      url: 'https://example.com/p',
      title: 'A very reasonable page title',
      headingCount: 2,
      internalLinkCount: 1,
      externalLinkCount: 1,
      schemaTypes: ['Article'],
      hasSchemaOrgArticle: true,
      contentHash: 'hash-1',
    });
    expect(outcome.artifact.wordCount).toBeGreaterThan(20);
    expect(deps.contentSource.scrapePage).toHaveBeenCalledWith({
      url: 'https://example.com/p',
      formats: ['markdown', 'metadata'],
      timeoutMs: 60_000,
      maxCharacters: 200_000,
    });
  });

  it('sanitizes control characters, script/iframe/doctype markers out of the excerpt', async () => {
    const markdown =
      'A\u0000\u0001\u0008\u000B\u001F\u007FB before ' +
      '<script type="text/javascript">alert("x")</script> ' +
      '<IFRAME src="https://evil.example"></IFRAME> ' +
      '<!DOCTYPE html> after';
    const deps = makeDeps({
      contentSource: {
        scrapePage: vi.fn(async () => scrapeResult(makeDocument({ markdown }))),
        crawlSite: vi.fn(),
      },
    });
    const outcome = await runOwnedStage(makeCtx(), deps);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const { excerpt } = outcome.artifact;
    expect(excerpt).toContain('A B before');
    expect(excerpt).toContain('after');
    expect(excerpt).not.toMatch(/<script|<iframe|<!doctype/i);
    expect(excerpt.includes('\u0000')).toBe(false);
  });

  it('bounds the scan to 32k input characters and caps the excerpt at 8k', async () => {
    const markdown = `${'word '.repeat(6_500)}TAIL_MARKER_BEYOND_32K`;
    expect(markdown.length).toBeGreaterThan(32_000);
    const deps = makeDeps({
      contentSource: {
        scrapePage: vi.fn(async () => scrapeResult(makeDocument({ markdown }))),
        crawlSite: vi.fn(),
      },
    });
    const outcome = await runOwnedStage(makeCtx(), deps);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.artifact.excerpt).toHaveLength(8_000);
    expect(outcome.artifact.excerpt).not.toContain('TAIL_MARKER_BEYOND_32K');
  });

  it('handles absent metadata, links, headings, and structured data (null facts)', async () => {
    const bare = makeDocument({
      title: null,
      description: null,
      canonical: null,
      language: null,
    });
    delete (bare as Partial<ContentDocument>).links;
    delete (bare as Partial<ContentDocument>).headings;
    delete (bare as Partial<ContentDocument>).structuredData;
    const deps = makeDeps({
      contentSource: {
        scrapePage: vi.fn(async () => scrapeResult(bare)),
        crawlSite: vi.fn(),
      },
    });
    const outcome = await runOwnedStage(makeCtx(), deps);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.artifact).toMatchObject({
      title: null,
      description: null,
      canonical: null,
      language: null,
      headingCount: 0,
      internalLinkCount: 0,
      externalLinkCount: 0,
      schemaTypes: [],
      hasSchemaOrgArticle: false,
    });
  });

  it('dedupes schema types, drops empty ones, and caps the list at 50', async () => {
    const structuredData = [
      { type: 'Article', property: 'p', value: 'v' },
      { type: 'Article', property: 'q', value: 'v' },
      { type: '', property: 'r', value: 'v' },
      ...Array.from({ length: 60 }, (_, i) => ({
        type: `Type${i}`,
        property: 'p',
        value: 'v',
      })),
    ];
    const deps = makeDeps({
      contentSource: {
        scrapePage: vi.fn(async () => scrapeResult(makeDocument({ structuredData }))),
        crawlSite: vi.fn(),
      },
    });
    const outcome = await runOwnedStage(makeCtx(), deps);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.artifact.schemaTypes).toHaveLength(50);
    expect(outcome.artifact.schemaTypes[0]).toBe('Article');
    expect(new Set(outcome.artifact.schemaTypes).size).toBe(50);
    expect(outcome.artifact.hasSchemaOrgArticle).toBe(true);
  });

  it('treats title-only, headings-only, and words-only pages as usable', async () => {
    const variants: Array<Partial<ContentDocument>> = [
      { title: 'Just a title', markdown: '', headings: [] },
      { title: null, markdown: '', headings: [{ level: 2, text: 'H' }] },
      { title: null, markdown: 'twenty words exactly '.repeat(10), headings: [] },
    ];
    for (const variant of variants) {
      const deps = makeDeps({
        contentSource: {
          scrapePage: vi.fn(async () =>
            scrapeResult(makeDocument({ structuredData: [], ...variant })),
          ),
          crawlSite: vi.fn(),
        },
      });
      const outcome = await runOwnedStage(makeCtx(), deps);
      expect(outcome.ok).toBe(true);
    }
  });

  it('reports owned_page_unusable for an empty page and a whitespace-only title', async () => {
    for (const title of [null, '   ']) {
      const deps = makeDeps({
        contentSource: {
          scrapePage: vi.fn(async () =>
            scrapeResult(
              makeDocument({ title, markdown: 'too few words', headings: [], structuredData: [] }),
            ),
          ),
          crawlSite: vi.fn(),
        },
      });
      const outcome = await runOwnedStage(makeCtx(), deps);
      expect(outcome).toEqual({
        ok: false,
        code: 'owned_page_unusable',
        reason: 'no usable content',
      });
    }
  });

  it('maps scrape rejections to owned_page_unusable with a bounded reason', async () => {
    const long = new Error('x'.repeat(500));
    const deps = makeDeps({
      contentSource: {
        scrapePage: vi.fn(async () => {
          throw long;
        }),
        crawlSite: vi.fn(),
      },
    });
    const outcome = await runOwnedStage(makeCtx(), deps);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('owned_page_unusable');
    expect(outcome.reason).toHaveLength(200);

    const nonError = makeDeps({
      contentSource: {
        scrapePage: vi.fn(async () => {
          throw 'nope';
        }),
        crawlSite: vi.fn(),
      },
    });
    const fallback = await runOwnedStage(makeCtx(), nonError);
    expect(fallback).toMatchObject({ ok: false, reason: 'scrape failed' });
  });

  it('classifies a retryable vendor fault as owned_fetch_failed; non-retryable stays owned_page_unusable', async () => {
    const errCtx = { provider: 'firecrawl', operation: 'scrape' };
    const retryableThrows = [
      new VendorTimeoutError('scrape timed out', errCtx),
      new VendorQuotaError('quota', { ...errCtx, retryAfterSeconds: 30 }),
    ];
    for (const err of retryableThrows) {
      const deps = makeDeps({
        contentSource: {
          scrapePage: vi.fn(async () => {
            throw err;
          }),
          crawlSite: vi.fn(),
        },
      });
      expect(await runOwnedStage(makeCtx(), deps)).toMatchObject({
        ok: false,
        code: 'owned_fetch_failed',
      });
    }

    // A non-retryable ProviderError (e.g. robots-block) is a genuine
    // owned-page problem, not a transient fault.
    const blocked = makeDeps({
      contentSource: {
        scrapePage: vi.fn(async () => {
          throw new ProviderError('blocked by robots.txt', false, errCtx);
        }),
        crawlSite: vi.fn(),
      },
    });
    expect(await runOwnedStage(makeCtx(), blocked)).toMatchObject({
      ok: false,
      code: 'owned_page_unusable',
    });

    // A credential rejection (401/403) is an operator misconfiguration —
    // never the user's page, never transient.
    const rejected = makeDeps({
      contentSource: {
        scrapePage: vi.fn(async () => {
          throw new VendorAuthError('credentials rejected (HTTP 403)', errCtx);
        }),
        crawlSite: vi.fn(),
      },
    });
    expect(await runOwnedStage(makeCtx(), rejected)).toMatchObject({
      ok: false,
      code: 'provider_unavailable',
      reason: 'credentials rejected (HTTP 403)',
    });
  });

  it('normalizes vendor usage micros: negative and non-finite values cost zero', async () => {
    const cases: Array<[bigint, number]> = [
      [1_234n, 1_234],
      [-5n, 0],
      [10n ** 400n, 0], // Number() overflows to Infinity → non-finite → 0
    ];
    for (const [micros, expected] of cases) {
      const deps = makeDeps({
        contentSource: {
          scrapePage: vi.fn(async () => scrapeResult(makeDocument(), micros)),
          crawlSite: vi.fn(),
        },
      });
      const outcome = await runOwnedStage(makeCtx(), deps);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.costMicros).toBe(expected);
    }
  });
});

describe('runSerpStage', () => {
  it('assembles keyword + serp evidence and filters competitor candidates at zero user cost', async () => {
    const topUrls = [
      'https://example.com/p', // owned — rejected
      'https://unsafe-host.example/x', // unsafe via mocked authority
      'https://rival-a.example/post',
      'https://rival-a.example/post/', // duplicate
      'https://rival-b.example/report.pdf', // binary
      'https://rival-c.example/login', // login wall
      'https://rival-d.example/article',
      'https://rival-e.example/article',
      'https://rival-f.example/article', // over the ceiling of 3
      ...Array.from({ length: 20 }, (_, i) => `https://extra-${i}.example/x`),
    ];
    const deps = makeDeps({
      rank: {
        checkRank: vi.fn(async () => ({
          position: 4,
          serpTopUrls: topUrls,
          checkedAt: new Date('2026-07-15T00:00:00Z'),
        })),
      },
    });
    const outcome = await runSerpStage(makeCtx(), deps);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.costMicros).toBe(0);
    expect(outcome.artifact.keyword).toEqual({
      keyword: 'seo audits',
      locationCode: 2840,
      languageCode: 'en',
      volume: 100,
      difficulty: 40,
      intent: 'informational',
    });
    expect(outcome.artifact.serp.ownedPosition).toBe(4);
    expect(outcome.artifact.serp.topUrls).toHaveLength(20); // sliced from 29
    expect(outcome.artifact.competitorUrls).toEqual([
      'https://rival-a.example/post',
      'https://rival-d.example/article',
      'https://rival-e.example/article',
    ]);
    expect(deps.keyword.getMetrics).toHaveBeenCalledWith(['seo audits'], 2840, 'en');
    expect(deps.keyword.classifyIntent).toHaveBeenCalledWith(['seo audits'], 2840, 'en');
    expect(deps.rank.checkRank).toHaveBeenCalledWith({
      keyword: 'seo audits',
      domain: 'example.com',
      locationCode: 2840,
      languageCode: 'en',
      device: 'desktop',
    });
  });

  it('maps the zh locale to the zh-CN vendor language code', async () => {
    const deps = makeDeps();
    const outcome = await runSerpStage(makeCtx({ locale: 'zh' }), deps);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.artifact.keyword.languageCode).toBe('zh-CN');
    expect(deps.keyword.getMetrics).toHaveBeenCalledWith(['seo audits'], 2840, 'zh-CN');
  });

  it('uses the frozen reviewed competitor URLs instead of the live SERP candidates', async () => {
    const deps = makeDeps({
      rank: {
        checkRank: vi.fn(async () => ({
          position: 4,
          serpTopUrls: ['https://live-serp.example/article'],
          checkedAt: new Date('2026-07-15T00:00:00Z'),
        })),
      },
    });
    const outcome = await runSerpStage(
      makeCtx({ reviewedCompetitorUrls: ['https://reviewed.example/article'] }),
      deps,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.artifact.competitorUrls).toEqual(['https://reviewed.example/article']);
    expect(outcome.artifact.serp.topUrls).toEqual(['https://live-serp.example/article']);
  });

  it('tolerates empty metrics/intents, a missing serpTopUrls field, and a null position', async () => {
    const deps = makeDeps({
      keyword: {
        getMetrics: vi.fn(async () => []),
        classifyIntent: vi.fn(async () => []),
      },
      rank: {
        checkRank: vi.fn(async () => ({
          position: null,
          checkedAt: new Date('2026-07-15T00:00:00Z'),
        })),
      },
    });
    const outcome = await runSerpStage(makeCtx(), deps);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.artifact.keyword).toMatchObject({
      volume: null,
      difficulty: null,
      intent: null,
    });
    expect(outcome.artifact.serp).toEqual({
      device: 'desktop',
      ownedPosition: null,
      topUrls: [],
    });
    expect(outcome.artifact.competitorUrls).toEqual([]);
  });

  it('reports keyword_unavailable when the metrics lookup throws', async () => {
    const deps = makeDeps({
      keyword: {
        getMetrics: vi.fn(async () => {
          throw new Error('metrics down');
        }),
        classifyIntent: vi.fn(),
      },
    });
    const outcome = await runSerpStage(makeCtx(), deps);
    expect(outcome).toEqual({
      ok: false,
      code: 'keyword_unavailable',
      reason: 'metrics down',
    });
  });

  it('reports keyword_unavailable with the fallback reason on a non-Error intent throw', async () => {
    const deps = makeDeps({
      keyword: {
        getMetrics: vi.fn(async () => []),
        classifyIntent: vi.fn(async () => {
          throw 'rate limited';
        }),
      },
    });
    const outcome = await runSerpStage(makeCtx(), deps);
    expect(outcome).toEqual({
      ok: false,
      code: 'keyword_unavailable',
      reason: 'keyword lookup failed',
    });
  });

  it('reports serp_unavailable when the rank check throws (Error and non-Error)', async () => {
    const deps = makeDeps({
      rank: {
        checkRank: vi.fn(async () => {
          throw new Error('serp exploded');
        }),
      },
    });
    await expect(runSerpStage(makeCtx(), deps)).resolves.toEqual({
      ok: false,
      code: 'serp_unavailable',
      reason: 'serp exploded',
    });

    const nonError = makeDeps({
      rank: {
        checkRank: vi.fn(async () => {
          throw 42;
        }),
      },
    });
    await expect(runSerpStage(makeCtx(), nonError)).resolves.toEqual({
      ok: false,
      code: 'serp_unavailable',
      reason: 'serp fetch failed',
    });
  });
});

describe('runCompetitorsStage', () => {
  it('returns empty artifacts for an empty URL list', async () => {
    const deps = makeDeps();
    const outcome = await runCompetitorsStage(makeCtx(), deps, {
      urls: [],
      budgetMicros: 10_000,
    });
    expect(outcome).toEqual({
      ok: true,
      artifact: { competitors: [], failures: [] },
      costMicros: 0,
    });
    expect(deps.contentSource.scrapePage).not.toHaveBeenCalled();
  });

  it('collects bounded competitor evidence with sequential source ids', async () => {
    const docs: Record<string, ContentDocument> = {
      'https://rival-1.example/a': makeDocument({ contentHash: 'c1' }),
      'https://rival-2.example/b': makeDocument({
        title: null,
        contentHash: 'c2',
        headings: undefined as never,
        structuredData: undefined as never,
      }),
      'https://rival-3.example/c': makeDocument({ contentHash: 'c3' }),
    };
    const deps = makeDeps({
      contentSource: {
        scrapePage: vi.fn(async ({ url }: { url: string }) => scrapeResult(docs[url]!)),
        crawlSite: vi.fn(),
      },
    });
    const outcome = await runCompetitorsStage(makeCtx(), deps, {
      urls: Object.keys(docs),
      budgetMicros: 100_000,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.artifact.failures).toEqual([]);
    expect(outcome.artifact.competitors.map((c) => c.sourceId)).toEqual([
      'competitor-1',
      'competitor-2',
      'competitor-3',
    ]);
    expect(outcome.artifact.competitors[1]).toMatchObject({
      title: null,
      headingCount: 0,
      schemaTypes: [],
      hasSchemaOrgArticle: false,
    });
    expect(outcome.artifact.competitors[0]!.snippet.length).toBeLessThanOrEqual(400);
    expect(outcome.costMicros).toBe(3_000);
  });

  it('marks every URL unavailable without scraping when the budget is already spent', async () => {
    const deps = makeDeps();
    const outcome = await runCompetitorsStage(makeCtx(), deps, {
      urls: ['https://rival-1.example/a', 'https://rival-2.example/b'],
      budgetMicros: 0,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.artifact.competitors).toEqual([]);
    expect(outcome.artifact.failures).toEqual([
      { url: 'https://rival-1.example/a', reason: 'unavailable' },
      { url: 'https://rival-2.example/b', reason: 'unavailable' },
    ]);
    expect(deps.contentSource.scrapePage).not.toHaveBeenCalled();
  });

  it('stops spending mid-list once the budget is exhausted', async () => {
    const deps = makeDeps();
    const outcome = await runCompetitorsStage(makeCtx(), deps, {
      urls: [
        'https://rival-1.example/a',
        'https://rival-2.example/b',
        'https://rival-3.example/c',
      ],
      budgetMicros: 1_000, // exactly one 1000-micro scrape
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.artifact.competitors).toHaveLength(1);
    expect(outcome.artifact.failures.map((f) => f.reason)).toEqual([
      'unavailable',
      'unavailable',
    ]);
    expect(outcome.costMicros).toBe(1_000);
    expect(deps.contentSource.scrapePage).toHaveBeenCalledTimes(1);
  });

  it('enforces the 20k aggregate snippet ceiling across many competitors', async () => {
    const longDoc = makeDocument({ markdown: 'lengthy competitor prose '.repeat(40) });
    const deps = makeDeps({
      contentSource: {
        scrapePage: vi.fn(async () => scrapeResult(longDoc)),
        crawlSite: vi.fn(),
      },
    });
    const urls = Array.from({ length: 51 }, (_, i) => `https://rival-${i}.example/x`);
    const outcome = await runCompetitorsStage(makeCtx(), deps, {
      urls,
      budgetMicros: 10_000_000,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // 50 × 400-char snippets fill the 20k budget; the 51st is refused.
    expect(outcome.artifact.competitors).toHaveLength(50);
    expect(outcome.artifact.failures).toEqual([
      { url: 'https://rival-50.example/x', reason: 'unavailable' },
    ]);
    expect(outcome.costMicros).toBe(50_000);
  });

  it('maps scrape failures onto the bounded failure-reason taxonomy', async () => {
    const behaviors: Record<string, () => never> = {
      'https://t.example/a': () => {
        throw new Error('Request Timeout after 60s');
      },
      'https://q.example/a': () => {
        throw new Error('QUOTA exceeded for account');
      },
      'https://m.example/a': () => {
        throw new Error('malformed vendor payload');
      },
      'https://u.example/a': () => {
        throw new Error('unsafe target: private range blocked');
      },
      'https://x.example/a': () => {
        throw new Error('something else entirely');
      },
      'https://s.example/a': () => {
        throw 'timeout as a bare string';
      },
    };
    const deps = makeDeps({
      contentSource: {
        scrapePage: vi.fn(async ({ url }: { url: string }) => behaviors[url]!()),
        crawlSite: vi.fn(),
      },
    });
    const outcome = await runCompetitorsStage(makeCtx(), deps, {
      urls: Object.keys(behaviors),
      budgetMicros: 100_000,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.artifact.failures.map((f) => f.reason)).toEqual([
      'timeout',
      'quota',
      'malformed',
      'unsafe',
      'unavailable',
      'timeout',
    ]);
    expect(outcome.costMicros).toBe(0);
  });
});

const OWNED_FACTS = {
  url: 'https://example.com/p',
  title: 'A very reasonable page title',
  description: 'Long enough description for the fixtures in this suite.',
  canonical: 'https://example.com/p',
  language: 'en',
  wordCount: 500,
  headingCount: 3,
  schemaTypes: ['Article'],
  hasSchemaOrgArticle: true,
  internalLinkCount: 3,
  externalLinkCount: 1,
  contentHash: 'hash-owned',
  excerpt: 'A bounded excerpt about seo audits.',
};

const KEYWORD_EVIDENCE = {
  keyword: 'seo audits',
  locationCode: 2840,
  languageCode: 'en',
  volume: 100,
  difficulty: 40,
  intent: 'informational' as const,
};

const COMPETITOR = {
  sourceId: 'competitor-1',
  url: 'https://rival-1.example/a',
  title: 'Rival',
  wordCount: 900,
  headingCount: 4,
  schemaTypes: ['Article'],
  hasSchemaOrgArticle: true,
  snippet: 'rival snippet',
  contentHash: 'hash-competitor',
};

describe('runBriefStage', () => {
  it('runs the content_brief profile and maps provenance onto the artifact', async () => {
    const run = vi.fn(async (_input: unknown) =>
      aiResult({
        title: 'Brief title',
        audience: 'General readers',
        outline: ['intro', 'body'],
        citations: ['competitor-1'],
      }),
    );
    const deps = makeDeps({ ai: { preflight: vi.fn(), run } });
    const outcome = await runBriefStage(makeCtx(), deps, {
      facts: OWNED_FACTS,
      keyword: KEYWORD_EVIDENCE,
      competitors: [COMPETITOR],
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(JSON.parse(outcome.artifact.text)).toEqual({
      title: 'Brief title',
      audience: 'General readers',
      outline: ['intro', 'body'],
    });
    expect(outcome.artifact).toMatchObject({
      citations: ['competitor-1'],
      profileVersion: '1.0.0',
      provider: 'fake',
      costMicros: 2_000,
    });
    expect(outcome.costMicros).toBe(2_000);
    expect(outcome.aiCostMicros).toBe(2_000);
    const call = run.mock.calls[0]![0] as {
      profile: string;
      usage: { jobId: string };
      input: { keyword: string; competitorSnippets: Array<{ id: string; text: string }> };
    };
    expect(call.profile).toBe('content_brief');
    expect(call.usage.jobId).toBe('analysis-1');
    expect(call.input.keyword).toBe('seo audits');
    expect(call.input.competitorSnippets).toEqual([
      { id: 'competitor-1', text: 'rival snippet' },
    ]);
  });

  it('treats a missing provenance cost as zero micros', async () => {
    const deps = makeDeps({
      ai: {
        preflight: vi.fn(),
        run: vi.fn(async () =>
          aiResult(
            { title: 'T', audience: 'A', outline: [], citations: [] },
            { cost: undefined },
          ),
        ),
      },
    });
    const outcome = await runBriefStage(makeCtx(), deps, {
      facts: OWNED_FACTS,
      keyword: KEYWORD_EVIDENCE,
      competitors: [],
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.costMicros).toBe(0);
    expect(outcome.artifact.costMicros).toBe(0);
  });

  it('maps AI failures to brief_failed for Error and non-Error throws', async () => {
    const failing = makeDeps({
      ai: {
        preflight: vi.fn(),
        run: vi.fn(async () => {
          throw new Error('provider refused');
        }),
      },
    });
    await expect(
      runBriefStage(makeCtx(), failing, {
        facts: OWNED_FACTS,
        keyword: KEYWORD_EVIDENCE,
        competitors: [],
      }),
    ).resolves.toEqual({ ok: false, code: 'brief_failed', reason: 'provider refused' });

    const nonError = makeDeps({
      ai: {
        preflight: vi.fn(),
        run: vi.fn(async () => {
          throw 'nope';
        }),
      },
    });
    await expect(
      runBriefStage(makeCtx(), nonError, {
        facts: OWNED_FACTS,
        keyword: KEYWORD_EVIDENCE,
        competitors: [],
      }),
    ).resolves.toEqual({ ok: false, code: 'brief_failed', reason: 'brief failed' });
  });
});

describe('runDraftStage', () => {
  const BRIEF = {
    text: JSON.stringify({ title: 'Brief', audience: 'A', outline: ['x'] }),
    citations: [],
    profileVersion: '1.0.0',
    provider: 'fake',
    costMicros: 2_000,
  };

  it('runs the content_first_draft profile with a bounded brief and maps provenance', async () => {
    const run = vi.fn(async (_input: unknown) =>
      aiResult({ title: 'Draft', body: 'Draft body text.', citations: ['competitor-1'] }),
    );
    const deps = makeDeps({ ai: { preflight: vi.fn(), run } });
    const longBrief = { ...BRIEF, text: 'b'.repeat(20_000) };
    const outcome = await runDraftStage(makeCtx(), deps, {
      facts: OWNED_FACTS,
      keyword: KEYWORD_EVIDENCE,
      brief: longBrief,
      competitors: [COMPETITOR],
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.artifact).toMatchObject({
      text: 'Draft body text.',
      citations: ['competitor-1'],
      profileVersion: '1.0.0',
      provider: 'fake',
      costMicros: 2_000,
    });
    expect(outcome.aiCostMicros).toBe(2_000);
    const call = run.mock.calls[0]![0] as {
      profile: string;
      input: { brief: string };
    };
    expect(call.profile).toBe('content_first_draft');
    expect(call.input.brief).toHaveLength(15_000);
  });

  it('treats a missing provenance cost as zero micros', async () => {
    const deps = makeDeps({
      ai: {
        preflight: vi.fn(),
        run: vi.fn(async () =>
          aiResult({ title: 'D', body: 'Body.', citations: [] }, { cost: undefined }),
        ),
      },
    });
    const outcome = await runDraftStage(makeCtx(), deps, {
      facts: OWNED_FACTS,
      keyword: KEYWORD_EVIDENCE,
      brief: BRIEF,
      competitors: [],
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.costMicros).toBe(0);
  });

  it('maps AI failures to draft_failed for Error and non-Error throws', async () => {
    const failing = makeDeps({
      ai: {
        preflight: vi.fn(),
        run: vi.fn(async () => {
          throw new Error('draft provider refused');
        }),
      },
    });
    await expect(
      runDraftStage(makeCtx(), failing, {
        facts: OWNED_FACTS,
        keyword: KEYWORD_EVIDENCE,
        brief: BRIEF,
        competitors: [],
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'draft_failed',
      reason: 'draft provider refused',
    });

    const nonError = makeDeps({
      ai: {
        preflight: vi.fn(),
        run: vi.fn(async () => {
          throw { odd: true };
        }),
      },
    });
    await expect(
      runDraftStage(makeCtx(), nonError, {
        facts: OWNED_FACTS,
        keyword: KEYWORD_EVIDENCE,
        brief: BRIEF,
        competitors: [],
      }),
    ).resolves.toEqual({ ok: false, code: 'draft_failed', reason: 'draft failed' });
  });
});
