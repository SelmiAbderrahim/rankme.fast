/**
 * Content Intelligence reconciliation sweep — tests.
 *
 * Invariants under test:
 *   - a created-but-not-enqueued `queued` row past the orphan window
 *     without a matching BullMQ job → marked failed and `content_analysis_events`
 *     records `kind='failed'`.
 *   - a `queued` row whose job is still in the queue is left alone even
 *     when `updatedAt` is stale (BullMQ retry backoff).
 *   - a non-terminal non-queued row (any collecting_* / scoring / generating_*)
 *     past the stuck-run window → marked failed.
 *   - terminal rows are skipped (both by the query filter and the
 *     in-transaction re-check).
 *   - repeated sweep is idempotent — nothing new gets marked on the second
 *     pass and the events table stays at one row per analysis.
 *   - `queuedOrphanMs === stuckRunMs` collapses the second query without
 *     changing outcomes (edge case coverage on the second query branch).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job, Queue } from 'bullmq';
import type { Logger } from 'pino';
import { Types } from 'mongoose';
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
import { contentAnalysisEvents } from '../../db/schema/content-analysis-events.js';
import { Site, claimSiteDeletion } from '../sites/index.js';
import { User } from '../users/users.model.js';
import {
  ContentAnalysis,
  runContentAnalysisReconciliationSweep,
  createContentAnalysisReconciliationProcessor,
  DEFAULT_QUEUED_ORPHAN_MS,
  DEFAULT_STUCK_RUN_MS,
  CONTENT_ANALYSIS_RECON_BATCH_SIZE,
  CONTENT_ANALYSIS_RECON_INTERVAL_MS,
  CONTENT_ANALYSIS_RECON_QUEUE,
  CONTENT_ANALYSIS_RECON_JOB,
  CONTENT_ANALYSIS_RECON_SCHEDULER_KEY,
  type ContentAnalysisStatus,
} from './index.js';

const silentLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
} as unknown as Logger;

/** Minimal fake queue implementing only `getJob(id)`. */
function fakeQueue(present: Set<string>): Queue {
  return {
    async getJob(id: string): Promise<Job | undefined> {
      return present.has(id) ? ({ id } as Job) : undefined;
    },
  } as unknown as Queue;
}

async function makeAnalysis(overrides: {
  status?: ContentAnalysisStatus;
  updatedAtOffsetMs?: number;
  suffix?: string;
} = {}) {
  const status = overrides.status ?? 'queued';
  const accountId = new Types.ObjectId().toString();
  const siteId = new Types.ObjectId();
  // The sweep runs under the account + site work leases, so the owning account
  // must exist and not be mid-deletion or every row is skipped unclaimed.
  await User.create({
    _id: accountId,
    email: `${accountId}@example.com`,
  });
  await Site.create({
    _id: siteId,
    accountId,
    url: `https://${siteId.toString()}.example.com`,
    domain: `${siteId.toString()}.example.com`,
  });
  const doc = await ContentAnalysis.create({
    accountId,
    ownerUserId: accountId,
    siteId,
    ownedUrl: `https://example.com/${overrides.suffix ?? 'p'}`,
    keyword: `kw-${overrides.suffix ?? 'x'}`,
    locale: 'en' as const,
    status,
    stages: [
      {
        name: status,
        startedAt: new Date(),
        completedAt: null,
        error: null,
      },
    ],
    inputFingerprint: 'y'.repeat(64),
    idempotencyKey: `idem_${'z'.repeat(20)}-${overrides.suffix ?? 'x'}`.padEnd(48, '0'),
    providerRefs: { snapshotIds: [] },
    requestedAt: new Date(),
  });
  // Force updatedAt into the past so the sweep picks it up.
  if (overrides.updatedAtOffsetMs !== undefined) {
    const past = new Date(Date.now() - overrides.updatedAtOffsetMs);
    await ContentAnalysis.updateOne(
      { _id: doc._id },
      { $set: { updatedAt: past } },
      { timestamps: false },
    );
  }
  return doc;
}

beforeAll(async () => {
  await startMemoryMongo();
  await startTestPostgres();
  await ContentAnalysis.syncIndexes();
});
afterAll(async () => {
  await stopMemoryMongo();
  await stopTestPostgres();
});
beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
});

describe('runContentAnalysisReconciliationSweep', () => {
  it('does not mutate a stale analysis after its site deletion claim', async () => {
    const doc = await makeAnalysis({
      status: 'queued',
      updatedAtOffsetMs: DEFAULT_QUEUED_ORPHAN_MS + 60_000,
      suffix: 'deleting',
    });
    await expect(claimSiteDeletion({
      accountId: String(doc.accountId),
      siteId: String(doc.siteId),
    })).resolves.toMatchObject({ status: 'claimed' });
    const getJob = vi.fn();

    const outcome = await runContentAnalysisReconciliationSweep({
      db: getTestDb(),
      logger: silentLogger,
      queue: { getJob } as unknown as Queue,
    });

    expect(outcome).toMatchObject({ scanned: 1, skipped: 1, markedOrphan: 0 });
    expect(getJob).not.toHaveBeenCalled();
    expect((await ContentAnalysis.findById(doc._id))?.status).toBe('queued');
    expect(await getTestDb().select().from(contentAnalysisEvents)).toEqual([]);
  });

  it('marks a created-but-not-enqueued queued row failed', async () => {
    const db = getTestDb();
    const doc = await makeAnalysis({
      status: 'queued',
      updatedAtOffsetMs: DEFAULT_QUEUED_ORPHAN_MS + 60_000,
    });
    const outcome = await runContentAnalysisReconciliationSweep({
      db,
      logger: silentLogger,
      queue: fakeQueue(new Set()),
    });
    expect(outcome).toMatchObject({ markedOrphan: 1, markedStuck: 0, skipped: 0 });
    const after = await ContentAnalysis.findById(doc._id);
    expect(after?.status).toBe('failed');
    expect(after?.error?.category).toBe('unexpected');
    expect(after?.error?.messageKey).toBe(
      'contentIntelligence.errors.orphanedReservation',
    );
    const events = await db.select().from(contentAnalysisEvents);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'failed', reservationKey: doc.idempotencyKey });
  });

  it('leaves a queued row alone when its job is still in the queue', async () => {
    const db = getTestDb();
    const doc = await makeAnalysis({
      status: 'queued',
      updatedAtOffsetMs: DEFAULT_QUEUED_ORPHAN_MS + 60_000,
    });
    const outcome = await runContentAnalysisReconciliationSweep({
      db,
      logger: silentLogger,
      queue: fakeQueue(new Set([`content-analysis-${doc._id}`])),
    });
    expect(outcome).toMatchObject({ markedOrphan: 0, markedStuck: 0, skipped: 1 });
    const after = await ContentAnalysis.findById(doc._id);
    expect(after?.status).toBe('queued');
  });

  it('marks a stalled non-queued run failed', async () => {
    const db = getTestDb();
    const doc = await makeAnalysis({
      status: 'scoring',
      updatedAtOffsetMs: DEFAULT_STUCK_RUN_MS + 60_000,
    });
    const outcome = await runContentAnalysisReconciliationSweep({
      db,
      logger: silentLogger,
      queue: fakeQueue(new Set()),
    });
    expect(outcome).toMatchObject({ markedOrphan: 0, markedStuck: 1 });
    const after = await ContentAnalysis.findById(doc._id);
    expect(after?.status).toBe('failed');
    expect(after?.error?.messageKey).toBe('contentIntelligence.errors.stalledRun');
    const events = await db.select().from(contentAnalysisEvents);
    expect(events.map((e) => e.kind)).toEqual(['failed']);
  });

  it('skips terminal rows even when the collection contains them', async () => {
    const db = getTestDb();
    // Terminal row should never appear in the scan set; add a stalled row too.
    await makeAnalysis({
      status: 'completed',
      updatedAtOffsetMs: DEFAULT_STUCK_RUN_MS + 60_000,
    });
    await makeAnalysis({
      status: 'scoring',
      updatedAtOffsetMs: DEFAULT_STUCK_RUN_MS + 60_000,
      suffix: 'b',
    });
    const outcome = await runContentAnalysisReconciliationSweep({
      db,
      logger: silentLogger,
      queue: fakeQueue(new Set()),
    });
    // Only the stalled row is scanned + marked; terminal row is filtered by
    // the `status: $in NON_TERMINAL_STATUSES` clause.
    expect(outcome.scanned).toBe(1);
    expect(outcome.markedStuck).toBe(1);
  });

  it('is idempotent — a second sweep does nothing more', async () => {
    const db = getTestDb();
    await makeAnalysis({
      status: 'queued',
      updatedAtOffsetMs: DEFAULT_QUEUED_ORPHAN_MS + 60_000,
    });
    const first = await runContentAnalysisReconciliationSweep({
      db,
      logger: silentLogger,
      queue: fakeQueue(new Set()),
    });
    expect(first.markedOrphan).toBe(1);
    const second = await runContentAnalysisReconciliationSweep({
      db,
      logger: silentLogger,
      queue: fakeQueue(new Set()),
    });
    expect(second.scanned).toBe(0);
    expect(second.markedOrphan).toBe(0);
  });

  it('continues with a second batch when the first batch reaches the limit', async () => {
    const db = getTestDb();
    await makeAnalysis({
      status: 'scoring',
      updatedAtOffsetMs: DEFAULT_STUCK_RUN_MS + 60_000,
      suffix: 'page-a',
    });
    await makeAnalysis({
      status: 'scoring',
      updatedAtOffsetMs: DEFAULT_STUCK_RUN_MS + 60_000,
      suffix: 'page-b',
    });
    const outcome = await runContentAnalysisReconciliationSweep({
      db,
      logger: silentLogger,
      queue: fakeQueue(new Set()),
      batchSize: 1,
    });
    expect(outcome).toMatchObject({ scanned: 2, markedStuck: 2 });
  });

  it('collapses the queued-orphan branch when queuedOrphanMs === stuckRunMs', async () => {
    const db = getTestDb();
    await makeAnalysis({
      status: 'queued',
      updatedAtOffsetMs: DEFAULT_STUCK_RUN_MS + 60_000,
    });
    const outcome = await runContentAnalysisReconciliationSweep({
      db,
      logger: silentLogger,
      queue: fakeQueue(new Set()),
      queuedOrphanMs: DEFAULT_STUCK_RUN_MS,
      stuckRunMs: DEFAULT_STUCK_RUN_MS,
    });
    // The main non-terminal scan catches it (status queued is in the
    // NON_TERMINAL list); the secondary queued-orphan query is skipped
    // because queuedOrphanMs is not strictly less than stuckRunMs.
    expect(outcome.markedOrphan).toBe(1);
  });

  it('handles the terminal-race path — a run that becomes terminal between query and iteration is skipped', async () => {
    const db = getTestDb();
    const doc = await makeAnalysis({
      status: 'scoring',
      updatedAtOffsetMs: DEFAULT_STUCK_RUN_MS + 60_000,
    });
    // Simulate the race: flip the row terminal AFTER the find would run.
    // Patch ContentAnalysis.find so the first batch returns our (already
    // mutated) hydrated doc, but the iteration re-check sees terminal.
    const originalFind = ContentAnalysis.find.bind(ContentAnalysis);
    const stub = vi.spyOn(ContentAnalysis, 'find').mockImplementation((...args: unknown[]) => {
      // Mutate the DB terminal state before the query resolves — the query
      // will then return a hydrated doc whose in-memory `status` we mutate
      // to `completed`, matching the terminal-race semantics under test.
      const query = originalFind(...(args as Parameters<typeof originalFind>)) as unknown as {
        sort: (o: unknown) => { limit: (n: number) => Promise<InstanceType<typeof ContentAnalysis>[]> };
      };
      return {
        sort: (o: unknown) => ({
          limit: async (n: number) => {
            const rows = await query.sort(o).limit(n);
            // Flip the hydrated doc terminal in-memory so the sweep's
            // in-transaction re-check hits the skip branch.
            for (const r of rows) r.status = 'completed';
            return rows;
          },
        }),
      } as ReturnType<typeof originalFind>;
    });
    const outcome = await runContentAnalysisReconciliationSweep({
      db,
      logger: silentLogger,
      queue: fakeQueue(new Set()),
    });
    expect(outcome.skipped).toBeGreaterThan(0);
    expect(outcome.markedStuck).toBe(0);
    stub.mockRestore();
    // The real underlying DB row was never modified by the sweep.
    const after = await ContentAnalysis.findById(doc._id);
    expect(after?.status).toBe('scoring');
  });

  it('processor factory returns a callable that runs one sweep', async () => {
    const db = getTestDb();
    await makeAnalysis({
      status: 'queued',
      updatedAtOffsetMs: DEFAULT_QUEUED_ORPHAN_MS + 60_000,
    });
    const proc = createContentAnalysisReconciliationProcessor({
      db,
      logger: silentLogger,
      queue: fakeQueue(new Set()),
    });
    const outcome = await proc();
    expect(outcome.markedOrphan).toBe(1);
  });

  it('exports stable queue + scheduler + interval + batch constants', () => {
    expect(CONTENT_ANALYSIS_RECON_QUEUE).toBe('content-analysis-recon');
    expect(CONTENT_ANALYSIS_RECON_JOB).toBe('sweep');
    expect(CONTENT_ANALYSIS_RECON_SCHEDULER_KEY).toBe(
      'content-analysis-reconciliation-sweep',
    );
    expect(CONTENT_ANALYSIS_RECON_INTERVAL_MS).toBe(5 * 60 * 1000);
    expect(CONTENT_ANALYSIS_RECON_BATCH_SIZE).toBe(100);
  });
});
