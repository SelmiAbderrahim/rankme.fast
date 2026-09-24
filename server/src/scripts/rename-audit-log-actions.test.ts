import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditLog } from '../modules/audit/audit-log.model.js';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../shared/testing/mongo.js';
import {
  LEGACY_ACTION_MAP,
  LEGACY_TARGET_TYPE_MAP,
  renameAuditLogActions,
} from './rename-audit-log-actions.js';

beforeAll(async () => {
  await startMemoryMongo();
});

afterAll(async () => {
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
});

/**
 * Insert legacy rows through the raw collection so we bypass the (updated)
 * Mongoose enum validation and can simulate real production data.
 */
async function insertLegacy(rows: Array<Record<string, unknown>>): Promise<void> {
  await AuditLog.collection.insertMany(
    rows.map((row) => ({
      _id: new mongoose.Types.ObjectId(),
      actorUserId: new mongoose.Types.ObjectId(),
      ip: '',
      metadata: {},
      createdAt: new Date(),
      ...row,
    })),
  );
}

describe('renameAuditLogActions', () => {
  it('exposes the documented legacy → SEO mapping', () => {
    expect(LEGACY_ACTION_MAP).toEqual({
      'backup.run': 'audit.run',
      'backup.restore': 'audit.run',
      'backup.delete': 'site.delete',
    });
    expect(LEGACY_TARGET_TYPE_MAP).toEqual({ project: 'site' });
  });

  it('renames every legacy action + target-type row and reports per-value counts', async () => {
    await insertLegacy([
      { action: 'backup.run', targetType: 'project', targetId: 'p1' },
      { action: 'backup.run', targetType: 'project', targetId: 'p2' },
      { action: 'backup.restore', targetType: 'project', targetId: 'p3' },
      { action: 'backup.delete', targetType: 'project', targetId: 'p4' },
      // Already-migrated rows are left untouched:
      { action: 'site.create', targetType: 'site', targetId: 's-untouched' },
    ]);

    const result = await renameAuditLogActions(AuditLog);

    expect(result.actionRenames).toEqual({
      'backup.run': 2,
      'backup.restore': 1,
      'backup.delete': 1,
    });
    expect(result.targetTypeRenames).toEqual({ project: 4 });
    expect(result.totalActionRows).toBe(4);
    expect(result.totalTargetRows).toBe(4);

    // No legacy value remains on any row.
    for (const legacy of Object.keys(LEGACY_ACTION_MAP)) {
      expect(await AuditLog.collection.countDocuments({ action: legacy })).toBe(0);
    }
    for (const legacy of Object.keys(LEGACY_TARGET_TYPE_MAP)) {
      expect(await AuditLog.collection.countDocuments({ targetType: legacy })).toBe(0);
    }

    // Post-migration values line up with the documented mapping.
    expect(await AuditLog.collection.countDocuments({ action: 'audit.run' })).toBe(3);
    expect(await AuditLog.collection.countDocuments({ action: 'site.delete' })).toBe(1);
    // 4 renamed rows + 1 pre-migrated `site.create` row that already carried
    // targetType='site' — the migration is a no-op on the untouched row.
    expect(await AuditLog.collection.countDocuments({ targetType: 'site' })).toBe(5);

    // The already-migrated row survived untouched.
    expect(
      await AuditLog.collection.countDocuments({
        action: 'site.create',
        targetId: 's-untouched',
      }),
    ).toBe(1);
  });

  it('is idempotent — a second run reports zero renames on a clean-slate DB', async () => {
    const empty = await renameAuditLogActions(AuditLog);
    expect(empty.totalActionRows).toBe(0);
    expect(empty.totalTargetRows).toBe(0);
    expect(Object.values(empty.actionRenames).every((n) => n === 0)).toBe(true);
    expect(Object.values(empty.targetTypeRenames).every((n) => n === 0)).toBe(true);

    // Second consecutive run does nothing.
    const again = await renameAuditLogActions(AuditLog);
    expect(again.totalActionRows).toBe(0);
    expect(again.totalTargetRows).toBe(0);
  });

  it('falls back to 0 when the driver omits modifiedCount (defensive branch)', async () => {
    // Simulate a driver response with no `modifiedCount` field. Mongoose's
    // Model interface types it as required but Mongo drivers historically
    // varied — the migration must not throw on the missing field.
    const fakeModel = {
      updateMany: async () => ({}) as unknown as { modifiedCount?: number },
    } as unknown as typeof AuditLog;
    const result = await renameAuditLogActions(fakeModel);
    for (const n of Object.values(result.actionRenames)) expect(n).toBe(0);
    for (const n of Object.values(result.targetTypeRenames)) expect(n).toBe(0);
    expect(result.totalActionRows).toBe(0);
    expect(result.totalTargetRows).toBe(0);
  });
});
