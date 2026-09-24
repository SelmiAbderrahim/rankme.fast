import mongoose from 'mongoose';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import { FAKE_AUDIT_RESULT } from '../../shared/providers/index.js';
import {
  AuditRun,
  completeAuditRun,
  createAuditCompletedHandler,
  createAuditFailedHandler,
  markAuditRunRunning,
} from './index.js';

const logger = pino({ level: 'silent' });

beforeAll(() => startMemoryMongo());
afterAll(() => stopMemoryMongo());
beforeEach(() => clearCollections());

async function seedRunningRun() {
  const run = await AuditRun.create({
    accountId: new mongoose.Types.ObjectId(),
    siteId: new mongoose.Types.ObjectId(),
    pageCap: 100,
  });
  await markAuditRunRunning(run.id);
  return run.id as string;
}

describe('createAuditCompletedHandler', () => {
  it('closes a still-running run as succeeded (worker died before bookkeeping)', async () => {
    const runId = await seedRunningRun();
    await createAuditCompletedHandler({ logger })({ jobId: `audit-${runId}` });

    const run = await AuditRun.findById(runId);
    expect(run?.status).toBe('succeeded');
    expect(run?.finishedAt).toBeInstanceOf(Date);
  });

  it('no-ops when the worker already finalized the run', async () => {
    const runId = await seedRunningRun();
    await completeAuditRun(runId, FAKE_AUDIT_RESULT);
    await createAuditCompletedHandler({ logger })({ jobId: `audit-${runId}` });

    // The worker's result write was not clobbered — the stored result slims to domainChecks.
    expect((await AuditRun.findById(runId))?.result).toEqual({
      domainChecks: FAKE_AUDIT_RESULT.domainChecks,
    });
  });

  it('warns and skips foreign jobIds', async () => {
    const warnSpy = vi.spyOn(logger, 'warn');
    await createAuditCompletedHandler({ logger })({ jobId: 'not-ours' });
    expect(warnSpy).toHaveBeenCalledWith(
      { jobId: 'not-ours' },
      'audit completed event with unrecognized jobId',
    );
    warnSpy.mockRestore();
  });
});

describe('createAuditFailedHandler', () => {
  it('closes a still-running run as failed with the reason', async () => {
    const runId = await seedRunningRun();
    await createAuditFailedHandler({ logger })({
      jobId: `audit-${runId}`,
      failedReason: 'worker crashed mid-flight',
    });

    const run = await AuditRun.findById(runId);
    expect(run?.status).toBe('failed');
    expect(run?.error).toBe('worker crashed mid-flight');
  });

  it('yields to a terminal state the worker already wrote', async () => {
    const runId = await seedRunningRun();
    await completeAuditRun(runId, FAKE_AUDIT_RESULT);
    await createAuditFailedHandler({ logger })({
      jobId: `audit-${runId}`,
      failedReason: 'stale event',
    });
    expect((await AuditRun.findById(runId))?.status).toBe('succeeded');
  });

  it('warns and skips foreign jobIds', async () => {
    const warnSpy = vi.spyOn(logger, 'warn');
    await createAuditFailedHandler({ logger })({ jobId: 'rank:x:y', failedReason: 'x' });
    expect(warnSpy).toHaveBeenCalledWith(
      { jobId: 'rank:x:y' },
      'audit failed event with unrecognized jobId',
    );
    warnSpy.mockRestore();
  });
});
