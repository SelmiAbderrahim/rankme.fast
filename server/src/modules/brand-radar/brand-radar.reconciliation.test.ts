/**
 * Spec 07a-2 — Brand Radar reconciliation sweep.
 *
 * Detection windows, the re-enqueue path for an orphaned scan, and the
 * stuck-run settlement (marked `failed` with one scan-level `failed` event).
 */
import type { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import mongoose from 'mongoose';
import type { Logger } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../db/client.js';
import { brandRadarEvents } from '../../db/schema/brand-radar-events.js';
import { Site, claimSiteDeletion } from '../sites/index.js';
import { User } from '../users/users.model.js';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import {
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import {
  BrandRadarScan,
  type BrandRadarScanStatus,
} from './brand-radar.model.js';
import {
  BRAND_RADAR_QUEUED_ORPHAN_MS,
  BRAND_RADAR_RECON_INTERVAL_MS,
  BRAND_RADAR_RECON_JOB,
  BRAND_RADAR_RECON_QUEUE,
  BRAND_RADAR_RECON_SCHEDULER_KEY,
  BRAND_RADAR_STUCK_RUN_MS,
  createBrandRadarReconciliationProcessor,
  runBrandRadarReconciliationSweep,
} from './brand-radar.reconciliation.js';

const silentLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
} as unknown as Logger;

let db: Db;
let getJob: ReturnType<typeof vi.fn>;
let add: ReturnType<typeof vi.fn>;
let queue: Queue;

const ACCOUNT = new mongoose.Types.ObjectId().toString();
// Every scan is site-scoped, so the sweep always runs under this site's work
// lease — the row must exist for the lease to be acquirable.
const SITE = new mongoose.Types.ObjectId().toString();
const NOW = new Date('2026-03-01T12:00:00.000Z');

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60 * 1000);
}

async function seedScan(input: {
  status: BrandRadarScanStatus;
  updatedAt: Date;
  retainedRowCount?: number;
  siteId?: string;
}): Promise<string> {
  const scan = await BrandRadarScan.create({
    accountId: ACCOUNT,
    brandQuery: 'Acme Corp',
    outputLocale: 'en',
    status: input.status,
    queryHash: 'c'.repeat(64),
    retainedRowCount: input.retainedRowCount ?? 0,
    siteId: input.siteId ?? SITE,
    retainedRowIds: Array.from(
      { length: input.retainedRowCount ?? 0 },
      (_, i) => `row-${i}`,
    ),
  });
  // `timestamps: true` stamps `updatedAt` on write; age the row explicitly.
  await BrandRadarScan.collection.updateOne(
    { _id: scan._id },
    { $set: { updatedAt: input.updatedAt } },
  );
  return String(scan._id);
}

function sweep(overrides: Record<string, unknown> = {}) {
  return runBrandRadarReconciliationSweep({
    db,
    logger: silentLogger,
    queue,
    now: () => NOW,
    ...overrides,
  });
}

beforeAll(async () => {
  await startMemoryMongo();
  db = (await startTestPostgres()) as unknown as Db;
});

afterAll(async () => {
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  vi.clearAllMocks();
  getJob = vi.fn().mockResolvedValue(null);
  add = vi.fn().mockResolvedValue({ id: 'job' });
  queue = { getJob, add } as unknown as Queue;
  // The sweep runs every scan under the account + site work leases, so both
  // rows must exist for the lease to be acquirable.
  await User.create({
    _id: new mongoose.Types.ObjectId(ACCOUNT),
    email: 'brand-radar-recon@example.com',
    emailVerified: true,
  });
  await Site.create({
    _id: new mongoose.Types.ObjectId(SITE),
    accountId: new mongoose.Types.ObjectId(ACCOUNT),
    url: 'https://brand-recon.example.com',
    domain: 'brand-recon.example.com',
  });
});

describe('detection windows', () => {
  it('does not re-enqueue or settle a site scan after deletion is claimed', async () => {
    const site = await Site.create({
      accountId: ACCOUNT,
      url: 'https://brand-deleting.example.com',
      domain: 'brand-deleting.example.com',
    });
    const scanId = await seedScan({
      status: 'queued',
      updatedAt: minutesAgo(20),
      siteId: String(site._id),
    });
    await expect(claimSiteDeletion({
      accountId: ACCOUNT,
      siteId: String(site._id),
    })).resolves.toMatchObject({ status: 'claimed' });

    await expect(sweep()).resolves.toMatchObject({
      scanned: 1,
      skipped: 1,
      reEnqueued: 0,
      markedFailed: 0,
    });
    expect(getJob).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    expect((await BrandRadarScan.findById(scanId))?.status).toBe('queued');
  });

  it('pins the shipped sweep constants', () => {
    expect(BRAND_RADAR_QUEUED_ORPHAN_MS).toBe(10 * 60 * 1000);
    expect(BRAND_RADAR_STUCK_RUN_MS).toBe(60 * 60 * 1000);
    expect(BRAND_RADAR_RECON_INTERVAL_MS).toBe(5 * 60 * 1000);
    expect(BRAND_RADAR_RECON_QUEUE).toBe('brand-radar-recon');
    expect(BRAND_RADAR_RECON_JOB).toBe('sweep');
    expect(BRAND_RADAR_RECON_SCHEDULER_KEY).toBe('brand-radar-reconciliation-sweep');
  });

  it('ignores rows that are younger than the orphan window', async () => {
    await seedScan({ status: 'queued', updatedAt: minutesAgo(2) });
    await seedScan({ status: 'running', updatedAt: minutesAgo(2) });
    expect(await sweep()).toMatchObject({ scanned: 0, reEnqueued: 0, markedFailed: 0 });
  });

  it('skips a queued row whose job is still live', async () => {
    await seedScan({ status: 'queued', updatedAt: minutesAgo(20) });
    getJob.mockResolvedValue({ id: 'live' });
    expect(await sweep()).toMatchObject({ scanned: 1, skipped: 1, reEnqueued: 0 });
    expect(add).not.toHaveBeenCalled();
  });

  it('skips a running row still inside the stuck window', async () => {
    await seedScan({ status: 'running', updatedAt: minutesAgo(20) });
    expect(await sweep()).toMatchObject({ scanned: 1, skipped: 1, markedFailed: 0 });
  });
});

describe('re-enqueue path', () => {
  it('re-enqueues an orphaned queued scan with the deterministic job id', async () => {
    const scanId = await seedScan({ status: 'queued', updatedAt: minutesAgo(20) });

    const outcome = await sweep();

    expect(outcome).toMatchObject({ scanned: 1, reEnqueued: 1, markedFailed: 0 });
    expect(getJob).toHaveBeenCalledWith(`brand-radar-${scanId}`);
    expect(add).toHaveBeenCalledWith(
      'brand-radar-scan',
      { accountId: ACCOUNT, siteId: SITE, scanId, outputLocale: 'en' },
      expect.objectContaining({ jobId: `brand-radar-${scanId}` }),
    );
    const doc = await BrandRadarScan.findById(scanId);
    expect(doc?.status).toBe('queued');
  });

  it('fails locale-less active work without re-enqueueing it', async () => {
    const scanId = await seedScan({ status: 'queued', updatedAt: minutesAgo(20) });
    await BrandRadarScan.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(scanId) },
      { $unset: { outputLocale: 1 } },
    );

    const first = await sweep();
    const second = await sweep();

    expect(first).toMatchObject({ markedFailed: 1, reEnqueued: 0 });
    expect(second).toMatchObject({ scanned: 0, markedFailed: 0 });
    expect(getJob).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    expect((await BrandRadarScan.findById(scanId))?.status).toBe('failed');
  });

  it('records the retained-row count on failed locale-less work', async () => {
    const scanId = await seedScan({
      status: 'queued',
      updatedAt: minutesAgo(20),
      retainedRowCount: 2,
    });
    await BrandRadarScan.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(scanId) },
      { $unset: { outputLocale: 1 } },
    );

    const outcome = await sweep();

    expect(outcome).toMatchObject({ markedFailed: 1, reEnqueued: 0 });
    const events = await db
      .select()
      .from(brandRadarEvents)
      .where(eq(brandRadarEvents.scanId, scanId));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      stage: 'scan',
      event: 'failed',
      metadata: { retainedRows: 2 },
    });
  });
});

describe('stuck-run settlement', () => {
  it('fails a stuck run that retained nothing', async () => {
    const scanId = await seedScan({ status: 'running', updatedAt: minutesAgo(90) });

    const outcome = await sweep();

    expect(outcome).toMatchObject({ markedFailed: 1 });
    const doc = await BrandRadarScan.findById(scanId);
    expect(doc?.status).toBe('failed');
    // Halt disclosure: the sweep records the honest whole-run stage.
    expect(doc?.halt?.stage).toBe('scan');
    expect(doc?.halt?.reason).toBe('processing_failure');
    expect(doc?.terminalAt?.toISOString()).toBe(NOW.toISOString());
    const events = await db
      .select()
      .from(brandRadarEvents)
      .where(eq(brandRadarEvents.scanId, scanId));
    expect(events.map((e) => `${e.stage}:${e.event}`)).toEqual(['scan:failed']);
  });

  it('fails a stuck run that retained evidence and records the row count', async () => {
    const scanId = await seedScan({
      status: 'running',
      updatedAt: minutesAgo(90),
      retainedRowCount: 2,
    });

    const outcome = await sweep();

    expect(outcome).toMatchObject({ markedFailed: 1 });
    const events = await db
      .select()
      .from(brandRadarEvents)
      .where(eq(brandRadarEvents.scanId, scanId));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event: 'failed',
      metadata: { reason: 'processing_failure', retainedRows: 2 },
    });
  });

  it('fails a long-orphaned queued scan instead of re-enqueueing forever', async () => {
    const scanId = await seedScan({ status: 'queued', updatedAt: minutesAgo(120) });

    const outcome = await sweep();

    expect(outcome).toMatchObject({ markedFailed: 1, reEnqueued: 0 });
    expect(add).not.toHaveBeenCalled();
    expect((await BrandRadarScan.findById(scanId))?.status).toBe('failed');
  });

  it('is idempotent — a second pass finds nothing left to settle', async () => {
    await seedScan({ status: 'running', updatedAt: minutesAgo(90) });
    await sweep();
    expect(await sweep()).toMatchObject({ scanned: 0, markedFailed: 0 });
  });
});

describe('batching', () => {
  it('stops after the batch ceiling when every row keeps being skipped', async () => {
    await seedScan({ status: 'queued', updatedAt: minutesAgo(20) });
    await seedScan({ status: 'queued', updatedAt: minutesAgo(21) });
    getJob.mockResolvedValue({ id: 'live' });

    const outcome = await sweep({ batchSize: 1 });

    // One row per batch, 100 batches, all skipped — the loop exits on the
    // MAX_BATCHES guard rather than spinning forever.
    expect(outcome.scanned).toBe(100);
    expect(outcome.skipped).toBe(100);
  });

  it('defaults to the wall clock when no clock is injected', async () => {
    await seedScan({ status: 'queued', updatedAt: minutesAgo(20) });
    // Real "now" is far past the seeded 2026-03-01 fixture, so the row is well
    // outside the orphan window and the sweep re-enqueues it.
    const outcome = await runBrandRadarReconciliationSweep({
      db,
      logger: silentLogger,
      queue,
    });
    expect(outcome.scanned).toBe(1);
  });

  it('exposes a BullMQ processor wrapper', async () => {
    const processor = createBrandRadarReconciliationProcessor({
      db,
      logger: silentLogger,
      queue,
      now: () => NOW,
    });
    expect(await processor()).toMatchObject({ scanned: 0 });
  });
});
