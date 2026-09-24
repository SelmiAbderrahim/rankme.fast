/**
 * Prompt 10d — reconciliation sweep invariants.
 *
 * Guarantees exercised:
 *   - a `queued` row whose BullMQ job has vanished is marked failed with
 *     `processing_failure`
 *   - a `queued` row with a live queue job is skipped
 *   - a non-terminal `discovering`/`clustering` row that has not moved for
 *     the stuck window is marked failed with `processing_failure`
 *   - a stuck run that already retained ≥1 source keeps its sources
 *   - a terminal row is skipped (idempotent replay)
 *   - the sweep is idempotent — running twice does not double the outcome
 */
import type { Queue } from 'bullmq';
import type { Logger } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import { Site, claimSiteDeletion } from '../sites/index.js';
import { User } from '../users/users.model.js';
import { AudienceResearchRun } from './audience-research.model.js';
import {
  runAudienceResearchReconciliationSweep,
  createAudienceResearchReconciliationProcessor,
  DEFAULT_QUEUED_ORPHAN_MS,
  DEFAULT_STUCK_RUN_MS,
} from './audience-research.reconciliation.js';

const silentLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
} as unknown as Logger;

beforeAll(async () => {
  await startMemoryMongo();
});
afterAll(async () => {
  await stopMemoryMongo();
});
beforeEach(async () => {
  await clearCollections();
});

function makeQueue(overrides: { getJob?: (id: string) => Promise<unknown> } = {}): Queue {
  return {
    getJob: overrides.getJob ?? (async () => null),
  } as unknown as Queue;
}

async function seed(overrides: Record<string, unknown> = {}) {
  const accountId = new Types.ObjectId();
  const siteId = new Types.ObjectId();
  // The sweep runs under the account + site work leases, so the owning account
  // must exist and not be mid-deletion or every row is skipped unclaimed.
  await User.create({
    _id: accountId,
    email: `${accountId.toString()}@example.com`,
  });
  await Site.create({
    _id: siteId,
    accountId,
    url: `https://${siteId.toString()}.example.com`,
    domain: `${siteId.toString()}.example.com`,
  });
  return AudienceResearchRun.create({
    accountId,
    siteId,
    state: 'queued',
    input: {
      siteMarket: { country: 'US', language: 'en', device: 'desktop' as const },
      competitorDomains: [],
      seedTopics: ['seo'],
      queryTemplateVersion: 1,
    },
    deterministicInputHash: 'x'.repeat(64),
    sources: [],
    signals: [],
    costLedger: [],
    requestedAt: new Date(),
    ...overrides,
  });
}

// Push the doc's `updatedAt` backwards without triggering timestamp autosync.
async function backdate(id: unknown, ms: number): Promise<void> {
  const past = new Date(Date.now() - ms);
  await AudienceResearchRun.collection.updateOne(
    { _id: id as never },
    { $set: { updatedAt: past, createdAt: past } },
  );
}

describe('runAudienceResearchReconciliationSweep', () => {
  it('does not fail a run after its site deletion claim', async () => {
    const doc = await seed();
    await backdate(doc._id, DEFAULT_QUEUED_ORPHAN_MS + 60_000);
    await expect(claimSiteDeletion({
      accountId: String(doc.accountId),
      siteId: String(doc.siteId),
    })).resolves.toMatchObject({ status: 'claimed' });
    const getJob = vi.fn();

    const outcome = await runAudienceResearchReconciliationSweep({
      logger: silentLogger,
      queue: makeQueue({ getJob }),
    });

    expect(outcome).toMatchObject({ scanned: 1, skipped: 1, markedOrphan: 0 });
    expect(getJob).not.toHaveBeenCalled();
    expect((await AudienceResearchRun.findById(doc._id))?.state).toBe('queued');
  });

  it('marks a queued row whose job has vanished failed', async () => {
    const doc = await seed();
    await backdate(doc._id, DEFAULT_QUEUED_ORPHAN_MS + 60_000);
    const queue = makeQueue({ getJob: async () => null });

    const outcome = await runAudienceResearchReconciliationSweep({
      logger: silentLogger,
      queue,
      now: () => new Date(),
    });

    expect(outcome.markedOrphan).toBe(1);
    const after = await AudienceResearchRun.findById(doc._id);
    expect(after?.state).toBe('failed');
    expect(after?.terminal?.reasonCode).toBe('processing_failure');
  });

  it('skips a queued row whose job is still on the queue', async () => {
    const doc = await seed();
    await backdate(doc._id, DEFAULT_QUEUED_ORPHAN_MS + 60_000);
    const queue = makeQueue({
      getJob: async () => ({ id: `audience-research-${String(doc._id)}` }),
    });

    const outcome = await runAudienceResearchReconciliationSweep({
      logger: silentLogger,
      queue,
      now: () => new Date(),
    });

    expect(outcome.markedOrphan).toBe(0);
    expect(outcome.skipped).toBeGreaterThanOrEqual(1);
    const after = await AudienceResearchRun.findById(doc._id);
    expect(after?.state).toBe('queued');
  });

  it('marks a stuck non-terminal (clustering) run failed', async () => {
    const doc = await seed({ state: 'clustering' });
    await backdate(doc._id, DEFAULT_STUCK_RUN_MS + 60_000);
    const queue = makeQueue({ getJob: async () => null });

    const outcome = await runAudienceResearchReconciliationSweep({
      logger: silentLogger,
      queue,
    });

    expect(outcome.markedStuck).toBe(1);
    const after = await AudienceResearchRun.findById(doc._id);
    expect(after?.state).toBe('failed');
    expect(after?.terminal?.reasonCode).toBe('processing_failure');
  });

  it('marks a stuck run that retained sources failed and keeps the sources', async () => {
    const doc = await seed({
      state: 'clustering',
      sources: [
        {
          sourceId: 'src-001',
          canonicalUrl: 'https://example.com/thread',
          title: 'A thread',
          sourceType: 'forum',
          registrableDomain: 'example.com',
          observedAt: null,
          contentHash: 'a'.repeat(64),
          excerpt: 'evidence excerpt',
          observationMeta: {
            sourceKind: 'vendor',
            sourceLabel: null,
            observedAt: new Date().toISOString(),
            freshUntil: null,
            freshness: 'unknown',
            market: null,
            sampleCount: 1,
            coverageNoteKey: null,
          },
          discoveryQueryIds: ['q-1'],
        },
      ],
    });
    await backdate(doc._id, DEFAULT_STUCK_RUN_MS + 60_000);

    const outcome = await runAudienceResearchReconciliationSweep({
      logger: silentLogger,
      queue: makeQueue({ getJob: async () => null }),
    });

    expect(outcome.markedStuck).toBe(1);
    const after = await AudienceResearchRun.findById(doc._id);
    expect(after?.state).toBe('failed');
    expect(after?.sources?.length).toBe(1);
  });

  it('skips a terminal row (idempotent replay)', async () => {
    const doc = await seed({
      state: 'completed',
      terminal: { state: 'completed', reasonCode: 'ok', completedAt: new Date() },
    });
    await backdate(doc._id, DEFAULT_STUCK_RUN_MS + 60_000);
    const queue = makeQueue({ getJob: async () => null });
    const outcome = await runAudienceResearchReconciliationSweep({
      logger: silentLogger,
      queue,
    });
    expect(outcome.markedOrphan).toBe(0);
    expect(outcome.markedStuck).toBe(0);
  });

  it('is idempotent under a second pass', async () => {
    const doc = await seed();
    await backdate(doc._id, DEFAULT_QUEUED_ORPHAN_MS + 60_000);
    const queue = makeQueue({ getJob: async () => null });

    await runAudienceResearchReconciliationSweep({ logger: silentLogger, queue });
    const outcome = await runAudienceResearchReconciliationSweep({ logger: silentLogger, queue });

    expect(outcome.markedOrphan).toBe(0);
    expect(outcome.markedStuck).toBe(0);
  });

  it('re-checks terminality in-loop so a concurrent worker never loses the row', async () => {
    // The batch query filters terminal rows out, so this can only happen when
    // the pipeline finalizes a run between the query and the in-loop write.
    const accountId = new Types.ObjectId();
    await User.create({ _id: accountId, email: `${accountId.toString()}@example.com` });
    const site = await Site.create({
      accountId,
      url: 'https://terminal-recheck.example.com',
      domain: 'terminal-recheck.example.com',
    });
    const stale = {
      _id: new Types.ObjectId(),
      accountId,
      siteId: site._id,
      state: 'completed',
    };
    vi.spyOn(AudienceResearchRun, 'find').mockReturnValueOnce({
      sort: () => ({ limit: async () => [stale] }),
    } as never);

    const outcome = await runAudienceResearchReconciliationSweep({
      logger: silentLogger,
      queue: makeQueue({ getJob: async () => null }),
    });

    expect(outcome.scanned).toBe(1);
    expect(outcome.skipped).toBe(1);
    expect(outcome.markedOrphan).toBe(0);
    expect(outcome.markedStuck).toBe(0);
    vi.restoreAllMocks();
  });

  it('marks an in-memory orphan whose sources are absent failed', async () => {
    const accountId = new Types.ObjectId();
    await User.create({ _id: accountId, email: `${accountId.toString()}@example.com` });
    const site = await Site.create({
      accountId,
      url: 'https://orphan-race.example.com',
      domain: 'orphan-race.example.com',
    });
    const stale = {
      _id: new Types.ObjectId(),
      accountId,
      siteId: site._id,
      state: 'queued',
      sources: undefined,
      save: vi.fn().mockResolvedValue(undefined),
    };
    vi.spyOn(AudienceResearchRun, 'find').mockReturnValueOnce({
      sort: () => ({ limit: async () => [stale] }),
    } as never);

    const outcome = await runAudienceResearchReconciliationSweep({
      logger: silentLogger,
      queue: makeQueue({ getJob: async () => null }),
      queuedOrphanMs: DEFAULT_STUCK_RUN_MS,
      stuckRunMs: DEFAULT_STUCK_RUN_MS,
    });

    expect(outcome).toMatchObject({ markedOrphan: 1 });
    expect(stale.save).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
  });

  it('skips the orphan probe entirely when the orphan window is not tighter', async () => {
    const doc = await seed({ state: 'discovering' });
    await backdate(doc._id, DEFAULT_STUCK_RUN_MS + 60_000);

    const outcome = await runAudienceResearchReconciliationSweep({
      logger: silentLogger,
      queue: makeQueue({ getJob: async () => null }),
      queuedOrphanMs: DEFAULT_STUCK_RUN_MS,
      stuckRunMs: DEFAULT_STUCK_RUN_MS,
    });

    expect(outcome.markedStuck).toBe(1);
    expect(outcome.markedOrphan).toBe(0);
  });

  it('drains more than one batch when a full page comes back', async () => {
    const first = await seed({ state: 'discovering', deterministicInputHash: 'y'.repeat(64) });
    const second = await seed({ state: 'clustering', deterministicInputHash: 'z'.repeat(64) });
    await backdate(first._id, DEFAULT_STUCK_RUN_MS + 120_000);
    await backdate(second._id, DEFAULT_STUCK_RUN_MS + 60_000);

    const outcome = await runAudienceResearchReconciliationSweep({
      logger: silentLogger,
      queue: makeQueue({ getJob: async () => null }),
      batchSize: 1,
    });

    expect(outcome.markedStuck).toBe(2);
    expect(await AudienceResearchRun.countDocuments({ state: 'failed' })).toBe(2);
  });

  it('exposes a processor factory that returns the same outcome shape', async () => {
    const doc = await seed();
    await backdate(doc._id, DEFAULT_QUEUED_ORPHAN_MS + 60_000);
    const queue = makeQueue({ getJob: async () => null });
    const processor = createAudienceResearchReconciliationProcessor({
      logger: silentLogger,
      queue,
    });
    const outcome = await processor();
    expect(outcome.markedOrphan).toBe(1);
  });
});
