import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../app.js';
import { env } from '../config/env.js';
import { account, user as userTable } from '../db/schema/index.js';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../shared/testing/mongo.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../shared/testing/postgres.js';
import { installTestAuth, loginTestUser, uninstallTestAuth } from '../shared/testing/auth.js';
import { setResendTransport, type EmailMessage } from '../modules/communication/index.js';
import { User, ROLE_ADMIN, ROLE_MEMBER } from '../modules/users/index.js';
import { migrateUsersToBetterAuth } from './migrate-users-to-better-auth.js';

const app = createApp();

describe('migrate-users-to-better-auth', () => {
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

  it('ports email/name/role/emailVerified under the SAME id (reuse-id mapping)', async () => {
    const legacy = await User.create({
      email: 'legacy@example.com',
      profile: { firstName: 'Lea', lastName: 'Gacy' },
      role: ROLE_ADMIN,
      emailVerified: true,
    });

    const result = await migrateUsersToBetterAuth(getTestDb());
    expect(result).toEqual({ migrated: 1, skipped: 0 });

    const rows = await getTestDb()
      .select()
      .from(userTable)
      .where(eq(userTable.id, legacy._id.toString()));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: legacy._id.toString(),
      email: 'legacy@example.com',
      name: 'Lea Gacy',
      role: ROLE_ADMIN,
      emailVerified: true,
    });

    const credentials = await getTestDb()
      .select()
      .from(account)
      .where(eq(account.userId, legacy._id.toString()));
    expect(credentials).toHaveLength(1);
    expect(credentials[0]).toMatchObject({
      providerId: 'credential',
      accountId: legacy._id.toString(),
    });
    expect(credentials[0]?.password).toBeTruthy();
  });

  it('handles blank name parts and defaults', async () => {
    await User.create({ email: 'noname@example.com' });
    await migrateUsersToBetterAuth(getTestDb());
    const rows = await getTestDb()
      .select()
      .from(userTable)
      .where(eq(userTable.email, 'noname@example.com'));
    expect(rows[0]?.name).toBe('');
    expect(rows[0]?.role).toBe(ROLE_MEMBER);
    expect(rows[0]?.emailVerified).toBe(false);
  });

  it('is idempotent: a re-run skips every already-migrated user', async () => {
    await User.create({ email: 'one@example.com' });
    await User.create({ email: 'two@example.com' });

    const first = await migrateUsersToBetterAuth(getTestDb());
    expect(first).toEqual({ migrated: 2, skipped: 0 });

    const second = await migrateUsersToBetterAuth(getTestDb());
    expect(second).toEqual({ migrated: 0, skipped: 2 });

    const rows = await getTestDb().select().from(userTable);
    expect(rows).toHaveLength(2);
  });

  it('migrated users cannot log in with ANY password until they reset (reset-required)', async () => {
    const legacy = await User.create({ email: 'reset-me@example.com', emailVerified: true });
    await migrateUsersToBetterAuth(getTestDb());

    // The legacy bcrypt password is gone; the placeholder is unguessable.
    const attempt = await request(app)
      .post('/api/auth/sign-in/email')
      .set('Origin', env.CLIENT_URL)
      .send({ email: 'reset-me@example.com', password: 'their-old-password' });
    expect(attempt.status).toBe(401);

    // …but the forgot-password flow rotates the credential and unlocks login.
    const sent: EmailMessage[] = [];
    env.RESEND_API_KEY = 'test-key';
    env.RESEND_FROM = 'RankMeFast <noreply@rankme.test>';
    setResendTransport(async (message) => {
      sent.push(message);
      return { delivered: true };
    });
    try {
      const reqRes = await request(app)
        .post('/api/auth/request-password-reset')
        .set('Origin', env.CLIENT_URL)
        .send({
          email: 'reset-me@example.com',
          redirectTo: `${env.CLIENT_URL}/reset-password`,
        });
      expect(reqRes.status).toBe(200);
      const url = /https?:\/\/\S+/.exec(sent[0]?.text ?? '')?.[0] ?? '';
      const token = /reset-password\/([^/?#]+)/.exec(url)?.[1] ?? '';
      expect(token).not.toBe('');

      const resetRes = await request(app)
        .post('/api/auth/reset-password')
        .set('Origin', env.CLIENT_URL)
        .send({ newPassword: 'fresh-password-42', token });
      expect(resetRes.status).toBe(200);

      const cookie = await loginTestUser(app, 'reset-me@example.com', 'fresh-password-42');
      expect(cookie).toContain('better-auth.session_token');
      expect(await User.findById(legacy._id)).not.toBeNull();
    } finally {
      setResendTransport(null);
      delete (env as Record<string, unknown>).RESEND_API_KEY;
      delete (env as Record<string, unknown>).RESEND_FROM;
    }
  });
});
