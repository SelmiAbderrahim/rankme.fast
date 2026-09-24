/**
 * Auto audit re-run tests — every guard is a silent skip (never a throw),
 * and the daily dedupe ignores failed/unavailable runs.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Job, Queue } from 'bullmq';
import mongoose from 'mongoose';
import { pino } from 'pino';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import { AUDIT_JOB_NAME } from '../../shared/queue/queues.js';
import { Site } from '../sites/index.js';
import { AUDIT_PAGE_CAP_MAX } from './audits.schema.js';
import { AuditRun, AUTO_RERUN_TRIGGER, requestAutoAuditRerun } from './index.js';

const logger = pino({ level: 'silent' });

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
  return Site.create({ accountId, url: `https://${host}`, domain: host });
}

describe('requestAutoAuditRerun', () => {
  it('happy path: creates a rank-drop run and enqueues with jobId dedupe at the structural page ceiling', async () => {
    const accountId = new mongoose.Types.ObjectId().toHexString();
    const site = await seedSite(accountId);
    const { queue, jobs } = fakeQueue();

    const outcome = await requestAutoAuditRerun(
      { accountId, siteId: site.id as string },
      { auditsQueue: queue, logger },
    );
    expect(outcome.enqueued).toBe(true);
    const runId = (outcome as { enqueued: true; runId: string }).runId;

    const run = await AuditRun.findById(runId);
    expect(run?.trigger).toBe(AUTO_RERUN_TRIGGER);
    expect(run?.status).toBe('queued');
    expect(run?.pageCap).toBe(AUDIT_PAGE_CAP_MAX);

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      name: AUDIT_JOB_NAME,
      data: { accountId, siteId: site.id as string, runId, pageCap: AUDIT_PAGE_CAP_MAX },
      opts: { jobId: `audit-${runId}` },
    });
  });

  it('null queue → queue-unavailable skip', async () => {
    const accountId = new mongoose.Types.ObjectId().toHexString();
    const outcome = await requestAutoAuditRerun(
      { accountId, siteId: new mongoose.Types.ObjectId().toHexString() },
      { auditsQueue: null, logger },
    );
    expect(outcome).toEqual({ enqueued: false, reason: 'queue-unavailable' });
  });

  it('cross-account siteId → site-not-found skip', async () => {
    const owner = new mongoose.Types.ObjectId().toHexString();
    const stranger = new mongoose.Types.ObjectId().toHexString();
    const site = await seedSite(owner);
    const { queue, jobs } = fakeQueue();

    const outcome = await requestAutoAuditRerun(
      { accountId: stranger, siteId: site.id as string },
      { auditsQueue: queue, logger },
    );
    expect(outcome).toEqual({ enqueued: false, reason: 'site-not-found' });
    expect(jobs).toHaveLength(0);
    expect(await AuditRun.countDocuments({ siteId: site._id })).toBe(0);
  });

  it('paused site → site-paused skip, no run doc, no enqueue', async () => {
    const accountId = new mongoose.Types.ObjectId().toHexString();
    const site = await seedSite(accountId);
    await Site.updateOne({ _id: site._id }, { $set: { paused: true, pausedAt: new Date() } });
    const { queue, jobs } = fakeQueue();

    const outcome = await requestAutoAuditRerun(
      { accountId, siteId: site.id as string },
      { auditsQueue: queue, logger },
    );
    expect(outcome).toEqual({ enqueued: false, reason: 'site-paused' });
    expect(jobs).toHaveLength(0);
    expect(await AuditRun.countDocuments({ siteId: site._id })).toBe(0);
  });

  it('in-flight run → run-in-flight skip', async () => {
    const accountId = new mongoose.Types.ObjectId().toHexString();
    const site = await seedSite(accountId);
    await AuditRun.create({ accountId, siteId: site._id, pageCap: 100, status: 'running' });
    const { queue, jobs } = fakeQueue();

    const outcome = await requestAutoAuditRerun(
      { accountId, siteId: site.id as string },
      { auditsQueue: queue, logger },
    );
    expect(outcome).toEqual({ enqueued: false, reason: 'run-in-flight' });
    expect(jobs).toHaveLength(0);
  });

  it('succeeded run inside 24h → recent-run skip', async () => {
    const accountId = new mongoose.Types.ObjectId().toHexString();
    const site = await seedSite(accountId);
    await AuditRun.create({ accountId, siteId: site._id, pageCap: 100, status: 'succeeded' });
    const { queue, jobs } = fakeQueue();

    const outcome = await requestAutoAuditRerun(
      { accountId, siteId: site.id as string },
      { auditsQueue: queue, logger },
    );
    expect(outcome).toEqual({ enqueued: false, reason: 'recent-run' });
    expect(jobs).toHaveLength(0);
  });

  it('failed run inside 24h does NOT block the re-run', async () => {
    const accountId = new mongoose.Types.ObjectId().toHexString();
    const site = await seedSite(accountId);
    await AuditRun.create({ accountId, siteId: site._id, pageCap: 100, status: 'failed' });
    const { queue, jobs } = fakeQueue();

    const outcome = await requestAutoAuditRerun(
      { accountId, siteId: site.id as string },
      { auditsQueue: queue, logger },
    );
    expect(outcome.enqueued).toBe(true);
    expect(jobs).toHaveLength(1);
  });

  it('succeeded run older than 24h does NOT block (frozen clock)', async () => {
    const accountId = new mongoose.Types.ObjectId().toHexString();
    const site = await seedSite(accountId);
    const old = await AuditRun.create({
      accountId,
      siteId: site._id,
      pageCap: 100,
      status: 'succeeded',
    });
    // Freeze "now" 25h after the seeded run's createdAt.
    const now = () => new Date(old.createdAt.getTime() + 25 * 60 * 60 * 1000);
    const { queue, jobs } = fakeQueue();

    const outcome = await requestAutoAuditRerun(
      { accountId, siteId: site.id as string },
      { auditsQueue: queue, logger, now },
    );
    expect(outcome.enqueued).toBe(true);
    expect(jobs).toHaveLength(1);
  });
});
