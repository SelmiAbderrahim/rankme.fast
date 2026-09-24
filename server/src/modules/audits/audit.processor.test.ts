import { UnrecoverableError, type Job } from 'bullmq';
import mongoose from 'mongoose';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GscReconnectRequiredError,
  VendorAuthError,
  VendorUnavailableError,
  createFakeAuditProvider,
  createFakePageSpeedProvider,
  recordVendorCostUsd,
  FAKE_AUDIT_RESULT,
  type AuditProvider,
  type AuditStatus,
  type GscSearchEvaluationInput,
  type GscSitemapsEvaluationInput,
  type IndexStatusEvaluationInput,
  type PageSpeedProvider,
} from '../../shared/providers/index.js';
import { PAGESPEED_STAGE_DEADLINE_BUDGET_MS } from '../../shared/safety/pagespeed-defaults.js';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import { Site } from '../sites/index.js';
import {
  AuditRun,
  AuditedPage,
  ReportSnapshot,
  createAuditProcessor,
  onAuditJobExhausted,
  selectPageSpeedSampleUrls,
  urlPathDepth,
} from './index.js';

const logger = pino({ level: 'silent' });

beforeAll(() => startMemoryMongo());
afterAll(() => stopMemoryMongo());
beforeEach(() => clearCollections());

async function seed() {
  const accountId = new mongoose.Types.ObjectId();
  const site = await Site.create({
    accountId,
    url: 'https://example.com',
    domain: 'example.com',
  });
  const run = await AuditRun.create({ accountId, siteId: site._id, pageCap: 100 });
  return {
    accountId: accountId.toHexString(),
    siteId: site.id as string,
    runId: run.id as string,
  };
}

function jobFor(data: unknown): Job {
  return { data, attemptsMade: 0, opts: { attempts: 3 } } as unknown as Job;
}

const errCtx = { provider: 'fake', operation: 'test' };

describe('createAuditProcessor', () => {
  it('happy path: start → poll → result → run succeeded', async () => {
    const ids = await seed();
    const provider = createFakeAuditProvider({ vendorTaskId: 'task-1' });
    const processor = createAuditProcessor({ provider, logger });

    const outcome = await processor(jobFor({ ...ids, pageCap: 100 }));
    expect(outcome).toEqual({ runId: ids.runId, pagesCrawled: 2 });

    const run = await AuditRun.findById(ids.runId);
    expect(run?.status).toBe('succeeded');
    expect(run?.vendorTaskId).toBe('task-1');
    // Only domainChecks lands on the run doc.
    expect(run?.result).toEqual({ domainChecks: FAKE_AUDIT_RESULT.domainChecks });
  });

  it('archives the normalized crawl result (per-account) when an archiver is wired', async () => {
    const ids = await seed();
    const provider = createFakeAuditProvider({ vendorTaskId: 'task-arch' });
    const calls: Array<Record<string, unknown>> = [];
    const processor = createAuditProcessor({
      provider,
      logger,
      archiveVendorResponse: async (input) => {
        calls.push(input as unknown as Record<string, unknown>);
      },
    });
    await processor(jobFor({ ...ids, pageCap: 100 }));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      capability: 'audit',
      operation: 'crawl-result',
      accountId: ids.accountId,
      payload: FAKE_AUDIT_RESULT,
    });
    expect(calls[0]?.params).toMatchObject({
      accountId: ids.accountId,
      domain: 'example.com',
      vendorTaskId: 'task-arch',
      // Page counts feed the superadmin page-based cost estimator.
      pageCap: 100,
      pagesCrawled: FAKE_AUDIT_RESULT.pages.length,
    });
    expect(calls[0]?.fetchedAt).toBeInstanceOf(Date);
  });

  it('retry-resume: a running run with a vendorTaskId never re-posts the crawl', async () => {
    const ids = await seed();
    // Simulate attempt #1 having posted the crawl and persisted the task id
    // before dying (poll-budget exhaustion / worker crash).
    await AuditRun.updateOne(
      { _id: ids.runId },
      { $set: { status: 'running', vendorTaskId: 'task-prior' } },
    );
    const inner = createFakeAuditProvider({ vendorTaskId: 'task-never-posted' });
    const startAudit = vi.fn(inner.startAudit.bind(inner));
    const getAuditStatus = vi.fn(inner.getAuditStatus.bind(inner));
    const calls: Array<Record<string, unknown>> = [];
    const processor = createAuditProcessor({
      provider: { ...inner, startAudit, getAuditStatus },
      logger,
      archiveVendorResponse: async (input) => {
        calls.push(input as unknown as Record<string, unknown>);
      },
    });
    const outcome = await processor(jobFor({ ...ids, pageCap: 100 }));
    expect(outcome).toEqual({ runId: ids.runId, pagesCrawled: 2 });
    // The billed task_post never fired — polling resumed the persisted task.
    expect(startAudit).not.toHaveBeenCalled();
    expect(getAuditStatus).toHaveBeenCalledWith('task-prior');
    expect(calls[0]?.params).toMatchObject({ vendorTaskId: 'task-prior' });
    const run = await AuditRun.findById(ids.runId);
    expect(run?.status).toBe('succeeded');
  });

  it('retry with a running run but NO persisted task id posts a fresh crawl (crash-window fallback)', async () => {
    const ids = await seed();
    await AuditRun.updateOne({ _id: ids.runId }, { $set: { status: 'running' } });
    const inner = createFakeAuditProvider({ vendorTaskId: 'task-fresh' });
    const startAudit = vi.fn(inner.startAudit.bind(inner));
    const processor = createAuditProcessor({ provider: { ...inner, startAudit }, logger });
    const outcome = await processor(jobFor({ ...ids, pageCap: 100 }));
    expect(outcome).toEqual({ runId: ids.runId, pagesCrawled: 2 });
    expect(startAudit).toHaveBeenCalledTimes(1);
  });

  it('sums the vendor cost recorded across the crawl span onto the archive row', async () => {
    const ids = await seed();
    const inner = createFakeAuditProvider({ vendorTaskId: 'task-cost' });
    const provider: AuditProvider = {
      async startAudit(input) {
        // Stands in for the DataForSEO choke point recording envelope costs.
        recordVendorCostUsd(0.001);
        return inner.startAudit(input);
      },
      async getAuditStatus(id) {
        return inner.getAuditStatus(id);
      },
      async getAuditResult(id) {
        recordVendorCostUsd(0.5);
        return inner.getAuditResult(id);
      },
    };
    const calls: Array<{ costMicros?: bigint | null }> = [];
    const processor = createAuditProcessor({
      provider,
      logger,
      archiveVendorResponse: async (input) => {
        calls.push(input);
      },
    });
    await processor(jobFor({ ...ids, pageCap: 100 }));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.costMicros).toBe(501_000n);
  });

  it('archives nothing when the vendor crawl fails', async () => {
    const ids = await seed();
    const provider = createFakeAuditProvider({
      vendorTaskId: 'task-f',
      status: { state: 'failed', error: 'blocked' },
    });
    const calls: unknown[] = [];
    const processor = createAuditProcessor({
      provider,
      logger,
      archiveVendorResponse: async (input) => {
        calls.push(input);
      },
    });
    await expect(processor(jobFor({ ...ids, pageCap: 100 }))).rejects.toThrow(
      UnrecoverableError,
    );
    expect(calls).toHaveLength(0);
  });

  it('polls through crawling until the vendor finishes', async () => {
    const ids = await seed();
    const status: AuditStatus = { state: 'crawling', pagesCrawled: 1 };
    const provider = createFakeAuditProvider({ status });
    const sleep = vi.fn(async () => {
      status.state = 'finished'; // vendor finishes while we wait
    });
    const processor = createAuditProcessor({ provider, logger, sleep, pollIntervalMs: 1 });

    const outcome = await processor(jobFor({ ...ids, pageCap: 100 }));
    expect(outcome.pagesCrawled).toBe(2);
    expect(sleep).toHaveBeenCalledWith(1);
  });

  it('vendor-reported crawl failure → UnrecoverableError + run failed', async () => {
    const ids = await seed();
    const provider = createFakeAuditProvider({
      status: { state: 'failed', error: 'robots.txt denied' },
    });
    const processor = createAuditProcessor({ provider, logger });

    await expect(processor(jobFor({ ...ids, pageCap: 100 }))).rejects.toThrow(
      UnrecoverableError,
    );
    const run = await AuditRun.findById(ids.runId);
    expect(run?.status).toBe('failed');
    expect(run?.error).toBe('vendor audit failed: robots.txt denied');
  });

  it('vendor failure without detail reports unknown', async () => {
    const ids = await seed();
    const provider = createFakeAuditProvider({ status: { state: 'failed' } });
    const processor = createAuditProcessor({ provider, logger });

    await expect(processor(jobFor({ ...ids, pageCap: 100 }))).rejects.toThrow(
      /vendor audit failed: unknown/,
    );
  });

  it('poll budget exhausted → plain retryable error, run stays running', async () => {
    const ids = await seed();
    const provider = createFakeAuditProvider({ status: { state: 'queued' } });
    const processor = createAuditProcessor({
      provider,
      logger,
      maxPolls: 2,
      sleep: async () => {},
    });

    const rejection = expect(processor(jobFor({ ...ids, pageCap: 100 }))).rejects;
    await rejection.toThrow(/still running after 2 polls/);
    await rejection.not.toThrow(UnrecoverableError);
    expect((await AuditRun.findById(ids.runId))?.status).toBe('running');
  });

  it('missing site (cross-account or deleted) → UnrecoverableError + run failed', async () => {
    const ids = await seed();
    const foreign = { ...ids, accountId: new mongoose.Types.ObjectId().toHexString() };
    const processor = createAuditProcessor({ provider: createFakeAuditProvider(), logger });

    await expect(processor(jobFor({ ...foreign, pageCap: 100 }))).rejects.toThrow(
      'site not found for audit job',
    );
    expect((await AuditRun.findById(ids.runId))?.status).toBe('failed');
  });

  it('malformed payload → UnrecoverableError before any domain write', async () => {
    await seed();
    const processor = createAuditProcessor({ provider: createFakeAuditProvider(), logger });
    await expect(processor(jobFor({ evil: true }))).rejects.toThrow(UnrecoverableError);
    // No run was touched — there is no runId to touch.
    expect(await AuditRun.countDocuments({ status: { $ne: 'queued' } })).toBe(0);
  });

  it('non-retryable provider error (auth) → run failed + UnrecoverableError', async () => {
    const ids = await seed();
    const provider = createFakeAuditProvider({
      failure: new VendorAuthError('401 bad credentials', errCtx),
    });
    const processor = createAuditProcessor({ provider, logger });

    await expect(processor(jobFor({ ...ids, pageCap: 100 }))).rejects.toThrow(
      UnrecoverableError,
    );
    const run = await AuditRun.findById(ids.runId);
    expect(run?.status).toBe('failed');
    expect(run?.error).toBe('401 bad credentials');
  });

  it('retryable provider error is rethrown untouched (BullMQ retries)', async () => {
    const ids = await seed();
    const provider = createFakeAuditProvider({
      failure: new VendorUnavailableError('503 from vendor', errCtx),
    });
    const processor = createAuditProcessor({ provider, logger });

    await expect(processor(jobFor({ ...ids, pageCap: 100 }))).rejects.toThrow(
      VendorUnavailableError,
    );
    // Not finalized — the retry (or the exhaustion hook) owns the ending.
    expect((await AuditRun.findById(ids.runId))?.status).toBe('queued');
  });

  it('legacy lead run (no Site doc) → UnrecoverableError + run failed', async () => {
    const systemId = new mongoose.Types.ObjectId();
    const run = await AuditRun.create({
      accountId: systemId,
      siteId: systemId,
      pageCap: 25,
      kind: 'lead',
      targetUrl: 'https://lead.example',
      targetDomain: 'lead.example',
    });
    const processor = createAuditProcessor({ provider: createFakeAuditProvider(), logger });
    const ids = {
      accountId: systemId.toHexString(),
      siteId: systemId.toHexString(),
      runId: run.id as string,
    };
    await expect(processor(jobFor({ ...ids, pageCap: 25 }))).rejects.toThrow(
      'site not found for audit job',
    );
    expect((await AuditRun.findById(ids.runId))?.status).toBe('failed');
  });

  it('uses the default 2s poll cadence when none injected (one real sleep)', async () => {
    const ids = await seed();
    const inner = createFakeAuditProvider();
    let polls = 0;
    const provider = {
      ...inner,
      async getAuditStatus(taskId: string): Promise<AuditStatus> {
        polls += 1;
        return polls === 1 ? { state: 'crawling' } : inner.getAuditStatus(taskId);
      },
    };
    const processor = createAuditProcessor({ provider, logger });

    const startedAt = Date.now();
    const outcome = await processor(jobFor({ ...ids, pageCap: 100 }));
    expect(outcome.pagesCrawled).toBe(2);
    expect(polls).toBe(2);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1_900);
  });
});

describe('urlPathDepth', () => {
  it('counts non-empty path segments', () => {
    expect(urlPathDepth('https://example.com/')).toBe(0);
    expect(urlPathDepth('https://example.com/a')).toBe(1);
    expect(urlPathDepth('https://example.com/a/b/c/')).toBe(3);
  });
  it('returns MAX_SAFE_INTEGER on garbage input (sinks it to the end of sort)', () => {
    expect(urlPathDepth('not a url')).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('selectPageSpeedSampleUrls', () => {
  const pages = [
    { url: 'https://example.com/deep/nested/page', isIndexable: true, onPageScore: 80 },
    { url: 'https://example.com/shallow', isIndexable: true, onPageScore: 40 },
    { url: 'https://example.com/other', isIndexable: true, onPageScore: 90 },
    { url: 'https://example.com/hidden', isIndexable: false, onPageScore: 70 },
  ] as const;

  it('always leads with the root URL, then shortest paths first', () => {
    const urls = selectPageSpeedSampleUrls(
      'https://example.com',
      pages as never,
      2,
    );
    expect(urls[0]).toBe('https://example.com');
    expect(urls.length).toBe(3);
    // Depth 1 paths ("/shallow", "/other") come before the depth-3 nested one.
    expect(urls.slice(1)).toEqual(
      expect.arrayContaining(['https://example.com/shallow', 'https://example.com/other']),
    );
    expect(urls).not.toContain('https://example.com/deep/nested/page');
  });

  it('tiebreaks equal depths by higher onPageScore', () => {
    const urls = selectPageSpeedSampleUrls(
      'https://example.com',
      pages as never,
      1,
    );
    // /other (score 90) beats /shallow (score 40) among the depth-1 pages.
    expect(urls).toEqual(['https://example.com', 'https://example.com/other']);
  });

  it('skips non-indexable pages', () => {
    const urls = selectPageSpeedSampleUrls(
      'https://example.com',
      pages as never,
      10,
    );
    expect(urls).not.toContain('https://example.com/hidden');
  });

  it('empty pages list — still returns the root URL', () => {
    expect(selectPageSpeedSampleUrls('https://example.com', [], 3)).toEqual([
      'https://example.com',
    ]);
  });

  it('sampleSize 0 means root-only PageSpeed analysis', () => {
    expect(selectPageSpeedSampleUrls('https://example.com', pages as never, 0)).toEqual([
      'https://example.com',
    ]);
  });

  it('dedupes when a crawled page URL equals the root URL', () => {
    const withRoot = [
      { url: 'https://example.com', isIndexable: true, onPageScore: 80 },
      ...pages,
    ];
    const urls = selectPageSpeedSampleUrls(
      'https://example.com',
      withRoot as never,
      2,
    );
    expect(urls.filter((u) => u === 'https://example.com')).toHaveLength(1);
  });

  it('dedupes duplicate URLs between crawled pages (ranked loop `seen` guard)', () => {
    const dupes = [
      { url: 'https://example.com/a', isIndexable: true, onPageScore: 90 },
      { url: 'https://example.com/a', isIndexable: true, onPageScore: 80 },
      { url: 'https://example.com/b', isIndexable: true, onPageScore: 70 },
    ];
    const urls = selectPageSpeedSampleUrls('https://example.com', dupes as never, 3);
    // Only ONE entry for /a should survive the dedupe.
    expect(urls.filter((u) => u === 'https://example.com/a')).toHaveLength(1);
  });

  it('missing onPageScore is treated as 0 for tiebreaking', () => {
    const two = [
      { url: 'https://example.com/a', isIndexable: true },
      { url: 'https://example.com/b', isIndexable: true, onPageScore: 5 },
    ];
    const urls = selectPageSpeedSampleUrls('https://example.com', two as never, 1);
    // /b wins on onPageScore=5 vs undefined→0.
    expect(urls).toEqual(['https://example.com', 'https://example.com/b']);
  });

  it('all pages missing onPageScore — both ?? 0 fallbacks fire in the sort', () => {
    const noScores = [
      { url: 'https://example.com/a', isIndexable: true },
      { url: 'https://example.com/b', isIndexable: true },
      { url: 'https://example.com/c', isIndexable: true },
    ];
    const urls = selectPageSpeedSampleUrls('https://example.com', noScores as never, 3);
    expect(urls[0]).toBe('https://example.com');
    expect(urls.length).toBe(4);
  });
});

describe('onAuditJobExhausted', () => {
  it('marks the run unavailable for retryable provider errors', async () => {
    const ids = await seed();
    await onAuditJobExhausted(
      jobFor({ ...ids, pageCap: 100 }),
      new VendorUnavailableError('503 thrice', errCtx),
    );
    const run = await AuditRun.findById(ids.runId);
    expect(run?.status).toBe('unavailable');
    expect(run?.error).toBe('503 thrice');
  });

  it('marks the run failed for non-provider errors', async () => {
    const ids = await seed();
    await onAuditJobExhausted(jobFor({ ...ids, pageCap: 100 }), new Error('processor bug'));
    expect((await AuditRun.findById(ids.runId))?.status).toBe('failed');
  });

  it('no-ops on payloads that never parsed', async () => {
    const ids = await seed();
    await onAuditJobExhausted(jobFor({ garbage: 1 }), new Error('x'));
    expect((await AuditRun.findById(ids.runId))?.status).toBe('queued');
  });
});

describe('audit processor — page persistence and PageSpeed sampling', () => {
  it('persists pages and marks the run succeeded on the happy path', async () => {
    const ids = await seed();
    const provider = createFakeAuditProvider();
    const processor = createAuditProcessor({ provider, logger });
    await processor(jobFor({ ...ids, pageCap: 100 }));
    const pages = await AuditedPage.find({ runId: ids.runId }).sort({ url: 1 });
    expect(pages).toHaveLength(FAKE_AUDIT_RESULT.pages.length);
    expect(pages.map((p) => p.url).sort()).toEqual(
      FAKE_AUDIT_RESULT.pages.map((p) => p.url).sort(),
    );
    expect((await AuditRun.findById(ids.runId))?.status).toBe('succeeded');
  });

  it('idempotent re-run replaces prior pages (no partial data alongside final)', async () => {
    const ids = await seed();
    // Seed a "stale" page from a prior partial attempt.
    await AuditedPage.create({
      runId: ids.runId,
      url: 'https://example.com/stale',
      statusCode: 200,
      onPageScore: 10,
    });
    const provider = createFakeAuditProvider();
    const processor = createAuditProcessor({ provider, logger });
    // First transition to queued so the run-service guard passes.
    await AuditRun.updateOne({ _id: ids.runId }, { $set: { status: 'queued' } });
    await processor(jobFor({ ...ids, pageCap: 100 }));
    const pages = await AuditedPage.find({ runId: ids.runId });
    expect(pages.some((p) => p.url === 'https://example.com/stale')).toBe(false);
    expect(pages).toHaveLength(FAKE_AUDIT_RESULT.pages.length);
  });

  it('writes a report snapshot on happy path', async () => {
    const ids = await seed();
    const provider = createFakeAuditProvider();
    const processor = createAuditProcessor({ provider, logger });
    await processor(jobFor({ ...ids, pageCap: 100 }));
    const snap = await ReportSnapshot.findOne({ runId: ids.runId });
    expect(snap).not.toBeNull();
    expect(snap!.counts.fixNow + snap!.counts.watch + snap!.counts.passed).toBeGreaterThan(0);
    expect(snap!.findings.length).toBeGreaterThan(0);
  });

  it('re-running replaces the prior snapshot in place (idempotent)', async () => {
    const ids = await seed();
    const provider = createFakeAuditProvider();
    const processor = createAuditProcessor({ provider, logger });
    await processor(jobFor({ ...ids, pageCap: 100 }));
    await AuditRun.updateOne({ _id: ids.runId }, { $set: { status: 'queued' } });
    await processor(jobFor({ ...ids, pageCap: 100 }));
    const snapshots = await ReportSnapshot.find({ runId: ids.runId });
    expect(snapshots).toHaveLength(1);
  });

  it('samples PageSpeed + persists a pageSpeed section', async () => {
    const ids = await seed();
    const provider = createFakeAuditProvider();
    const psCalls: string[] = [];
    const pageSpeedProvider: PageSpeedProvider = {
      async analyze(input) {
        psCalls.push(input.url);
        return {
          labScores: { performance: 92, accessibility: 90, bestPractices: 92, seo: 100 },
          coreWebVitals: { lcpMs: 1800, inp: 120, cls: 0.05, category: 'good' },
          mobileFriendly: true,
        };
      },
    };
    const processor = createAuditProcessor({
      provider,
      logger,
      pageSpeedProvider,
      pageSpeedSampleSize: 2,
    });
    await processor(jobFor({ ...ids, pageCap: 100 }));
    expect(psCalls.length).toBeGreaterThan(0);
    // Root URL is always sampled.
    expect(psCalls[0]).toBe('https://example.com');
    const snap = await ReportSnapshot.findOne({ runId: ids.runId });
    const snapAny = snap as unknown as {
      pageSpeed?: { status: 'ok' | 'unavailable'; samples: Array<{ url: string }> };
    };
    expect(snapAny.pageSpeed?.status).toBe('ok');
    expect(snapAny.pageSpeed?.samples.length).toBeGreaterThan(0);
  });

  it('page-speed sampling failure degrades to unavailable — run still finishes', async () => {
    const ids = await seed();
    const provider = createFakeAuditProvider();
    const err = new VendorUnavailableError('vendor down', errCtx);
    const pageSpeedProvider: PageSpeedProvider = {
      async analyze() {
        throw err;
      },
    };
    const processor = createAuditProcessor({
      provider,
      logger,
      pageSpeedProvider,
      pageSpeedSampleSize: 1,
    });
    const outcome = await processor(jobFor({ ...ids, pageCap: 100 }));
    expect(outcome.runId).toBe(ids.runId);
    const run = await AuditRun.findById(ids.runId);
    expect(run?.status).toBe('succeeded');
    const snap = await ReportSnapshot.findOne({ runId: ids.runId });
    const snapAny = snap as unknown as { pageSpeed?: { status: 'ok' | 'unavailable' } };
    expect(snapAny.pageSpeed?.status).toBe('unavailable');
  });

  it('mixed pageSpeed failures — status stays "ok" as long as ≥1 sample succeeds', async () => {
    const ids = await seed();
    const provider = createFakeAuditProvider();
    let call = 0;
    const pageSpeedProvider: PageSpeedProvider = {
      async analyze() {
        call += 1;
        if (call === 1) throw new VendorUnavailableError('flaky', errCtx);
        return {
          labScores: { performance: 92, accessibility: 90, bestPractices: 92, seo: 100 },
          coreWebVitals: { lcpMs: 1800, inp: 120, cls: 0.05, category: 'good' },
        };
      },
    };
    const processor = createAuditProcessor({
      provider,
      logger,
      pageSpeedProvider,
      pageSpeedSampleSize: 2,
    });
    await processor(jobFor({ ...ids, pageCap: 100 }));
    const snap = await ReportSnapshot.findOne({ runId: ids.runId });
    const snapAny = snap as unknown as { pageSpeed?: { status: 'ok' | 'unavailable'; samples: unknown[] } };
    expect(snapAny.pageSpeed?.status).toBe('ok');
    expect(snapAny.pageSpeed?.samples.length).toBe(1);
  });

  it('pageSpeedSampleSize=0 analyzes only the root URL', async () => {
    const ids = await seed();
    const provider = createFakeAuditProvider();
    const analyze = vi.fn(async () => ({
      labScores: { performance: 90, accessibility: 90, bestPractices: 90, seo: 100 },
    }));
    const processor = createAuditProcessor({
      provider,
      logger,
      pageSpeedProvider: { analyze } as PageSpeedProvider,
      pageSpeedSampleSize: 0,
    });
    await processor(jobFor({ ...ids, pageCap: 100 }));
    expect(analyze).toHaveBeenCalledOnce();
    expect(analyze).toHaveBeenCalledWith({
      url: 'https://example.com',
      strategy: 'mobile',
    });
    const snap = await ReportSnapshot.findOne({ runId: ids.runId });
    const snapAny = snap as unknown as {
      pageSpeed?: { status: string; samples: Array<{ url: string }> };
    };
    expect(snapAny.pageSpeed).toMatchObject({
      status: 'ok',
      samples: [{ url: 'https://example.com' }],
    });
  });

  it('skips PageSpeed before spend when the bounded stage cannot fit the audit deadline', async () => {
    const ids = await seed();
    const analyze = vi.fn(async () => ({
      labScores: { performance: 90, accessibility: 90, bestPractices: 90, seo: 100 },
    }));
    let clockReads = 0;
    const processor = createAuditProcessor({
      provider: createFakeAuditProvider(),
      logger,
      pageSpeedProvider: { analyze } as PageSpeedProvider,
      pageSpeedSampleSize: 3,
      runTimeoutMs: PAGESPEED_STAGE_DEADLINE_BUDGET_MS,
      now: () => {
        clockReads += 1;
        return clockReads >= 3 ? 1 : 0;
      },
    });

    await processor(jobFor({ ...ids, pageCap: 100 }));

    expect(analyze).not.toHaveBeenCalled();
    const snap = await ReportSnapshot.findOne({ runId: ids.runId });
    const snapAny = snap as unknown as {
      pageSpeed?: { status: string; samples: unknown[] };
    };
    expect(snapAny.pageSpeed?.status).toBe('unavailable');
    expect(snapAny.pageSpeed?.samples).toHaveLength(0);
  });

  it('no pageSpeedProvider dep → no PageSpeed calls or snapshot section', async () => {
    const ids = await seed();
    const provider = createFakeAuditProvider();
    const processor = createAuditProcessor({ provider, logger });
    await processor(jobFor({ ...ids, pageCap: 100 }));
    const snap = await ReportSnapshot.findOne({ runId: ids.runId });
    const snapAny = snap as unknown as { pageSpeed?: unknown };
    expect(snapAny.pageSpeed ?? null).toBeNull();
  });

  it('provider result WITHOUT fieldDataLevel — falls back to url/none from coreWebVitals presence', async () => {
    const ids = await seed();
    const provider = createFakeAuditProvider();
    let call = 0;
    const pageSpeedProvider: PageSpeedProvider = {
      async analyze() {
        call += 1;
        // No fieldDataLevel on the returned object — first sample HAS CWV
        // (should default to 'url'), second sample has NONE (defaults to 'none').
        if (call === 1) {
          return {
            labScores: { performance: 92, accessibility: 90, bestPractices: 92, seo: 100 },
            coreWebVitals: { lcpMs: 1800, inp: 120, cls: 0.05, category: 'good' as const },
          };
        }
        return {
          labScores: { performance: 92, accessibility: 90, bestPractices: 92, seo: 100 },
        };
      },
    };
    const processor = createAuditProcessor({
      provider,
      logger,
      pageSpeedProvider,
      pageSpeedSampleSize: 2,
    });
    await processor(jobFor({ ...ids, pageCap: 100 }));
    const snap = await ReportSnapshot.findOne({ runId: ids.runId });
    const snapAny = snap as unknown as {
      pageSpeed?: { samples: Array<{ fieldDataLevel: string }> };
    };
    const levels = snapAny.pageSpeed?.samples.map((s) => s.fieldDataLevel) ?? [];
    expect(levels).toContain('url');
    expect(levels).toContain('none');
  });

  it('honours the AnalyzedPageSpeed fieldDataLevel when the provider carries it', async () => {
    const ids = await seed();
    const provider = createFakeAuditProvider();
    // The fake provider returns FAKE_PAGESPEED_RESULT which now carries fieldDataLevel='url'.
    const processor = createAuditProcessor({
      provider,
      logger,
      pageSpeedProvider: createFakePageSpeedProvider(),
      pageSpeedSampleSize: 1,
    });
    await processor(jobFor({ ...ids, pageCap: 100 }));
    const snap = await ReportSnapshot.findOne({ runId: ids.runId });
    const snapAny = snap as unknown as {
      pageSpeed?: { samples: Array<{ fieldDataLevel: string }> };
    };
    expect(snapAny.pageSpeed?.samples[0]?.fieldDataLevel).toBe('url');
  });

  it('collectIndexStatus dep unset → snapshot has no indexStatus (audit still finishes)', async () => {
    const ids = await seed();
    const provider = createFakeAuditProvider();
    const processor = createAuditProcessor({ provider, logger });
    await processor(jobFor({ ...ids, pageCap: 100 }));
    const snap = await ReportSnapshot.findOne({ runId: ids.runId });
    const snapAny = snap as unknown as { indexStatus?: unknown };
    expect(snapAny.indexStatus ?? null).toBeNull();
  });

  it('collectIndexStatus success → indexStatus samples persisted', async () => {
    const ids = await seed();
    const provider = createFakeAuditProvider();
    const collectIndexStatus = vi.fn(async (): Promise<IndexStatusEvaluationInput> => ({
      status: 'ok',
      samples: [
        {
          url: 'https://example.com',
          inspection: {
            indexVerdict: 'PASS',
            coverageState: 'Submitted and indexed',
            robotsTxtState: 'ALLOWED',
            pageFetchState: 'SUCCESSFUL',
            googleCanonical: 'https://example.com/',
            lastCrawlTime: new Date('2026-01-01T00:00:00.000Z'),
            richResults: { verdict: 'PASS', items: [{ type: 'FAQ', issues: 0 }] },
          },
        },
      ],
    }));
    const processor = createAuditProcessor({
      provider,
      logger,
      collectIndexStatus,
      gscInspectSampleSize: 2,
    });
    await processor(jobFor({ ...ids, pageCap: 100 }));
    expect(collectIndexStatus).toHaveBeenCalledTimes(1);
    const args = (collectIndexStatus.mock.calls as unknown as Array<unknown[]>)[0]![0] as {
      accountId: string;
      siteId: string;
      domain: string;
      rootUrl: string;
      urls: readonly string[];
    };
    expect(args.accountId).toBe(ids.accountId);
    expect(args.siteId).toBe(ids.siteId);
    expect(args.domain).toBe('example.com');
    expect(args.rootUrl).toBe('https://example.com');
    expect(args.urls.length).toBeGreaterThan(0);
    const snap = await ReportSnapshot.findOne({ runId: ids.runId });
    const snapAny = snap as unknown as {
      indexStatus?: { status: string; samples: Array<{ url: string }> };
    };
    expect(snapAny.indexStatus?.status).toBe('ok');
    expect(snapAny.indexStatus?.samples[0]?.url).toBe('https://example.com');
  });

  it('collectIndexStatus throws GscReconnectRequiredError → degrades to unavailable (run still finishes)', async () => {
    const ids = await seed();
    const provider = createFakeAuditProvider();
    const collectIndexStatus = vi.fn(async (): Promise<IndexStatusEvaluationInput> => {
      throw new GscReconnectRequiredError('reconnect', {
        provider: 'google',
        operation: 'gsc-token-refresh',
      });
    });
    const processor = createAuditProcessor({
      provider,
      logger,
      collectIndexStatus,
      gscInspectSampleSize: 1,
    });
    const outcome = await processor(jobFor({ ...ids, pageCap: 100 }));
    expect(outcome.runId).toBe(ids.runId);
    const run = await AuditRun.findById(ids.runId);
    expect(run?.status).toBe('succeeded');
    const snap = await ReportSnapshot.findOne({ runId: ids.runId });
    const snapAny = snap as unknown as { indexStatus?: { status: string } };
    expect(snapAny.indexStatus?.status).toBe('unavailable');
  });

  it('collectIndexStatus returns not-connected without throwing → status persisted', async () => {
    const ids = await seed();
    const provider = createFakeAuditProvider();
    const collectIndexStatus = vi.fn(async (): Promise<IndexStatusEvaluationInput> => ({
      status: 'not-connected',
      samples: [],
    }));
    const processor = createAuditProcessor({
      provider,
      logger,
      collectIndexStatus,
    });
    await processor(jobFor({ ...ids, pageCap: 100 }));
    const snap = await ReportSnapshot.findOne({ runId: ids.runId });
    const snapAny = snap as unknown as { indexStatus?: { status: string } };
    expect(snapAny.indexStatus?.status).toBe('not-connected');
  });

  it('gscInspectSampleSize=0 skips GSC entirely (no indexStatus section)', async () => {
    const ids = await seed();
    const provider = createFakeAuditProvider();
    const collectIndexStatus = vi.fn();
    const processor = createAuditProcessor({
      provider,
      logger,
      collectIndexStatus,
      gscInspectSampleSize: 0,
    });
    await processor(jobFor({ ...ids, pageCap: 100 }));
    expect(collectIndexStatus).not.toHaveBeenCalled();
    const snap = await ReportSnapshot.findOne({ runId: ids.runId });
    const snapAny = snap as unknown as { indexStatus?: unknown };
    expect(snapAny.indexStatus ?? null).toBeNull();
  });

  it('collectGscInsights dep unset → snapshot has neither gsc section (audit still finishes)', async () => {
    const ids = await seed();
    const provider = createFakeAuditProvider();
    const processor = createAuditProcessor({ provider, logger });
    await processor(jobFor({ ...ids, pageCap: 100 }));
    const snap = await ReportSnapshot.findOne({ runId: ids.runId });
    const snapAny = snap as unknown as { gscSearch?: unknown; gscSitemaps?: unknown };
    expect(snapAny.gscSearch ?? null).toBeNull();
    expect(snapAny.gscSitemaps ?? null).toBeNull();
  });

  it('collectGscInsights success → both sections persisted', async () => {
    const ids = await seed();
    const provider = createFakeAuditProvider();
    const collectGscInsights = vi.fn(async () => ({
      search: {
        status: 'ok',
        totalClicks: 54,
        totalImpressions: 4280,
        averageCtr: 54 / 4280,
        averagePosition: 6.2,
        topQueries: [
          {
            query: 'seo audit',
            clicks: 30,
            impressions: 3000,
            ctr: 0.01,
            position: 5.5,
          },
        ],
        topPages: [
          {
            url: 'https://example.com/',
            clicks: 20,
            impressions: 2000,
            ctr: 0.01,
            position: 4.0,
          },
        ],
        delta: { clicks: 8, impressions: 400 },
      } satisfies GscSearchEvaluationInput,
      sitemaps: {
        status: 'ok',
        sitemaps: [
          {
            path: 'https://example.com/sitemap.xml',
            errors: 0,
            warnings: 0,
            processed: 128,
            lastDownloaded: new Date('2026-07-01T04:30:00.000Z'),
          },
        ],
      } satisfies GscSitemapsEvaluationInput,
    }));
    const processor = createAuditProcessor({
      provider,
      logger,
      collectGscInsights,
    });
    await processor(jobFor({ ...ids, pageCap: 100 }));
    expect(collectGscInsights).toHaveBeenCalledTimes(1);
    expect(collectGscInsights).toHaveBeenCalledWith({
      accountId: ids.accountId,
      siteId: ids.siteId,
      domain: 'example.com',
    });
    const snap = await ReportSnapshot.findOne({ runId: ids.runId });
    const snapAny = snap as unknown as {
      gscSearch?: {
        status: string;
        totalClicks: number;
        topQueries: Array<{ query: string }>;
        delta: { clicks: number | null };
      };
      gscSitemaps?: { status: string; sitemaps: Array<{ path: string }> };
    };
    expect(snapAny.gscSearch?.status).toBe('ok');
    expect(snapAny.gscSearch?.totalClicks).toBe(54);
    expect(snapAny.gscSearch?.topQueries[0]?.query).toBe('seo audit');
    expect(snapAny.gscSearch?.delta.clicks).toBe(8);
    expect(snapAny.gscSitemaps?.status).toBe('ok');
    expect(snapAny.gscSitemaps?.sitemaps[0]?.path).toBe(
      'https://example.com/sitemap.xml',
    );
  });

  it('collectGscInsights throws → both sections degrade to unavailable, run still finishes', async () => {
    const ids = await seed();
    const provider = createFakeAuditProvider();
    const collectGscInsights = vi.fn(async () => {
      throw new Error('unexpected collector crash');
    });
    const processor = createAuditProcessor({
      provider,
      logger,
      collectGscInsights: collectGscInsights as never,
    });
    const outcome = await processor(jobFor({ ...ids, pageCap: 100 }));
    expect(outcome.runId).toBe(ids.runId);
    const run = await AuditRun.findById(ids.runId);
    expect(run?.status).toBe('succeeded');
    const snap = await ReportSnapshot.findOne({ runId: ids.runId });
    const snapAny = snap as unknown as {
      gscSearch?: { status: string; topQueries: unknown[] };
      gscSitemaps?: { status: string; sitemaps: unknown[] };
    };
    expect(snapAny.gscSearch?.status).toBe('unavailable');
    expect(snapAny.gscSearch?.topQueries).toEqual([]);
    expect(snapAny.gscSitemaps?.status).toBe('unavailable');
    expect(snapAny.gscSitemaps?.sitemaps).toEqual([]);
  });

  it('PageSpeed sampling caps concurrent calls to PAGESPEED_CONCURRENCY (3)', async () => {
    const ids = await seed();
    // Make the vendor return more pages than the concurrency bound.
    function makePage(i: number) {
      return {
        url: `https://example.com/p${i}`,
        statusCode: 200,
        title: `p${i}`,
        metaDescription: null,
        h1: [],
        h2: [],
        canonical: null,
        hasStructuredData: false,
        structuredDataErrors: [],
        isIndexable: true,
        nonIndexableReason: null,
        brokenLinks: [],
        onPageScore: 90 - i,
        timing: null,
      };
    }
    const bigResult = {
      pages: Array.from({ length: 7 }, (_, i) => makePage(i)),
      domainChecks: FAKE_AUDIT_RESULT.domainChecks,
    };
    const provider = {
      ...createFakeAuditProvider({ vendorTaskId: 'psi-conc' }),
      async getAuditResult(): Promise<typeof bigResult> {
        return bigResult;
      },
    };

    let active = 0;
    let peak = 0;
    const analyze = vi.fn(async () => {
      active += 1;
      if (active > peak) peak = active;
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return {
        labScores: { performance: 90, accessibility: 90, bestPractices: 90, seo: 100 },
        coreWebVitals: { lcpMs: 1000, inp: 100, cls: 0.01, category: 'good' as const },
      };
    });
    const processor = createAuditProcessor({
      provider: provider as never,
      logger,
      pageSpeedProvider: { analyze } as unknown as PageSpeedProvider,
      pageSpeedSampleSize: 7,
    });
    await processor(jobFor({ ...ids, pageCap: 100 }));
    // 8 URLs sampled (root + 7 pages), at most 3 in flight at any time.
    expect(analyze).toHaveBeenCalled();
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('PageSpeed sampling preserves input URL order regardless of completion order', async () => {
    const ids = await seed();
    function makePage(url: string, score: number) {
      return {
        url,
        statusCode: 200,
        title: url,
        metaDescription: null,
        h1: [],
        h2: [],
        canonical: null,
        hasStructuredData: false,
        structuredDataErrors: [],
        isIndexable: true,
        nonIndexableReason: null,
        brokenLinks: [],
        onPageScore: score,
        timing: null,
      };
    }
    const bigResult = {
      pages: [
        makePage('https://example.com/first', 99),
        makePage('https://example.com/second', 90),
        makePage('https://example.com/third', 80),
      ],
      domainChecks: FAKE_AUDIT_RESULT.domainChecks,
    };
    const provider = {
      ...createFakeAuditProvider(),
      async getAuditResult(): Promise<typeof bigResult> {
        return bigResult;
      },
    };
    // Make the SECOND URL resolve last so completion order != input order.
    const analyze = vi.fn(async (input: { url: string }) => {
      const delayMs = input.url.endsWith('/second') ? 60 : 5;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return {
        labScores: { performance: 90, accessibility: 90, bestPractices: 90, seo: 100 },
      };
    });
    const processor = createAuditProcessor({
      provider: provider as never,
      logger,
      pageSpeedProvider: { analyze } as unknown as PageSpeedProvider,
      pageSpeedSampleSize: 3,
    });
    await processor(jobFor({ ...ids, pageCap: 100 }));
    const snap = await ReportSnapshot.findOne({ runId: ids.runId });
    const snapAny = snap as unknown as {
      pageSpeed?: { samples: Array<{ url: string }> };
    };
    const urls = (snapAny.pageSpeed?.samples ?? []).map((s) => s.url);
    // First entry is always the root URL; the remaining follow crawled-pages
    // order (root, /first, /second, /third).
    expect(urls[0]).toBe('https://example.com');
    expect(urls).toEqual([
      'https://example.com',
      'https://example.com/first',
      'https://example.com/second',
      'https://example.com/third',
    ]);
  });

  it('PageSpeed mixed success/failure keeps status=ok when ≥1 succeeds', async () => {
    const ids = await seed();
    // Two URLs, second one fails. status stays "ok" (matches existing test
    // shape but exercises the bounded-concurrency path).
    let call = 0;
    const analyze = vi.fn(async () => {
      call += 1;
      if (call === 2) throw new Error('flake');
      return {
        labScores: { performance: 90, accessibility: 90, bestPractices: 90, seo: 100 },
      };
    });
    const processor = createAuditProcessor({
      provider: createFakeAuditProvider(),
      logger,
      pageSpeedProvider: { analyze } as unknown as PageSpeedProvider,
      pageSpeedSampleSize: 3,
    });
    await processor(jobFor({ ...ids, pageCap: 100 }));
    const snap = await ReportSnapshot.findOne({ runId: ids.runId });
    const snapAny = snap as unknown as {
      pageSpeed?: { status: 'ok' | 'unavailable'; samples: unknown[] };
    };
    expect(snapAny.pageSpeed?.status).toBe('ok');
    expect(snapAny.pageSpeed?.samples.length).toBeGreaterThanOrEqual(1);
  });

  it('run-timeout deadline is a non-retryable UnrecoverableError → run failed', async () => {
    const ids = await seed();
    const status: AuditStatus = { state: 'crawling' };
    const provider = createFakeAuditProvider({ status });
    // now() advances past the deadline on the very first poll check.
    const start = 1_000_000;
    let calls = 0;
    const processor = createAuditProcessor({
      provider,
      logger,
      pollIntervalMs: 1,
      maxPolls: 50,
      runTimeoutMs: 100,
      sleep: async () => {},
      now: () => {
        calls += 1;
        return start + (calls === 1 ? 0 : 999_999);
      },
    });
    await expect(processor(jobFor({ ...ids, pageCap: 100 }))).rejects.toThrow(
      UnrecoverableError,
    );
    const run = await AuditRun.findById(ids.runId);
    expect(run?.status).toBe('failed');
    expect(run?.error).toMatch(/exceeded 100ms deadline/);
  });
});
