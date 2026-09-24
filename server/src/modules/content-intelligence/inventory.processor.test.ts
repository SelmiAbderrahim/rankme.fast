/**
 * Content inventory processor tests (prompt 08).
 *
 * Real mongodb-memory-server + PGlite. A controllable ContentSourceProvider +
 * fake AiProfileRunner + injected url-safety resolver drive every terminal path:
 * completed / partial / failed(no_pages|crawl|analysis) / cancelled, incremental
 * page persistence, no-raw-HTML storage, 7-day TTL snapshots, the optional AI
 * explanation (success / skip-on-budget / skip-on-failure), replay no-op, and
 * one terminal lifecycle event per run.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import pino from 'pino';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import { contentInventoryEvents } from '../../db/schema/content-inventory-events.js';
import type { PublicUrlResolver } from '../../shared/security/url-safety.js';
import type {
  ContentDocument,
  ContentSourceProvider,
  CrawlSiteResult,
} from '../../shared/providers/content-source.js';
import type { AiProfileRunner } from '../../shared/ai-profiles/index.js';
import { ProviderError } from '../../shared/providers/errors.js';
import {
  ContentInventoryPage,
  ContentInventoryRun,
  ContentInventorySnapshot,
} from './inventory.model.js';
import {
  advance,
  addWarning,
  createContentInventoryProcessor,
  finalize,
  stripHtmlMarkers,
} from './inventory.processor.js';
import * as analysisModule from './inventory.analysis.js';
import type { ContentInventoryJob } from '../../shared/queue/index.js';
import { GSC_DIMENSION_KEY_SEPARATOR, gscSearchAnalytics } from '../../db/schema/gsc.js';
import { keywords } from '../../db/schema/keywords.js';
import { Site } from '../sites/index.js';

const ACCOUNT = '000000000000000000000abc';
const SITE = '000000000000000000000def';
const ORIGIN = 'https://example.com';

const resolver: PublicUrlResolver = async () => [{ address: '93.184.216.34', family: 4 }];
const logger = pino({ level: 'silent' });

function db(): ApplicationDb {
  return getTestDb() as unknown as ApplicationDb;
}

function ownedDoc(url: string, over: Partial<ContentDocument> = {}): ContentDocument {
  return {
    sourceUrl: url,
    statusCode: 200,
    title: 'Owned page',
    description: 'desc',
    canonical: url,
    robots: ['index'],
    language: 'en',
    markdown: '# Owned',
    text: 'Owned page body text with enough words to count here today.',
    headings: [{ level: 1, text: 'Owned page heading' }],
    links: [],
    structuredData: [],
    contentHash: `hash-${url}`,
    capturedAt: new Date('2026-07-20T00:00:00Z'),
    ...over,
  };
}

function makeSource(crawl: Partial<CrawlSiteResult> & { throw?: unknown } = {}): ContentSourceProvider {
  return {
    async crawlSite(): Promise<CrawlSiteResult> {
      if (crawl.throw) throw crawl.throw;
      return {
        documents: crawl.documents ?? [ownedDoc(`${ORIGIN}/a`), ownedDoc(`${ORIGIN}/b`)],
        failures: crawl.failures ?? [],
        completion: crawl.completion ?? 'complete',
        usage: crawl.usage ?? { credits: 2, estimatedCostMicros: 2_000n, estimated: true },
      };
    },
    async scrapePage() {
      throw new Error('scrapePage not expected in these tests');
    },
  };
}

const aiOk: AiProfileRunner = {
  preflight() {},
  async run() {
    return {
      object: { explanation: 'Two pages compete for the same query.', citations: [] },
      provenance: { actualOrEstimatedCostMicros: 5_000n },
    } as never;
  },
};

const aiThrow: AiProfileRunner = {
  preflight() {},
  async run() {
    throw new Error('ai down');
  },
};

function proc(over: Partial<Parameters<typeof createContentInventoryProcessor>[0]> = {}) {
  return createContentInventoryProcessor({
    db: db(),
    contentSource: makeSource(),
    ai: aiOk,
    aiProviderOrder: ['fake'] as never,
    logger,
    resolver,
    ...over,
  });
}

function job(runId: string, key: string): Job<ContentInventoryJob> {
  return {
    data: { accountId: ACCOUNT, siteId: SITE, runId, reservationKey: key },
  } as Job<ContentInventoryJob>;
}

let keySeq = 0;
async function queuedRun(over: Record<string, unknown> = {}): Promise<{ runId: string; key: string }> {
  keySeq += 1;
  const key = `run_key_${keySeq}`;
  const pageLimit = (over.pageLimit as number | undefined) ?? 4;
  const blocks = Math.ceil(pageLimit / 4);
  const run = await ContentInventoryRun.create({
    accountId: ACCOUNT,
    ownerUserId: ACCOUNT,
    siteId: SITE,
    origin: ORIGIN,
    locale: 'en',
    status: 'queued',
    input: { pageLimit, allowedPaths: [], excludedPaths: [], sitemapSeeds: [] },
    progress: {
      pagesRequested: pageLimit,
      pagesProcessed: 0,
      pagesFailed: 0,
      blocksReserved: blocks,
    },
    stages: [{ name: 'queued', startedAt: new Date(), completedAt: null, error: null }],
    warnings: [],
    error: null,
    inputFingerprint: `fp_${key}`,
    idempotencyKey: key,
    thresholdsVersion: '1',
    findings: null,
    costMicros: 0,
    aiCostMicros: 0,
    requestedAt: new Date(),
    ...over,
  });
  return { runId: String(run._id), key };
}

async function eventsFor(): Promise<Array<{ kind: string; units: number }>> {
  const rows = await getTestDb().select().from(contentInventoryEvents);
  return rows.map((r) => ({ kind: r.kind, units: Number(r.units) }));
}

beforeAll(async () => {
  await startMemoryMongo();
  await startTestPostgres();
});
afterAll(async () => {
  await stopMemoryMongo();
  await stopTestPostgres();
});
beforeEach(async () => {
  await Site.create({
    _id: SITE,
    accountId: ACCOUNT,
    url: ORIGIN,
    domain: 'example.com',
    displayName: 'Example',
    gscPropertyUrl: 'sc-domain:example.com',
    gscBindingGenerationId: 'legacy',
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await clearCollections();
  await truncateAllTables();
});

describe('content inventory processor', () => {
  it('runs a full inventory to completed with incremental pages, TTL snapshot, findings + AI', async () => {
    const { runId, key } = await queuedRun();
    await proc()(job(runId, key));

    const run = await ContentInventoryRun.findById(runId);
    expect(run?.status).toBe('completed');
    expect(run?.progress.pagesProcessed).toBe(2);
    expect((run?.findings as { opportunityExplanation: string }).opportunityExplanation).toContain(
      'compete',
    );

    const pages = await ContentInventoryPage.find({ runId });
    expect(pages).toHaveLength(2);
    // Derived facts only — no raw HTML fields.
    expect(JSON.stringify(pages[0]!.facts)).not.toMatch(/markdown|rawHtml|<script/i);

    const snapshots = await ContentInventorySnapshot.find({ runId });
    expect(snapshots.length).toBeGreaterThan(0);
    const ttlMs = snapshots[0]!.expiryAt.getTime() - snapshots[0]!.retrievedAt.getTime();
    expect(ttlMs).toBe(7 * 24 * 60 * 60 * 1000);

    const events = await eventsFor();
    expect(events.find((e) => e.kind === 'completed')).toBeDefined();
  });

  it('sanitizes a script-laden excerpt before persisting the snapshot', async () => {
    const { runId, key } = await queuedRun();
    await proc({
      contentSource: makeSource({
        documents: [ownedDoc(`${ORIGIN}/x`, { text: 'safe text <script>evil()</script> more' })],
      }),
    })(job(runId, key));
    const snapshots = await ContentInventorySnapshot.find({ runId });
    expect(snapshots[0]!.excerpt).not.toMatch(/<script/i);
  });

  it('marks a run partial with a warning when the crawl is partial', async () => {
    const { runId, key } = await queuedRun({ pageLimit: 20 });
    await proc({
      contentSource: makeSource({
        documents: [ownedDoc(`${ORIGIN}/a`), ownedDoc(`${ORIGIN}/b`)],
        failures: [{ url: `${ORIGIN}/blocked`, reason: 'robots', message: 'r' }],
        completion: 'partial',
      }),
    })(job(runId, key));

    const run = await ContentInventoryRun.findById(runId);
    expect(run?.status).toBe('partial');
    expect(run?.warnings.some((w) => w.code === 'inventory_partial_crawl')).toBe(true);
    const events = await eventsFor();
    expect(events).toEqual([{ kind: 'completed', units: 0 }]);
  });

  it('fails a run when no pages are crawled', async () => {
    const { runId, key } = await queuedRun();
    await proc({ contentSource: makeSource({ documents: [], completion: 'complete' }) })(
      job(runId, key),
    );
    const run = await ContentInventoryRun.findById(runId);
    expect(run?.status).toBe('failed');
    expect(run?.error?.category).toBe('no_pages_crawled');
    const events = await eventsFor();
    expect(events).toEqual([{ kind: 'failed', units: 0 }]);
  });

  it('cancels a run when the crawl reports a cancellation', async () => {
    const { runId, key } = await queuedRun();
    await proc({ contentSource: makeSource({ completion: 'cancelled', documents: [] }) })(
      job(runId, key),
    );
    const run = await ContentInventoryRun.findById(runId);
    expect(run?.status).toBe('cancelled');
    const events = await eventsFor();
    expect(events.find((e) => e.kind === 'cancelled')).toBeDefined();
  });

  it('fails with crawl_failed when the crawler throws a non-quota provider error', async () => {
    const { runId, key } = await queuedRun();
    await proc({
      contentSource: makeSource({
        throw: new ProviderError('boom', false, { provider: 'fake', operation: 'crawl' }),
      }),
    })(job(runId, key));
    const run = await ContentInventoryRun.findById(runId);
    expect(run?.status).toBe('failed');
    expect(run?.error?.category).toBe('crawl_failed');
  });

  it('adds a stopped-early warning and stays partial on a provider quota stop', async () => {
    const { runId, key } = await queuedRun();
    // Quota thrown by crawlSite → completion "quota" with zero pages → no_pages.
    // To exercise the stopped-early warning we need pages + a quota completion,
    // so drive it via a budget stop instead (cost ceiling below a 2nd page).
    await proc({
      costCeilingMicros: 1_500,
      contentSource: makeSource({
        documents: [ownedDoc(`${ORIGIN}/a`), ownedDoc(`${ORIGIN}/b`)],
        usage: { credits: 2, estimatedCostMicros: 2_000n, estimated: true },
      }),
    })(job(runId, key));
    const run = await ContentInventoryRun.findById(runId);
    expect(run?.status).toBe('partial');
    expect(run?.warnings.some((w) => w.code === 'inventory_stopped_early')).toBe(true);
  });

  it('completes with a skip warning when the AI explanation fails (findings still complete)', async () => {
    const { runId, key } = await queuedRun();
    await proc({ ai: aiThrow })(job(runId, key));
    const run = await ContentInventoryRun.findById(runId);
    expect(run?.status).toBe('completed');
    expect((run?.findings as { opportunityExplanation: string | null }).opportunityExplanation).toBeNull();
    expect(run?.warnings.some((w) => w.code === 'inventory_explanation_skipped')).toBe(true);
  });

  it('skips the AI explanation when the sub-budget is exhausted', async () => {
    const { runId, key } = await queuedRun();
    await proc({ aiBudgetMicros: 0 })(job(runId, key));
    const run = await ContentInventoryRun.findById(runId);
    expect(run?.warnings.some((w) => w.code === 'inventory_explanation_skipped')).toBe(true);
    expect((run?.findings as { opportunityExplanation: string | null }).opportunityExplanation).toBeNull();
  });

  it('fails with analysis_failed when the deterministic analysis throws', async () => {
    const { runId, key } = await queuedRun();
    vi.spyOn(analysisModule, 'analyzeInventory').mockImplementationOnce(() => {
      throw new Error('analysis boom');
    });
    await proc()(job(runId, key));
    const run = await ContentInventoryRun.findById(runId);
    expect(run?.status).toBe('failed');
    expect(run?.error?.category).toBe('analysis_failed');
  });

  it('tolerates a page-persist failure without aborting the crawl', async () => {
    const { runId, key } = await queuedRun();
    const spy = vi
      .spyOn(ContentInventoryPage, 'updateOne')
      .mockRejectedValueOnce(new Error('mongo down') as never);
    await proc()(job(runId, key));
    expect(spy).toHaveBeenCalled();
    const run = await ContentInventoryRun.findById(runId);
    // The run still reaches a terminal state.
    expect(['completed', 'partial']).toContain(run?.status);
  });

  it('is a no-op on a terminal run replay', async () => {
    const { runId, key } = await queuedRun({ status: 'completed', completedAt: new Date() });
    await proc()(job(runId, key));
    // No pages were crawled because the processor short-circuited.
    expect(await ContentInventoryPage.countDocuments({ runId })).toBe(0);
  });

  it('drops the job when the run is not found', async () => {
    await proc()(job('0000000000000000000000ff', 'missing'));
    expect(await ContentInventoryRun.countDocuments()).toBe(0);
  });

  it('rejects a malformed payload as unrecoverable', async () => {
    await expect(
      proc()({ data: { bad: true } } as unknown as Job<ContentInventoryJob>),
    ).rejects.toThrow();
  });

  it('produces cannibalization + gap findings from seeded GSC/keyword evidence', async () => {
    // Two owned pages compete for the same GSC query → cannibalization.
    for (const page of [`${ORIGIN}/a`, `${ORIGIN}/b`]) {
      await getTestDb().insert(gscSearchAnalytics).values({
        accountId: ACCOUNT,
        siteId: SITE,
        bindingGenerationId: 'legacy',
        snapshotDate: '2026-07-10',
        dimensionSet: 'query,page',
        windowDays: 28,
        dimensionKey: `seo audit${GSC_DIMENSION_KEY_SEPARATOR}${page}`,
        clicks: 3,
        impressions: 50,
        ctr: 0.06,
        position: 4,
      });
    }
    // A tracked keyword with no owning page → topical gap.
    await getTestDb().insert(keywords).values({
      accountId: ACCOUNT,
      siteId: SITE,
      phrase: 'uncovered topic',
      locationCode: 2840,
      languageCode: 'en',
      active: true,
    });
    const { runId, key } = await queuedRun();
    await proc()(job(runId, key));
    const run = await ContentInventoryRun.findById(runId);
    const findings = run?.findings as {
      cannibalization: unknown[];
      gaps: unknown[];
    };
    expect(findings.cannibalization.length).toBeGreaterThan(0);
    expect(findings.gaps.length).toBeGreaterThan(0);
    // GSC evidence present → no evidence-missing warning.
    expect(run?.warnings.some((w) => w.code === 'inventory_evidence_missing')).toBe(false);
  });

  it('drops a pre-existing page whose stored facts fail schema validation', async () => {
    const { runId, key } = await queuedRun();
    await ContentInventoryPage.create({
      runId,
      accountId: ACCOUNT,
      siteId: SITE,
      url: `${ORIGIN}/stale`,
      contentHash: 'stale',
      createdAtMs: Date.now(),
      facts: { not: 'valid' },
    });
    await proc()(job(runId, key));
    const run = await ContentInventoryRun.findById(runId);
    expect(run?.status).toBe('completed');
  });

  it('records a null explanation when the AI returns an empty string', async () => {
    const { runId, key } = await queuedRun();
    const aiEmpty: AiProfileRunner = {
      preflight() {},
      async run() {
        return {
          object: { explanation: '   ', citations: [] },
          provenance: { actualOrEstimatedCostMicros: 1_000n },
        } as never;
      },
    };
    await proc({ ai: aiEmpty })(job(runId, key));
    const run = await ContentInventoryRun.findById(runId);
    expect((run?.findings as { opportunityExplanation: string | null }).opportunityExplanation).toBeNull();
  });

  it('defaults the AI cost to zero when provenance omits it', async () => {
    const { runId, key } = await queuedRun();
    const aiNoCost: AiProfileRunner = {
      preflight() {},
      async run() {
        return { object: { explanation: 'ok', citations: [] }, provenance: {} } as never;
      },
    };
    await proc({ ai: aiNoCost })(job(runId, key));
    const run = await ContentInventoryRun.findById(runId);
    expect(run?.status).toBe('completed');
    expect(Number(run?.aiCostMicros)).toBe(0);
  });

  it('skips the snapshot when the sanitized excerpt is empty', async () => {
    const { runId, key } = await queuedRun();
    await proc({
      contentSource: makeSource({ documents: [ownedDoc(`${ORIGIN}/x`, { text: '\u0001\u0002\u0003' })] }),
    })(job(runId, key));
    expect(await ContentInventorySnapshot.countDocuments({ runId })).toBe(0);
    expect(await ContentInventoryPage.countDocuments({ runId })).toBe(1);
  });

  it('runs without an injected resolver (real DNS on a public origin)', async () => {
    const { runId, key } = await queuedRun();
    await proc({ resolver: undefined })(job(runId, key));
    const run = await ContentInventoryRun.findById(runId);
    expect(['completed', 'partial']).toContain(run?.status);
  });

  it('stops when the run disappears before the crawl stage advance', async () => {
    const { runId, key } = await queuedRun();
    vi.spyOn(ContentInventoryRun, 'findById').mockResolvedValueOnce(null as never);
    await proc()(job(runId, key));
    // No crawl ran, so no pages were persisted.
    expect(await ContentInventoryPage.countDocuments({ runId })).toBe(0);
  });

  it('stops after the crawl when a concurrent cancel wins', async () => {
    const { runId, key } = await queuedRun();
    const cancellingSource: ContentSourceProvider = {
      async crawlSite() {
        await ContentInventoryRun.updateOne(
          { _id: runId },
          { $set: { status: 'cancelled', completedAt: new Date() } },
        );
        return {
          documents: [ownedDoc(`${ORIGIN}/a`)],
          failures: [],
          completion: 'complete',
          usage: { credits: 1, estimatedCostMicros: 1_000n, estimated: true },
        };
      },
      async scrapePage() {
        throw new Error('unused');
      },
    };
    await proc({ contentSource: cancellingSource })(job(runId, key));
    const run = await ContentInventoryRun.findById(runId);
    expect(run?.status).toBe('cancelled');
    // The processor stopped before analysis — no findings written.
    expect(run?.findings).toBeNull();
  });

  it('stops when the run goes terminal before the analyzing stage advance', async () => {
    const { runId, key } = await queuedRun();
    let calls = 0;
    const real = ContentInventoryRun.findById.bind(ContentInventoryRun);
    vi.spyOn(ContentInventoryRun, 'findById').mockImplementation(((id: unknown) => {
      calls += 1;
      // The 3rd findById is advance('analyzing') — return a terminal doc.
      if (calls === 3) return Promise.resolve({ status: 'completed' }) as never;
      return real(id as never) as never;
    }) as never);
    await proc()(job(runId, key));
    const run = await real(runId as never);
    // The run never reached analysis findings.
    expect(run?.findings).toBeNull();
  });
});

describe('processor helpers', () => {
  const payload = {
    accountId: ACCOUNT,
    siteId: SITE,
    runId: '0000000000000000000000ff',
    reservationKey: 'k',
  };
  const now = () => new Date('2026-07-20T00:00:00Z');

  function bareRun(over: Record<string, unknown> = {}) {
    const key = `hk_${Math.random().toString(36).slice(2)}`;
    return ContentInventoryRun.create({
      accountId: ACCOUNT,
      ownerUserId: ACCOUNT,
      siteId: SITE,
      origin: ORIGIN,
      locale: 'en',
      status: 'queued',
      input: { pageLimit: 4, allowedPaths: [], excludedPaths: [], sitemapSeeds: [] },
      progress: { pagesRequested: 4, pagesProcessed: 0, pagesFailed: 0, blocksReserved: 1 },
      stages: [{ name: 'queued', startedAt: new Date(), completedAt: null, error: null }],
      warnings: [],
      error: null,
      inputFingerprint: `fp_${key}`,
      idempotencyKey: key,
      thresholdsVersion: '1',
      findings: null,
      costMicros: 0,
      aiCostMicros: 0,
      requestedAt: new Date(),
      ...over,
    });
  }

  it('advance returns null for a missing or terminal run', async () => {
    expect(await advance('0000000000000000000000ff', 'crawling', now)).toBeNull();
    const done = await bareRun({ status: 'completed' });
    expect(await advance(String(done._id), 'crawling', now)).toBeNull();
  });

  it('advance is idempotent when already at the target stage', async () => {
    const run = await bareRun({ status: 'crawling', stages: [] });
    const out = await advance(String(run._id), 'crawling', now);
    expect(out?.status).toBe('crawling');
  });

  it('advance tolerates a run with no open stage entry', async () => {
    const run = await bareRun({
      stages: [{ name: 'queued', startedAt: new Date(), completedAt: new Date(), error: null }],
    });
    const out = await advance(String(run._id), 'crawling', now);
    expect(out?.status).toBe('crawling');
  });

  it('finalize is a no-op on a missing or terminal run', async () => {
    await expect(finalize({ db: db(), payload, status: 'completed', now })).resolves.toBeUndefined();
    const done = await bareRun({ status: 'failed' });
    await finalize({ db: db(), payload: { ...payload, runId: String(done._id) }, status: 'completed', now });
    const reloaded = await ContentInventoryRun.findById(done._id);
    expect(reloaded?.status).toBe('failed');
  });

  it('finalize tolerates a run whose current stage is already closed', async () => {
    const run = await bareRun({
      stages: [{ name: 'queued', startedAt: new Date(), completedAt: new Date(), error: null }],
    });
    await finalize({ db: db(), payload: { ...payload, runId: String(run._id) }, status: 'completed', now });
    const reloaded = await ContentInventoryRun.findById(run._id);
    expect(reloaded?.status).toBe('completed');
  });

  it('addWarning de-duplicates by code', async () => {
    const run = await bareRun();
    addWarning(run, 'code', 'key');
    addWarning(run, 'code', 'key-2');
    expect(run.warnings.filter((w) => w.code === 'code')).toHaveLength(1);
  });

  it('stripHtmlMarkers neutralizes deeply-nested markers past the pass budget', () => {
    const depth = 8;
    const nested = `${'<!doc'.repeat(depth)}<!doctype${'type'.repeat(depth)}`;
    const out = stripHtmlMarkers(nested);
    expect(out).not.toMatch(/<!doctype/i);
    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
  });
});
