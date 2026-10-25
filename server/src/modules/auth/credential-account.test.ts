import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../app.js';
import { env } from '../../config/env.js';
import { account, session } from '../../db/schema/index.js';
import { clearCollections, startMemoryMongo, stopMemoryMongo } from '../../shared/testing/mongo.js';
import { getTestDb, startTestPostgres, stopTestPostgres, truncateAllTables } from '../../shared/testing/postgres.js';
import { installTestAuth, uninstallTestAuth, signupVerifiedUser, loginTestUser } from '../../shared/testing/auth.js';
import { setResendTransport, type EmailMessage } from '../communication/index.js';

const app = createApp();
const mail: EmailMessage[] = [];
const originalMailKey = env.RESEND_API_KEY;
const originalMailFrom = env.RESEND_FROM;

describe('native credential setup', () => {
  beforeAll(async () => {
    await startMemoryMongo();
    await startTestPostgres();
    installTestAuth();
    env.RESEND_API_KEY = 'test-key';
    env.RESEND_FROM = 'RankMeFast <noreply@rankme.test>';
    setResendTransport(async (message) => { mail.push(message); return { delivered: true }; });
  });
  beforeEach(async () => {
    await clearCollections();
    await truncateAllTables();
    mail.length = 0;
  });
  afterAll(async () => {
    setResendTransport(null);
    env.RESEND_API_KEY = originalMailKey;
    env.RESEND_FROM = originalMailFrom;
    uninstallTestAuth();
    await stopTestPostgres();
    await stopMemoryMongo();
  });

  it('sets the first password for a social account only with a single-use emailed token', async () => {
    const owner = await signupVerifiedUser(app, { email: 'social-owner@example.test' });
    await getTestDb().update(account).set({ providerId: 'google', password: null }).where(eq(account.userId, owner.id));
    const list = await request(app).get('/api/auth/list-accounts').set('Cookie', owner.cookie).expect(200);
    expect(list.body.map((row: { providerId: string }) => row.providerId)).toEqual(['google']);
    expect(list.body.every((row: object) => !('password' in row))).toBe(true);

    const mutation = (path: string, body: object) => request(app).post(`/api/auth/${path}`)
      .set('Cookie', owner.cookie).set('Origin', env.CLIENT_URL).send(body);
    expect((await mutation('change-password', {
      currentPassword: owner.password, newPassword: 'replacement-secret',
    })).status).toBe(400);
    expect((await mutation('two-factor/enable', { password: owner.password })).status).toBe(400);
    expect((await mutation('reset-password', { token: 'invalid', newPassword: 'replacement-secret' })).status).toBe(400);

    await getTestDb().update(session).set({ createdAt: new Date(Date.now() - 2 * 86_400_000) })
      .where(eq(session.userId, owner.id));
    await mutation('request-password-reset', {
      email: owner.email, redirectTo: `${env.CLIENT_URL}/reset-password`,
    }).expect(200);
    const emailed = mail.find((message) => message.to === owner.email);
    const token = /reset-password\/([^/?#\s]+)/.exec(emailed?.text ?? '')?.[1];
    expect(token).toBeTruthy();
    const body = { token, newPassword: 'replacement-secret' };
    await mutation('reset-password', body).expect(200);
    await mutation('reset-password', body).expect(400);
    const cookie = await loginTestUser(app, owner.email, body.newPassword);
    const linked = await request(app).get('/api/auth/list-accounts').set('Cookie', cookie).expect(200);
    expect(linked.body.map((row: { providerId: string }) => row.providerId).sort())
      .toEqual(['credential', 'google']);
  });

  it('keeps linked account reads caller-scoped and password changes origin-protected', async () => {
    const owner = await signupVerifiedUser(app, { email: 'linked-owner@example.test' });
    const foreign = await signupVerifiedUser(app, { email: 'linked-foreign@example.test' });
    await getTestDb().insert(account).values({
      id: randomUUID(), userId: owner.id, providerId: 'google', accountId: 'linked-google',
    });
    const list = await request(app).get('/api/auth/list-accounts')
      .query({ userId: foreign.id }).set('Cookie', owner.cookie).expect(200);
    expect(list.body).toHaveLength(2);
    expect(list.body.every((row: { userId: string }) => row.userId === owner.id)).toBe(true);
    await request(app).get('/api/auth/list-accounts').expect(401);

    const body = {
      currentPassword: owner.password, newPassword: 'linked-new-password', revokeOtherSessions: true,
    };
    const endpoint = () => request(app).post('/api/auth/change-password').set('Cookie', owner.cookie);
    await endpoint().set('Origin', 'https://foreign.example').send(body).expect(403);
    await endpoint().set('Origin', env.CLIENT_URL)
      .send({ ...body, currentPassword: 'incorrect' }).expect(400);
    await endpoint().set('Origin', env.CLIENT_URL).send(body).expect(200);
    await loginTestUser(app, owner.email, body.newPassword);
  });
});
