import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
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
  signupTestUser,
  signupVerifiedUser,
  uninstallTestAuth,
} from '../../shared/testing/auth.js';
import { User, getRoleRank } from './users.model.js';
import {
  findUserById,
  getLanguagePreference,
  getUserProfile,
  resolveLanguagePreference,
  resolveLanguagePreferenceOr,
  resolveNotificationPreferences,
  toPublicUser,
  updateLanguagePreference,
  updateNotificationPreferences,
  DEFAULT_NOTIFICATION_PREFERENCES,
  type PublicUser,
} from './users.service.js';
import type { UserHydrated } from './users.model.js';
import {
  DICTIONARIES,
  SUPPORTED_LOCALES,
} from '../../shared/i18n/index.js';
import { __setCsrfBypassForTests } from '../../shared/middleware/csrf.js';

const app = createApp();

describe('getRoleRank', () => {
  it('ranks known roles by privilege and defaults unknown/undefined to 0', () => {
    expect(getRoleRank('Admin')).toBeGreaterThan(getRoleRank('Member'));
    expect(getRoleRank('nope')).toBe(0);
    expect(getRoleRank(undefined)).toBe(0);
  });
});

describe('toPublicUser defaults', () => {
  it('fills empty name / false verification when fields are absent', () => {
    const bare = {
      _id: { toString: () => 'id1' },
      email: 'bare@example.com',
      role: 'Member',
    } as unknown as UserHydrated;
    const pub: PublicUser = toPublicUser(bare);
    expect(pub).toEqual({
      id: 'id1',
      email: 'bare@example.com',
      firstName: '',
      lastName: '',
      role: 'Member',
      emailVerified: false,
      language: 'en',
    });
  });

  it('resolves a supported language and falls back to English for corrupt legacy values', () => {
    expect(resolveLanguagePreference('ar')).toBe('ar');
    expect(resolveLanguagePreference('EN')).toBeNull();
    expect(resolveLanguagePreferenceOr('fr', 'en')).toBe('fr');
    expect(resolveLanguagePreferenceOr('invalid', 'de')).toBe('de');
    const corrupt = {
      _id: { toString: () => 'id2' },
      email: 'corrupt@example.com',
      role: 'Member',
      emailVerified: true,
      language: 'xx',
    } as unknown as UserHydrated;
    expect(toPublicUser(corrupt).language).toBe('en');
  });
});

describe('users module', () => {
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

  it('findUserById resolves the mirror document or null', async () => {
    const created = await User.create({ email: 'find-by-id@example.com', emailVerified: true });
    expect((await findUserById(String(created._id)))?.email).toBe('find-by-id@example.com');
    expect(await findUserById(String(new User()._id))).toBeNull();
  });

  it('returns 401 without a session cookie', async () => {
    const res = await request(app).get('/api/users/507f1f77bcf86cd799439011');
    expect(res.status).toBe(401);

    // A garbage/tampered session cookie is equally rejected.
    const tampered = await request(app)
      .get('/api/users/507f1f77bcf86cd799439011')
      .set('Cookie', 'better-auth.session_token=tampered');
    expect(tampered.status).toBe(401);
  });

  it('getUserProfile throws 404 for a missing user id', async () => {
    await expect(getUserProfile('507f1f77bcf86cd799439011')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('returns the profile of the authenticated user', async () => {
    const created = await signupVerifiedUser(app, { email: 'profile@test.com' });
    // Signup creates the Mongo mirror under the same id; set the domain
    // profile fields the assertion expects.
    await User.updateOne(
      { _id: created.id },
      { $set: { profile: { firstName: 'Pro', lastName: 'File' } } },
    );

    const res = await request(app)
      .get(`/api/users/${created.id}`)
      .set('Cookie', created.cookie);

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      id: created.id,
      email: 'profile@test.com',
      firstName: 'Pro',
      lastName: 'File',
      role: 'Member',
      emailVerified: true,
      language: 'en',
    });
  });

  it('returns 404 with the localized userNotFound key when requesting a different user', async () => {
    const a = await signupVerifiedUser(app, { email: 'a@test.com' });
    const b = await signupTestUser(app, { email: 'b@test.com' });

    // Cross-account isolation: a foreign userId is indistinguishable from a
    // missing one — 404, never 401 or 403 (per the shared 404-not-403 rule).
    const res = await request(app).get(`/api/users/${b.id}`).set('Cookie', a.cookie);
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe(DICTIONARIES.en.errors.userNotFound);

    // And the same request under `x-lang: fr` returns the French text —
    // proves the key routes through translate(), not a literal.
    const french = await request(app)
      .get(`/api/users/${b.id}`)
      .set('Cookie', a.cookie)
      .set('x-lang', 'fr');
    expect(french.status).toBe(404);
    expect(french.body.error.message).toBe(DICTIONARIES.fr.errors.userNotFound);
  });

  describe('language preference', () => {
    it('GET exposes null for missing and invalid legacy values', async () => {
      const created = await signupVerifiedUser(app, { email: 'language-null@test.com' });
      await User.collection.updateOne(
        { _id: new User({ _id: created.id })._id },
        { $unset: { language: '' } },
      );
      const missing = await request(app)
        .get('/api/users/preferences/language')
        .set('Cookie', created.cookie);
      expect(missing.status).toBe(200);
      expect(missing.body).toEqual({ language: null });

      await User.collection.updateOne(
        { _id: new User({ _id: created.id })._id },
        { $set: { language: 'xx' } },
      );
      const invalid = await request(app)
        .get('/api/users/preferences/language')
        .set('Cookie', created.cookie);
      expect(invalid.status).toBe(200);
      expect(invalid.body).toEqual({ language: null });
    });

    it('accepts, persists, and reads back every supported locale', async () => {
      const created = await signupVerifiedUser(app, { email: 'language-seven@test.com' });
      for (const language of SUPPORTED_LOCALES) {
        const patch = await request(app)
          .patch('/api/users/preferences/language')
          .set('Cookie', created.cookie)
          .send({ language });
        expect(patch.status).toBe(200);
        expect(patch.body).toEqual({ language });
        const get = await request(app)
          .get('/api/users/preferences/language')
          .set('Cookie', created.cookie);
        expect(get.body).toEqual({ language });
      }
      expect((await User.findById(created.id).lean())?.language).toBe('zh');
    });

    it('strictly rejects unsupported values, unknown fields, and invalid ifUnset', async () => {
      const created = await signupVerifiedUser(app, { email: 'language-invalid@test.com' });
      for (const body of [
        { language: 'pt' },
        { language: 'en-US' },
        { language: 'EN' },
        { language: 'en', userId: created.id },
        { language: 'en', accountId: created.id },
        { language: 'en', workspaceId: created.id },
        { language: 'en', ifUnset: 'yes' },
        {},
      ]) {
        const response = await request(app)
          .patch('/api/users/preferences/language')
          .set('Cookie', created.cookie)
          .send(body);
        expect(response.status).toBe(400);
      }
      expect(await getLanguagePreference(created.id)).toBe('en');
    });

    it('ifUnset atomically converges two devices on the stored winner', async () => {
      const created = await signupVerifiedUser(app, { email: 'language-race@test.com' });
      await User.updateOne({ _id: created.id }, { $set: { language: null } });

      const [first, second] = await Promise.all([
        request(app)
          .patch('/api/users/preferences/language')
          .set('Cookie', created.cookie)
          .send({ language: 'ar', ifUnset: true }),
        request(app)
          .patch('/api/users/preferences/language')
          .set('Cookie', created.cookie)
          .send({ language: 'fr', ifUnset: true }),
      ]);

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(first.body.language).toBe(second.body.language);
      expect(['ar', 'fr']).toContain(first.body.language);
      expect((await User.findById(created.id).lean())?.language).toBe(first.body.language);
    });

    it('ifUnset repairs invalid legacy state while a normal PATCH overwrites', async () => {
      const created = await signupVerifiedUser(app, { email: 'language-overwrite@test.com' });
      await User.collection.updateOne(
        { _id: new User({ _id: created.id })._id },
        { $set: { language: 'invalid' } },
      );
      await expect(updateLanguagePreference(created.id, 'de', true)).resolves.toBe('de');
      const overwrite = await request(app)
        .patch('/api/users/preferences/language')
        .set('Cookie', created.cookie)
        .send({ language: 'es', ifUnset: false });
      expect(overwrite.status).toBe(200);
      expect(overwrite.body).toEqual({ language: 'es' });
      await expect(getLanguagePreference(created.id)).resolves.toBe('es');
    });

    it('is authenticated, verified, CSRF-protected, and actor-scoped', async () => {
      expect((await request(app).get('/api/users/preferences/language')).status).toBe(401);
      expect(
        (
          await request(app)
            .patch('/api/users/preferences/language')
            .send({ language: 'fr' })
        ).status,
      ).toBe(401);

      const unverified = await signupTestUser(app, { email: 'language-unverified@test.com' });
      expect(
        (
          await request(app)
            .get('/api/users/preferences/language')
            .set('Cookie', unverified.cookie)
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app)
            .patch('/api/users/preferences/language')
            .set('Cookie', unverified.cookie)
            .send({ language: 'fr' })
        ).status,
      ).toBe(403);

      const actor = await signupVerifiedUser(app, { email: 'language-csrf@test.com' });
      const other = await signupVerifiedUser(app, { email: 'language-other@test.com' });
      __setCsrfBypassForTests(false);
      try {
        const rejected = await request(app)
          .patch('/api/users/preferences/language')
          .set('Cookie', actor.cookie)
          .send({ language: 'ru' });
        expect(rejected.status).toBe(403);

        const tokenResponse = await request(app).get('/api/security/csrf-token');
        const csrfCookie = (tokenResponse.headers['set-cookie'] as unknown as string[])
          .map((entry) => entry.split(';')[0])
          .join('; ');
        const accepted = await request(app)
          .patch('/api/users/preferences/language')
          .set('Cookie', `${actor.cookie}; ${csrfCookie}`)
          .set('x-csrf-token', tokenResponse.body.csrfToken as string)
          .send({ language: 'ru' });
        expect(accepted.status).toBe(200);
      } finally {
        __setCsrfBypassForTests(true);
      }
      expect((await User.findById(actor.id).lean())?.language).toBe('ru');
      expect((await User.findById(other.id).lean())?.language).toBe('en');
    });

    it('returns localized 404s when the Better Auth mirror is missing', async () => {
      const created = await signupVerifiedUser(app, { email: 'language-missing@test.com' });
      await User.deleteOne({ _id: created.id });
      for (const language of ['en', 'fr'] as const) {
        const response = await request(app)
          .get('/api/users/preferences/language')
          .set('Cookie', created.cookie)
          .set('x-lang', language);
        expect(response.status).toBe(404);
        expect(response.body.error.message).toBe(
          DICTIONARIES[language].errors.userNotFound,
        );
      }
      const patch = await request(app)
        .patch('/api/users/preferences/language')
        .set('Cookie', created.cookie)
        .set('x-lang', 'fr')
        .send({ language: 'de' });
      expect(patch.status).toBe(404);
      expect(patch.body.error.message).toBe(DICTIONARIES.fr.errors.userNotFound);
      await expect(updateLanguagePreference(created.id, 'en')).rejects.toMatchObject({
        status: 404,
      });
      await expect(updateLanguagePreference(created.id, 'en', true)).rejects.toMatchObject({
        status: 404,
      });
    });
  });

  describe('notification preferences', () => {
    it('resolveNotificationPreferences returns all-true defaults for an unknown user', async () => {
      const prefs = await resolveNotificationPreferences('507f1f77bcf86cd799439011');
      expect(prefs).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
    });

    it('resolveNotificationPreferences returns all-true for a user with no stored field', async () => {
      const created = await signupVerifiedUser(app, { email: 'defaults@test.com' });
      // Force the field to be absent (Mongoose sets defaults on save; strip them).
      await User.updateOne(
        { _id: created.id },
        { $unset: { notificationPreferences: '' } },
      );
      const prefs = await resolveNotificationPreferences(created.id);
      expect(prefs).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
    });

    it('resolveNotificationPreferences merges stored partial over defaults', async () => {
      const created = await signupVerifiedUser(app, { email: 'partial@test.com' });
      await User.updateOne(
        { _id: created.id },
        { $set: { 'notificationPreferences.emailMarketing': false } },
      );
      const prefs = await resolveNotificationPreferences(created.id);
      expect(prefs.emailMarketing).toBe(false);
      expect(prefs.emailAuditComplete).toBe(true);
      expect(prefs.emailRankDrop).toBe(true);
    });

    it('updateNotificationPreferences persists a subset and returns the merged object', async () => {
      const created = await signupVerifiedUser(app, { email: 'update@test.com' });
      const merged = await updateNotificationPreferences(created.id, {
        emailAuditComplete: false,
        emailRankDrop: false,
      });
      expect(merged).toEqual({
        emailAuditComplete: false,
        emailRankDrop: false,
        emailMarketing: true,
        emailMonitorChange: true,
        // Alert-rule notifications are their own
        // opt-out, so muting them never also mutes rank drops or monitoring.
        emailAlerts: true,
      });
      const round = await resolveNotificationPreferences(created.id);
      expect(round).toEqual(merged);
    });

    it('updateNotificationPreferences throws 404 for an unknown user', async () => {
      await expect(
        updateNotificationPreferences('507f1f77bcf86cd799439011', { emailMarketing: false }),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('GET /api/users/notifications returns defaults for a fresh user', async () => {
      const created = await signupVerifiedUser(app, { email: 'get@test.com' });
      const res = await request(app)
        .get('/api/users/notifications')
        .set('Cookie', created.cookie);
      expect(res.status).toBe(200);
      expect(res.body.preferences).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
    });

    it('GET /api/users/notifications returns 401 unauthenticated', async () => {
      const res = await request(app).get('/api/users/notifications');
      expect(res.status).toBe(401);
    });

    it('PATCH /api/users/notifications persists a subset and the next GET reflects it', async () => {
      const created = await signupVerifiedUser(app, { email: 'patch@test.com' });
      const patch = await request(app)
        .patch('/api/users/notifications')
        .set('Cookie', created.cookie)
        .send({ emailMarketing: false, emailRankDrop: false });
      expect(patch.status).toBe(200);
      expect(patch.body.preferences).toEqual({
        emailAuditComplete: true,
        emailRankDrop: false,
        emailMarketing: false,
        emailMonitorChange: true,
        // Alert-rule notifications are their own
        // opt-out, so muting them never also mutes rank drops or monitoring.
        emailAlerts: true,
      });

      const get = await request(app)
        .get('/api/users/notifications')
        .set('Cookie', created.cookie);
      expect(get.status).toBe(200);
      expect(get.body.preferences).toEqual(patch.body.preferences);
    });

    it('PATCH /api/users/notifications rejects invalid bodies with 400', async () => {
      const created = await signupVerifiedUser(app, { email: 'invalid@test.com' });
      // Unknown field
      const unknown = await request(app)
        .patch('/api/users/notifications')
        .set('Cookie', created.cookie)
        .send({ emailUnknown: false });
      expect(unknown.status).toBe(400);
      // Empty body
      const empty = await request(app)
        .patch('/api/users/notifications')
        .set('Cookie', created.cookie)
        .send({});
      expect(empty.status).toBe(400);
      // Non-boolean value
      const nonBool = await request(app)
        .patch('/api/users/notifications')
        .set('Cookie', created.cookie)
        .send({ emailMarketing: 'nope' });
      expect(nonBool.status).toBe(400);
    });

    it('PATCH /api/users/notifications returns 401 unauthenticated', async () => {
      const res = await request(app)
        .patch('/api/users/notifications')
        .send({ emailMarketing: false });
      expect(res.status).toBe(401);
    });
  });
});
