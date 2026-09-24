import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import type { Request } from 'express';
import { createApp } from '../../app.js';
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
  installTestAuth,
  signupVerifiedUser,
  uninstallTestAuth,
  type TestUser,
} from '../../shared/testing/auth.js';
import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
  AuditLog,
} from './audit-log.model.js';
import {
  extractIp,
  listAuditForUser,
  recordAudit,
  recordAuditOnce,
} from './audit.service.js';

const app = createApp();

/** Signup + verify through the real Better Auth endpoint (same-id Mongo mirror). */
function seedUser(email = 'a@x.co'): Promise<TestUser> {
  return signupVerifiedUser(app, { email });
}

beforeAll(async () => {
  await startMemoryMongo();
  await startTestPostgres();
  installTestAuth();
});

afterAll(async () => {
  uninstallTestAuth();
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
});

describe('audit enum shape (D.1 rebrand)', () => {
  it('AUDIT_ACTIONS contains the SEO action set + admin actions with no backup leftovers', () => {
    expect([...AUDIT_ACTIONS].sort()).toEqual(
      [
        'site.create',
        'site.delete',
        'site.pause',
        'site.resume',
        'audit.run',
        'report.view',
        'report_export.created',
        'report_export.rendered',
        'report_export.downloaded',
        'report_export.deleted',
        'report_export.refused',
        'report_export.share_created',
        'report_export.share_viewed',
        'report_export.share_revoked',
        'report_export.expired',
        'report_export.purged',
        'keyword.add',
        'keyword.remove',
        'google.connect',
        'google.set_property',
        'google.set_ga4_property',
        'google.set_site_bindings',
        'google.unlink_site',
        'google.disconnect',
        'data.export',
        'data.delete.requested',
        'data.delete.cancelled',
        'data.delete.blocked',
        'data.delete.completed',
        'admin.role_change',
        'admin.suspend',
        'admin.unsuspend',
        'superadmin.role_change',
        'superadmin.suspend',
        'superadmin.unsuspend',
        'superadmin.cache_invalidate',
        'superadmin.dlq_requeue',
        'superadmin.kill_switch',
        'superadmin.monitor_reconcile',
        'team.invite',
        'team.accept',
        'team.remove',
        // rankme-enterprise-orgs 02 — workspace team roles.
        'team.role_change',
        'team.invite_resend',
        'team.reject',
        'team.access_change',
      ].sort(),
    );
    for (const banned of ['backup.run', 'backup.restore', 'backup.delete', 'plan.change', 'subscription.change', 'billing.portal_opened']) {
      expect((AUDIT_ACTIONS as readonly string[]).includes(banned)).toBe(false);
    }
  });

  it('AUDIT_TARGET_TYPES includes site/keyword/user/webhook — no legacy `project` or billing targets', () => {
    expect([...AUDIT_TARGET_TYPES].sort()).toEqual(
      [
        'cache_key',
        'keyword',
        'kill_switch',
        'monitor',
        'queue_job',
        'report_export',
        'report_export_share',
        'site',
        'user',
        'webhook',
        'team_member',
      ].sort(),
    );
    expect((AUDIT_TARGET_TYPES as readonly string[]).includes('project')).toBe(false);
    expect((AUDIT_TARGET_TYPES as readonly string[]).includes('subscription')).toBe(false);
  });
});

describe('audit.service.recordAudit', () => {
  it('appends an AuditLog with actor, action, target, ip, metadata', async () => {
    const actor = new mongoose.Types.ObjectId().toString();
    await recordAudit({
      actorUserId: actor,
      action: 'site.create',
      targetType: 'site',
      targetId: 'p1',
      ip: '1.2.3.4',
      metadata: { foo: 'bar' },
    });
    const entries = await AuditLog.find({});
    expect(entries).toHaveLength(1);
    expect(entries[0]?.action).toBe('site.create');
    expect(entries[0]?.ip).toBe('1.2.3.4');
    expect(entries[0]?.metadata).toMatchObject({ foo: 'bar' });
    expect((entries[0] as unknown as { createdAt: Date }).createdAt).toBeInstanceOf(Date);
  });

  it('defaults ip and metadata when omitted', async () => {
    await recordAudit({
      actorUserId: new mongoose.Types.ObjectId().toString(),
      action: 'data.export',
      targetType: 'user',
      targetId: 's1',
    });
    const e = await AuditLog.findOne({});
    expect(e?.ip).toBe('');
    expect(e?.metadata).toEqual({});
  });

  it('is best-effort: a persistence error is swallowed', async () => {
    // Pass an invalid enum value to trigger validation error.
    await recordAudit({
      actorUserId: new mongoose.Types.ObjectId().toString(),
      // @ts-expect-error deliberate bad action
      action: 'not.a.real.action',
      targetType: 'site',
      targetId: 'x',
    });
    // No throw, no entry appended.
    const count = await AuditLog.countDocuments({});
    expect(count).toBe(0);
  });
});

describe('audit.service.recordAuditOnce', () => {
  it('persists once per idempotency key with default ip and metadata', async () => {
    const input = {
      actorUserId: new mongoose.Types.ObjectId().toString(),
      action: 'data.delete.completed' as const,
      targetType: 'user' as const,
      targetId: 'audit-once',
    };
    await expect(recordAuditOnce('audit-once', input)).resolves.toBe(true);
    await expect(recordAuditOnce('audit-once', input)).resolves.toBe(false);
    const rows = await AuditLog.find({ idempotencyKey: 'audit-once' }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ip: '', metadata: {}, targetId: 'audit-once' });
  });

  it('treats a duplicate-key upsert race as an already-recorded audit', async () => {
    const update = vi
      .spyOn(AuditLog, 'updateOne')
      .mockRejectedValueOnce(Object.assign(new Error('duplicate key'), { code: 11_000 }));

    await expect(
      recordAuditOnce('audit-race', {
        actorUserId: new mongoose.Types.ObjectId().toString(),
        action: 'data.delete.completed',
        targetType: 'user',
        targetId: 'audit-race',
      }),
    ).resolves.toBe(false);

    update.mockRestore();
  });

  it('preserves a non-duplicate persistence failure', async () => {
    const failure = new Error('mongo unavailable');
    const update = vi.spyOn(AuditLog, 'updateOne').mockRejectedValueOnce(failure);

    await expect(
      recordAuditOnce('audit-write-failure', {
        actorUserId: new mongoose.Types.ObjectId().toString(),
        action: 'data.delete.completed',
        targetType: 'user',
        targetId: 'audit-write-failure',
      }),
    ).rejects.toBe(failure);

    update.mockRestore();
  });
});

describe('audit.service.extractIp', () => {
  it('reads the first x-forwarded-for entry as string', () => {
    const ip = extractIp({
      headers: { 'x-forwarded-for': '1.1.1.1, 2.2.2.2' },
      ip: '3.3.3.3',
    } as unknown as Request);
    expect(ip).toBe('1.1.1.1');
  });

  it('reads the first x-forwarded-for entry as array', () => {
    const ip = extractIp({
      headers: { 'x-forwarded-for': ['1.1.1.1, 9.9.9.9'] },
      ip: '3.3.3.3',
    } as unknown as Request);
    expect(ip).toBe('1.1.1.1');
  });

  it('falls back to req.ip when no forwarded header', () => {
    const ip = extractIp({
      headers: {},
      ip: '3.3.3.3',
    } as unknown as Request);
    expect(ip).toBe('3.3.3.3');
  });

  it('returns empty string when everything is missing', () => {
    const ip = extractIp({
      headers: {},
    } as unknown as Request);
    expect(ip).toBe('');
  });
});

describe('audit routes', () => {
  it('requires auth', async () => {
    const res = await request(app).get('/api/audit');
    expect(res.status).toBe(401);

    // A garbage/tampered session cookie is equally rejected.
    const tampered = await request(app)
      .get('/api/audit')
      .set('Cookie', 'better-auth.session_token=tampered');
    expect(tampered.status).toBe(401);
  });

  it('returns caller-scoped audit entries sorted newest first', async () => {
    const alice = await seedUser('alice@x.co');
    const bob = await seedUser('bob@x.co');
    await recordAudit({
      actorUserId: alice.id,
      action: 'site.create',
      targetType: 'site',
      targetId: 'p1',
    });
    await new Promise((r) => setTimeout(r, 5));
    await recordAudit({
      actorUserId: alice.id,
      action: 'data.export',
      targetType: 'user',
      targetId: 's1',
    });
    await recordAudit({
      actorUserId: bob.id,
      action: 'site.delete',
      targetType: 'site',
      targetId: 'p2',
    });

    const res = await request(app).get('/api/audit').set('Cookie', alice.cookie);
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(2);
    expect(res.body.entries[0].action).toBe('data.export');
    expect(res.body.entries[1].action).toBe('site.create');
  });

  it('respects the limit query param and rejects invalid values', async () => {
    const alice = await seedUser();
    for (let i = 0; i < 5; i++) {
      await recordAudit({
        actorUserId: alice.id,
        action: 'site.create',
        targetType: 'site',
        targetId: `p${i}`,
      });
    }
    const r1 = await request(app).get('/api/audit?limit=2').set('Cookie', alice.cookie);
    expect(r1.body.entries).toHaveLength(2);

    const r2 = await request(app).get('/api/audit?limit=abc').set('Cookie', alice.cookie);
    expect(r2.status).toBe(200);
    expect(r2.body.entries).toHaveLength(5);

    const r3 = await request(app).get('/api/audit?limit=999').set('Cookie', alice.cookie);
    expect(r3.status).toBe(200);
    expect(r3.body.entries).toHaveLength(5);
  });

  it('listAuditForUser is directly callable', async () => {
    const alice = await seedUser();
    await recordAudit({
      actorUserId: alice.id,
      action: 'site.create',
      targetType: 'site',
      targetId: 'p1',
    });
    const entries = await listAuditForUser(alice.id);
    expect(entries).toHaveLength(1);
  });
});
