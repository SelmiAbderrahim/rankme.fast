/**
 * Crawl evidence at the pipeline level: the audit's page limit holds on what
 * is stored, large crawls survive, broken-link targets are re-requested, URLs
 * the crawl missed get a recorded cause, and the stored AI Visibility and
 * Local SEO rollups feed their checks.
 */
import type { Job } from 'bullmq';
import mongoose from 'mongoose';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFakeAuditProvider,
  type AuditPage,
  type AuditResult,
} from '../../shared/providers/index.js';
import type { PageProber, PageProbeResult } from '../../shared/security/site-probe.js';
import { clearCollections, startMemoryMongo, stopMemoryMongo } from '../../shared/testing/mongo.js';
import { Site } from '../sites/index.js';
import { AuditRun, AuditedPage, ReportSnapshot, createAuditProcessor } from './index.js';
import { EVIDENCE_STAGE_RESERVE_MS } from './audit.processor.js';
import { isNotEvaluatedFinding } from './rules/index.js';

const logger = pino({ level: 'silent' });

beforeAll(() => startMemoryMongo());
afterAll(() => stopMemoryMongo());
beforeEach(() => clearCollections());

async function seed(pageCap = 5_000) {
  const accountId = new mongoose.Types.ObjectId();
  const site = await Site.create({ accountId, url: 'https://example.com', domain: 'example.com' });
  const run = await AuditRun.create({ accountId, siteId: site._id, pageCap });
  return {
    accountId: accountId.toHexString(),
    siteId: site.id as string,
    runId: run.id as string,
    pageCap,
  };
}

function jobFor(data: unknown): Job {
  return { data, attemptsMade: 0, opts: { attempts: 3 } } as unknown as Job;
}

function crawledPage(index: number, overrides: Partial<AuditPage> = {}): AuditPage {
  return {
    url: `https://example.com/en/p${index}`,
    statusCode: 200,
    title: `Page ${index} title`,
    metaDescription: `Description ${index}`,
    h1: [`Heading ${index}`],
    h2: [],
    canonical: `https://example.com/en/p${index}`,
    hasStructuredData: true,
    structuredDataErrors: [],
    isIndexable: true,
    brokenLinks: [],
    onPageScore: 80,
    ...overrides,
  };
}

function resultOf(pages: AuditPage[], extra: Partial<AuditResult> = {}): AuditResult {
  return {
    domainChecks: {
      robotsTxtFound: true,
      sitemapFound: true,
      httpsEnforced: true,
      canonicalizationOk: true,
    },
    pages,
    ...extra,
  };
}

function probe(overrides: Partial<PageProbeResult> = {}): PageProbeResult {
  return {
    url: 'https://example.com/',
    statusCode: 200,
    finalUrl: 'https://example.com/',
    redirectChain: [],
    contentType: 'text/html',
    failure: null,
    ...overrides,
  };
}

function prober(answer: (url: string) => PageProbeResult): PageProber & { probe: ReturnType<typeof vi.fn> } {
  return { probe: vi.fn(async (url: string) => answer(url)) };
}

function processorFor(result: AuditResult, extra: Parameters<typeof createAuditProcessor>[0] extends infer D ? Partial<D> : never = {}) {
  return createAuditProcessor({
    provider: createFakeAuditProvider({ vendorTaskId: 'task-evidence', result }),
    logger,
    ...extra,
  });
}

describe('audit processor — page limit', () => {
  it('stores a crawl of more than 100 pages in full and records the count on the run', async () => {
    const ids = await seed(5_000);
    const pages = Array.from({ length: 250 }, (_, i) => crawledPage(i));
    await processorFor(resultOf(pages, { vendorPagesCrawled: 250 }))(jobFor(ids));
    expect(await AuditedPage.countDocuments({ runId: ids.runId })).toBe(250);
    const run = await AuditRun.findById(ids.runId).lean();
    expect(run).toMatchObject({ status: 'succeeded', pagesCrawled: 250, vendorPagesCrawled: 250 });
  });

  it('never stores more pages than the audit allows, even when the vendor returns more', async () => {
    const ids = await seed(10);
    const pages = Array.from({ length: 14 }, (_, i) => crawledPage(i));
    const warn = vi.fn();
    await processorFor(resultOf(pages, { vendorPagesCrawled: 14 }), {
      logger: { ...logger, warn, info: vi.fn() } as never,
    })(jobFor(ids));
    expect(await AuditedPage.countDocuments({ runId: ids.runId })).toBe(10);
    expect((await AuditRun.findById(ids.runId).lean())!.pagesCrawled).toBe(10);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ pageCap: 10, dropped: 4 }),
      expect.stringContaining('more pages than the audit allows'),
    );
  });

  it('stores exactly the page limit when the crawl matches it', async () => {
    const ids = await seed(10);
    const pages = Array.from({ length: 10 }, (_, i) => crawledPage(i));
    const warn = vi.fn();
    await processorFor(resultOf(pages), { logger: { ...logger, warn, info: vi.fn() } as never })(jobFor(ids));
    expect((await AuditRun.findById(ids.runId).lean())!.pagesCrawled).toBe(10);
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns when the stored crawl is smaller than the vendor says it crawled', async () => {
    const ids = await seed(5_000);
    const warn = vi.fn();
    await processorFor(resultOf([crawledPage(1), crawledPage(2)], { vendorPagesCrawled: 300 }), {
      logger: { ...logger, warn, info: vi.fn() } as never,
    })(jobFor(ids));
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ storedPages: 2, vendorPagesCrawled: 300 }),
      expect.stringContaining('page list is incomplete'),
    );
    expect((await AuditRun.findById(ids.runId).lean())!.vendorPagesCrawled).toBe(300);
  });

  it('leaves vendorPagesCrawled unset when the vendor reported none', async () => {
    const ids = await seed(5_000);
    await processorFor(resultOf([crawledPage(1)]))(jobFor(ids));
    const run = await AuditRun.findById(ids.runId).lean();
    expect(run!.pagesCrawled).toBe(1);
    expect(run!.vendorPagesCrawled).toBeNull();
  });
});

describe('audit processor — broken link verification', () => {
  const linkingPages = () => [
    crawledPage(1, {
      brokenLinks: ['https://example.com/pricing', 'https://example.com/en/missing', 'https://example.com/guarded'],
    }),
    crawledPage(2, { brokenLinks: ['https://example.com/pricing'] }),
    crawledPage(3),
  ];

  const answer = (url: string): PageProbeResult => {
    if (url.endsWith('/pricing')) {
      return probe({
        url,
        statusCode: 200,
        finalUrl: 'https://example.com/en/pricing',
        redirectChain: [{ url, status: 301 }],
      });
    }
    if (url.endsWith('/missing')) {
      return probe({ url, statusCode: 404, failure: { kind: 'http_error', statusCode: 404 } });
    }
    return probe({ url, statusCode: 403, failure: { kind: 'http_error', statusCode: 403 } });
  };

  it('clears targets that resolve, keeps genuine ones, and persists the evidence', async () => {
    const ids = await seed();
    const pageProber = prober(answer);
    await processorFor(resultOf(linkingPages()), { pageProber })(jobFor(ids));

    const first = await AuditedPage.findOne({ runId: ids.runId, url: 'https://example.com/en/p1' }).lean();
    expect(first!.brokenLinks).toEqual(['https://example.com/en/missing', 'https://example.com/guarded']);
    expect(first!.brokenLinkEvidence).toEqual([
      {
        target: 'https://example.com/pricing',
        outcome: 'cleared',
        status: 200,
        finalUrl: 'https://example.com/en/pricing',
      },
      { target: 'https://example.com/en/missing', outcome: 'confirmed', status: 404, failure: 'http_error' },
      { target: 'https://example.com/guarded', outcome: 'unverified', status: 403, failure: 'http_error' },
    ]);
    const second = await AuditedPage.findOne({ runId: ids.runId, url: 'https://example.com/en/p2' }).lean();
    expect(second!.brokenLinks).toEqual([]);
    expect(second!.brokenLinkEvidence).toHaveLength(1);

    // The finding is built from the verified list: only page 1 still links to a broken target.
    const snapshot = await ReportSnapshot.findOne({ runId: ids.runId }).lean();
    const finding = snapshot!.findings.find((f) => f.ruleId === 'broken-internal-links');
    expect(finding!.affectedUrls).toEqual(['https://example.com/en/p1']);
  });

  it('passes the finding when every reported target resolves', async () => {
    const ids = await seed();
    const pages = [crawledPage(1, { brokenLinks: ['https://example.com/pricing'] })];
    await processorFor(resultOf(pages), { pageProber: prober(answer) })(jobFor(ids));
    const snapshot = await ReportSnapshot.findOne({ runId: ids.runId }).lean();
    expect(snapshot!.findings.find((f) => f.ruleId === 'broken-internal-links')!.bucket).toBe('passed');
  });

  it('keeps the crawler verdict when verification throws', async () => {
    const ids = await seed();
    const warn = vi.fn();
    const failing: PageProber = { probe: vi.fn().mockRejectedValue(new Error('boom')) };
    await processorFor(resultOf(linkingPages()), {
      pageProber: failing,
      logger: { ...logger, warn, info: vi.fn() } as never,
    })(jobFor(ids));
    const first = await AuditedPage.findOne({ runId: ids.runId, url: 'https://example.com/en/p1' }).lean();
    expect(first!.brokenLinks).toHaveLength(3);
    expect(first!.brokenLinkEvidence).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: 'boom' }),
      expect.stringContaining('verification failed'),
    );
    expect((await AuditRun.findById(ids.runId).lean())!.status).toBe('succeeded');
  });

  it('does not verify or probe anything without a page prober', async () => {
    const ids = await seed();
    await processorFor(resultOf(linkingPages()))(jobFor(ids));
    const first = await AuditedPage.findOne({ runId: ids.runId, url: 'https://example.com/en/p1' }).lean();
    expect(first!.brokenLinks).toHaveLength(3);
    expect((await AuditRun.findById(ids.runId).lean())!.coverageProbes).toBeUndefined();
  });

  it('skips the evidence stages once the audit budget is spent', async () => {
    const ids = await seed();
    const pageProber = prober(answer);
    let clock = 0;
    const processor = createAuditProcessor({
      provider: createFakeAuditProvider({ vendorTaskId: 'task-budget', result: resultOf(linkingPages()) }),
      logger,
      pageProber,
      runTimeoutMs: EVIDENCE_STAGE_RESERVE_MS + 1_000,
      now: () => {
        clock += 500;
        return clock;
      },
    });
    await processor(jobFor(ids));
    expect(pageProber.probe).not.toHaveBeenCalled();
    const first = await AuditedPage.findOne({ runId: ids.runId, url: 'https://example.com/en/p1' }).lean();
    expect(first!.brokenLinks).toHaveLength(3);
  });
});

describe('audit processor — crawl coverage', () => {
  it('records why the site root and Search Console URLs are missing from the crawl', async () => {
    const ids = await seed();
    const pageProber = prober((url) => {
      if (url === 'https://example.com') {
        return probe({
          url,
          finalUrl: 'https://example.com/en',
          redirectChain: [{ url, status: 301 }],
        });
      }
      return probe({ url, statusCode: 404, failure: { kind: 'http_error', statusCode: 404 } });
    });
    const collectGscInsights = vi.fn(async () => ({
      search: {
        status: 'no-data' as const,
        totalClicks: 0,
        totalImpressions: 0,
        averageCtr: 0,
        averagePosition: 0,
        topQueries: [],
        topPages: [],
        delta: { clicks: null, impressions: null },
      },
      sitemaps: { status: 'no-sitemaps' as const, sitemaps: [] },
      pageUrls: ['https://example.com/en/p1', 'https://example.com/pricing'],
    }));
    await processorFor(resultOf([crawledPage(1)]), { pageProber, collectGscInsights })(jobFor(ids));

    const run = await AuditRun.findById(ids.runId).lean();
    expect(run!.coverageProbes).toEqual([
      {
        url: 'https://example.com',
        source: 'site-root',
        statusCode: 200,
        finalUrl: 'https://example.com/en',
        redirectChain: [{ url: 'https://example.com', status: 301 }],
        contentType: 'text/html',
        failure: null,
      },
      {
        url: 'https://example.com/pricing',
        source: 'search-console',
        statusCode: 404,
        finalUrl: 'https://example.com/',
        redirectChain: [],
        contentType: 'text/html',
        failure: { kind: 'http_error', statusCode: 404 },
      },
    ]);
  });

  it('records an empty probe list when the crawl returned everything that was asked about', async () => {
    const ids = await seed();
    const pages = [crawledPage(1, { url: 'https://example.com/' })];
    await processorFor(resultOf(pages), { pageProber: prober(() => probe()) })(jobFor(ids));
    expect((await AuditRun.findById(ids.runId).lean())!.coverageProbes).toEqual([]);
  });

  it('survives a failing prober and records no coverage evidence', async () => {
    const ids = await seed();
    const warn = vi.fn();
    const failing: PageProber = { probe: vi.fn().mockRejectedValue(new Error('network down')) };
    await processorFor(resultOf([crawledPage(1)]), {
      pageProber: failing,
      logger: { ...logger, warn, info: vi.fn() } as never,
    })(jobFor(ids));
    expect((await AuditRun.findById(ids.runId).lean())!.status).toBe('succeeded');
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: 'network down' }),
      expect.stringContaining('coverage probes failed'),
    );
  });
});

describe('audit processor — stored rollups', () => {
  const findingOf = async (runId: string, ruleId: string) => {
    const snapshot = await ReportSnapshot.findOne({ runId }).lean();
    return snapshot!.findings.find((f) => f.ruleId === ruleId)!;
  };

  const aiRollup = {
    status: 'ok' as const,
    aiOverviewCitedCount: 2,
    aiOverviewTotalChecked: 4,
    llmMentionedCount: 3,
    llmTotalChecked: 6,
    shareOfVoicePct: 60,
    negativeSentimentCount: 0,
    competitorsPresent: true,
    sentiment: { positive: 2, neutral: 1, negative: 0 },
    notMentionedPrompts: ['best widgets'],
  };

  it('evaluates AI visibility and Local SEO from the stored rollups', async () => {
    const ids = await seed();
    const collectAiVisibility = vi.fn(async () => aiRollup);
    const collectLocalSeo = vi.fn(async () => ({
      status: 'ok' as const,
      listings: [
        { source: 'google', consistent: true },
        { source: 'yelp', consistent: false },
      ],
      reviews: { averageRating: 4.6, reviewCount: 40 },
      qa: { unansweredCount: 0 },
      localPack: null,
    }));
    await processorFor(resultOf([crawledPage(1)]), { collectAiVisibility, collectLocalSeo })(jobFor(ids));
    expect(collectAiVisibility).toHaveBeenCalledWith({ accountId: ids.accountId, siteId: ids.siteId });
    expect(collectLocalSeo).toHaveBeenCalledWith({ accountId: ids.accountId, siteId: ids.siteId });
    expect((await findingOf(ids.runId, 'ai-visibility-low')).bucket).toBe('passed');
    expect((await findingOf(ids.runId, 'nap-inconsistency')).bucket).toBe('fix-now');
    expect((await findingOf(ids.runId, 'low-review-count')).bucket).toBe('passed');
    const snapshot = await ReportSnapshot.findOne({ runId: ids.runId }).lean();
    expect(snapshot!.aiVisibility).toMatchObject({ status: 'ok', shareOfVoicePct: 60 });
    expect(snapshot!.localSeo).toMatchObject({ status: 'ok' });
  });

  it('degrades both rollups to unavailable, with a log, when reading them fails', async () => {
    const ids = await seed();
    const warn = vi.fn();
    await processorFor(resultOf([crawledPage(1)]), {
      collectAiVisibility: vi.fn().mockRejectedValue(new Error('pg down')),
      collectLocalSeo: vi.fn().mockRejectedValue(new Error('pg down')),
      logger: { ...logger, warn, info: vi.fn() } as never,
    })(jobFor(ids));
    const snapshot = await ReportSnapshot.findOne({ runId: ids.runId }).lean();
    expect(snapshot!.aiVisibility).toMatchObject({ status: 'unavailable' });
    expect(snapshot!.localSeo).toMatchObject({ status: 'unavailable' });
    expect(isNotEvaluatedFinding(await findingOf(ids.runId, 'ai-visibility-low'))).toBe(true);
    expect(isNotEvaluatedFinding(await findingOf(ids.runId, 'nap-inconsistency'))).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ err: 'pg down' }), expect.stringContaining('ai visibility'));
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ err: 'pg down' }), expect.stringContaining('local seo'));
    expect((await AuditRun.findById(ids.runId).lean())!.status).toBe('succeeded');
  });

  it('reports tracked-but-unchecked AI prompts as not evaluated rather than passed', async () => {
    const ids = await seed();
    await processorFor(resultOf([crawledPage(1)]), {
      collectAiVisibility: async () => ({ ...aiRollup, aiOverviewTotalChecked: 0, llmTotalChecked: 0, aiOverviewCitedCount: 0, llmMentionedCount: 0 }),
    })(jobFor(ids));
    const finding = await findingOf(ids.runId, 'ai-visibility-low');
    expect(isNotEvaluatedFinding(finding)).toBe(true);
    expect(finding.meta).toMatchObject({ reason: 'no-checks-yet' });
  });
});
