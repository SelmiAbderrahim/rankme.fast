import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../../app.js';
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
import {
  installTestAuth,
  loginTestUser,
  signupTestUser,
  signupVerifiedUser,
  uninstallTestAuth,
  type TestUser,
} from '../../shared/testing/auth.js';
import { teamMembers } from '../../db/schema/team-members.js';
import {
  teamMemberSiteGrants,
  teamProvisionedAccounts,
} from '../../db/schema/team-members.js';
import {
  account as authAccounts,
  session as authSessions,
  user as authUsers,
  verification,
} from '../../db/schema/auth.js';
import { accountDeletionTombstones } from '../../db/schema/index.js';
import { DICTIONARIES, translate } from '../../shared/i18n/index.js';
import { AuditLog } from '../audit/index.js';
import { User } from '../users/index.js';
import { logger } from '../../config/logger.js';
import { setTeamDb } from './team.holder.js';
import * as teamHolder from './team.holder.js';
import {
  acceptInvite,
  acceptInvitationById,
  cleanupExpiredInvitations,
  inviteMember,
  listTeam,
  removeMember,
  rejectInvitationById,
  rejectInvitationByToken,
  listPendingInvitations,
  previewInvitation,
  reconcileTeamInvitations,
  resendInvite,
  teamServiceTestables,
} from './team.service.js';
import { teamControllerTestables } from './team.controller.js';
import { env } from '../../config/env.js';
import { setResendTransport, type EmailMessage } from '../communication/index.js';
import { Site } from '../sites/index.js';
import { getAuth, provisionInvitationIdentity } from '../auth/index.js';

const envRecord = env as unknown as Record<string, string>;
const originalEmailTransport = env.EMAIL_TRANSPORT;

const app = createApp();

async function seedUser(email: string): Promise<TestUser> {
  return signupVerifiedUser(app, { email });
}

beforeAll(async () => {
  await startMemoryMongo();
  const db = await startTestPostgres();
  installTestAuth();
  setTeamDb(db as unknown as never);
  envRecord.RESEND_API_KEY = 'team-test-key';
  envRecord.RESEND_FROM = 'team-test@example.com';
  envRecord.EMAIL_TRANSPORT = 'resend';
  setResendTransport(async () => ({ delivered: true }));
});

afterAll(async () => {
  uninstallTestAuth();
  setResendTransport(null);
  envRecord.EMAIL_TRANSPORT = originalEmailTransport;
  setTeamDb(null);
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  vi.restoreAllMocks();
  envRecord.EMAIL_TRANSPORT = 'resend';
  setResendTransport(async () => ({ delivered: true }));
});

describe('auth gating', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const bare = await request(app).get('/api/team');
    expect(bare.status).toBe(401);
    const post = await request(app).post('/api/team/invite').send({ email: 'x@x.co' });
    expect(post.status).toBe(401);
  });
});

describe('GET /api/team', () => {
  it('returns the owner row and roster pagination facts', async () => {
    const owner = await seedUser('owner@example.com');
    const res = await request(app).get('/api/team').set('Cookie', owner.cookie);
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('seats');
    expect(res.body.meta).toEqual({ total: 1, page: 1, pageSize: 25 });
    expect(res.body.members).toHaveLength(1);
    expect(res.body.members[0]).toMatchObject({
      email: 'owner@example.com',
      role: 'owner',
      status: 'accepted',
    });
  });

});

describe('POST /api/team/invite', () => {
  it('creates a pending invite and lists it on the roster', async () => {
    const owner = await seedUser('pro-owner@example.com');
    const res = await request(app)
      .post('/api/team/invite')
      .set('Cookie', owner.cookie)
      .send({ email: 'friend@example.com' });
    expect(res.status).toBe(201);
    expect(res.body.member).toMatchObject({
      email: 'friend@example.com',
      status: 'pending',
      role: 'member',
    });
    expect(res.body.message).toBe(
      DICTIONARIES.en.team.invited.replace('{{email}}', 'friend@example.com'),
    );
    const auditRows = await AuditLog.find({ actorUserId: owner.id }).lean();
    expect(auditRows[0]?.action).toBe('team.invite');
    expect(auditRows[0]?.metadata ?? {}).toEqual({});
    expect(JSON.stringify(auditRows[0])).not.toContain('friend@example.com');

    const list = await request(app).get('/api/team').set('Cookie', owner.cookie);
    expect(list.body.meta.total).toBe(2);
  });

  it('falls back to the owner email when profile name is empty', async () => {
    const owner = await seedUser('empty-name@example.com');
    // Clear the profile so readInviterName's `joined.length > 0 ? … : doc.email`
    // takes the doc.email arm.
    await User.updateOne(
      { _id: owner.id },
      { $set: { 'profile.firstName': '', 'profile.lastName': '' } },
    );
    const res = await request(app)
      .post('/api/team/invite')
      .set('Cookie', owner.cookie)
      .send({ email: 'guest2@example.com' });
    expect(res.status).toBe(201);
  });

  it('uses the owner first+last name in the invite metadata when set', async () => {
    const owner = await seedUser('named-owner@example.com');
    await User.updateOne(
      { _id: owner.id },
      { $set: { 'profile.firstName': 'Grace', 'profile.lastName': 'Hopper' } },
    );
    const res = await request(app)
      .post('/api/team/invite')
      .set('Cookie', owner.cookie)
      .send({ email: 'guest@example.com' });
    expect(res.status).toBe(201);
    // No direct assertion on inviterName (it's in the email body only), but
    // this test drives the `joined.length > 0 ? joined : doc.email` branch.
  });

  it('normalizes email to lowercase', async () => {
    const owner = await seedUser('mix-owner@example.com');
    const res = await request(app)
      .post('/api/team/invite')
      .set('Cookie', owner.cookie)
      .send({ email: '  Friend@Example.COM  ' });
    expect(res.status).toBe(201);
    expect(res.body.member.email).toBe('friend@example.com');
  });

  it('pre-binds an existing identity while keeping the invite pending', async () => {
    const owner = await seedUser('bound-owner@example.com');
    const invitee = await seedUser('bound-invitee@example.com');

    const result = await inviteMember(owner.id, {
      email: '  BOUND-INVITEE@EXAMPLE.COM ',
      inviterName: 'Owner',
      locale: 'en',
    });

    expect(result.member).toMatchObject({
      email: 'bound-invitee@example.com',
      userId: null,
      status: 'pending',
      acceptedAt: null,
    });
    const [stored] = await getTestDb()
      .select()
      .from(teamMembers)
      .where(eq(teamMembers.id, result.member.id));
    expect(stored).toMatchObject({ userId: invitee.id, acceptedAt: null });
  });

  it('freezes an existing invitee preference and the inviter locale for an external invitee', async () => {
    const owner = await seedUser('locale-owner@example.com');
    const existing = await seedUser('locale-existing@example.com');
    await User.findByIdAndUpdate(existing.id, { language: 'ar' });
    const sent: EmailMessage[] = [];
    setResendTransport(async (message) => {
      sent.push(message);
      return { delivered: true };
    });

    await inviteMember(owner.id, {
      email: existing.email,
      inviterName: 'Owner',
      locale: 'de',
    });
    await inviteMember(owner.id, {
      email: 'locale-external@example.com',
      inviterName: 'Owner',
      locale: 'fr',
    });

    expect(sent[0]?.subject).toBe(translate('ar', 'email.teamInvite.subject', {
      teamName: owner.email,
    }));
    expect(sent[0]?.html).toContain('lang="ar"');
    expect(sent[0]?.text).toContain('/ar/team/accept/');
    expect(sent[1]?.subject).toBe(translate('fr', 'email.teamInvite.subject', {
      teamName: owner.email,
    }));
    expect(sent[1]?.text).toContain('/fr/team/accept/');
    expect(sent.every((message) => message.idempotencyKey?.startsWith('team-invite/')))
      .toBe(true);
  });

  it('rejects an invite when target-account deletion wins after identity lookup', async () => {
    const owner = await seedUser('race-owner@example.com');
    const invitee = await seedUser('race-invitee@example.com');

    const error = await inviteMember(
        owner.id,
        { email: invitee.email, inviterName: 'Owner', locale: 'en' },
        {
          afterIdentityLookup: async (userId, tx) => {
            expect(userId).toBe(invitee.id);
            // PGlite exposes one connection, so inject the tombstone into the
            // same transaction at the exact lookup -> insert seam. Production
            // installation uses the exclusive global handoff lock; the next
            // guarded INSERT must observe the winning tombstone either way.
            await tx.insert(accountDeletionTombstones).values({
              accountId: invitee.id,
              deletionStartedAt: new Date('2026-08-06T00:00:00Z'),
            });
          },
        },
      ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as { cause?: { message?: string } }).cause?.message).toMatch(
      /account deletion has started/,
    );
    expect(
      await getTestDb()
        .select()
        .from(teamMembers)
        .where(eq(teamMembers.email, invitee.email)),
    ).toEqual([]);
  });

  it('rejects invalid emails with a localized 400', async () => {
    const owner = await seedUser('valid-owner@example.com');
    const res = await request(app)
      .post('/api/team/invite')
      .set('Cookie', owner.cookie)
      .send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe(DICTIONARIES.en.errors.validationFailed);
  });

  it('concurrent duplicate-email invites yield one row and a 409', async () => {
    const owner = await seedUser('conc-dup@example.com');
    const [a, b] = await Promise.allSettled([
      inviteMember(owner.id, { email: 'dup-race@example.com', inviterName: 'Owner', locale: 'en' }),
      inviteMember(owner.id, { email: 'dup-race@example.com', inviterName: 'Owner', locale: 'en' }),
    ]);
    const fulfilled = [a, b].filter((r) => r.status === 'fulfilled');
    const rejected = [a, b].filter((r) => r.status === 'rejected') as Array<
      PromiseRejectedResult
    >;
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toMatchObject({
      status: 409,
      message: 'team.errors.alreadyInvited',
    });
  });

  it('a mail-delivery failure still creates the invite row and returns emailDelivered:false', async () => {
    const owner = await seedUser('mail-boom@example.com');
    // Poke the module-scoped mailer so it rejects — the invite row + token
    // must still land (Postgres row is committed BEFORE the mail attempt).
    const communication = await import('../communication/communication.service.js');
    const spy = vi
      .spyOn(communication, 'deliverTeamInviteEmail')
      .mockRejectedValue(new Error('smtp offline'));
    const logSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    try {
      const result = await inviteMember(owner.id, {
        email: 'mail-fail@example.com',
        inviterName: 'Owner',
        locale: 'en',
      });
      expect(result.emailDelivered).toBe(false);
      expect(result.inviteToken).toBeTruthy();
      // Row is present and pending, not revoked.
      const rows = await getTestDb()
        .select()
        .from(teamMembers)
        .where(eq(teamMembers.email, 'mail-fail@example.com'));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.revokedAt).toBeNull();
      expect(logSpy).toHaveBeenCalledWith(
        { teamId: owner.id },
        'team invite delivery outcome is unknown; invitation remains pending',
      );
      expect(JSON.stringify(logSpy.mock.calls)).not.toContain('mail-fail@example.com');
    } finally {
      logSpy.mockRestore();
      spy.mockRestore();
    }
  });

  it('rejects a duplicate pending invite (localized 409)', async () => {
    const owner = await seedUser('dup-owner@example.com');
    const first = await request(app)
      .post('/api/team/invite')
      .set('Cookie', owner.cookie)
      .send({ email: 'dup@example.com' });
    expect(first.status).toBe(201);
    const second = await request(app)
      .post('/api/team/invite')
      .set('Cookie', owner.cookie)
      .send({ email: 'dup@example.com' });
    expect(second.status).toBe(409);
    expect(second.body.error.message).toBe(DICTIONARIES.en.team.errors.alreadyInvited);
  });

  it('rejects inviting yourself with a localized 409', async () => {
    const owner = await seedUser('self@example.com');
    const res = await request(app)
      .post('/api/team/invite')
      .set('Cookie', owner.cookie)
      .send({ email: 'self@example.com' });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe(DICTIONARIES.en.team.errors.alreadyMember);
  });

  it('invite controller returns 401 when the owner Mongo mirror is missing (readInviterName)', async () => {
    const owner = await seedUser('bare-owner@example.com');
    // Wipe the Mongo mirror row so readInviterName sees null.
    await User.deleteOne({ _id: owner.id });
    const res = await request(app)
      .post('/api/team/invite')
      .set('Cookie', owner.cookie)
      .send({ email: 'x@example.com' });
    expect(res.status).toBe(401);
  });

  it('rethrows non-unique DB errors from the invite insert', async () => {
    const owner = await seedUser('rethrow@example.com');
    const boom = Object.assign(new Error('kaboom'), { code: '23503' });
    const realDb = teamHolder.getTeamDb();
    // The invite insert now runs inside db.transaction; wrap the tx handle
    // so its .insert() throws while the outer db (ensureOwnerRow) still works.
    const wrapped = new Proxy(realDb, {
      get(target, prop) {
        if (prop === 'transaction') {
          return async (cb: (tx: unknown) => Promise<unknown>) => {
            return target.transaction(async (tx) => {
              (tx as { insert: unknown }).insert = () => {
                throw boom;
              };
              return cb(tx);
            });
          };
        }
        return Reflect.get(target, prop);
      },
    });
    vi.spyOn(teamHolder, 'getTeamDb').mockReturnValue(wrapped as never);
    await expect(
      inviteMember(owner.id, {
        email: 'x@example.com',
        inviterName: 'Owner',
        locale: 'en',
      }),
    ).rejects.toBe(boom);
  });

  it('maps a wrapped unique insert race to the localized duplicate conflict', async () => {
    const owner = await seedUser('unique-race-owner@example.com');
    const unique = Object.assign(new Error('duplicate'), { code: '23505' });
    const realDb = teamHolder.getTeamDb();
    const wrapped = new Proxy(realDb, {
      get(target, prop) {
        if (prop === 'transaction') {
          return async (callback: (tx: unknown) => Promise<unknown>) =>
            target.transaction(async (tx) => {
              (tx as { insert: unknown }).insert = () => {
                throw unique;
              };
              return callback(tx);
            });
        }
        return Reflect.get(target, prop);
      },
    });
    vi.spyOn(teamHolder, 'getTeamDb').mockReturnValue(wrapped as never);
    await expect(inviteMember(owner.id, {
      email: 'unique-race-target@example.com',
      inviterName: 'Owner',
      locale: 'en',
    })).rejects.toMatchObject({ status: 409, message: 'team.errors.alreadyInvited' });
  });

  it('fails closed for deleting or incomplete provisional identity state', async () => {
    const owner = await seedUser('provisional-state-owner@example.com');
    const deleting = await seedUser('provisional-deleting@example.com');
    const missingCredential = await seedUser('provisional-missing-credential@example.com');
    await getTestDb().insert(teamProvisionedAccounts).values([
      {
        userId: deleting.id,
        email: deleting.email,
        status: 'deleting',
        mustChangePassword: true,
      },
      {
        userId: missingCredential.id,
        email: missingCredential.email,
        status: 'pending',
        mustChangePassword: true,
      },
    ]);
    await expect(inviteMember(owner.id, {
      email: deleting.email,
      inviterName: 'Owner',
      locale: 'en',
    })).rejects.toMatchObject({ status: 409, message: 'team.errors.inviteBeingCleaned' });
    await expect(inviteMember(owner.id, {
      email: missingCredential.email,
      inviterName: 'Owner',
      locale: 'en',
    })).rejects.toThrow(/credential is unavailable/u);
  });

  it('cleans a newly provisioned identity when a post-lookup barrier fails', async () => {
    const owner = await seedUser('lookup-barrier-owner@example.com');
    await expect(inviteMember(owner.id, {
      email: 'lookup-barrier-target@example.com',
      inviterName: 'Owner',
      locale: 'en',
    }, {
      afterIdentityLookup: async () => {
        throw new Error('deletion barrier won');
      },
    })).rejects.toThrow(/deletion barrier won/u);
    expect(await User.findOne({ email: 'lookup-barrier-target@example.com' }).lean()).toBeNull();
  });

  it('handles a signup race and a missing provisioning result without unbound invitations', async () => {
    const owner = await seedUser('provision-race-owner@example.com');
    await expect(inviteMember(owner.id, {
      email: 'provision-race-winner@example.com',
      inviterName: 'Owner',
      locale: 'en',
    }, {
      provisionIdentity: async (...args) => {
        await provisionInvitationIdentity(...args);
        throw new Error('simulated post-create unique race');
      },
    })).resolves.toMatchObject({
      member: { email: 'provision-race-winner@example.com', status: 'pending' },
    });
    await expect(inviteMember(owner.id, {
      email: 'missing-provision-result@example.com',
      inviterName: 'Owner',
      locale: 'en',
    }, {
      provisionIdentity: async () => undefined,
    })).rejects.toThrow(/identity was not resolved/u);
  });

  it('does not overwrite a terminal invite when definitive delivery rollback loses a race', async () => {
    const owner = await seedUser('delivery-race-owner@example.com');
    setResendTransport(async () => ({ delivered: false }));
    await expect(inviteMember(owner.id, {
      email: 'delivery-race-target@example.com',
      inviterName: 'Owner',
      locale: 'en',
    }, {
      afterDelivery: async (memberId, db) => {
        await db.update(teamMembers).set({ revokedAt: new Date() })
          .where(eq(teamMembers.id, memberId));
      },
    })).resolves.toMatchObject({ emailDelivered: false });
  });
});

describe('POST /api/team/accept/:token', () => {
  it('accepts a valid invite for the invited user', async () => {
    const owner = await seedUser('inv-owner@example.com');
    const invited = await seedUser('invitee@example.com');
    const invited2 = invited; // alias
    // Directly call the service so we have the token.
    const result = await inviteMember(owner.id, {
      email: 'invitee@example.com',
      inviterName: 'Owner',
      locale: 'en',
    });
    const res = await request(app)
      .post(`/api/team/accept/${result.inviteToken}`)
      .set('Cookie', invited2.cookie);
    expect(res.status).toBe(200);
    expect(res.body.member).toMatchObject({ email: 'invitee@example.com', status: 'accepted' });

    // Second acceptance is a use-again 400.
    const replay = await request(app)
      .post(`/api/team/accept/${result.inviteToken}`)
      .set('Cookie', invited2.cookie);
    expect(replay.status).toBe(400);
    expect(replay.body.error.message).toBe(DICTIONARIES.en.team.errors.inviteUsed);
  });

  it('returns 404 for an unknown token', async () => {
    const invited = await seedUser('unk@example.com');
    const res = await request(app)
      .post('/api/team/accept/deadbeefdeadbeefdeadbeefdeadbeef')
      .set('Cookie', invited.cookie);
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe(DICTIONARIES.en.team.errors.inviteNotFound);
  });

  it('returns 400 for an expired invite', async () => {
    const owner = await seedUser('exp-owner@example.com');
    const invited = await seedUser('exp-invitee@example.com');
    const result = await inviteMember(owner.id, {
      email: 'exp-invitee@example.com',
      inviterName: 'Owner',
      locale: 'en',
    });
    // Force expiry.
    const db = getTestDb();
    await db
      .update(teamMembers)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(teamMembers.id, result.member.id));
    const res = await request(app)
      .post(`/api/team/accept/${result.inviteToken}`)
      .set('Cookie', invited.cookie);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe(DICTIONARIES.en.team.errors.inviteExpired);
  });

  it('returns 404 when a different user tries to redeem the token', async () => {
    const owner = await seedUser('cross-owner@example.com');
    const invited = await seedUser('cross-invitee@example.com');
    void invited;
    const stranger = await seedUser('stranger@example.com');
    const result = await inviteMember(owner.id, {
      email: 'cross-invitee@example.com',
      inviterName: 'Owner',
      locale: 'en',
    });
    const res = await request(app)
      .post(`/api/team/accept/${result.inviteToken}`)
      .set('Cookie', stranger.cookie);
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe(DICTIONARIES.en.team.errors.inviteNotFound);
  });

  it('rejects invite already revoked (404)', async () => {
    const owner = await seedUser('rev-owner@example.com');
    const invited = await seedUser('rev-invitee@example.com');
    const result = await inviteMember(owner.id, {
      email: 'rev-invitee@example.com',
      inviterName: 'Owner',
      locale: 'en',
    });
    const db = getTestDb();
    await db
      .update(teamMembers)
      .set({ revokedAt: new Date() })
      .where(eq(teamMembers.id, result.member.id));
    const res = await request(app)
      .post(`/api/team/accept/${result.inviteToken}`)
      .set('Cookie', invited.cookie);
    expect(res.status).toBe(404);
  });
});

describe('scoped invitation decisions', () => {
  it('serves public previews and both rejection controller variants without exposing secrets', async () => {
    const owner = await seedUser('preview-owner@example.com');
    const invitee = await seedUser('preview-invitee@example.com');
    const tokenInvite = await inviteMember(owner.id, {
      email: 'preview-token@example.com',
      inviterName: 'Preview Owner',
      locale: 'en',
    });
    const preview = await request(app).get(
      `/api/team/invitations/preview/${tokenInvite.inviteToken}`,
    );
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ action: 'accept', requiresAuthentication: true });
    expect(JSON.stringify(preview.body)).not.toMatch(/token|password/iu);
    const rejectedByToken = await request(app).post(
      `/api/team/reject/${tokenInvite.rejectToken}`,
    );
    expect(rejectedByToken.status).toBe(200);
    expect(rejectedByToken.body.message).toBe(DICTIONARIES.en.team.rejected);

    const idInvite = await inviteMember(owner.id, {
      email: invitee.email,
      inviterName: 'Preview Owner',
      locale: 'en',
    });
    const rejectedById = await request(app)
      .post(`/api/team/invitations/${idInvite.member.id}/reject`)
      .set('Cookie', invitee.cookie);
    expect(rejectedById.status).toBe(200);
    expect(await AuditLog.find({ action: 'team.reject' }).lean()).toHaveLength(1);
  });

  it('renders selected-site invitation details and every inviter label fallback', async () => {
    const owner = await seedUser('detail-owner@example.com');
    const invitee = await seedUser('detail-invitee@example.com');
    await User.updateOne(
      { _id: owner.id },
      { $set: { 'profile.firstName': 'Ada', 'profile.lastName': 'Lovelace' } },
    );
    const site = await Site.create({
      accountId: owner.id,
      url: 'https://team-detail.example',
      domain: 'team-detail.example',
      displayName: 'Detail Site',
    });
    const siteId = String(site._id);
    const invited = await inviteMember(owner.id, {
      email: invitee.email,
      inviterName: 'Ada Lovelace',
      locale: 'en',
      siteAccess: { mode: 'selected', siteIds: [siteId] },
    });
    const inbox = await listPendingInvitations(invitee.id);
    expect(inbox[0]).toMatchObject({
      teamName: owner.email,
      inviterName: 'Ada Lovelace',
      sites: [{ id: siteId, label: 'Detail Site' }],
    });
    const preview = await previewInvitation(invited.inviteToken);
    expect(preview.invitation.sites).toEqual([{ id: siteId, label: 'Detail Site' }]);

    await Site.deleteOne({ _id: siteId });
    await User.deleteOne({ _id: owner.id });
    const fallback = await listPendingInvitations(invitee.id);
    expect(fallback[0]).toMatchObject({
      teamName: owner.id,
      sites: [{ id: siteId, label: siteId }],
    });
  });

  it('returns the same 404 for unknown, expired, accepted, and revoked previews or rejections', async () => {
    const owner = await seedUser('terminal-preview-owner@example.com');
    const invitee = await seedUser('terminal-preview-user@example.com');
    await expect(previewInvitation('unknown-preview-token')).rejects.toMatchObject({ status: 404 });
    await expect(rejectInvitationByToken('unknown-reject-token')).rejects.toMatchObject({
      status: 404,
    });

    const expired = await inviteMember(owner.id, {
      email: 'expired-preview@example.com',
      inviterName: 'Owner',
      locale: 'en',
    });
    await getTestDb().update(teamMembers).set({ expiresAt: new Date('2020-01-01T00:00:00Z') })
      .where(eq(teamMembers.id, expired.member.id));
    await expect(previewInvitation(expired.inviteToken)).rejects.toMatchObject({ status: 404 });
    await expect(rejectInvitationByToken(expired.rejectToken)).rejects.toMatchObject({ status: 404 });
    await expect(acceptInvitationById(invitee.id, expired.member.id)).rejects.toMatchObject({
      status: 404,
    });

    const accepted = await inviteMember(owner.id, {
      email: invitee.email,
      inviterName: 'Owner',
      locale: 'en',
    });
    await acceptInvite(invitee.id, accepted.inviteToken);
    await expect(previewInvitation(accepted.inviteToken)).rejects.toMatchObject({ status: 404 });
    await expect(rejectInvitationByToken(accepted.rejectToken)).rejects.toMatchObject({ status: 404 });

    const revoked = await inviteMember(owner.id, {
      email: 'revoked-preview@example.com',
      inviterName: 'Owner',
      locale: 'en',
    });
    await getTestDb().update(teamMembers).set({ revokedAt: new Date() })
      .where(eq(teamMembers.id, revoked.member.id));
    await expect(previewInvitation(revoked.inviteToken)).rejects.toMatchObject({ status: 404 });
  });

  it('does not expose tokens in the HTTP response and stores distinct hashed actions', async () => {
    const owner = await seedUser('secret-owner@example.com');
    const existing = await seedUser('secret-existing@example.com');
    const res = await request(app).post('/api/team/invite').set('Cookie', owner.cookie).send({
      email: existing.email,
      role: 'admin',
      siteAccess: { mode: 'all' },
    });
    expect(res.status).toBe(201);
    expect(JSON.stringify(res.body)).not.toMatch(/inviteToken|rejectToken|password/iu);
    const [stored] = await getTestDb().select().from(teamMembers)
      .where(eq(teamMembers.id, res.body.member.id as string));
    expect(stored?.inviteTokenHash).toMatch(/^[a-f\d]{64}$/u);
    expect(stored?.rejectTokenHash).toMatch(/^[a-f\d]{64}$/u);
    expect(stored?.rejectTokenHash).not.toBe(stored?.inviteTokenHash);
  });

  it('rolls back a provisional account on definitive credential-email failure', async () => {
    const owner = await seedUser('delivery-owner@example.com');
    setResendTransport(async () => ({ delivered: false }));
    const failed = await request(app).post('/api/team/invite').set('Cookie', owner.cookie).send({
      email: 'undeliverable-new@example.com',
      role: 'member',
      siteAccess: { mode: 'all' },
    });
    expect(failed.status).toBe(502);
    expect(await getTestDb().select().from(teamProvisionedAccounts)).toEqual([]);
    expect(await User.findOne({ email: 'undeliverable-new@example.com' }).lean()).toBeNull();
    expect(await getTestDb().select().from(teamMembers)
      .where(eq(teamMembers.email, 'undeliverable-new@example.com'))).toHaveLength(1);
    expect((await getTestDb().select().from(teamMembers)
      .where(eq(teamMembers.email, 'undeliverable-new@example.com')))[0]?.revokedAt)
      .not.toBeNull();
  });

  it('keeps an existing-user inbox invite when email delivery is definitively rejected', async () => {
    const owner = await seedUser('existing-delivery-owner@example.com');
    const existing = await seedUser('existing-delivery-user@example.com');
    setResendTransport(async () => ({ delivered: false }));
    const result = await request(app).post('/api/team/invite').set('Cookie', owner.cookie).send({
      email: existing.email,
      role: 'member',
      siteAccess: { mode: 'all' },
    });
    expect(result.status).toBe(201);
    expect(result.body.emailDelivered).toBe(false);
    expect(await listPendingInvitations(existing.id)).toHaveLength(1);
  });

  it('restores prior action tokens and keeps the stable password after a definitive resend failure', async () => {
    const owner = await seedUser('resend-restore-owner@example.com');
    const sent: EmailMessage[] = [];
    setResendTransport(async (message) => {
      sent.push(message);
      return { delivered: true };
    });
    const result = await inviteMember(owner.id, {
      email: 'resend-restore-new@example.com',
      inviterName: 'Owner',
      locale: 'en',
    });
    const password = /Temporary password: ([^\n]+)/u.exec(sent[0]!.text)?.[1];
    const [before] = await getTestDb().select().from(teamMembers)
      .where(eq(teamMembers.id, result.member.id));
    setResendTransport(async () => ({ delivered: false }));
    await expect(resendInvite(owner.id, result.member.id, {
      inviterName: 'Owner',
      locale: 'en',
      actorRole: 'owner',
      actorSiteAccess: { mode: 'all', siteIds: [] },
    })).rejects.toMatchObject({ status: 502 });
    const [after] = await getTestDb().select().from(teamMembers)
      .where(eq(teamMembers.id, result.member.id));
    expect(after).toMatchObject({
      inviteTokenHash: before!.inviteTokenHash,
      rejectTokenHash: before!.rejectTokenHash,
    });
    await expect(loginTestUser(app, result.member.email, password!)).resolves.not.toBe('');
  });

  it('freezes the request locale when a resend has no readable invitee profile', async () => {
    const owner = await seedUser('resend-locale-owner@example.com');
    const rows = await getTestDb().insert(teamMembers).values([
      {
        teamId: owner.id,
        userId: null,
        email: 'resend-unbound@example.com',
        role: 'member',
        siteAccessMode: 'all',
        inviteTokenHash: '1'.repeat(64),
        rejectTokenHash: '2'.repeat(64),
        invitedBy: owner.id,
        expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      },
      {
        teamId: owner.id,
        userId: '507f1f77bcf86cd799439011',
        email: 'resend-missing-profile@example.com',
        role: 'member',
        siteAccessMode: 'all',
        inviteTokenHash: '3'.repeat(64),
        rejectTokenHash: '4'.repeat(64),
        invitedBy: owner.id,
        expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      },
    ]).returning();
    const deliverInvite = vi.fn(async () => ({ delivered: true }));

    await resendInvite(owner.id, rows[0]!.id, {
      inviterName: 'Owner',
      locale: 'fr',
      actorRole: 'owner',
      actorSiteAccess: { mode: 'all', siteIds: [] },
    }, { deliverInvite });
    await resendInvite(owner.id, rows[1]!.id, {
      inviterName: 'Owner',
      locale: 'en',
      actorRole: 'owner',
      actorSiteAccess: { mode: 'all', siteIds: [] },
    }, { deliverInvite });

    expect(deliverInvite).toHaveBeenNthCalledWith(1, expect.objectContaining({
      locale: 'fr',
      acceptUrl: expect.stringContaining('/fr/team/accept/'),
      rejectUrl: expect.stringContaining('/fr/team/reject/'),
      signInUrl: expect.stringContaining('returnTo=%2Ffr%2Fteam%2Faccept%2F'),
    }));
    expect(deliverInvite).toHaveBeenNthCalledWith(2, expect.objectContaining({
      locale: 'en',
      acceptUrl: expect.not.stringContaining('/en/team/accept/'),
      signInUrl: expect.stringContaining('returnTo=%2Fteam%2Faccept%2F'),
    }));
  });

  it('keeps a rotated selected-site resend when delivery outcome is unknown', async () => {
    const owner = await seedUser('resend-unknown-owner@example.com');
    const invitee = await seedUser('resend-unknown-user@example.com');
    const site = await Site.create({
      accountId: owner.id,
      url: 'https://resend-selected.example',
      domain: 'resend-selected.example',
      displayName: 'Resend Site',
    });
    const siteId = String(site._id);
    const invited = await inviteMember(owner.id, {
      email: invitee.email,
      inviterName: 'Owner',
      locale: 'en',
      siteAccess: { mode: 'selected', siteIds: [siteId] },
    });
    setResendTransport(async () => {
      throw new Error('delivery outcome unknown');
    });
    await expect(resendInvite(owner.id, invited.member.id, {
      inviterName: 'Owner',
      locale: 'en',
      actorRole: 'owner',
      actorSiteAccess: { mode: 'all', siteIds: [] },
    }, {
      deliverInvite: async () => {
        throw new Error('delivery outcome unknown');
      },
    })).resolves.toMatchObject({
      member: { siteAccess: { mode: 'selected', siteIds: [siteId] } },
      emailDelivered: false,
      outcomeUnknown: true,
    });
  });

  it('does not rotate a token after acceptance wins inside the locked transaction', async () => {
    const owner = await seedUser('resend-race-owner@example.com');
    const invitee = await seedUser('resend-race-user@example.com');
    const invited = await inviteMember(owner.id, {
      email: invitee.email,
      inviterName: 'Owner',
      locale: 'en',
    });
    await expect(resendInvite(owner.id, invited.member.id, {
      inviterName: 'Owner',
      locale: 'en',
      actorRole: 'owner',
      actorSiteAccess: { mode: 'all', siteIds: [] },
    }, {
      beforeRotationUpdate: async (memberId, tx) => {
        await tx.update(teamMembers).set({ acceptedAt: new Date() })
          .where(eq(teamMembers.id, memberId));
      },
    })).rejects.toMatchObject({ status: 400 });
  });

  it('lists an existing user invitation and rejection preserves the account', async () => {
    const owner = await seedUser('inbox-owner@example.com');
    const existing = await seedUser('inbox-existing@example.com');
    const result = await inviteMember(owner.id, {
      email: existing.email,
      inviterName: 'Owner',
      locale: 'en',
      role: 'member',
      siteAccess: { mode: 'all' },
    });
    const inbox = await listPendingInvitations(existing.id);
    expect(inbox[0]).toMatchObject({ id: result.member.id, requiresPasswordChange: false });
    expect((await previewInvitation(result.rejectToken)).action).toBe('reject');
    await rejectInvitationById(existing.id, result.member.id);
    expect(await User.findById(existing.id).lean()).not.toBeNull();
  });

  it('rejecting the last provisional invitation removes its identity', async () => {
    const owner = await seedUser('new-owner@example.com');
    const result = await inviteMember(owner.id, {
      email: 'brand-new-invitee@example.com',
      inviterName: 'Owner',
      locale: 'en',
    });
    const [provisioning] = await getTestDb().select().from(teamProvisionedAccounts);
    expect(provisioning).toMatchObject({ status: 'pending', mustChangePassword: true });
    expect(await User.findById(provisioning!.userId).lean()).not.toBeNull();
    await getTestDb().insert(verification).values({
      id: 'provisional-reset-token',
      identifier: 'reset-password:opaque',
      value: provisioning!.userId,
      expiresAt: new Date('2099-01-01T00:00:00Z'),
    });
    await getTestDb().insert(verification).values({
      id: 'provisional-email-token',
      identifier: 'brand-new-invitee@example.com',
      value: 'opaque-email-verification-value',
      expiresAt: new Date('2099-01-01T00:00:00Z'),
    });
    await rejectInvitationByToken(result.rejectToken);
    expect(await User.findById(provisioning!.userId).lean()).toBeNull();
    expect(await getTestDb().select().from(teamProvisionedAccounts)).toEqual([]);
    expect(await getTestDb().select().from(authUsers)).toHaveLength(1);
    expect(await getTestDb().select().from(authAccounts)).toHaveLength(1);
    expect(await getTestDb().select().from(authSessions)).toHaveLength(1);
    expect(await getTestDb().select().from(verification)).toEqual([]);
  });

  it('provisions through Better Auth, forces password rotation, and stays restricted until acceptance', async () => {
    const owner = await seedUser('provision-owner@example.com');
    const sent: EmailMessage[] = [];
    setResendTransport(async (message) => {
      sent.push(message);
      return { delivered: true };
    });
    const invitedEmail = 'provisioned@example.com';
    const created = await request(app).post('/api/team/invite').set('Cookie', owner.cookie).send({
      email: invitedEmail,
      role: 'member',
      siteAccess: { mode: 'all' },
    });
    expect(created.status).toBe(201);
    const password = /Temporary password: ([^\n]+)/u.exec(sent[0]!.text)?.[1];
    expect(password).toMatch(/^[A-Za-z\d_-]{32}$/u);
    const [provisioning] = await getTestDb().select().from(teamProvisionedAccounts);
    const [identity] = await getTestDb().select().from(authUsers)
      .where(eq(authUsers.email, invitedEmail));
    expect(identity).toMatchObject({
      emailVerified: false,
      mustChangePassword: true,
      provisionalAccount: true,
    });
    expect(await User.findById(identity!.id).lean()).not.toBeNull();
    expect(await getTestDb().select().from(authSessions)
      .where(eq(authSessions.userId, identity!.id))).toEqual([]);
    const cookie = await loginTestUser(app, invitedEmail, password!);

    const blockedProduct = await request(app).get('/api/sites').set('Cookie', cookie);
    expect(blockedProduct.status).toBe(403);
    const blockedAuth = await request(app)
      .post('/api/auth/update-user')
      .set('Cookie', cookie)
      .set('Origin', env.CLIENT_URL)
      .send({ name: 'Not yet' });
    expect(blockedAuth.status).toBe(403);

    const blockedAcceptance = await request(app)
      .post(`/api/team/invitations/${created.body.member.id as string}/accept`)
      .set('Cookie', cookie);
    expect(blockedAcceptance.status).toBe(400);
    expect(blockedAcceptance.body.error.message).toBe(
      DICTIONARIES.en.team.errors.passwordChangeRequired,
    );

    const changed = await request(app)
      .post('/api/auth/change-password')
      .set('Cookie', cookie)
      .set('Origin', env.CLIENT_URL)
      .send({ currentPassword: password, newPassword: 'new-correct-horse-battery' });
    expect(changed.status).toBe(200);
    expect((await getTestDb().select().from(teamProvisionedAccounts)
      .where(eq(teamProvisionedAccounts.userId, identity!.id)))[0]).toMatchObject({
      status: 'pending',
      mustChangePassword: false,
    });
    const stillBlocked = await request(app)
      .post('/api/auth/update-user')
      .set('Cookie', cookie)
      .set('Origin', env.CLIENT_URL)
      .send({ name: 'Still not yet' });
    expect(stillBlocked.status).toBe(403);

    const accepted = await request(app)
      .post(`/api/team/invitations/${created.body.member.id as string}/accept`)
      .set('Cookie', cookie);
    expect(accepted.status).toBe(200);
    expect((await getTestDb().select().from(authUsers)
      .where(eq(authUsers.id, identity!.id)))[0]).toMatchObject({
      emailVerified: true,
      mustChangePassword: false,
      provisionalAccount: false,
    });
    expect(provisioning?.userId).toBe(identity!.id);
  });

  it('keeps a provisional identity until its final live invitation is rejected', async () => {
    const ownerA = await seedUser('multi-owner-a@example.com');
    const ownerB = await seedUser('multi-owner-b@example.com');
    const email = 'multi-provisional@example.com';
    const first = await inviteMember(ownerA.id, { email, inviterName: 'A', locale: 'en' });
    const second = await inviteMember(ownerB.id, { email, inviterName: 'B', locale: 'en' });
    const [provisioning] = await getTestDb().select().from(teamProvisionedAccounts);
    await rejectInvitationByToken(first.rejectToken);
    expect(await User.findById(provisioning!.userId).lean()).not.toBeNull();
    await rejectInvitationByToken(second.rejectToken);
    expect(await User.findById(provisioning!.userId).lean()).toBeNull();
  });

  it('serializes same-address provisioning and includes credentials in both cross-team emails', async () => {
    const ownerA = await seedUser('parallel-owner-a@example.com');
    const ownerB = await seedUser('parallel-owner-b@example.com');
    const messages: EmailMessage[] = [];
    setResendTransport(async (message) => {
      messages.push(message);
      return { delivered: true };
    });
    const email = 'parallel-provisional@example.com';
    const results = await Promise.all([
      inviteMember(ownerA.id, { email, inviterName: 'A', locale: 'en' }),
      inviteMember(ownerB.id, { email, inviterName: 'B', locale: 'en' }),
    ]);
    expect(results).toHaveLength(2);
    expect(messages).toHaveLength(2);
    expect(messages.every((message) => /Temporary password: [^\n]+/u.test(message.text)))
      .toBe(true);
    const passwords = messages.map(
      (message) => /Temporary password: ([^\n]+)/u.exec(message.text)?.[1],
    );
    expect(new Set(passwords).size).toBe(1);
    await expect(loginTestUser(app, email, passwords[0]!)).resolves.not.toBe('');
    expect(await getTestDb().select().from(teamProvisionedAccounts)).toHaveLength(1);
    expect((await getTestDb().select().from(teamMembers)
      .where(eq(teamMembers.email, email))).filter((row) => !row.revokedAt)).toHaveLength(2);
  });

  it('does not let an ordinary unverified signup consume an invitation for its address', async () => {
    const owner = await seedUser('unverified-owner@example.com');
    const unverified = await signupTestUser(app, { email: 'unverified-target@example.com' });
    const invitation = await inviteMember(owner.id, {
      email: unverified.email,
      inviterName: 'Owner',
      locale: 'en',
    });
    const inbox = await request(app).get('/api/team/invitations')
      .set('Cookie', unverified.cookie);
    expect(inbox.status).toBe(403);
    expect(inbox.body.error.details).toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
    expect((await request(app).post(`/api/team/accept/${invitation.inviteToken}`)
      .set('Cookie', unverified.cookie)).status).toBe(403);
    expect((await request(app)
      .post(`/api/team/invitations/${invitation.member.id}/accept`)
      .set('Cookie', unverified.cookie)).status).toBe(403);
    expect((await request(app)
      .post(`/api/team/invitations/${invitation.member.id}/reject`)
      .set('Cookie', unverified.cookie)).status).toBe(403);
  });

  it('rejects a duplicate invitation after the existing user already accepted', async () => {
    const owner = await seedUser('accepted-duplicate-owner@example.com');
    const existing = await seedUser('accepted-duplicate-user@example.com');
    const first = await inviteMember(owner.id, {
      email: existing.email,
      inviterName: 'Owner',
      locale: 'en',
    });
    await acceptInvite(existing.id, first.inviteToken);
    await expect(inviteMember(owner.id, {
      email: existing.email,
      inviterName: 'Owner',
      locale: 'en',
    })).rejects.toMatchObject({ status: 409, message: 'team.errors.alreadyMember' });
  });

  it('bounds admin resend and removal to member targets within the admin site scope', async () => {
    const owner = await seedUser('managed-scope-owner@example.com');
    const admin = await seedUser('managed-scope-admin@example.com');
    const otherAdmin = await seedUser('managed-scope-other-admin@example.com');
    const target = await seedUser('managed-scope-target@example.com');
    const allowedSite = '507f1f77bcf86cd799439021';
    const deniedSite = '507f1f77bcf86cd799439022';
    const [targetRow] = await getTestDb().insert(teamMembers).values({
      teamId: owner.id,
      userId: target.id,
      email: target.email,
      role: 'member',
      siteAccessMode: 'selected',
      inviteTokenHash: '7'.repeat(64),
      invitedBy: owner.id,
      acceptedAt: new Date(),
      expiresAt: new Date('2099-01-01T00:00:00Z'),
    }).returning();
    await getTestDb().insert(teamMemberSiteGrants).values({
      teamMemberId: targetRow!.id,
      siteId: deniedSite,
    });
    const selectedAdmin = {
      workspaceAccountId: owner.id,
      actorUserId: admin.id,
      teamRole: 'admin' as const,
      teamSiteAccess: { mode: 'selected' as const, siteIds: [allowedSite] },
    };
    await expect(removeMember(selectedAdmin, targetRow!.id))
      .rejects.toMatchObject({ status: 404 });
    const [adminTarget] = await getTestDb().insert(teamMembers).values({
      teamId: owner.id,
      userId: otherAdmin.id,
      email: otherAdmin.email,
      role: 'admin',
      siteAccessMode: 'selected',
      inviteTokenHash: '8'.repeat(64),
      invitedBy: owner.id,
      acceptedAt: new Date(),
      expiresAt: new Date('2099-01-01T00:00:00Z'),
    }).returning();
    await getTestDb().insert(teamMemberSiteGrants).values({
      teamMemberId: adminTarget!.id,
      siteId: allowedSite,
    });
    await expect(removeMember(selectedAdmin, adminTarget!.id))
      .rejects.toMatchObject({ status: 404 });

    const allSitesInvite = await inviteMember(owner.id, {
      email: 'managed-scope-pending@example.com',
      inviterName: 'Owner',
      locale: 'en',
      siteAccess: { mode: 'all' },
    });
    await expect(resendInvite(owner.id, allSitesInvite.member.id, {
      inviterName: 'Admin',
      locale: 'en',
      actorRole: 'admin',
      actorSiteAccess: { mode: 'selected', siteIds: [allowedSite] },
    })).rejects.toMatchObject({ status: 404 });
  });

  it('persists selected role/site grants and bounds delegated admins', async () => {
    const owner = await seedUser('scope-owner@example.com');
    const siteA = '507f1f77bcf86cd799439011';
    const siteB = '507f1f77bcf86cd799439012';
    const result = await inviteMember(owner.id, {
      email: 'scoped-existing@example.com',
      inviterName: 'Owner',
      locale: 'en',
      role: 'admin',
      siteAccess: { mode: 'selected', siteIds: [siteA, siteB] },
    }, {
      validateSiteAccess: async () => [
        { id: siteA, label: 'Site A' },
        { id: siteB, label: 'Site B' },
      ],
    });
    expect(result.member).toMatchObject({
      role: 'admin',
      siteAccess: { mode: 'selected', siteIds: [siteA, siteB] },
    });
    expect(await getTestDb().select().from(teamMemberSiteGrants)).toHaveLength(2);
    await expect(inviteMember(owner.id, {
      email: 'escalation@example.com',
      inviterName: 'Admin',
      locale: 'en',
      role: 'admin',
      siteAccess: { mode: 'selected', siteIds: [siteA] },
      actorRole: 'admin',
      actorSiteAccess: { mode: 'selected', siteIds: [siteA] },
    })).rejects.toMatchObject({ status: 404 });
    await expect(inviteMember(owner.id, {
      email: 'outside-scope@example.com',
      inviterName: 'Admin',
      locale: 'en',
      role: 'member',
      siteAccess: { mode: 'selected', siteIds: [siteB] },
      actorRole: 'admin',
      actorSiteAccess: { mode: 'selected', siteIds: [siteA] },
    })).rejects.toMatchObject({ status: 404 });
  });

  it('reject and accept are serialized so only one terminal decision wins', async () => {
    const owner = await seedUser('decision-owner@example.com');
    const existing = await seedUser('decision-user@example.com');
    const result = await inviteMember(owner.id, {
      email: existing.email,
      inviterName: 'Owner',
      locale: 'en',
    });
    const outcomes = await Promise.allSettled([
      acceptInvite(existing.id, result.inviteToken),
      rejectInvitationByToken(result.rejectToken),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
  });

  it('retries a failed cross-store provisional cleanup', async () => {
    const owner = await seedUser('cleanup-owner@example.com');
    const result = await inviteMember(owner.id, {
      email: 'cleanup-provisional@example.com',
      inviterName: 'Owner',
      locale: 'en',
    });
    const [provisioning] = await getTestDb().select().from(teamProvisionedAccounts);
    const deleteSpy = vi.spyOn(User, 'deleteOne').mockRejectedValueOnce(new Error('mongo unavailable'));
    await expect(rejectInvitationByToken(result.rejectToken)).rejects.toThrow('mongo unavailable');
    expect((await getTestDb().select().from(teamProvisionedAccounts))[0]?.status).toBe('deleting');
    const reconciled = await reconcileTeamInvitations();
    expect(reconciled).toMatchObject({
      provisionalDeletesRetried: 1,
      provisionalDeletesFailed: 0,
    });
    expect(await User.findById(provisioning!.userId).lean()).toBeNull();
    deleteSpy.mockRestore();
  });

  it('reports both bounded reconciliation failure counters without losing durable markers', async () => {
    const owner = await seedUser('reconcile-failure-owner@example.com');
    const claimed = await seedUser('reconcile-claimed@example.com');
    const pending = await inviteMember(owner.id, {
      email: 'reconcile-delete@example.com',
      inviterName: 'Owner',
      locale: 'en',
    });
    const deleteSpy = vi.spyOn(User, 'deleteOne').mockRejectedValue(
      new Error('mongo remains unavailable'),
    );
    await expect(rejectInvitationByToken(pending.rejectToken)).rejects.toThrow(
      /mongo remains unavailable/u,
    );
    await getTestDb().insert(teamProvisionedAccounts).values({
      userId: claimed.id,
      email: claimed.email,
      status: 'claimed',
      mustChangePassword: false,
    });
    const authContext = await getAuth().$context;
    const claimSpy = vi.spyOn(authContext.internalAdapter, 'updateUser')
      .mockRejectedValue(new Error('auth projection unavailable'));
    const result = await reconcileTeamInvitations(0);
    expect(result).toMatchObject({
      provisionalDeletesRetried: 0,
      provisionalDeletesFailed: 1,
      claimProjectionsRetried: 0,
      claimProjectionsFailed: 1,
    });
    claimSpy.mockRestore();
    deleteSpy.mockRestore();
    const repaired = await reconcileTeamInvitations(1);
    expect(repaired).toMatchObject({
      provisionalDeletesRetried: 1,
      provisionalDeletesFailed: 0,
      claimProjectionsRetried: 1,
      claimProjectionsFailed: 0,
    });
  });

  it('bounds empty expiry cleanup batches and leaves terminal candidates unchanged', async () => {
    expect(await cleanupExpiredInvitations(999)).toBe(0);
    expect(await cleanupExpiredInvitations(-1)).toBe(0);
  });

  it('makes expiry cleanup harmless when deletion or revocation wins either race window', async () => {
    const owner = await seedUser('expiry-race-owner@example.com');
    const deleted = await inviteMember(owner.id, {
      email: 'expiry-race-deleted@example.com',
      inviterName: 'Owner',
      locale: 'en',
    });
    await getTestDb().update(teamMembers).set({ expiresAt: new Date(0) })
      .where(eq(teamMembers.id, deleted.member.id));
    await expect(cleanupExpiredInvitations(1, {
      beforeCandidateLock: async (memberId, db) => {
        await db.delete(teamMembers).where(eq(teamMembers.id, memberId));
      },
    })).resolves.toBe(0);

    const revoked = await inviteMember(owner.id, {
      email: 'expiry-race-revoked@example.com',
      inviterName: 'Owner',
      locale: 'en',
    });
    await getTestDb().update(teamMembers).set({ expiresAt: new Date(0) })
      .where(eq(teamMembers.id, revoked.member.id));
    await expect(cleanupExpiredInvitations(1, {
      afterCandidateLock: async (memberId, tx) => {
        await tx.update(teamMembers).set({ revokedAt: new Date() })
          .where(eq(teamMembers.id, memberId));
      },
    })).resolves.toBe(0);
  });

  it('expires an invitation and removes its grants and orphaned provisional identity', async () => {
    const owner = await seedUser('expiry-owner@example.com');
    const siteId = '507f1f77bcf86cd799439011';
    const result = await inviteMember(owner.id, {
      email: 'expiry-provisional@example.com',
      inviterName: 'Owner',
      locale: 'en',
      siteAccess: { mode: 'selected', siteIds: [siteId] },
    }, { validateSiteAccess: async () => [{ id: siteId, label: 'Site' }] });
    const [provisioning] = await getTestDb().select().from(teamProvisionedAccounts);
    await getTestDb().update(teamMembers).set({ expiresAt: new Date('2020-01-01T00:00:00Z') })
      .where(eq(teamMembers.id, result.member.id));
    const reconciled = await reconcileTeamInvitations();
    expect(reconciled.expiredRevoked).toBe(1);
    expect(await getTestDb().select().from(teamMemberSiteGrants)).toEqual([]);
    expect(await User.findById(provisioning!.userId).lean()).toBeNull();
  });
});

describe('DELETE /api/team/members/:id', () => {
  it('owner removes a pending invite; the roster shrinks', async () => {
    const owner = await seedUser('rem-owner@example.com');
    const invite = await request(app)
      .post('/api/team/invite')
      .set('Cookie', owner.cookie)
      .send({ email: 'target@example.com' });
    expect(invite.status).toBe(201);
    const memberId = invite.body.member.id as string;

    const del = await request(app)
      .delete(`/api/team/members/${memberId}`)
      .set('Cookie', owner.cookie);
    expect(del.status).toBe(200);
    expect(del.body.message).toBe(DICTIONARIES.en.team.removed);

    const list = await request(app).get('/api/team').set('Cookie', owner.cookie);
    expect(list.body.meta.total).toBe(1);
  });

  it('member removing themselves is allowed (leave)', async () => {
    const owner = await seedUser('leave-owner@example.com');
    const invited = await seedUser('leaver@example.com');
    const result = await inviteMember(owner.id, {
      email: 'leaver@example.com',
      inviterName: 'Owner',
      locale: 'en',
    });
    // Accept as invited so userId is bound.
    await acceptInvite(invited.id, result.inviteToken);
    const del = await request(app)
      .delete(`/api/team/members/${result.member.id}`)
      .set('Cookie', invited.cookie);
    expect(del.status).toBe(200);
  });

  it('cross-account removal returns 404 (no leak)', async () => {
    const owner = await seedUser('own-a@example.com');
    const other = await seedUser('own-b@example.com');
    const invite = await request(app)
      .post('/api/team/invite')
      .set('Cookie', owner.cookie)
      .send({ email: 'friend@example.com' });
    const memberId = invite.body.member.id as string;
    const del = await request(app)
      .delete(`/api/team/members/${memberId}`)
      .set('Cookie', other.cookie);
    expect(del.status).toBe(404);
  });

  it('cannot remove the team owner', async () => {
    const owner = await seedUser('owner-safe@example.com');
    const list = await listTeam(owner.id);
    const ownerRow = list.members.find((m) => m.role === 'owner');
    expect(ownerRow).toBeDefined();
    await expect(
      removeMember(
        {
          workspaceAccountId: owner.id,
          actorUserId: owner.id,
          teamRole: 'owner',
          teamSiteAccess: { mode: 'all', siteIds: [] },
        },
        ownerRow!.id,
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: 'team.errors.cannotRemoveOwner',
    });
  });

  it('unknown member id → 404', async () => {
    const owner = await seedUser('nf@example.com');
    const res = await request(app)
      .delete('/api/team/members/00000000-0000-0000-0000-000000000000')
      .set('Cookie', owner.cookie);
    expect(res.status).toBe(404);
  });

  it('malformed uuid → 400 validation', async () => {
    const owner = await seedUser('mal@example.com');
    const res = await request(app)
      .delete('/api/team/members/not-a-uuid')
      .set('Cookie', owner.cookie);
    expect(res.status).toBe(400);
  });

  it('an already-revoked row cannot be revoked twice', async () => {
    const owner = await seedUser('twice@example.com');
    const invite = await request(app)
      .post('/api/team/invite')
      .set('Cookie', owner.cookie)
      .send({ email: 't@example.com' });
    const memberId = invite.body.member.id as string;
    await request(app)
      .delete(`/api/team/members/${memberId}`)
      .set('Cookie', owner.cookie);
    const second = await request(app)
      .delete(`/api/team/members/${memberId}`)
      .set('Cookie', owner.cookie);
    expect(second.status).toBe(404);
  });
});

describe('service helpers — coverage of defensive branches', () => {
  it('covers pure request-context, identity, label, expiry, and delegation invariants', async () => {
    expect(teamControllerTestables.teamContextFrom({})).toEqual({
      actorRole: 'owner',
      actorSiteAccess: { mode: 'all', siteIds: [] },
    });
    expect(teamControllerTestables.teamContextFrom({
      teamRole: 'admin',
      teamSiteAccessMode: 'selected',
      teamSiteIds: new Set(['site-b', 'site-a']),
    })).toEqual({
      actorRole: 'admin',
      actorSiteAccess: { mode: 'selected', siteIds: ['site-b', 'site-a'] },
    });

    expect(teamServiceTestables.requiredValue(0, new Error('missing'))).toBe(0);
    expect(() => teamServiceTestables.requiredValue(null, new Error('missing')))
      .toThrow(/missing/u);
    expect(teamServiceTestables.hasSelectedSiteAccess({ siteAccessMode: 'selected' })).toBe(true);
    expect(teamServiceTestables.hasSelectedSiteAccess({ siteAccessMode: 'all' })).toBe(false);
    expect(teamServiceTestables.displayLabel({ displayName: 'Name', domain: 'domain.test' }))
      .toBe('Name');
    expect(teamServiceTestables.displayLabel({ displayName: '', domain: 'domain.test' }))
      .toBe('domain.test');
    expect(teamServiceTestables.ownerLabel({ email: 'owner@example.com' }, 'owner-id'))
      .toBe('owner@example.com');
    expect(teamServiceTestables.ownerLabel(null, 'owner-id')).toBe('owner-id');
    const labels = new Map([['site-a', 'Site A']]);
    expect(teamServiceTestables.mappedLabel(labels, 'site-a')).toBe('Site A');
    expect(teamServiceTestables.mappedLabel(labels, 'site-b')).toBe('site-b');
    expect(teamServiceTestables.siteIdsForAccess('all', ['site-b'])).toEqual([]);
    expect(teamServiceTestables.siteIdsForAccess('selected', ['site-b', 'site-a']))
      .toEqual(['site-a', 'site-b']);
    expect(teamServiceTestables.siteIdsForAccess('selected', undefined)).toEqual([]);
    expect(teamServiceTestables.escapeLikePattern('a_b%\\c')).toBe('a\\_b\\%\\\\c');
    expect(teamServiceTestables.hashToken('stable')).toMatch(/^[a-f\d]{64}$/u);

    const expired = { acceptedAt: null, revokedAt: null, expiresAt: new Date(0) };
    expect(teamServiceTestables.canExpireInvitation(expired, new Date(1))).toBe(true);
    expect(teamServiceTestables.canExpireInvitation(null, new Date(1))).toBe(false);
    expect(teamServiceTestables.canExpireInvitation(
      { ...expired, acceptedAt: new Date(0) },
      new Date(1),
    )).toBe(false);
    expect(teamServiceTestables.canExpireInvitation(
      { ...expired, revokedAt: new Date(0) },
      new Date(1),
    )).toBe(false);
    expect(teamServiceTestables.canExpireInvitation(
      { ...expired, expiresAt: new Date(2) },
      new Date(1),
    )).toBe(false);

    expect(() => teamServiceTestables.assertDelegatedAccess(
      'admin',
      { mode: 'all' },
      'owner',
      { mode: 'all', siteIds: [] },
    )).not.toThrow();
    expect(() => teamServiceTestables.assertDelegatedAccess(
      'member',
      { mode: 'all' },
      'member',
      { mode: 'all', siteIds: [] },
    )).toThrow(/memberNotFound/u);
    expect(() => teamServiceTestables.assertDelegatedAccess(
      'member',
      { mode: 'all' },
      'admin',
      { mode: 'selected', siteIds: ['site-a'] },
    )).toThrow(/siteNotFound/u);
    expect(() => teamServiceTestables.assertDelegatedAccess(
      'member',
      { mode: 'all' },
      'admin',
      { mode: 'all', siteIds: [] },
    )).not.toThrow();
    expect(() => teamServiceTestables.assertDelegatedAccess(
      'member',
      { mode: 'selected', siteIds: ['site-a'] },
      'admin',
      { mode: 'all', siteIds: [] },
    )).not.toThrow();
    expect(() => teamServiceTestables.assertDelegatedAccess(
      'member',
      { mode: 'selected', siteIds: ['site-a'] },
      'admin',
      { mode: 'selected', siteIds: ['site-a'] },
    )).not.toThrow();
    expect(() => teamServiceTestables.assertDelegatedAccess(
      'member',
      { mode: 'selected', siteIds: ['site-b'] },
      'admin',
      { mode: 'selected', siteIds: ['site-a'] },
    )).toThrow(/siteNotFound/u);
    expect(teamServiceTestables.invitationLookupCondition({ kind: 'id', id: 'member-id' }))
      .toBeDefined();
    expect(teamServiceTestables.invitationLookupCondition({ kind: 'token', hash: 'hash' }))
      .toBeDefined();
    await expect(teamServiceTestables.provisionalState(teamHolder.getTeamDb(), null))
      .resolves.toBeNull();
    await expect(teamServiceTestables.cleanupProvisionedIfOrphaned(
      teamHolder.getTeamDb(),
      null,
    ))
      .resolves.toBeUndefined();
    await expect(listPendingInvitations('missing-identity')).rejects.toMatchObject({
      status: 401,
    });
  });

  it('covers selected-scope management and non-pending orphan cleanup decisions', async () => {
    const owner = await seedUser('helper-owner@example.com');
    const target = await seedUser('helper-target@example.com');
    const claimed = await seedUser('helper-claimed@example.com');
    const [row] = await getTestDb().insert(teamMembers).values({
      teamId: owner.id,
      userId: target.id,
      email: target.email,
      role: 'member',
      siteAccessMode: 'selected',
      inviteTokenHash: 'f'.repeat(64),
      invitedBy: owner.id,
      acceptedAt: new Date(),
      expiresAt: new Date('2099-01-01T00:00:00Z'),
    }).returning();
    await getTestDb().insert(teamMemberSiteGrants).values({
      teamMemberId: row!.id,
      siteId: 'site-a',
    });
    await expect(teamServiceTestables.assertCanManageTarget(
      teamHolder.getTeamDb(),
      row!,
      'admin',
      { mode: 'selected', siteIds: ['site-a'] },
    )).resolves.toBeUndefined();

    await getTestDb().insert(teamProvisionedAccounts).values({
      userId: claimed.id,
      email: claimed.email,
      status: 'claimed',
      mustChangePassword: false,
    });
    await expect(teamServiceTestables.cleanupProvisionedIfOrphaned(
      teamHolder.getTeamDb(),
      claimed.id,
    )).resolves.toBeUndefined();
  });

  it('listTeam throws unauthorized when owner user is missing', async () => {
    await expect(listTeam('507f1f77bcf86cd799439011')).rejects.toMatchObject({
      status: 401,
    });
  });

  it('getTeamDb throws before configured', async () => {
    setTeamDb(null);
    expect(() => teamHolder.getTeamDb()).toThrow(/not configured/);
    // Restore for later tests in-suite (the beforeEach truncates, doesn't re-set).
    setTeamDb(getTestDb() as unknown as never);
  });

  it('serializes concurrent acceptance so exactly one request wins', async () => {
    const owner = await seedUser('race-owner@example.com');
    const invited = await seedUser('racer@example.com');
    const result = await inviteMember(owner.id, {
      email: 'racer@example.com',
      inviterName: 'Owner',
      locale: 'en',
    });
    const outcomes = await Promise.allSettled([
      acceptInvite(invited.id, result.inviteToken),
      acceptInvite(invited.id, result.inviteToken),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
  });
});
