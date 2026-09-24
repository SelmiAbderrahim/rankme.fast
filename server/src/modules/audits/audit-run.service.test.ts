import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import {
  AuditRun,
  completeAuditRun,
  failAuditRun,
  markAuditRunRunning,
} from './index.js';
import { FAKE_AUDIT_RESULT } from '../../shared/providers/index.js';

beforeAll(() => startMemoryMongo());
afterAll(() => stopMemoryMongo());
beforeEach(() => clearCollections());

async function seedRun() {
  return AuditRun.create({
    accountId: new mongoose.Types.ObjectId(),
    siteId: new mongoose.Types.ObjectId(),
    pageCap: 100,
  });
}

describe('AuditRun lifecycle', () => {
  it('new runs start queued with empty lifecycle fields', async () => {
    const run = await seedRun();
    expect(run.status).toBe('queued');
    expect(run.startedAt).toBeNull();
    expect(run.finishedAt).toBeNull();
    expect(run.error).toBeNull();
    expect(run.vendorTaskId).toBeNull();
    expect(run.result).toBeNull();
  });

  it('queued → running stamps startedAt and vendorTaskId', async () => {
    const run = await seedRun();
    const { transitioned } = await markAuditRunRunning(run.id, 'task-9');
    expect(transitioned).toBe(true);

    const updated = await AuditRun.findById(run.id);
    expect(updated?.status).toBe('running');
    expect(updated?.startedAt).toBeInstanceOf(Date);
    expect(updated?.vendorTaskId).toBe('task-9');
  });

  it('running is only reachable from queued (idempotent retries)', async () => {
    const run = await seedRun();
    await markAuditRunRunning(run.id);
    const second = await markAuditRunRunning(run.id, 'task-late');
    expect(second.transitioned).toBe(false);
    expect((await AuditRun.findById(run.id))?.vendorTaskId).toBeNull();
  });

  it('running → succeeded stores only the domainChecks slice', async () => {
    const run = await seedRun();
    await markAuditRunRunning(run.id);
    const { transitioned } = await completeAuditRun(run.id, FAKE_AUDIT_RESULT);
    expect(transitioned).toBe(true);

    const updated = await AuditRun.findById(run.id);
    expect(updated?.status).toBe('succeeded');
    expect(updated?.finishedAt).toBeInstanceOf(Date);
    // Only domainChecks is persisted — the per-page detail already lives in
    // AuditedPage + ReportSnapshot.
    expect(updated?.result).toEqual({ domainChecks: FAKE_AUDIT_RESULT.domainChecks });
    expect(updated?.error).toBeNull();
  });

  it('failAuditRun marks failed with the operator message', async () => {
    const run = await seedRun();
    await markAuditRunRunning(run.id);
    const { transitioned } = await failAuditRun(run.id, 'vendor said no');
    expect(transitioned).toBe(true);

    const updated = await AuditRun.findById(run.id);
    expect(updated?.status).toBe('failed');
    expect(updated?.error).toBe('vendor said no');
  });

  it('failAuditRun with unavailable maps to the unavailable status', async () => {
    const run = await seedRun();
    const { transitioned } = await failAuditRun(run.id, 'quota exhausted', {
      unavailable: true,
    });
    expect(transitioned).toBe(true);
    expect((await AuditRun.findById(run.id))?.status).toBe('unavailable');
  });

  it('terminal states are write-once — later writers no-op', async () => {
    const run = await seedRun();
    await markAuditRunRunning(run.id);
    await completeAuditRun(run.id, FAKE_AUDIT_RESULT);

    expect((await failAuditRun(run.id, 'too late')).transitioned).toBe(false);
    expect((await completeAuditRun(run.id, FAKE_AUDIT_RESULT)).transitioned).toBe(false);
    const updated = await AuditRun.findById(run.id);
    expect(updated?.status).toBe('succeeded');
    expect(updated?.error).toBeNull();
  });
});
