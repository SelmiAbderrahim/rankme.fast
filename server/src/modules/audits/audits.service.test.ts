/**
 * Audits HTTP-service tests (prompt 07).
 *
 * Covers the start/list/get orchestration plus the page-cap policy and the
 * page persistence idempotency. A fake in-memory Queue stands in for BullMQ
 * so we can assert what actually got enqueued without touching Redis.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job, Queue } from 'bullmq';
import mongoose from 'mongoose';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { Site, claimSiteDeletion } from '../sites/index.js';
import {
  AuditRun,
  AuditedPage,
  getAuditRun,
  listAuditRuns,
  replaceAuditedPages,
  resolveAuditPageCap,
  startAuditForSite,
} from './index.js';
import { AUDIT_PAGE_CAP_MAX } from './audits.schema.js';

beforeAll(async () => {
  await startMemoryMongo();
});
afterAll(async () => {
  await stopMemoryMongo();
});
beforeEach(async () => {
  await clearCollections();
});

interface EnqueuedJob {
  name: string;
  data: unknown;
  opts: { jobId?: string };
}

function fakeQueue(): { queue: Queue; jobs: EnqueuedJob[] } {
  const jobs: EnqueuedJob[] = [];
  const queue = {
    async add(name: string, data: unknown, opts: { jobId?: string }): Promise<Job> {
      jobs.push({ name, data, opts });
      return { id: opts.jobId } as Job;
    },
  } as unknown as Queue;
  return { queue, jobs };
}

async function seedSite(accountId: string, host = 'example.com') {
  return Site.create({
    accountId,
    url: `https://${host}`,
    domain: host,
  });
}

describe('resolveAuditPageCap', () => {
  it('takes the structural maximum when no request is given', () => {
    expect(resolveAuditPageCap()).toBe(AUDIT_PAGE_CAP_MAX);
  });

  it('clamps a requested cap down to the structural maximum', () => {
    expect(resolveAuditPageCap(AUDIT_PAGE_CAP_MAX + 5_000)).toBe(AUDIT_PAGE_CAP_MAX);
    expect(resolveAuditPageCap(50)).toBe(50);
  });

  it('ignores non-positive requested caps', () => {
    expect(resolveAuditPageCap(0)).toBe(AUDIT_PAGE_CAP_MAX);
    expect(resolveAuditPageCap(-5)).toBe(AUDIT_PAGE_CAP_MAX);
  });
});

describe('startAuditForSite', () => {
  it('uses the structural page ceiling when no cap is requested', async () => {
    const accountId = new mongoose.Types.ObjectId().toHexString();
    const site = await seedSite(accountId, 'self-host-audit.example');
    const { queue, jobs } = fakeQueue();
    const run = await startAuditForSite(
      { accountId, siteId: site.id as string },
      { auditsQueue: queue },
    );
    expect(run.pageCap).toBe(AUDIT_PAGE_CAP_MAX);
    expect(jobs).toHaveLength(1);
  });

  it('honours a requested page cap', async () => {
    const accountId = new mongoose.Types.ObjectId().toHexString();
    const site = await seedSite(accountId, 'requested-cap.example');
    const { queue, jobs } = fakeQueue();
    const run = await startAuditForSite(
      { accountId, siteId: site.id as string, requestedPageCap: 50 },
      { auditsQueue: queue },
    );
    expect(run.pageCap).toBe(50);
    expect(jobs[0]?.data).toMatchObject({ pageCap: 50 });
  });

  it('rechecks the live site after acquiring its work lease', async () => {
    const accountId = new mongoose.Types.ObjectId().toHexString();
    const site = await seedSite(accountId, 'lease-race-audit.example');
    const { queue } = fakeQueue();
    vi.spyOn(Site, 'findOne').mockResolvedValueOnce(null as never);

    await expect(
      startAuditForSite(
        { accountId, siteId: site.id as string },
        { auditsQueue: queue },
      ),
    ).rejects.toMatchObject({ status: 404, message: 'sites.errors.notFound' });
    vi.restoreAllMocks();
  });

  it('rejects with 409 when a run is already queued or running for the site', async () => {
    const accountId = new mongoose.Types.ObjectId().toHexString();
    const site = await seedSite(accountId);
    const { queue } = fakeQueue();

    await startAuditForSite(
      { accountId, siteId: site.id as string },
      { auditsQueue: queue },
    );
    await expect(
      startAuditForSite({ accountId, siteId: site.id as string }, { auditsQueue: queue }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('cross-account or unknown site is 404 (no existence leak)', async () => {
    const owner = new mongoose.Types.ObjectId().toHexString();
    const intruder = new mongoose.Types.ObjectId().toHexString();
    const site = await seedSite(owner);
    const { queue } = fakeQueue();

    await expect(
      startAuditForSite(
        { accountId: intruder, siteId: site.id as string },
        { auditsQueue: queue },
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      startAuditForSite(
        { accountId: owner, siteId: new mongoose.Types.ObjectId().toHexString() },
        { auditsQueue: queue },
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('malformed siteId → 404', async () => {
    const accountId = new mongoose.Types.ObjectId().toHexString();
    const { queue } = fakeQueue();
    await expect(
      startAuditForSite({ accountId, siteId: 'not-an-object-id' }, { auditsQueue: queue }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('returns 503 when the queue is not configured', async () => {
    const accountId = new mongoose.Types.ObjectId().toHexString();
    const site = await seedSite(accountId);
    await expect(
      startAuditForSite(
        { accountId, siteId: site.id as string },
        { auditsQueue: null },
      ),
    ).rejects.toBeInstanceOf(HttpError);
  });

  it('blocks direct MCP/chat starts after deletion is claimed without creating or enqueueing', async () => {
    const accountId = new mongoose.Types.ObjectId().toHexString();
    const site = await seedSite(accountId, 'mcp-delete-race.example');
    const { queue, jobs } = fakeQueue();
    await expect(claimSiteDeletion({
      accountId,
      siteId: site.id as string,
    })).resolves.toMatchObject({ status: 'claimed' });

    await expect(
      startAuditForSite(
        { accountId, siteId: site.id as string },
        { auditsQueue: queue },
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(jobs).toEqual([]);
    expect(await AuditRun.countDocuments({ siteId: site._id })).toBe(0);
  });
});

describe('startAuditForSite concurrency', () => {
  it('maps a mocked duplicate-key create failure to 409', async () => {
    const accountId = new mongoose.Types.ObjectId().toHexString();
    const site = await seedSite(accountId, 'self-host-create-race.example');
    const { queue } = fakeQueue();
    vi.spyOn(AuditRun, 'exists').mockResolvedValueOnce(null as never);
    vi.spyOn(AuditRun, 'create').mockRejectedValueOnce(
      Object.assign(new Error('duplicate key'), { code: 11_000 }) as never,
    );
    try {
      await expect(
        startAuditForSite(
          { accountId, siteId: site.id as string },
          { auditsQueue: queue },
        ),
      ).rejects.toMatchObject({ status: 409, message: 'audits.errors.runInProgress' });
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('two concurrent starts create exactly one run', async () => {
    const accountId = new mongoose.Types.ObjectId().toHexString();
    const site = await seedSite(accountId);
    const { queue } = fakeQueue();
    // The partial-unique `activeKey` index is the arbiter; force it live.
    await AuditRun.syncIndexes();

    const results = await Promise.allSettled([
      startAuditForSite({ accountId, siteId: site.id as string }, { auditsQueue: queue }),
      startAuditForSite({ accountId, siteId: site.id as string }, { auditsQueue: queue }),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected') as Array<
      PromiseRejectedResult
    >;
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toMatchObject({
      status: 409,
      message: 'audits.errors.runInProgress',
    });
    expect(await AuditRun.countDocuments({ siteId: site._id })).toBe(1);
  });

  it('duplicate-key race maps to the localized 409, not a 500', async () => {
    const accountId = new mongoose.Types.ObjectId().toHexString();
    const site = await seedSite(accountId);
    await AuditRun.syncIndexes();
    // Pre-insert a queued run to occupy the partial-unique index.
    await AuditRun.create({
      accountId,
      siteId: site._id,
      status: 'queued',
      pageCap: 100,
      activeKey: (site._id as mongoose.Types.ObjectId).toString(),
    });
    // Bypass the fast-path exists() so we exercise the E11000 branch on create.
    vi.spyOn(AuditRun, 'exists').mockResolvedValueOnce(null as never);
    const { queue } = fakeQueue();
    await expect(
      startAuditForSite({ accountId, siteId: site.id as string }, { auditsQueue: queue }),
    ).rejects.toMatchObject({ status: 409, message: 'audits.errors.runInProgress' });
    vi.restoreAllMocks();
  });

  it('rethrows non-duplicate AuditRun.create failures', async () => {
    const accountId = new mongoose.Types.ObjectId().toHexString();
    const site = await seedSite(accountId);
    const boom = new Error('mongo down');
    vi.spyOn(AuditRun, 'exists').mockResolvedValueOnce(null as never);
    vi.spyOn(AuditRun, 'create').mockRejectedValueOnce(boom as never);
    const { queue } = fakeQueue();
    await expect(
      startAuditForSite({ accountId, siteId: site.id as string }, { auditsQueue: queue }),
    ).rejects.toBe(boom);
    vi.restoreAllMocks();
  });

  it('enqueue failure with a non-Error throw still surfaces 503 (undefined cause branch)', async () => {
    const accountId = new mongoose.Types.ObjectId().toHexString();
    const site = await seedSite(accountId, 'nonerr-queue.example');
    const nonErrFailing = {
      async add(): Promise<never> {
        throw 'plain-string-failure';
      },
    } as unknown as Queue;
    await expect(
      startAuditForSite(
        { accountId, siteId: site.id as string },
        { auditsQueue: nonErrFailing },
      ),
    ).rejects.toMatchObject({ status: 503, message: 'audits.errors.queueUnavailable' });
    const runs = await AuditRun.find({ siteId: site._id });
    expect(runs[0]?.status).toBe('failed');
  });

  it('enqueue failure marks the run failed', async () => {
    const accountId = new mongoose.Types.ObjectId().toHexString();
    const site = await seedSite(accountId);
    const failing = {
      async add(): Promise<never> {
        throw new Error('redis down');
      },
    } as unknown as Queue;
    await expect(
      startAuditForSite(
        { accountId, siteId: site.id as string },
        { auditsQueue: failing },
      ),
    ).rejects.toMatchObject({ status: 503, message: 'audits.errors.queueUnavailable' });
    const runs = await AuditRun.find({ siteId: site._id });
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe('failed');
    expect(runs[0]?.error).toBe('enqueue failed');
    expect(runs[0]?.finishedAt).toBeInstanceOf(Date);
    expect(runs[0]?.activeKey).toBeNull();
  });

  it('a terminal run does not block a new start', async () => {
    const accountId = new mongoose.Types.ObjectId().toHexString();
    const site = await seedSite(accountId);
    await AuditRun.syncIndexes();
    // Simulate a completed prior run — activeKey cleared, status succeeded.
    await AuditRun.create({
      accountId,
      siteId: site._id,
      status: 'succeeded',
      pageCap: 100,
      activeKey: null,
    });
    const { queue } = fakeQueue();
    const run = await startAuditForSite(
      { accountId, siteId: site.id as string },
      { auditsQueue: queue },
    );
    expect(run.status).toBe('queued');
  });
});

describe('listAuditRuns', () => {
  it('hides list and run reads immediately after deletion is claimed', async () => {
    const accountId = new mongoose.Types.ObjectId().toHexString();
    const site = await seedSite(accountId, 'hidden-audits.example.com');
    const run = await AuditRun.create({
      accountId,
      siteId: site._id,
      pageCap: 100,
      status: 'succeeded',
    });
    await expect(claimSiteDeletion({
      accountId,
      siteId: site.id as string,
    })).resolves.toMatchObject({ status: 'claimed' });

    await expect(listAuditRuns({
      accountId,
      siteId: site.id as string,
      limit: 10,
    })).rejects.toMatchObject({ status: 404 });
    await expect(getAuditRun({
      accountId,
      runId: run.id as string,
    })).rejects.toMatchObject({ status: 404 });
  });

  it('returns paged runs newest-first with per-run pagesCrawled count', async () => {
    const accountId = new mongoose.Types.ObjectId().toHexString();
    const site = await seedSite(accountId);
    const run = await AuditRun.create({
      accountId,
      siteId: site._id,
      pageCap: 100,
    });
    await AuditedPage.create({
      runId: run._id,
      url: 'https://example.com/',
      statusCode: 200,
      onPageScore: 90,
    });

    const page = await listAuditRuns({
      accountId,
      siteId: site.id as string,
      limit: 10,
    });
    expect(page.runs).toHaveLength(1);
    expect(page.runs[0]?.pagesCrawled).toBe(1);
    expect(page.nextCursor).toBeNull();
  });

  it('cursor pagination surfaces the next page and marks nextCursor', async () => {
    const accountId = new mongoose.Types.ObjectId().toHexString();
    const site = await seedSite(accountId);
    for (let i = 0; i < 3; i += 1) {
      await AuditRun.create({ accountId, siteId: site._id, pageCap: 100 });
    }
    const first = await listAuditRuns({
      accountId,
      siteId: site.id as string,
      limit: 2,
    });
    expect(first.runs).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const next = await listAuditRuns({
      accountId,
      siteId: site.id as string,
      limit: 2,
      cursor: first.nextCursor!,
    });
    expect(next.runs).toHaveLength(1);
    expect(next.nextCursor).toBeNull();
  });

  it('rejects a malformed cursor with a 400', async () => {
    const accountId = new mongoose.Types.ObjectId().toHexString();
    const site = await seedSite(accountId);
    await expect(
      listAuditRuns({ accountId, siteId: site.id as string, limit: 10, cursor: 'nope' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('malformed siteId → 404', async () => {
    const accountId = new mongoose.Types.ObjectId().toHexString();
    await expect(
      listAuditRuns({ accountId, siteId: 'nope', limit: 10 }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('cross-account site → 404', async () => {
    const owner = new mongoose.Types.ObjectId().toHexString();
    const other = new mongoose.Types.ObjectId().toHexString();
    const site = await seedSite(owner);
    await expect(
      listAuditRuns({ accountId: other, siteId: site.id as string, limit: 10 }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('CODEBASE-REVIEW §4.3 — list results strip the `result` field from every row', async () => {
    const accountId = new mongoose.Types.ObjectId().toHexString();
    const site = await seedSite(accountId);
    // Two runs, one with a fat legacy result and one with the slim shape.
    await AuditRun.create({
      accountId,
      siteId: site._id,
      pageCap: 100,
      result: {
        domainChecks: { robotsTxtFound: true, sitemapFound: false, httpsEnforced: true, canonicalizationOk: true },
        pages: [{ url: 'https://ex/', statusCode: 200 }],
      },
    });
    await AuditRun.create({
      accountId,
      siteId: site._id,
      pageCap: 100,
      result: {
        domainChecks: { robotsTxtFound: true, sitemapFound: true, httpsEnforced: true, canonicalizationOk: false },
      },
    });
    const page = await listAuditRuns({
      accountId,
      siteId: site.id as string,
      limit: 10,
    });
    // Neither list row leaks the persisted `result` payload.
    for (const row of page.runs) {
      expect((row as unknown as { result?: unknown }).result).toBeUndefined();
    }
  });
});

describe('getAuditRun', () => {
  it('returns run + summary derived from the persisted result', async () => {
    const accountId = new mongoose.Types.ObjectId().toHexString();
    const site = await seedSite(accountId);
    const run = await AuditRun.create({
      accountId,
      siteId: site._id,
      status: 'succeeded',
      pageCap: 100,
      result: {
        domainChecks: {
          robotsTxtFound: true,
          sitemapFound: true,
          httpsEnforced: true,
          canonicalizationOk: false,
        },
        pages: [],
      },
    });
    await AuditedPage.create({
      runId: run._id,
      url: 'https://example.com/',
      statusCode: 200,
      onPageScore: 80,
    });
    const view = await getAuditRun({ accountId, runId: run.id as string });
    expect(view.run.status).toBe('succeeded');
    expect(view.summary.pagesCrawled).toBe(1);
    expect(view.summary.domainChecks?.canonicalizationOk).toBe(false);
  });

  it('malformed runId → 404', async () => {
    const accountId = new mongoose.Types.ObjectId().toHexString();
    await expect(getAuditRun({ accountId, runId: 'nope' })).rejects.toMatchObject({
      status: 404,
    });
  });

  it('cross-account runId → 404', async () => {
    const owner = new mongoose.Types.ObjectId().toHexString();
    const other = new mongoose.Types.ObjectId().toHexString();
    const site = await seedSite(owner);
    const run = await AuditRun.create({ accountId: owner, siteId: site._id, pageCap: 100 });
    await expect(
      getAuditRun({ accountId: other, runId: run.id as string }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('serializes startedAt/finishedAt as ISO strings when populated', async () => {
    const accountId = new mongoose.Types.ObjectId().toHexString();
    const site = await seedSite(accountId);
    const startedAt = new Date('2026-05-01T00:00:00.000Z');
    const finishedAt = new Date('2026-05-01T00:15:00.000Z');
    const run = await AuditRun.create({
      accountId,
      siteId: site._id,
      status: 'succeeded',
      pageCap: 100,
      startedAt,
      finishedAt,
      vendorTaskId: 'vendor-task-1',
      error: 'unused',
    });
    const view = await getAuditRun({ accountId, runId: run.id as string });
    expect(view.run.startedAt).toBe(startedAt.toISOString());
    expect(view.run.finishedAt).toBe(finishedAt.toISOString());
    expect(view.run.vendorTaskId).toBe('vendor-task-1');
    expect(view.run.error).toBe('unused');
  });

  it('domainChecks null when no result yet', async () => {
    const accountId = new mongoose.Types.ObjectId().toHexString();
    const site = await seedSite(accountId);
    const run = await AuditRun.create({ accountId, siteId: site._id, pageCap: 100 });
    const view = await getAuditRun({ accountId, runId: run.id as string });
    expect(view.summary.domainChecks).toBeNull();
  });
});

describe('replaceAuditedPages', () => {
  it('drops prior pages then inserts the fresh set (idempotent re-runs)', async () => {
    const accountId = new mongoose.Types.ObjectId().toHexString();
    const site = await seedSite(accountId);
    const run = await AuditRun.create({ accountId, siteId: site._id, pageCap: 100 });
    await AuditedPage.create({
      runId: run._id,
      url: 'https://example.com/old',
      statusCode: 200,
      onPageScore: 10,
    });

    await replaceAuditedPages(run.id as string, [
      {
        url: 'https://example.com/',
        statusCode: 200,
        title: 'Home',
        metaDescription: null,
        h1: ['Home'],
        h2: [],
        canonical: 'https://example.com/',
        hasStructuredData: false,
        structuredDataErrors: [],
        isIndexable: true,
        brokenLinks: [],
        onPageScore: 88,
      },
    ]);

    const pages = await AuditedPage.find({ runId: run._id });
    expect(pages).toHaveLength(1);
    expect(pages[0]?.url).toBe('https://example.com/');
  });

  it('empty page list only drops (no insert)', async () => {
    const accountId = new mongoose.Types.ObjectId().toHexString();
    const site = await seedSite(accountId);
    const run = await AuditRun.create({ accountId, siteId: site._id, pageCap: 100 });
    await AuditedPage.create({
      runId: run._id,
      url: 'https://example.com/old',
      statusCode: 200,
      onPageScore: 10,
    });
    await replaceAuditedPages(run.id as string, []);
    expect(await AuditedPage.countDocuments({ runId: run._id })).toBe(0);
  });
});
