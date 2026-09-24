/**
 * Shared workspaces, end to end at the router — `rankme-enterprise-orgs` 02.
 *
 * The middleware matrix lives in `shared/middleware/workspace-context.test.ts`.
 * This suite proves the two consequences that matter to the product:
 *
 *  1. An accepted member working under `x-workspace-id` reads and writes the
 *     OWNER's data, and sees nothing of it in their own workspace.
 *  2. Attribution stays split: the record belongs to the workspace account,
 *     the audit row names the human who acted.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../../app.js';
import { teamMembers } from '../../db/schema/team-members.js';
import { WORKSPACE_HEADER } from '../../shared/middleware/workspace-context.js';
import {
  installTestAuth,
  signupVerifiedUser,
  uninstallTestAuth,
  type TestUser,
} from '../../shared/testing/auth.js';
import { clearCollections, startMemoryMongo, stopMemoryMongo } from '../../shared/testing/mongo.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import { DICTIONARIES } from '../../shared/i18n/index.js';
import { AuditLog } from '../audit/index.js';
import { setSitesDb } from '../sites/index.js';
import { setTeamDb } from './team.holder.js';
import { setResendTransport } from '../communication/index.js';
import { env } from '../../config/env.js';

const app = createApp();

let owner: TestUser;
let member: TestUser;
let memberRowId: string;

async function seedMembership(role: 'admin' | 'member'): Promise<void> {
  const rows = await getTestDb()
    .insert(teamMembers)
    .values({
      teamId: owner.id,
      userId: member.id,
      email: member.email,
      role,
      inviteTokenHash: 'a'.repeat(64),
      invitedBy: owner.id,
      acceptedAt: new Date('2026-07-01T00:00:00Z'),
      expiresAt: new Date('2099-01-01T00:00:00Z'),
    })
    .returning({ id: teamMembers.id });
  memberRowId = rows[0]!.id;
}

const asOwner = (path: string) => request(app).get(path).set('Cookie', owner.cookie);
const asMemberInWorkspace = (path: string) =>
  request(app).get(path).set('Cookie', member.cookie).set(WORKSPACE_HEADER, owner.id);

beforeAll(async () => {
  await startMemoryMongo();
  const db = await startTestPostgres();
  installTestAuth();
  setTeamDb(db as unknown as never);
  setSitesDb(db as unknown as never);
  (env as { RESEND_API_KEY?: string }).RESEND_API_KEY = 'team-test-key';
  (env as { RESEND_FROM?: string }).RESEND_FROM = 'team-test@example.com';
  setResendTransport(async () => ({ delivered: true }));
});

afterAll(async () => {
  uninstallTestAuth();
  setTeamDb(null);
  setSitesDb(null);
  setResendTransport(null);
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  setResendTransport(async () => ({ delivered: true }));
  owner = await signupVerifiedUser(app, { email: 'ws-owner@example.com' });
  member = await signupVerifiedUser(app, { email: 'ws-member@example.com' });
  await seedMembership('member');
});

async function ownerCreatesSite(url = 'https://owner-site.example'): Promise<string> {
  const res = await request(app)
    .post('/api/sites')
    .set('Cookie', owner.cookie)
    .send({ url });
  expect(res.status).toBe(201);
  return res.body.site.id as string;
}

describe('a member reads the owner workspace', () => {
  it("lists the owner's sites under the header and none of them without it", async () => {
    const siteId = await ownerCreatesSite();

    const shared = await asMemberInWorkspace('/api/sites');
    expect(shared.status).toBe(200);
    expect(shared.body.sites.map((s: { id: string }) => s.id)).toEqual([siteId]);

    // Same member, own workspace: the owner's site must not leak.
    const own = await request(app).get('/api/sites').set('Cookie', member.cookie);
    expect(own.status).toBe(200);
    expect(own.body.sites).toEqual([]);
  });

  it("reads a single owner-owned site by id under the header", async () => {
    const siteId = await ownerCreatesSite();
    expect((await asMemberInWorkspace(`/api/sites/${siteId}`)).status).toBe(200);
    // Without the header the same id is not theirs — 404, never 403.
    const own = await request(app).get(`/api/sites/${siteId}`).set('Cookie', member.cookie);
    expect(own.status).toBe(404);
  });

  it('stops reading the moment the membership is revoked', async () => {
    await ownerCreatesSite();
    expect((await asMemberInWorkspace('/api/sites')).status).toBe(200);

    await request(app)
      .delete(`/api/team/members/${memberRowId}`)
      .set('Cookie', owner.cookie);

    // No session surgery — the next request simply revalidates and fails.
    const after = await asMemberInWorkspace('/api/sites');
    expect(after.status).toBe(404);
  });

  it('is not found for a stranger who was never invited', async () => {
    const stranger = await signupVerifiedUser(app, { email: 'ws-stranger@example.com' });
    const res = await request(app)
      .get('/api/sites')
      .set('Cookie', stranger.cookie)
      .set(WORKSPACE_HEADER, owner.id);
    expect(res.status).toBe(404);
  });
});

describe('a member writes into the owner workspace', () => {
  it('does not let a member create a workspace site', async () => {
    const res = await request(app)
      .post('/api/sites')
      .set('Cookie', member.cookie)
      .set(WORKSPACE_HEADER, owner.id)
      .send({ url: 'https://member-created.example' });
    expect(res.status).toBe(404);
    expect(await AuditLog.find({ action: 'site.create' }).lean()).toEqual([]);
  });
});

describe('team management splits by role', () => {
  it('lets an admin member invite into the owner workspace', async () => {
    await getTestDb().delete(teamMembers);
    await seedMembership('admin');
    const res = await request(app)
      .post('/api/team/invite')
      .set('Cookie', member.cookie)
      .set(WORKSPACE_HEADER, owner.id)
      .send({ email: 'invited-by-admin@example.com' });
    expect(res.status).toBe(201);
    // The invite belongs to the workspace, so the owner sees the new row.
    const roster = await asOwner('/api/team');
    expect(roster.body.members.map((m: { email: string }) => m.email))
      .toContain('invited-by-admin@example.com');
  });

  it('does not let a plain member invite', async () => {
    const res = await request(app)
      .post('/api/team/invite')
      .set('Cookie', member.cookie)
      .set(WORKSPACE_HEADER, owner.id)
      .send({ email: 'nope@example.com' });
    expect(res.status).toBe(404);
  });

  it('does not let a plain member remove a peer', async () => {
    const peer = await signupVerifiedUser(app, { email: 'ws-peer@example.com' });
    const rows = await getTestDb()
      .insert(teamMembers)
      .values({
        teamId: owner.id,
        userId: peer.id,
        email: peer.email,
        role: 'member',
        inviteTokenHash: 'b'.repeat(64),
        invitedBy: owner.id,
        acceptedAt: new Date('2026-07-01T00:00:00Z'),
        expiresAt: new Date('2099-01-01T00:00:00Z'),
      })
      .returning({ id: teamMembers.id });

    const res = await request(app)
      .delete(`/api/team/members/${rows[0]!.id}`)
      .set('Cookie', member.cookie)
      .set(WORKSPACE_HEADER, owner.id);
    expect(res.status).toBe(404);
  });

  it('lets a plain member remove their OWN row — leaving is always allowed', async () => {
    const res = await request(app)
      .delete(`/api/team/members/${memberRowId}`)
      .set('Cookie', member.cookie)
      .set(WORKSPACE_HEADER, owner.id);
    expect(res.status).toBe(200);
    // Access is gone on the next request.
    expect((await asMemberInWorkspace('/api/sites')).status).toBe(404);
  });

  it('lets an admin member remove a peer', async () => {
    await getTestDb().delete(teamMembers);
    await seedMembership('admin');
    const peer = await signupVerifiedUser(app, { email: 'ws-peer2@example.com' });
    const rows = await getTestDb()
      .insert(teamMembers)
      .values({
        teamId: owner.id,
        userId: peer.id,
        email: peer.email,
        role: 'member',
        inviteTokenHash: 'c'.repeat(64),
        invitedBy: owner.id,
        acceptedAt: new Date('2026-07-01T00:00:00Z'),
        expiresAt: new Date('2099-01-01T00:00:00Z'),
      })
      .returning({ id: teamMembers.id });

    const res = await request(app)
      .delete(`/api/team/members/${rows[0]!.id}`)
      .set('Cookie', member.cookie)
      .set(WORKSPACE_HEADER, owner.id);
    expect(res.status).toBe(200);
  });
});

describe('PATCH /api/team/members/:id/role', () => {
  const patchRole = (cookie: string, id: string, role: string, workspace?: string) => {
    const req = request(app).patch(`/api/team/members/${id}/role`).set('Cookie', cookie);
    if (workspace) req.set(WORKSPACE_HEADER, workspace);
    return req.send({ role });
  };

  it('promotes a member to admin and demotes them back', async () => {
    const up = await patchRole(owner.cookie, memberRowId, 'admin');
    expect(up.status).toBe(200);
    expect(up.body.member.role).toBe('admin');
    expect(up.body.message).toBe(DICTIONARIES.en.team.roleChanged);
    // The new role is live on the very next request.
    const invited = await request(app)
      .post('/api/team/invite')
      .set('Cookie', member.cookie)
      .set(WORKSPACE_HEADER, owner.id)
      .send({ email: 'now-allowed@example.com' });
    expect(invited.status).not.toBe(404);

    const down = await patchRole(owner.cookie, memberRowId, 'member');
    expect(down.status).toBe(200);
    expect(down.body.member.role).toBe('member');
  });

  it('is an idempotent no-op when the role is unchanged', async () => {
    const first = await patchRole(owner.cookie, memberRowId, 'member');
    expect(first.status).toBe(200);
    expect(first.body.member.role).toBe('member');
  });

  it('refuses the owner row with a localized 400', async () => {
    const roster = await asOwner('/api/team');
    const ownerRow = roster.body.members.find((m: { role: string }) => m.role === 'owner');
    const res = await patchRole(owner.cookie, ownerRow.id, 'admin');
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe(DICTIONARIES.en.team.errors.cannotChangeOwnerRole);
  });

  it('refuses `owner` as a target role before loading the row', async () => {
    const res = await patchRole(owner.cookie, memberRowId, 'owner');
    expect(res.status).toBe(400);
  });

  it('is not found for an admin member — role changes are owner-only', async () => {
    await getTestDb().delete(teamMembers);
    await seedMembership('admin');
    const res = await patchRole(member.cookie, memberRowId, 'member', owner.id);
    expect(res.status).toBe(404);
  });

  it('is not found for a row in another workspace', async () => {
    const outsider = await signupVerifiedUser(app, { email: 'ws-outsider@example.com' });
    const rows = await getTestDb()
      .insert(teamMembers)
      .values({
        teamId: outsider.id,
        userId: outsider.id,
        email: outsider.email,
        role: 'member',
        inviteTokenHash: 'd'.repeat(64),
        invitedBy: outsider.id,
        acceptedAt: new Date('2026-07-01T00:00:00Z'),
        expiresAt: new Date('2099-01-01T00:00:00Z'),
      })
      .returning({ id: teamMembers.id });
    const res = await patchRole(owner.cookie, rows[0]!.id, 'admin');
    expect(res.status).toBe(404);
  });

  it('re-roles a pending invite so the role lands on acceptance', async () => {
    const invitee = await signupVerifiedUser(app, { email: 'pending-admin@example.com' });
    const invited = await request(app)
      .post('/api/team/invite')
      .set('Cookie', owner.cookie)
      .send({ email: invitee.email });
    expect(invited.status).toBe(201);
    const pendingId = invited.body.member.id as string;

    const promoted = await patchRole(owner.cookie, pendingId, 'admin');
    expect(promoted.status).toBe(200);
    expect(promoted.body.member).toMatchObject({ role: 'admin', status: 'pending' });

    const rows = await getTestDb()
      .select()
      .from(teamMembers)
      .where(eq(teamMembers.id, pendingId));
    expect(rows[0]!.role).toBe('admin');
    expect(rows[0]!.acceptedAt).toBeNull();
  });

  it('audits the role change against the human who made it', async () => {
    await patchRole(owner.cookie, memberRowId, 'admin');
    const entries = await AuditLog.find({ action: 'team.role_change' }).lean();
    expect(entries).toHaveLength(1);
    expect(String(entries[0]!.actorUserId)).toBe(owner.id);
    expect(entries[0]!.metadata).toMatchObject({ role: 'admin' });
  });
});

describe('PATCH /api/team/members/:id', () => {
  const patchAccess = (
    cookie: string,
    id: string,
    body: {
      role: 'admin' | 'member';
      siteAccess: { mode: 'all' } | { mode: 'selected'; siteIds: string[] };
    },
  ) => request(app).patch(`/api/team/members/${id}`).set('Cookie', cookie).send(body);

  it('atomically updates the role and selected-site grants, then clears them for all sites', async () => {
    const siteId = await ownerCreatesSite('https://selected-team-site.example');
    const selected = await patchAccess(owner.cookie, memberRowId, {
      role: 'admin',
      siteAccess: { mode: 'selected', siteIds: [siteId] },
    });
    expect(selected.status).toBe(200);
    expect(selected.body).toMatchObject({
      member: {
        id: memberRowId,
        role: 'admin',
        siteAccess: { mode: 'selected', siteIds: [siteId] },
      },
      message: DICTIONARIES.en.team.roleChanged,
    });
    expect(await AuditLog.find({ action: 'team.access_change' }).lean()).toHaveLength(1);
    const roster = await asOwner('/api/team');
    expect(roster.body.members.find((row: { id: string }) => row.id === memberRowId))
      .toMatchObject({ siteAccess: { mode: 'selected', siteIds: [siteId] } });
    const switcher = await request(app).get('/api/team/workspaces').set('Cookie', member.cookie);
    expect(switcher.body.workspaces.find(
      (workspace: { accountId: string }) => workspace.accountId === owner.id,
    )).toMatchObject({ siteAccess: { mode: 'selected', siteIds: [siteId] } });
    const sameRole = await request(app)
      .patch(`/api/team/members/${memberRowId}/role`)
      .set('Cookie', owner.cookie)
      .send({ role: 'admin' });
    expect(sameRole.body.member).toMatchObject({
      role: 'admin',
      siteAccess: { mode: 'selected', siteIds: [siteId] },
    });

    const all = await patchAccess(owner.cookie, memberRowId, {
      role: 'member',
      siteAccess: { mode: 'all' },
    });
    expect(all.status).toBe(200);
    expect(all.body.member).toMatchObject({
      role: 'member',
      siteAccess: { mode: 'all', siteIds: [] },
    });
  });

  it('returns 404 for missing, foreign, revoked, and unknown-site targets', async () => {
    const unknown = await patchAccess(
      owner.cookie,
      '00000000-0000-4000-8000-000000000001',
      { role: 'member', siteAccess: { mode: 'all' } },
    );
    expect(unknown.status).toBe(404);

    const outsider = await signupVerifiedUser(app, { email: 'access-outsider@example.com' });
    const [foreign] = await getTestDb().insert(teamMembers).values({
      teamId: outsider.id,
      userId: outsider.id,
      email: outsider.email,
      role: 'member',
      inviteTokenHash: 'e'.repeat(64),
      invitedBy: outsider.id,
      acceptedAt: new Date('2026-07-01T00:00:00Z'),
      expiresAt: new Date('2099-01-01T00:00:00Z'),
    }).returning({ id: teamMembers.id });
    expect((await patchAccess(owner.cookie, foreign!.id, {
      role: 'member',
      siteAccess: { mode: 'all' },
    })).status).toBe(404);

    await getTestDb().update(teamMembers).set({ revokedAt: new Date() })
      .where(eq(teamMembers.id, memberRowId));
    expect((await patchAccess(owner.cookie, memberRowId, {
      role: 'member',
      siteAccess: { mode: 'all' },
    })).status).toBe(404);

    expect((await patchAccess(owner.cookie, foreign!.id, {
      role: 'member',
      siteAccess: {
        mode: 'selected',
        siteIds: ['507f1f77bcf86cd799439099'],
      },
    })).status).toBe(404);
  });

  it('refuses the owner row and malformed access payloads', async () => {
    const roster = await asOwner('/api/team');
    const ownerRow = roster.body.members.find((row: { role: string }) => row.role === 'owner');
    expect((await patchAccess(owner.cookie, ownerRow.id as string, {
      role: 'admin',
      siteAccess: { mode: 'all' },
    })).status).toBe(400);
    expect((await request(app).patch(`/api/team/members/${memberRowId}`)
      .set('Cookie', owner.cookie)
      .send({ role: 'owner', siteAccess: { mode: 'all' } })).status).toBe(400);
  });
});

describe('POST /api/team/invite/:id/resend', () => {
  async function ownerInvites(email: string): Promise<{ id: string; token: string }> {
    const res = await request(app)
      .post('/api/team/invite')
      .set('Cookie', owner.cookie)
      .send({ email });
    expect(res.status).toBe(201);
    // The raw token is only reachable from the DB here because the invite
    // response does not expose it; resend is the endpoint that does.
    const rows = await getTestDb()
      .select()
      .from(teamMembers)
      .where(eq(teamMembers.id, res.body.member.id as string));
    return { id: res.body.member.id as string, token: rows[0]!.inviteTokenHash };
  }


  it('rotates the token so the previously emailed link dies', async () => {
    const invitee = await signupVerifiedUser(app, { email: 'resend-target@example.com' });
    const invited = await ownerInvites(invitee.email);

    const res = await request(app)
      .post(`/api/team/invite/${invited.id}/resend`)
      .set('Cookie', owner.cookie)
      .send();
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('inviteToken');
    expect(res.body.emailDelivered).toBe(true);
    expect(res.body.message).toBe(
      DICTIONARIES.en.team.inviteResent.replace('{{email}}', invitee.email),
    );

    const rows = await getTestDb()
      .select()
      .from(teamMembers)
      .where(eq(teamMembers.id, invited.id));
    expect(rows[0]!.inviteTokenHash).not.toBe(invited.token);

    // The invitation remains available through the actor-scoped inbox.
    const accepted = await request(app)
      .post(`/api/team/invitations/${invited.id}/accept`)
      .set('Cookie', invitee.cookie)
      .send();
    expect(accepted.status).toBe(200);
  });

  it('renews an expired pending invite — the reason the endpoint exists', async () => {
    const invitee = await signupVerifiedUser(app, { email: 'resend-expired@example.com' });
    const invited = await ownerInvites(invitee.email);
    await getTestDb()
      .update(teamMembers)
      .set({ expiresAt: new Date('2020-01-01T00:00:00Z') })
      .where(eq(teamMembers.id, invited.id));

    const res = await request(app)
      .post(`/api/team/invite/${invited.id}/resend`)
      .set('Cookie', owner.cookie)
      .send();
    expect(res.status).toBe(200);
    const accepted = await request(app)
      .post(`/api/team/invitations/${invited.id}/accept`)
      .set('Cookie', invitee.cookie)
      .send();
    expect(accepted.status).toBe(200);
  });

  it('refuses an already-accepted row', async () => {
    const res = await request(app)
      .post(`/api/team/invite/${memberRowId}/resend`)
      .set('Cookie', owner.cookie)
      .send();
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe(DICTIONARIES.en.team.errors.inviteUsed);
  });

  it('refuses a revoked row', async () => {
    const invitee = await signupVerifiedUser(app, { email: 'resend-revoked@example.com' });
    const invited = await ownerInvites(invitee.email);
    await request(app)
      .delete(`/api/team/members/${invited.id}`)
      .set('Cookie', owner.cookie);
    const res = await request(app)
      .post(`/api/team/invite/${invited.id}/resend`)
      .set('Cookie', owner.cookie)
      .send();
    expect(res.status).toBe(404);
  });

  it('is not found for a row in another workspace', async () => {
    const outsider = await signupVerifiedUser(app, { email: 'resend-outsider@example.com' });
    const rows = await getTestDb()
      .insert(teamMembers)
      .values({
        teamId: outsider.id,
        email: 'someone@example.com',
        role: 'member',
        inviteTokenHash: 'e'.repeat(64),
        invitedBy: outsider.id,
        expiresAt: new Date('2099-01-01T00:00:00Z'),
      })
      .returning({ id: teamMembers.id });
    const res = await request(app)
      .post(`/api/team/invite/${rows[0]!.id}/resend`)
      .set('Cookie', owner.cookie)
      .send();
    expect(res.status).toBe(404);
  });

  it('is not found for a plain member — resending issues a credential', async () => {
    const invitee = await signupVerifiedUser(app, { email: 'resend-guard@example.com' });
    const invited = await ownerInvites(invitee.email);
    const res = await request(app)
      .post(`/api/team/invite/${invited.id}/resend`)
      .set('Cookie', member.cookie)
      .set(WORKSPACE_HEADER, owner.id)
      .send();
    expect(res.status).toBe(404);
  });

  it('audits the resend against the human who made it', async () => {
    const invitee = await signupVerifiedUser(app, { email: 'resend-audit@example.com' });
    const invited = await ownerInvites(invitee.email);
    await request(app)
      .post(`/api/team/invite/${invited.id}/resend`)
      .set('Cookie', owner.cookie)
      .send();
    const entries = await AuditLog.find({ action: 'team.invite_resend' }).lean();
    expect(entries).toHaveLength(1);
    expect(String(entries[0]!.actorUserId)).toBe(owner.id);
  });

  it('never leaks a token or hash through the roster listing', async () => {
    const invitee = await signupVerifiedUser(app, { email: 'resend-noleak@example.com' });
    await ownerInvites(invitee.email);
    const roster = await asOwner('/api/team');
    expect(roster.status).toBe(200);
    const serialized = JSON.stringify(roster.body);
    expect(serialized).not.toMatch(/inviteToken|inviteTokenHash|tokenHash/iu);
    for (const row of roster.body.members) {
      expect(Object.keys(row).sort()).toEqual(
        ['acceptedAt', 'email', 'expiresAt', 'id', 'invitedAt', 'role', 'siteAccess', 'status', 'userId'].sort(),
      );
    }
  });
});

describe('GET /api/team — search and pagination', () => {
  beforeEach(async () => {
    // Three pending invites on top of the owner row and the seeded member.
    await getTestDb().insert(teamMembers).values(
      ['alpha@example.com', 'beta@example.com', 'gamma@example.com'].map((email, index) => ({
        teamId: owner.id,
        email,
        role: 'member' as const,
        inviteTokenHash: String(index).repeat(64).slice(0, 64),
        invitedBy: owner.id,
        invitedAt: new Date(`2026-07-0${index + 2}T00:00:00Z`),
        expiresAt: new Date('2099-01-01T00:00:00Z'),
      })),
    );
  });

  it('reports the roster total and defaults to page one', async () => {
    const res = await asOwner('/api/team');
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ total: 5, page: 1, pageSize: 25 });
    expect(res.body.members).toHaveLength(5);
  });

  it('pins the owner row first and orders the rest newest-invite-first', async () => {
    const res = await asOwner('/api/team');
    expect(res.body.members[0].role).toBe('owner');
    const rest = res.body.members.slice(1).map((m: { email: string }) => m.email);
    // `seedMembership` defaults `invitedAt` to now, so the seeded member is
    // the newest row and the three fixed-date invites follow in reverse date
    // order.
    expect(rest).toEqual([
      member.email,
      'gamma@example.com',
      'beta@example.com',
      'alpha@example.com',
    ]);
  });

  it('filters case-insensitively on a substring of the address', async () => {
    const res = await asOwner('/api/team?query=BET');
    expect(res.body.meta.total).toBe(1);
    expect(res.body.members.map((m: { email: string }) => m.email)).toEqual([
      'beta@example.com',
    ]);
  });

  it('treats LIKE metacharacters as literal text', async () => {
    // `%` would match everything if the pattern were not escaped.
    const res = await asOwner('/api/team?query=%25');
    expect(res.body.meta.total).toBe(0);
    expect(res.body.members).toEqual([]);
  });

  it('pages without changing the total', async () => {
    const first = await asOwner('/api/team?page=1&pageSize=2');
    expect(first.body.members).toHaveLength(2);
    expect(first.body.meta).toEqual({ total: 5, page: 1, pageSize: 2 });

    const second = await asOwner('/api/team?page=2&pageSize=2');
    expect(second.body.members).toHaveLength(2);
    expect(second.body.meta).toEqual({ total: 5, page: 2, pageSize: 2 });
    // Disjoint pages.
    const ids = new Set(first.body.members.map((m: { id: string }) => m.id));
    for (const row of second.body.members) expect(ids.has(row.id)).toBe(false);

  });

  it('returns an empty page past the end rather than an error', async () => {
    const res = await asOwner('/api/team?page=99&pageSize=2');
    expect(res.status).toBe(200);
    expect(res.body.members).toEqual([]);
    expect(res.body.meta.total).toBe(5);
  });

  it.each([
    ['page below one', '?page=0'],
    ['pageSize below one', '?pageSize=0'],
    ['pageSize above the ceiling', '?pageSize=101'],
  ])('rejects %s', async (_label, qs) => {
    expect((await asOwner(`/api/team${qs}`)).status).toBe(400);
  });

  it('is workspace-scoped — an admin member sees the OWNER roster', async () => {
    await getTestDb().delete(teamMembers).where(eq(teamMembers.id, memberRowId));
    await seedMembership('admin');
    const res = await asMemberInWorkspace('/api/team');
    expect(res.status).toBe(200);
    expect(res.body.members.map((m: { email: string }) => m.email)).toContain(owner.email);
  });
});

describe('GET /api/team/workspaces', () => {
  it('lists the caller own workspace first, then accepted memberships', async () => {
    const res = await request(app).get('/api/team/workspaces').set('Cookie', member.cookie);
    expect(res.status).toBe(200);
    expect(res.body.workspaces).toEqual([
      { accountId: member.id, label: member.email, role: 'owner', isOwn: true, siteAccess: { mode: 'all', siteIds: [] } },
      { accountId: owner.id, label: owner.email, role: 'member', isOwn: false, siteAccess: { mode: 'all', siteIds: [] } },
    ]);
  });

  it('reports the membership role', async () => {
    await getTestDb().delete(teamMembers).where(eq(teamMembers.id, memberRowId));
    await seedMembership('admin');
    const res = await request(app).get('/api/team/workspaces').set('Cookie', member.cookie);
    expect(res.body.workspaces[1]).toMatchObject({ role: 'admin', isOwn: false });
  });

  it('stays ACTOR-scoped under a workspace header, so switching cannot rewrite the switcher', async () => {
    const withHeader = await request(app)
      .get('/api/team/workspaces')
      .set('Cookie', member.cookie)
      .set(WORKSPACE_HEADER, owner.id);
    const without = await request(app)
      .get('/api/team/workspaces')
      .set('Cookie', member.cookie);
    expect(withHeader.status).toBe(200);
    expect(withHeader.body).toEqual(without.body);
  });

  it('omits a pending invite — nothing is openable until it is accepted', async () => {
    const invitee = await signupVerifiedUser(app, { email: 'ws-pending@example.com' });
    await getTestDb().insert(teamMembers).values({
      teamId: owner.id,
      userId: invitee.id,
      email: invitee.email,
      role: 'member',
      inviteTokenHash: 'f'.repeat(64),
      invitedBy: owner.id,
      expiresAt: new Date('2099-01-01T00:00:00Z'),
    });
    const res = await request(app).get('/api/team/workspaces').set('Cookie', invitee.cookie);
    expect(res.body.workspaces).toEqual([
      { accountId: invitee.id, label: invitee.email, role: 'owner', isOwn: true, siteAccess: { mode: 'all', siteIds: [] } },
    ]);
  });

  it('omits a revoked membership', async () => {
    await request(app)
      .delete(`/api/team/members/${memberRowId}`)
      .set('Cookie', owner.cookie);
    const res = await request(app).get('/api/team/workspaces').set('Cookie', member.cookie);
    expect(res.body.workspaces).toHaveLength(1);
    expect(res.body.workspaces[0].isOwn).toBe(true);
  });

  it('shows the owner only their own workspace when they belong to no other team', async () => {
    const res = await asOwner('/api/team/workspaces');
    expect(res.body.workspaces).toEqual([
      { accountId: owner.id, label: owner.email, role: 'owner', isOwn: true, siteAccess: { mode: 'all', siteIds: [] } },
    ]);
  });
});
