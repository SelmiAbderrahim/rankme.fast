/**
 * Two-factor authentication — plugin surface tests.
 *
 * Better Auth owns TOTP + backup-code crypto; these tests exercise the
 * enrolment / verify / backup-code / disable flow end-to-end through the
 * `authClient.twoFactor.*` API via supertest. Coverage:
 *   - enrol returns a totpURI + backup codes and flips twoFactorEnabled=true
 *   - a valid current TOTP code (generated deterministically from the
 *     enrolled secret) completes the challenge; an invalid one is rejected
 *   - a backup code satisfies the challenge once; reuse is rejected
 *   - disable requires a current password; success clears the flag
 *   - unauthenticated 2fa-management → 401
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createOTP } from '@better-auth/utils/otp';
import { base32 } from '@better-auth/utils/base32';
import { eq } from 'drizzle-orm';
import { createApp } from '../../app.js';
import { env } from '../../config/env.js';
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
import { user as userTable } from '../../db/schema/auth.js';
import { translate } from '../../shared/i18n/index.js';
import {
  cookieFrom,
  installTestAuth,
  signupVerifiedUser,
  uninstallTestAuth,
} from '../../shared/testing/auth.js';

const app = createApp();

function extractSecret(totpURI: string): string {
  const match = /[?&]secret=([^&]+)/i.exec(totpURI);
  if (!match) throw new Error(`no secret in totp URI: ${totpURI}`);
  return match[1] as string;
}

// The URI's `secret` param is base32-encoded (@better-auth/utils/otp url()).
// The plugin stores + verifies against the RAW secret, so decode back before
// calling createOTP().totp(). `String.fromCharCode(...bytes)` is the same
// "raw bytes as string" the plugin uses at generateRandomString time.
async function currentTotp(base32Secret: string): Promise<string> {
  const bytes = base32.decode(base32Secret);
  const raw = String.fromCharCode(...bytes);
  return createOTP(raw, { period: 30, digits: 6 }).totp();
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

describe('two-factor plugin (Better Auth)', () => {
  it('unauthenticated 2fa-management → 401', async () => {
    const res = await request(app)
      .post('/api/auth/two-factor/enable')
      .set('Origin', env.CLIENT_URL)
      .send({ password: 'anything' });
    expect(res.status).toBe(401);
  });

  it('enrol returns a totpURI + backup codes and flips twoFactorEnabled', async () => {
    const alice = await signupVerifiedUser(app, { email: 'alice@example.com' });
    const enrol = await request(app)
      .post('/api/auth/two-factor/enable')
      .set('Origin', env.CLIENT_URL)
      .set('Cookie', alice.cookie)
      .send({ password: alice.password });
    expect(enrol.status).toBe(200);
    expect(enrol.body.totpURI).toMatch(/^otpauth:\/\/totp\//);
    expect(Array.isArray(enrol.body.backupCodes)).toBe(true);
    expect(enrol.body.backupCodes.length).toBeGreaterThan(0);

    // Verify the TOTP to actually flip twoFactorEnabled on the user.
    const secret = extractSecret(enrol.body.totpURI);
    const code = await currentTotp(secret);
    const verify = await request(app)
      .post('/api/auth/two-factor/verify-totp')
      .set('Origin', env.CLIENT_URL)
      .set('Cookie', alice.cookie)
      .send({ code });
    expect(verify.status).toBe(200);
    // verify-totp rolls the session cookie (old one is deleted).
    const newCookie = cookieFrom(verify);

    const session = await request(app).get('/api/auth/get-session').set('Cookie', newCookie);
    expect(session.status).toBe(200);
    expect(session.body.user.twoFactorEnabled).toBe(true);
  });

  it('signin returns twoFactorRedirect when the user has a verified factor', async () => {
    const bob = await signupVerifiedUser(app, { email: 'bob@example.com' });
    // Enrol.
    const enrol = await request(app)
      .post('/api/auth/two-factor/enable')
      .set('Origin', env.CLIENT_URL)
      .set('Cookie', bob.cookie)
      .send({ password: bob.password });
    const secret = extractSecret(enrol.body.totpURI);
    const verify = await request(app)
      .post('/api/auth/two-factor/verify-totp')
      .set('Origin', env.CLIENT_URL)
      .set('Cookie', bob.cookie)
      .send({ code: await currentTotp(secret) });
    expect(verify.status).toBe(200);

    // A fresh signin now returns twoFactorRedirect: true, no session cookie.
    const signIn = await request(app)
      .post('/api/auth/sign-in/email')
      .set('Origin', env.CLIENT_URL)
      .send({ email: bob.email, password: bob.password });
    expect(signIn.status).toBe(200);
    expect(signIn.body).toMatchObject({ twoFactorRedirect: true });

    // The temporary two-factor cookie is issued (not the session cookie).
    const tempCookie = cookieFrom(signIn);
    expect(tempCookie).toContain('two_factor');

    // Complete the challenge with the current TOTP code.
    const challenge = await request(app)
      .post('/api/auth/two-factor/verify-totp')
      .set('Origin', env.CLIENT_URL)
      .set('Cookie', tempCookie)
      .send({ code: await currentTotp(secret) });
    expect(challenge.status).toBe(200);
    const sessionCookie = cookieFrom(challenge);
    expect(sessionCookie).toContain('better-auth.session_token');
  });

  it('invalid TOTP code is rejected', async () => {
    const carol = await signupVerifiedUser(app, { email: 'carol@example.com' });
    await request(app)
      .post('/api/auth/two-factor/enable')
      .set('Origin', env.CLIENT_URL)
      .set('Cookie', carol.cookie)
      .send({ password: carol.password });
    const bad = await request(app)
      .post('/api/auth/two-factor/verify-totp')
      .set('Origin', env.CLIENT_URL)
      .set('Cookie', carol.cookie)
      .set('x-lang', 'ar')
      .send({ code: '000000' });
    expect([400, 401, 403]).toContain(bad.status);
    expect(bad.body).toMatchObject({
      code: 'INVALID_CODE',
      messageKey: 'auth.error.invalidTwoFactorCode',
      message: translate('ar', 'auth.error.invalidTwoFactorCode'),
    });
    expect(bad.headers['content-language']).toBe('ar');
  });

  it('a backup code satisfies the challenge exactly once; reuse rejected', async () => {
    const dave = await signupVerifiedUser(app, { email: 'dave@example.com' });
    const enrol = await request(app)
      .post('/api/auth/two-factor/enable')
      .set('Origin', env.CLIENT_URL)
      .set('Cookie', dave.cookie)
      .send({ password: dave.password });
    const secret = extractSecret(enrol.body.totpURI);
    const backup = enrol.body.backupCodes[0] as string;
    // Verify enrolment first.
    await request(app)
      .post('/api/auth/two-factor/verify-totp')
      .set('Origin', env.CLIENT_URL)
      .set('Cookie', dave.cookie)
      .send({ code: await currentTotp(secret) });

    // Re-sign-in to get the challenge cookie.
    const signIn = await request(app)
      .post('/api/auth/sign-in/email')
      .set('Origin', env.CLIENT_URL)
      .send({ email: dave.email, password: dave.password });
    expect(signIn.body).toMatchObject({ twoFactorRedirect: true });
    const tempCookie = cookieFrom(signIn);

    // First use — success.
    const first = await request(app)
      .post('/api/auth/two-factor/verify-backup-code')
      .set('Origin', env.CLIENT_URL)
      .set('Cookie', tempCookie)
      .send({ code: backup });
    expect(first.status).toBe(200);

    // Re-sign-in → new challenge; the same backup code must NOT work.
    const signIn2 = await request(app)
      .post('/api/auth/sign-in/email')
      .set('Origin', env.CLIENT_URL)
      .send({ email: dave.email, password: dave.password });
    const tempCookie2 = cookieFrom(signIn2);
    const reuse = await request(app)
      .post('/api/auth/two-factor/verify-backup-code')
      .set('Origin', env.CLIENT_URL)
      .set('Cookie', tempCookie2)
      .set('x-lang', 'de')
      .send({ code: backup });
    expect([400, 401, 403]).toContain(reuse.status);
    expect(reuse.body).toMatchObject({
      code: 'INVALID_BACKUP_CODE',
      messageKey: 'auth.error.invalidTwoFactorCode',
      message: translate('de', 'auth.error.invalidTwoFactorCode'),
    });
  });

  it('disable requires a current password; success clears twoFactorEnabled', async () => {
    const eve = await signupVerifiedUser(app, { email: 'eve@example.com' });
    const enrol = await request(app)
      .post('/api/auth/two-factor/enable')
      .set('Origin', env.CLIENT_URL)
      .set('Cookie', eve.cookie)
      .send({ password: eve.password });
    const secret = extractSecret(enrol.body.totpURI);
    const verify = await request(app)
      .post('/api/auth/two-factor/verify-totp')
      .set('Origin', env.CLIENT_URL)
      .set('Cookie', eve.cookie)
      .send({ code: await currentTotp(secret) });
    const cookie = cookieFrom(verify);

    const badDisable = await request(app)
      .post('/api/auth/two-factor/disable')
      .set('Origin', env.CLIENT_URL)
      .set('Cookie', cookie)
      .send({ password: 'wrong-password' });
    expect([400, 401]).toContain(badDisable.status);

    const okDisable = await request(app)
      .post('/api/auth/two-factor/disable')
      .set('Origin', env.CLIENT_URL)
      .set('Cookie', cookie)
      .send({ password: eve.password });
    expect(okDisable.status).toBe(200);

    // Disable rolls the session cookie too — check the flag in the DB.
    const rows = await getTestDb().select().from(userTable).where(eq(userTable.id, eve.id));
    expect(rows[0]?.twoFactorEnabled).toBe(false);
  });
});
