import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pino } from 'pino';
import { Writable } from 'node:stream';
import { Types } from 'mongoose';
import { BASE_ERROR_CODES } from '@better-auth/core/error';
import { TWO_FACTOR_ERROR_CODES } from 'better-auth/plugins';
import type { Response as SupertestResponse } from 'supertest';
import { env } from '../../config/env.js';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import {
  startTestPostgres,
  stopTestPostgres,
} from '../../shared/testing/postgres.js';
import { localeFromFetchRequest } from '../../shared/i18n/request-locale.js';
import { ROLE_ADMIN, ROLE_MEMBER, User } from '../users/index.js';
import {
  createAuth,
  createBetterAuthLogger,
  decodeJwtPayload,
  getAuth,
  mirrorUserCreate,
  mirrorUserUpdate,
  rejectUnboundDirectOAuthTokens,
  setAuth,
  splitName,
} from './auth.js';
import {
  BETTER_AUTH_ERROR_KEYS,
  RANKME_AUTH_ERROR_CODES,
  localizeBetterAuthResponse,
} from './better-auth-errors.js';

function encodeJwtPayload(payload: Record<string, unknown>): string {
  const b64 = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64');
  const b64url = b64.replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `header.${b64url}.signature`;
}

describe('decodeJwtPayload', () => {
  it('decodes a base64url payload with `updateTo` (change-email verification token)', () => {
    const token = encodeJwtPayload({
      email: 'old@example.com',
      updateTo: 'new@example.com',
      requestType: 'change-email-verification',
    });
    const payload = decodeJwtPayload(token);
    expect(payload).toEqual({
      email: 'old@example.com',
      updateTo: 'new@example.com',
      requestType: 'change-email-verification',
    });
  });

  it('decodes a signup verification token (no updateTo field)', () => {
    const token = encodeJwtPayload({ email: 'signup@example.com' });
    const payload = decodeJwtPayload(token);
    expect(payload).toEqual({ email: 'signup@example.com' });
    expect(payload?.updateTo).toBeUndefined();
  });

  it('handles a base64url payload that needs padding', () => {
    // 4-char payload → base64 already padded; a 5-char stringify (rarely
    // exact multiple of 3 bytes pre-encoding) exercises the padding branch.
    const token = encodeJwtPayload({ x: 'y' });
    expect(decodeJwtPayload(token)).toEqual({ x: 'y' });
  });

  it('returns null when the payload segment is not valid JSON (catch branch)', () => {
    // Three segments (so we reach the try/catch), but the middle segment is
    // an arbitrary string that doesn't base64-decode into valid JSON.
    expect(decodeJwtPayload('header.not-b64-json.signature')).toBeNull();
  });
});

describe('splitName', () => {
  it('splits first/rest, collapsing whitespace', () => {
    expect(splitName('Ada Lovelace')).toEqual({ firstName: 'Ada', lastName: 'Lovelace' });
    expect(splitName('  Grace   Brewster Hopper ')).toEqual({
      firstName: 'Grace',
      lastName: 'Brewster Hopper',
    });
  });

  it('handles single names and empties', () => {
    expect(splitName('Plato')).toEqual({ firstName: 'Plato', lastName: '' });
    expect(splitName('   ')).toEqual({ firstName: '', lastName: '' });
    expect(splitName('')).toEqual({ firstName: '', lastName: '' });
  });
});

describe('localeFromFetchRequest', () => {
  it('prefers the x-lang header override', () => {
    const req = new Request('http://x.test', { headers: { 'x-lang': 'de' } });
    expect(localeFromFetchRequest(req)).toBe('de');
  });

  it('falls back to the lang cookie, including URI-encoded and malformed values', () => {
    const cookie = new Request('http://x.test', { headers: { cookie: 'a=b; lang=ru' } });
    expect(localeFromFetchRequest(cookie)).toBe('ru');
    const encoded = new Request('http://x.test', { headers: { cookie: 'lang=%7A%68' } });
    expect(localeFromFetchRequest(encoded)).toBe('zh');
    // Malformed percent-encoding must not throw — raw value is used.
    const malformed = new Request('http://x.test', { headers: { cookie: 'lang=%E0%A4%A' } });
    expect(localeFromFetchRequest(malformed)).toBe(env.DEFAULT_LOCALE);
  });

  it('ignores non-matching cookies and uses Accept-Language next', () => {
    const req = new Request('http://x.test', {
      headers: { cookie: 'session=abc; other=1', 'accept-language': 'es-ES,es;q=0.9' },
    });
    expect(localeFromFetchRequest(req)).toBe('es');
  });

  it('defaults when the request is absent or headerless', () => {
    expect(localeFromFetchRequest()).toBe(env.DEFAULT_LOCALE);
    expect(localeFromFetchRequest(new Request('http://x.test'))).toBe(env.DEFAULT_LOCALE);
  });
});

describe('Better Auth localized error contract', () => {
  it('pins every installed base and enabled two-factor error code', () => {
    expect(Object.keys(BASE_ERROR_CODES)).toEqual([
      'USER_NOT_FOUND',
      'FAILED_TO_CREATE_USER',
      'FAILED_TO_CREATE_SESSION',
      'FAILED_TO_UPDATE_USER',
      'FAILED_TO_GET_SESSION',
      'INVALID_PASSWORD',
      'INVALID_EMAIL',
      'INVALID_EMAIL_OR_PASSWORD',
      'INVALID_USER',
      'SOCIAL_ACCOUNT_ALREADY_LINKED',
      'PROVIDER_NOT_FOUND',
      'INVALID_TOKEN',
      'TOKEN_EXPIRED',
      'ID_TOKEN_NOT_SUPPORTED',
      'FAILED_TO_GET_USER_INFO',
      'USER_EMAIL_NOT_FOUND',
      'EMAIL_NOT_VERIFIED',
      'PASSWORD_TOO_SHORT',
      'PASSWORD_TOO_LONG',
      'USER_ALREADY_EXISTS',
      'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL',
      'EMAIL_CAN_NOT_BE_UPDATED',
      'CHANGE_EMAIL_DISABLED',
      'CREDENTIAL_ACCOUNT_NOT_FOUND',
      'SESSION_EXPIRED',
      'FAILED_TO_UNLINK_LAST_ACCOUNT',
      'ACCOUNT_NOT_FOUND',
      'USER_ALREADY_HAS_PASSWORD',
      'CROSS_SITE_NAVIGATION_LOGIN_BLOCKED',
      'VERIFICATION_EMAIL_NOT_ENABLED',
      'EMAIL_ALREADY_VERIFIED',
      'EMAIL_MISMATCH',
      'SESSION_NOT_FRESH',
      'LINKED_ACCOUNT_ALREADY_EXISTS',
      'INVALID_ORIGIN',
      'INVALID_CALLBACK_URL',
      'INVALID_REDIRECT_URL',
      'INVALID_ERROR_CALLBACK_URL',
      'INVALID_NEW_USER_CALLBACK_URL',
      'MISSING_OR_NULL_ORIGIN',
      'CALLBACK_URL_REQUIRED',
      'FAILED_TO_CREATE_VERIFICATION',
      'FIELD_NOT_ALLOWED',
      'ASYNC_VALIDATION_NOT_SUPPORTED',
      'VALIDATION_ERROR',
      'MISSING_FIELD',
      'METHOD_NOT_ALLOWED_DEFER_SESSION_REQUIRED',
      'BODY_MUST_BE_AN_OBJECT',
      'PASSWORD_ALREADY_SET',
    ]);
    expect(Object.keys(TWO_FACTOR_ERROR_CODES)).toEqual([
      'OTP_NOT_ENABLED',
      'OTP_HAS_EXPIRED',
      'TOTP_NOT_ENABLED',
      'TWO_FACTOR_NOT_ENABLED',
      'BACKUP_CODES_NOT_ENABLED',
      'INVALID_BACKUP_CODE',
      'INVALID_CODE',
      'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE',
      'ACCOUNT_TEMPORARILY_LOCKED',
      'INVALID_TWO_FACTOR_COOKIE',
    ]);
    expect(Object.keys(BETTER_AUTH_ERROR_KEYS).sort()).toEqual(
      [
        ...Object.keys(BASE_ERROR_CODES),
        ...Object.keys(TWO_FACTOR_ERROR_CODES),
        ...Object.keys(RANKME_AUTH_ERROR_CODES),
      ].sort(),
    );
  });

  it('localizes a known top-level JSON error and preserves response metadata', async () => {
    const upstream = new Response(
      JSON.stringify({ code: 'INVALID_EMAIL_OR_PASSWORD', message: 'upstream sentinel', retry: 2 }),
      {
        status: 401,
        statusText: 'Denied',
        headers: {
          'content-type': 'application/json',
          'content-length': '999',
          'set-cookie': 'better-auth.session=cleared; HttpOnly',
          'x-rate-limit': '4',
        },
      },
    );
    const localized = await localizeBetterAuthResponse(
      new Request('https://rankme.fast/api/auth/sign-in/email', {
        headers: { 'x-lang': 'ar' },
      }),
      upstream,
    );
    expect(localized.status).toBe(401);
    expect(localized.statusText).toBe('Denied');
    expect(localized.headers.get('content-language')).toBe('ar');
    expect(localized.headers.get('content-length')).toBeNull();
    expect(localized.headers.get('set-cookie')).toContain('better-auth.session=cleared');
    expect(localized.headers.get('x-rate-limit')).toBe('4');
    const body = await localized.json();
    expect(body).toEqual({
      code: 'INVALID_EMAIL_OR_PASSWORD',
      message: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
      messageKey: 'errors.invalidCredentials',
      retry: 2,
    });
    expect(JSON.stringify(body)).not.toContain('upstream sentinel');
  });

  it('localizes nested and unknown codes with a status-family fallback', async () => {
    const response = await localizeBetterAuthResponse(
      new Request('https://rankme.fast/api/auth/plugin', {
        headers: { 'accept-language': 'de' },
      }),
      Response.json(
        { error: { code: 'FUTURE_PLUGIN_CODE', message: 'future upstream', detail: 'safe' } },
        { status: 418 },
      ),
    );
    expect(await response.json()).toEqual({
      error: {
        code: 'FUTURE_PLUGIN_CODE',
        message: 'Ungültige Anfrage.',
        messageKey: 'errors.badRequest',
        detail: 'safe',
      },
    });
  });

  it('uses the status-family code for a malformed or missing upstream code', async () => {
    const malformed = await localizeBetterAuthResponse(
      new Request('https://rankme.fast/api/auth/x'),
      Response.json({ code: 'not stable', message: 'raw' }, { status: 503 }),
    );
    expect(await malformed.json()).toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      messageKey: 'errors.serviceUnavailable',
    });
    const missing = await localizeBetterAuthResponse(
      new Request('https://rankme.fast/api/auth/x'),
      Response.json({ message: 'raw' }, { status: 400 }),
    );
    expect(await missing.json()).toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('does not rewrite success, non-JSON, malformed JSON, or primitive JSON bodies', async () => {
    const request = new Request('https://rankme.fast/api/auth/x');
    const success = Response.json({ message: 'success body' });
    expect(await localizeBetterAuthResponse(request, success)).toBe(success);
    const html = new Response('<p>error</p>', {
      status: 400,
      headers: { 'content-type': 'text/html' },
    });
    expect(await localizeBetterAuthResponse(request, html)).toBe(html);
    const broken = new Response('{', {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
    expect(await localizeBetterAuthResponse(request, broken)).toBe(broken);
    const primitive = Response.json('error', { status: 400 });
    expect(await localizeBetterAuthResponse(request, primitive)).toBe(primitive);
  });
});

describe('Mongo mirror writers', () => {
  beforeAll(async () => {
    await startMemoryMongo();
  });

  afterAll(async () => {
    await stopMemoryMongo();
  });

  beforeEach(async () => {
    await clearCollections();
  });

  it('mirrorUserCreate keeps an explicit role and is create-only on re-run', async () => {
    const id = new Types.ObjectId().toHexString();
    await mirrorUserCreate({
      id,
      email: 'admin@example.com',
      name: 'Root Admin',
      emailVerified: true,
      role: ROLE_ADMIN,
    });
    const doc = await User.findById(id);
    expect(doc?.role).toBe(ROLE_ADMIN);
    expect(doc?.emailVerified).toBe(true);

    // $setOnInsert semantics: an existing mirror is never clobbered.
    await mirrorUserCreate({
      id,
      email: 'changed@example.com',
      name: 'Changed Name',
      emailVerified: false,
      role: ROLE_MEMBER,
    });
    const unchanged = await User.findById(id);
    expect(unchanged?.email).toBe('admin@example.com');
    expect(unchanged?.role).toBe(ROLE_ADMIN);
  });

  it('mirrorUserCreate falls back to Member for null/empty roles', async () => {
    const idNull = new Types.ObjectId().toHexString();
    await mirrorUserCreate({
      id: idNull,
      email: 'null-role@example.com',
      name: 'No Role',
      emailVerified: false,
      role: null,
    });
    expect((await User.findById(idNull))?.role).toBe(ROLE_MEMBER);

    const idEmpty = new Types.ObjectId().toHexString();
    await mirrorUserCreate({
      id: idEmpty,
      email: 'empty-role@example.com',
      name: 'Empty Role',
      emailVerified: false,
      role: '',
    });
    expect((await User.findById(idEmpty))?.role).toBe(ROLE_MEMBER);
  });

  it('mirrorUserUpdate syncs email + emailVerified onto the mirror', async () => {
    const id = new Types.ObjectId().toHexString();
    await mirrorUserCreate({
      id,
      email: 'before@example.com',
      name: 'Sync Me',
      emailVerified: false,
    });
    await mirrorUserUpdate({
      id,
      email: 'after@example.com',
      name: 'Sync Me',
      emailVerified: true,
    });
    const doc = await User.findById(id);
    expect(doc?.email).toBe('after@example.com');
    expect(doc?.emailVerified).toBe(true);
  });
});

describe('createAuth / instance management', () => {
  beforeAll(async () => {
    await startTestPostgres();
  });

  afterAll(async () => {
    await stopTestPostgres();
  });

  afterEach(() => {
    setAuth(null);
    delete (env as Record<string, unknown>).GOOGLE_CLIENT_ID;
    delete (env as Record<string, unknown>).GOOGLE_CLIENT_SECRET;
  });

  it('registers the Google provider only when both credentials are configured', async () => {
    const { getTestDb } = await import('../../shared/testing/postgres.js');

    const withoutGoogle = createAuth(getTestDb());
    expect(Object.keys(withoutGoogle.options.socialProviders ?? {})).toEqual([]);

    env.GOOGLE_CLIENT_ID = 'google-client-id';
    env.GOOGLE_CLIENT_SECRET = 'google-client-secret';
    const withGoogle = createAuth(getTestDb());
    expect(withGoogle.options.socialProviders?.google).toMatchObject({
      clientId: 'google-client-id',
      accessType: 'offline',
      prompt: 'select_account consent',
    });
    expect(withGoogle.options.account?.encryptOAuthTokens).toBe(true);
    expect(withGoogle.options.databaseHooks?.account?.create?.before).toBeDefined();
    expect(withGoogle.options.databaseHooks?.account?.update?.before).toBeDefined();
    expect(withGoogle.options.hooks?.before).toBeDefined();
    expect(withGoogle.options.logger?.log).toBeTypeOf('function');
  });

  it('rejects unbound direct-token OAuth while preserving redirect-style requests', () => {
    const direct = {
      provider: 'google',
      idToken: {
        token: 'verified-id-token',
        accessToken: 'unbound-access-token',
        refreshToken: 'unbound-refresh-token',
      },
    };
    expect(() => rejectUnboundDirectOAuthTokens('/link-social', direct)).toThrow(
      'DIRECT_ID_TOKEN_OAUTH_DISABLED',
    );
    expect(() => rejectUnboundDirectOAuthTokens('/sign-in/social', direct)).toThrow(
      'DIRECT_ID_TOKEN_OAUTH_DISABLED',
    );
    expect(() =>
      rejectUnboundDirectOAuthTokens('/link-social', {
        provider: 'google',
        callbackURL: `${env.CLIENT_URL}/sites/aaaaaaaaaaaaaaaaaaaaaaaa?tab=google`,
        scopes: ['openid'],
      }),
    ).not.toThrow();
    expect(() => rejectUnboundDirectOAuthTokens('/sign-in/email', direct)).not.toThrow();
  });

  it('Better Auth logger never emits raw messages, token args, or ciphertext', () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });
    const sink = pino({ level: 'debug' }, stream);
    const upstream = createBetterAuthLogger(sink);
    upstream.log(
      'error',
      'provider failed with plaintext-token-sentinel',
      Object.assign(new Error('ciphertext-sentinel'), { code: 'OAUTH_CALLBACK_FAILED' }),
      { accessToken: 'access-token-sentinel', code: 'SAFE_CODE' },
    );
    const invalidName = new Error('also hidden');
    invalidName.name = 'not a safe diagnostic name';
    upstream.log('warn', 'also hidden', invalidName, 0, { code: 'not a safe code' });
    const output = chunks.join('');
    expect(output).not.toContain('plaintext-token-sentinel');
    expect(output).not.toContain('ciphertext-sentinel');
    expect(output).not.toContain('access-token-sentinel');
    expect(output).toContain('OAUTH_CALLBACK_FAILED');
    expect(output).toContain('SAFE_CODE');
    expect(output).toContain('Error');
  });

  it('sends signup verification by default and permits an explicit test-harness opt-out', async () => {
    const { getTestDb } = await import('../../shared/testing/postgres.js');

    const productionDefault = createAuth(getTestDb());
    expect(productionDefault.options.emailVerification?.sendOnSignUp).toBe(true);

    const testHarness = createAuth(getTestDb(), { sendVerificationOnSignUp: false });
    expect(testHarness.options.emailVerification?.sendOnSignUp).toBe(false);
  });

  it('trusts the exact app origin and shares auth cookies only for a split subdomain', async () => {
    const { getTestDb } = await import('../../shared/testing/postgres.js');
    const originalAppUrl = env.APP_URL;
    env.APP_URL = 'http://app.localhost:3000';
    const splitDomain = createAuth(getTestDb());
    env.APP_URL = originalAppUrl;

    expect(splitDomain.options.trustedOrigins).toEqual([
      'http://localhost:3000',
      'http://app.localhost:3000',
    ]);
    expect(splitDomain.options.advanced?.crossSubDomainCookies).toEqual({
      enabled: true,
      domain: 'localhost',
    });

    const singleDomain = createAuth(getTestDb());
    expect(singleDomain.options.advanced?.crossSubDomainCookies).toBeUndefined();
  });

  it('generateId emits ObjectId-compatible hex', async () => {
    const { getTestDb } = await import('../../shared/testing/postgres.js');
    const auth = createAuth(getTestDb());
    const generateId = auth.options.advanced?.database?.generateId;
    expect(typeof generateId).toBe('function');
    const id = (generateId as (opts: { model: string }) => string)({ model: 'user' });
    expect(id).toMatch(/^[0-9a-f]{24}$/);
    expect(Types.ObjectId.isValid(id)).toBe(true);
  });

  it('getAuth lazily builds a singleton over the production client and setAuth swaps it', async () => {
    setAuth(null);
    const lazy = getAuth();
    expect(lazy).toBeDefined();
    // Second call returns the SAME instance (memoized).
    expect(getAuth()).toBe(lazy);

    const { getTestDb } = await import('../../shared/testing/postgres.js');
    const replacement = createAuth(getTestDb());
    setAuth(replacement);
    expect(getAuth()).toBe(replacement);
  });
});

describe('cookieFrom', () => {
  it('collapses Set-Cookie headers into a Cookie header, dropping cleared pairs', async () => {
    const { cookieFrom } = await import('../../shared/testing/auth.js');
    const res = {
      headers: {
        'set-cookie': [
          'better-auth.session_token=abc123; Path=/; HttpOnly',
          'cleared=; Max-Age=0',
          '',
        ],
      },
    } as unknown as SupertestResponse;
    expect(cookieFrom(res)).toBe('better-auth.session_token=abc123');
  });

  it('returns an empty string when no Set-Cookie header is present', async () => {
    const { cookieFrom } = await import('../../shared/testing/auth.js');
    const res = { headers: {} } as unknown as SupertestResponse;
    expect(cookieFrom(res)).toBe('');
  });
});
