import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../../app.js';
import { env } from '../../config/env.js';
import { getAuth } from './auth.js';
import { account, user as userTable, verification } from '../../db/schema/index.js';
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
  cookieFrom as cookieFromRes,
  installTestAuth,
  loginTestUser,
  markEmailVerified,
  signupTestUser,
  signupVerifiedUser,
  uninstallTestAuth,
} from '../../shared/testing/auth.js';
import { setResendTransport, type EmailMessage } from '../communication/index.js';
import { translate } from '../../shared/i18n/index.js';
import { ROLE_MEMBER, User } from '../users/index.js';

const app = createApp();

const sentEmails: EmailMessage[] = [];

function firstUrl(text: string): string {
  const match = /https?:\/\/\S+/.exec(text);
  if (!match) throw new Error(`no URL in email body: ${text}`);
  return match[0];
}

/** Turn an absolute better-auth URL into a supertest path. */
function toPath(url: string): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

describe('auth module (Better Auth)', () => {
  beforeAll(async () => {
    await startMemoryMongo();
    await startTestPostgres();
    installTestAuth({ sendVerificationOnSignUp: true });
    // Route transactional emails into the in-memory sink.
    env.RESEND_API_KEY = 'test-key';
    env.RESEND_FROM = 'RankMeFast <noreply@rankme.test>';
    setResendTransport(async (message) => {
      sentEmails.push(message);
      return { delivered: true };
    });
  });

  afterAll(async () => {
    setResendTransport(null);
    delete (env as Record<string, unknown>).RESEND_API_KEY;
    delete (env as Record<string, unknown>).RESEND_FROM;
    uninstallTestAuth();
    await stopTestPostgres();
    await stopMemoryMongo();
  });

  beforeEach(async () => {
    await clearCollections();
    await truncateAllTables();
    sentEmails.length = 0;
  });

  afterEach(() => {
    sentEmails.length = 0;
  });

  describe('signup → session → logout cycle', () => {
    it('rejects direct ID-token linking before any caller-supplied OAuth token is stored', async () => {
      const user = await signupVerifiedUser(app, { email: 'redirect-only@example.com' });
      const res = await request(app)
        .post('/api/auth/link-social')
        .set('Origin', env.CLIENT_URL)
        .set('x-lang', 'ar')
        .set('Cookie', user.cookie)
        .send({
          provider: 'google',
          idToken: {
            token: 'verified-id-token-sentinel',
            accessToken: 'unbound-access-token-sentinel',
            refreshToken: 'unbound-refresh-token-sentinel',
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('DIRECT_ID_TOKEN_OAUTH_DISABLED');
      expect(res.body.messageKey).toBe('auth.error.directOauthDisabled');
      expect(res.body.message).toBe(translate('ar', 'auth.error.directOauthDisabled'));
      expect(res.headers['content-language']).toBe('ar');
      expect(JSON.stringify(res.body)).not.toContain('Direct ID-token OAuth is disabled');
      const rows = await getTestDb()
        .select()
        .from(account)
        .where(eq(account.userId, user.id));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.providerId).toBe('credential');
    });

    it('signs up, sets a session cookie, authorizes a product request, and 401s after logout', async () => {
      const alice = await signupVerifiedUser(app, {
        email: 'alice@example.com',
        name: 'Alice Lovelace',
      });
      expect(alice.cookie).toContain('better-auth.session_token');

      const profile = await request(app)
        .get(`/api/users/${alice.id}`)
        .set('Cookie', alice.cookie);
      expect(profile.status).toBe(200);
      expect(profile.body.user.email).toBe('alice@example.com');

      const signOut = await request(app)
        .post('/api/auth/sign-out')
        .set('Origin', env.CLIENT_URL)
        .set('Cookie', alice.cookie)
        .send({});
      expect(signOut.status).toBe(200);

      const afterLogout = await request(app)
        .get(`/api/users/${alice.id}`)
        .set('Cookie', alice.cookie);
      expect(afterLogout.status).toBe(401);
    });

    it('sign-in issues a fresh session; wrong password is rejected', async () => {
      const bob = await signupVerifiedUser(app, { email: 'bob@example.com' });

      const cookie = await loginTestUser(app, bob.email, bob.password);
      const ok = await request(app).get(`/api/users/${bob.id}`).set('Cookie', cookie);
      expect(ok.status).toBe(200);

      const bad = await request(app)
        .post('/api/auth/sign-in/email')
        .set('Origin', env.CLIENT_URL)
        .set('x-lang', 'fr')
        .send({ email: bob.email, password: 'wrong-password' });
      expect(bad.status).toBe(401);
      expect(bad.body).toMatchObject({
        code: 'INVALID_EMAIL_OR_PASSWORD',
        messageKey: 'errors.invalidCredentials',
        message: translate('fr', 'errors.invalidCredentials'),
      });
      expect(bad.headers['content-language']).toBe('fr');
    });

    it('test harness surfaces signup/login failures loudly', async () => {
      await signupTestUser(app, { email: 'dupe@example.com' });
      // Duplicate signup → non-200 → the harness throws instead of returning
      // a broken fixture.
      await expect(signupTestUser(app, { email: 'dupe@example.com' })).rejects.toThrow(
        /test signup failed/,
      );
      await expect(loginTestUser(app, 'dupe@example.com', 'not-the-password')).rejects.toThrow(
        /test login failed/,
      );
    });

    it('get-session reflects the session state', async () => {
      const carol = await signupTestUser(app, { email: 'carol@example.com' });
      const withCookie = await request(app)
        .get('/api/auth/get-session')
        .set('Cookie', carol.cookie);
      expect(withCookie.status).toBe(200);
      expect(withCookie.body.user.email).toBe('carol@example.com');
      expect(withCookie.body.user.role).toBe(ROLE_MEMBER);

      const anonymous = await request(app).get('/api/auth/get-session');
      expect(anonymous.status).toBe(200);
      expect(anonymous.body).toBeNull();
    });
  });

  describe('session guard (requireAuth)', () => {
    it('401s with a localized message when no cookie is present', async () => {
      const res = await request(app).get('/api/users/000000000000000000000000');
      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe(translate('en', 'errors.unauthorized'));

      const fr = await request(app)
        .get('/api/users/000000000000000000000000')
        .set('x-lang', 'fr');
      expect(fr.status).toBe(401);
      expect(fr.body.error.message).toBe(translate('fr', 'errors.unauthorized'));
    });

    it('401s on a tampered session cookie', async () => {
      const res = await request(app)
        .get('/api/users/000000000000000000000000')
        .set('Cookie', 'better-auth.session_token=tampered.garbage-value');
      expect(res.status).toBe(401);
    });

    it('401s after the session is revoked server-side', async () => {
      const dave = await signupVerifiedUser(app, { email: 'dave@example.com' });
      await getTestDb().delete(account).where(eq(account.userId, dave.id));
      // Nuking the user cascades sessions — the cookie is now orphaned.
      await getTestDb().delete(userTable).where(eq(userTable.id, dave.id));
      const res = await request(app).get(`/api/users/${dave.id}`).set('Cookie', dave.cookie);
      expect(res.status).toBe(401);
    });
  });

  describe('email verification gate (requireVerified)', () => {
    it('blocks unverified users from product routes with EMAIL_NOT_VERIFIED', async () => {
      const eve = await signupTestUser(app, { email: 'eve@example.com' });
      const res = await request(app)
        .get(`/api/users/${eve.id}`)
        .set('Cookie', eve.cookie)
        .set('x-lang', 'zh');
      expect(res.status).toBe(403);
      expect(res.body.error.details.code).toBe('EMAIL_NOT_VERIFIED');
      expect(res.body.error.messageKey).toBe('errors.emailNotVerified');
      expect(res.body.error.message).toBe(translate('zh', 'errors.emailNotVerified'));
    });

    it('unblocks after the emailed verification link is followed', async () => {
      const frank = await signupTestUser(app, { email: 'frank@example.com' });
      const verificationEmail = sentEmails.find((m) => m.to === 'frank@example.com');
      expect(verificationEmail).toBeDefined();

      const verifyPath = toPath(firstUrl((verificationEmail as EmailMessage).text));
      const verifyRes = await request(app).get(verifyPath);
      expect([200, 302]).toContain(verifyRes.status);

      const rows = await getTestDb()
        .select()
        .from(userTable)
        .where(eq(userTable.id, frank.id));
      expect(rows[0]?.emailVerified).toBe(true);

      // The Mongo mirror is synced by the user.update.after hook.
      const mirror = await User.findById(frank.id);
      expect(mirror?.emailVerified).toBe(true);

      const res = await request(app).get(`/api/users/${frank.id}`).set('Cookie', frank.cookie);
      expect(res.status).toBe(200);
    });
  });

  describe('password reset flow', () => {
    it('request → emailed token → reset → old password dead, new password works', async () => {
      const grace = await signupVerifiedUser(app, { email: 'grace@example.com' });
      sentEmails.length = 0;

      const reqRes = await request(app)
        .post('/api/auth/request-password-reset')
        .set('Origin', env.CLIENT_URL)
        .send({ email: grace.email, redirectTo: `${env.CLIENT_URL}/reset-password` });
      expect(reqRes.status).toBe(200);

      const resetEmail = sentEmails.find((m) => m.to === grace.email);
      expect(resetEmail).toBeDefined();
      const resetUrl = firstUrl((resetEmail as EmailMessage).text);
      const tokenMatch = /reset-password\/([^/?#]+)/.exec(resetUrl);
      expect(tokenMatch).not.toBeNull();
      const token = (tokenMatch as RegExpExecArray)[1];
      const resetTokens = await getTestDb()
        .select()
        .from(verification)
        .where(eq(verification.value, grace.id));
      expect(resetTokens).toMatchObject([
        {
          identifier: `reset-password:${token}`,
          value: grace.id,
        },
      ]);

      // The completion callback has no request locale. Freeze the recipient's
      // current stored preference when that security event is accepted.
      await User.findByIdAndUpdate(grace.id, { language: 'ar' });
      sentEmails.length = 0;
      const resetRes = await request(app)
        .post('/api/auth/reset-password')
        .set('Origin', env.CLIENT_URL)
        .send({ newPassword: 'brand-new-password-1', token });
      expect(resetRes.status).toBe(200);

      // onPasswordReset dispatched the "password changed" notice.
      const changedEmail = sentEmails.find((m) => m.to === grace.email);
      expect(changedEmail?.subject).toBe(translate('ar', 'email.passwordChanged.subject'));

      const oldLogin = await request(app)
        .post('/api/auth/sign-in/email')
        .set('Origin', env.CLIENT_URL)
        .send({ email: grace.email, password: grace.password });
      expect(oldLogin.status).toBe(401);

      const newCookie = await loginTestUser(app, grace.email, 'brand-new-password-1');
      expect(newCookie).toContain('better-auth.session_token');
    });
  });

  describe('change password (authenticated)', () => {
    it('rotates the hash, kills the old cookie, keeps the new one, and mails a localized confirmation', async () => {
      const helen = await signupVerifiedUser(app, { email: 'helen@example.com' });
      sentEmails.length = 0;

      const res = await request(app)
        .post('/api/auth/change-password')
        .set('Origin', env.CLIENT_URL)
        .set('Cookie', helen.cookie)
        .set('x-lang', 'de')
        .send({
          currentPassword: helen.password,
          newPassword: 'brand-new-password-2',
          revokeOtherSessions: true,
        });
      expect(res.status).toBe(200);

      // Exactly one confirmation email fired, translated per request locale.
      const changedEmails = sentEmails.filter((m) => m.to === helen.email);
      expect(changedEmails).toHaveLength(1);
      expect(changedEmails[0]?.subject).toBe(
        translate('de', 'email.passwordChanged.subject'),
      );

      // Prior session cookie is revoked; the new Set-Cookie replaces it.
      const previous = await request(app)
        .get(`/api/users/${helen.id}`)
        .set('Cookie', helen.cookie);
      expect(previous.status).toBe(401);

      const rotatedCookie = cookieFromRes(res);
      expect(rotatedCookie).toContain('better-auth.session_token');
      const stillAuthed = await request(app)
        .get(`/api/users/${helen.id}`)
        .set('Cookie', rotatedCookie);
      expect(stillAuthed.status).toBe(200);

      // New credentials work, old ones do not.
      const oldLogin = await request(app)
        .post('/api/auth/sign-in/email')
        .set('Origin', env.CLIENT_URL)
        .send({ email: helen.email, password: helen.password });
      expect(oldLogin.status).toBe(401);
      const newCookie = await loginTestUser(app, helen.email, 'brand-new-password-2');
      expect(newCookie).toContain('better-auth.session_token');
    });

    it('rejects a wrong current password with 400 and does NOT send the email', async () => {
      const ivy = await signupVerifiedUser(app, { email: 'ivy@example.com' });
      sentEmails.length = 0;

      const res = await request(app)
        .post('/api/auth/change-password')
        .set('Origin', env.CLIENT_URL)
        .set('Cookie', ivy.cookie)
        .send({
          currentPassword: 'not-the-real-password',
          newPassword: 'brand-new-password-3',
          revokeOtherSessions: true,
        });
      expect(res.status).toBe(400);
      expect(sentEmails.filter((m) => m.to === ivy.email)).toHaveLength(0);

      // Original session and password are intact.
      const stillAuthed = await request(app)
        .get(`/api/users/${ivy.id}`)
        .set('Cookie', ivy.cookie);
      expect(stillAuthed.status).toBe(200);
      const stillWorks = await loginTestUser(app, ivy.email, ivy.password);
      expect(stillWorks).toContain('better-auth.session_token');
    });

    it('requires an authenticated session (no cookie → 401)', async () => {
      const res = await request(app)
        .post('/api/auth/change-password')
        .set('Origin', env.CLIENT_URL)
        .send({
          currentPassword: 'anything-1',
          newPassword: 'brand-new-password-4',
        });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });
  });

  describe('change email (authenticated, re-verification)', () => {
    it('mails the verification link to the NEW address, and old email stays active until the link is followed', async () => {
      const kate = await signupVerifiedUser(app, { email: 'kate@example.com' });
      sentEmails.length = 0;

      const res = await request(app)
        .post('/api/auth/change-email')
        .set('Origin', env.CLIENT_URL)
        .set('Cookie', kate.cookie)
        .set('x-lang', 'fr')
        .send({
          newEmail: 'kate-new@example.com',
          callbackURL: `${env.CLIENT_URL}/settings/security`,
        });
      expect(res.status).toBe(200);

      // Verification email fired to the NEW address, in the request locale.
      const toNew = sentEmails.filter((m) => m.to === 'kate-new@example.com');
      const toOld = sentEmails.filter((m) => m.to === 'kate@example.com');
      expect(toNew).toHaveLength(1);
      expect(toOld).toHaveLength(0);
      expect(toNew[0]?.subject).toBe(
        translate('fr', 'email.emailChangeVerification.subject'),
      );

      // Account email is unchanged pre-verification.
      const preRows = await getTestDb()
        .select()
        .from(userTable)
        .where(eq(userTable.id, kate.id));
      expect(preRows[0]?.email).toBe('kate@example.com');

      const preMirror = await User.findById(kate.id);
      expect(preMirror?.email).toBe('kate@example.com');

      // Old email + password still logs in.
      const stillWorks = await loginTestUser(app, 'kate@example.com', kate.password);
      expect(stillWorks).toContain('better-auth.session_token');

      // Follow the verification link → account email + Mongo mirror update.
      const verifyUrl = firstUrl(toNew[0]!.text!);
      const verifyRes = await request(app).get(toPath(verifyUrl));
      expect([200, 302]).toContain(verifyRes.status);

      const postRows = await getTestDb()
        .select()
        .from(userTable)
        .where(eq(userTable.id, kate.id));
      expect(postRows[0]?.email).toBe('kate-new@example.com');

      const postMirror = await User.findById(kate.id);
      expect(postMirror?.email).toBe('kate-new@example.com');

      // New address logs in with the same password.
      const withNew = await loginTestUser(app, 'kate-new@example.com', kate.password);
      expect(withNew).toContain('better-auth.session_token');
    });

    it('does not dispatch a verification mail when the new email already belongs to another account', async () => {
      const larry = await signupVerifiedUser(app, { email: 'larry@example.com' });
      // Someone else already owns "taken@example.com".
      await signupVerifiedUser(app, { email: 'taken@example.com' });
      sentEmails.length = 0;

      const res = await request(app)
        .post('/api/auth/change-email')
        .set('Origin', env.CLIENT_URL)
        .set('Cookie', larry.cookie)
        .send({
          newEmail: 'taken@example.com',
          callbackURL: `${env.CLIENT_URL}/settings/security`,
        });
      // Better Auth returns 200 with {status:true} to avoid leaking existence,
      // but our sendChangeEmailConfirmation MUST NOT fire — no mail leaves
      // the process to either address.
      expect(res.status).toBe(200);
      expect(sentEmails.filter((m) => m.to === 'taken@example.com')).toHaveLength(0);
      expect(sentEmails.filter((m) => m.to === 'larry@example.com')).toHaveLength(0);

      // Larry's account email is unchanged.
      const rows = await getTestDb()
        .select()
        .from(userTable)
        .where(eq(userTable.id, larry.id));
      expect(rows[0]?.email).toBe('larry@example.com');
    });

    it('rejects a change to the same address the account already has', async () => {
      const mira = await signupVerifiedUser(app, { email: 'mira@example.com' });
      sentEmails.length = 0;
      const res = await request(app)
        .post('/api/auth/change-email')
        .set('Origin', env.CLIENT_URL)
        .set('Cookie', mira.cookie)
        .send({
          newEmail: 'mira@example.com',
          callbackURL: `${env.CLIENT_URL}/settings/security`,
        });
      expect(res.status).toBe(400);
      expect(sentEmails).toHaveLength(0);
    });

    it('requires an authenticated session (no cookie)', async () => {
      const res = await request(app)
        .post('/api/auth/change-email')
        .set('Origin', env.CLIENT_URL)
        .send({
          newEmail: 'nobody@example.com',
          callbackURL: `${env.CLIENT_URL}/settings/security`,
        });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });
  });

  describe('hardening', () => {
    it('rejects cookie-bearing cross-origin requests (trusted-origins CSRF)', async () => {
      // Better Auth's origin validation applies to state-changing requests
      // that carry credentials — exactly the CSRF-relevant surface.
      const oscar = await signupTestUser(app, { email: 'oscar@example.com' });
      const res = await request(app)
        .post('/api/auth/sign-out')
        .set('Origin', 'https://evil.example.com')
        .set('Cookie', oscar.cookie)
        .send({});
      expect(res.status).toBe(403);

      // The session survives the forged attempt.
      const session = await request(app)
        .get('/api/auth/get-session')
        .set('Cookie', oscar.cookie);
      expect(session.body.user.email).toBe('oscar@example.com');
    });

    it('never lets a signup set its own role (input: false)', async () => {
      const res = await request(app)
        .post('/api/auth/sign-up/email')
        .set('Origin', env.CLIENT_URL)
        .send({
          email: 'mallory@example.com',
          password: 'sneaky-password-1',
          name: 'Mallory',
          role: 'Admin',
        });
      expect(res.status).toBe(200);
      const rows = await getTestDb()
        .select()
        .from(userTable)
        .where(eq(userTable.email, 'mallory@example.com'));
      expect(rows[0]?.role).toBe(ROLE_MEMBER);
    });

    it('rate-limits credential POSTs to /api/auth/* with a localized 429', async () => {
      const original = env.RATE_LIMIT_AUTH_MAX;
      env.RATE_LIMIT_AUTH_MAX = 2;
      const limitedApp = createApp();
      try {
        // Only credential mutations are throttled; read-only GET session reads
        // are exempt (see createAuthRateLimiter's `skip`), so drive the limit
        // with POST sign-in attempts. The limiter runs before Better Auth, so
        // the 429 fires regardless of the (invalid) body.
        const creds = { email: 'floodtest@example.com', password: 'wrong-password' };
        await request(limitedApp).post('/api/auth/sign-in/email').send(creds);
        await request(limitedApp).post('/api/auth/sign-in/email').send(creds);
        const limited = await request(limitedApp)
          .post('/api/auth/sign-in/email')
          .set('x-lang', 'de')
          .send(creds);
        expect(limited.status).toBe(429);
        expect(limited.body.error).toBe(translate('de', 'security.error.rateLimited'));
      } finally {
        env.RATE_LIMIT_AUTH_MAX = original;
      }
    });

    it('exempts get-session from Better Auth\'s own per-IP limiter too', () => {
      // Better Auth ships a second, internal limiter (100 req/60s per IP)
      // that counts every /api/auth/* call. Without this exemption a shared
      // egress IP exhausts it on ordinary page loads and the 429 reads to
      // the client as "signed out". Its limiter is disabled outside
      // production, so pin the CONFIG rather than a request loop that would
      // pass either way.
      expect(getAuth().options.rateLimit?.customRules?.['/get-session']).toBe(
        false,
      );
    });

    it('exempts read-only GET /api/auth/get-session from the auth limiter', async () => {
      const original = env.RATE_LIMIT_AUTH_MAX;
      env.RATE_LIMIT_AUTH_MAX = 2;
      const limitedApp = createApp();
      try {
        // Well past `max` — a browsing session polling the session endpoint must
        // never be throttled into a 429.
        for (let i = 0; i < 5; i += 1) {
          const res = await request(limitedApp).get('/api/auth/get-session');
          expect(res.status).not.toBe(429);
        }
      } finally {
        env.RATE_LIMIT_AUTH_MAX = original;
      }
    });
  });

  describe('Mongo domain mirror', () => {
    it('creates a mirror document with the same id, split name, and locale', async () => {
      const res = await request(app)
        .post('/api/auth/sign-up/email')
        .set('Origin', env.CLIENT_URL)
        .set('x-lang', 'fr')
        .send({
          email: 'heidi@example.com',
          password: 'strong-password-9',
          name: 'Heidi Klum Marie',
        });
      expect(res.status).toBe(200);
      const id = (res.body as { user: { id: string } }).user.id;
      expect(id).toMatch(/^[0-9a-f]{24}$/);

      const mirror = await User.findById(id);
      expect(mirror).not.toBeNull();
      expect(mirror?.email).toBe('heidi@example.com');
      expect(mirror?.profile?.firstName).toBe('Heidi');
      expect(mirror?.profile?.lastName).toBe('Klum Marie');
      expect(mirror?.role).toBe(ROLE_MEMBER);
      expect(mirror?.language).toBe('fr');
      expect(mirror?.emailVerified).toBe(false);
    });

    it('propagates a display-name change to the mirror profile', async () => {
      const user = await signupTestUser(app, {
        email: 'nadia@example.com',
        name: 'Nadia One',
      });
      const res = await request(app)
        .post('/api/auth/update-user')
        .set('Origin', env.CLIENT_URL)
        .set('Cookie', user.cookie)
        .send({ name: 'Nadia Two Three' });
      expect(res.status).toBe(200);

      const mirror = await User.findById(user.id);
      expect(mirror?.profile?.firstName).toBe('Nadia');
      expect(mirror?.profile?.lastName).toBe('Two Three');
    });

    it('signup rejects duplicate emails', async () => {
      await signupTestUser(app, { email: 'ivan@example.com' });
      const res = await request(app)
        .post('/api/auth/sign-up/email')
        .set('Origin', env.CLIENT_URL)
        .set('x-lang', 'de')
        .send({ email: 'ivan@example.com', password: 'another-pass-123', name: 'Ivan Again' });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(['USER_ALREADY_EXISTS', 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL']).toContain(
        res.body.code,
      );
      expect(res.body.messageKey).toBe('auth.error.accountUnavailable');
      expect(res.body.message).toBe(translate('de', 'auth.error.accountUnavailable'));
      expect(JSON.stringify(res.body).toLowerCase()).not.toContain('already exists');
    });

    it('localizes invalid email and short-password signup validation', async () => {
      const invalidEmail = await request(app)
        .post('/api/auth/sign-up/email')
        .set('Origin', env.CLIENT_URL)
        .set('x-lang', 'es')
        .send({ email: 'not-an-email', password: 'long-enough-password', name: 'Invalid' });
      expect(invalidEmail.status).toBeGreaterThanOrEqual(400);
      expect(invalidEmail.body).toMatchObject({
        code: 'VALIDATION_ERROR',
        messageKey: 'errors.validationFailed',
        message: translate('es', 'errors.validationFailed'),
      });

      const shortPassword = await request(app)
        .post('/api/auth/sign-up/email')
        .set('Origin', env.CLIENT_URL)
        .set('x-lang', 'ar')
        .send({ email: 'short@example.com', password: 'short', name: 'Short' });
      expect(shortPassword.status).toBeGreaterThanOrEqual(400);
      expect(shortPassword.body).toMatchObject({
        code: 'PASSWORD_TOO_SHORT',
        messageKey: 'errors.passwordTooShort',
        message: translate('ar', 'errors.passwordTooShort'),
      });
    });

    it('localizes provisional-account hook denials without changing its 403', async () => {
      const provisional = await signupVerifiedUser(app, { email: 'provisional@example.com' });
      await getTestDb()
        .update(userTable)
        .set({ provisionalAccount: true })
        .where(eq(userTable.id, provisional.id));
      const res = await request(app)
        .post('/api/auth/update-user')
        .set('Origin', env.CLIENT_URL)
        .set('Cookie', provisional.cookie)
        .set('x-lang', 'fr')
        .send({ name: 'Blocked Mutation' });
      expect(res.status).toBe(403);
      expect(res.body).toEqual({
        code: 'PROVISIONAL_ACCOUNT_RESTRICTED',
        message: translate('fr', 'auth.error.provisionalRestricted'),
        messageKey: 'auth.error.provisionalRestricted',
      });
    });
  });

  describe('cross-account authorization denial', () => {
    it.each([['users profile', (victimId: string) => `/api/users/${victimId}`]])(
      'user A cannot read user B via %s',
      async (_label, pathFor) => {
        const victim = await signupVerifiedUser(app, { email: 'victim@example.com' });
        const attacker = await signupVerifiedUser(app, { email: 'attacker@example.com' });
        const res = await request(app)
          .get(pathFor(victim.id))
          .set('Cookie', attacker.cookie);
        expect([401, 403, 404]).toContain(res.status);
        expect(JSON.stringify(res.body)).not.toContain('victim@example.com');
      },
    );
  });

  describe('helpers', () => {
    it('markEmailVerified is reflected in the live session', async () => {
      const judy = await signupTestUser(app, { email: 'judy@example.com' });
      await markEmailVerified(judy.id);
      const session = await request(app)
        .get('/api/auth/get-session')
        .set('Cookie', judy.cookie);
      expect(session.body.user.emailVerified).toBe(true);
    });
  });
});
