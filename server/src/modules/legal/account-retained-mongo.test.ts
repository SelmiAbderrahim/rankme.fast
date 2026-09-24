import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import { AuditLog } from '../audit/index.js';
import {
  deletedMongoActorId,
  deletedMongoReference,
  sanitizeRetainedMongoData,
} from './account-retained-mongo.js';

beforeAll(async () => {
  await startMemoryMongo();
});

afterAll(async () => {
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
});

describe('retained Mongo sanitization', () => {
  it('creates stable one-way references for replay-safe retained evidence', () => {
    const reference = deletedMongoReference('raw-account-reference');
    expect(reference).toMatch(/^redacted:[0-9a-f]{64}$/);
    expect(deletedMongoReference(reference)).toBe(reference);
  });

  it('pseudonymizes account/target audit links', async () => {
    const accountId = new Types.ObjectId().toString();
    const controlId = new Types.ObjectId().toString();
    const siteId = new Types.ObjectId().toString();
    const accountAudit = await AuditLog.create({
      actorUserId: accountId,
      action: 'data.delete.completed',
      targetType: 'user',
      targetId: accountId,
      idempotencyKey: `delete:${accountId}`,
      ip: '198.51.100.7',
      metadata: { email: 'delete@example.com' },
    });
    const crossActorAudit = await AuditLog.create({
      actorUserId: controlId,
      action: 'site.delete',
      targetType: 'site',
      targetId: siteId,
      ip: '198.51.100.8',
      metadata: { accountId },
    });
    const controlAudit = await AuditLog.create({
      actorUserId: controlId,
      action: 'report.view',
      targetType: 'site',
      targetId: new Types.ObjectId().toString(),
      ip: '198.51.100.9',
      metadata: { keep: true },
    });
    const actorOnlyAudit = await AuditLog.create({
      actorUserId: accountId,
      action: 'report.view',
      targetType: 'site',
      targetId: 'other-account-site',
      ip: '198.51.100.10',
    });
    await expect(
      sanitizeRetainedMongoData({
        accountId,
        resourceIds: new Set([siteId]),
      }),
    ).resolves.toEqual({ auditLogs: 3 });

    const sanitizedAccountAudit = await AuditLog.findById(accountAudit._id).lean();
    expect(sanitizedAccountAudit?.actorUserId).toEqual(deletedMongoActorId(accountId));
    expect(sanitizedAccountAudit?.targetId).toMatch(/^redacted:[0-9a-f]{64}$/);
    expect(sanitizedAccountAudit?.idempotencyKey).toMatch(/^redacted:[0-9a-f]{64}$/);
    expect(sanitizedAccountAudit?.ip).toBe('');
    expect(sanitizedAccountAudit?.metadata).toEqual({ redacted: true });

    const sanitizedCrossAudit = await AuditLog.findById(crossActorAudit._id).lean();
    expect(String(sanitizedCrossAudit?.actorUserId)).toBe(controlId);
    expect(sanitizedCrossAudit?.targetId).toMatch(/^redacted:/);
    expect(await AuditLog.findById(controlAudit._id).lean()).toMatchObject({
      targetId: controlAudit.targetId,
      ip: '198.51.100.9',
      metadata: { keep: true },
    });

    const sanitizedActorOnly = await AuditLog.findById(actorOnlyAudit._id).lean();
    expect(sanitizedActorOnly?.actorUserId).toEqual(deletedMongoActorId(accountId));
    expect(sanitizedActorOnly?.targetId).toBe('other-account-site');
    expect(sanitizedActorOnly?.idempotencyKey ?? null).toBeNull();
  });

  it('is idempotent after identifiers are already sanitized', async () => {
    const accountId = new Types.ObjectId().toString();
    await AuditLog.create({
      actorUserId: accountId,
      action: 'data.delete.completed',
      targetType: 'user',
      targetId: accountId,
    });
    const input = { accountId, resourceIds: new Set<string>() };
    await sanitizeRetainedMongoData(input);
    await expect(sanitizeRetainedMongoData(input)).resolves.toEqual({
      auditLogs: 0,
    });
  });
});
