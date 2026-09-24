import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { requireVerified, setAuth, type Auth } from '../../modules/auth/index.js';
import { requestId } from './request-id.js';
import { language } from './language.js';
import { requireCsrf } from './csrf.js';
import { rateLimitHandler } from './rate-limit.js';
import { errorHandler } from './error-handler.js';
import { requireAuth } from './require-auth.js';
import { env } from '../../config/env.js';
import { HttpError } from '../utils/http-error.js';
import { DICTIONARIES, translate } from '../i18n/index.js';
import { hasTranslationKey } from '../i18n/errors.js';
import { logger } from '../../config/logger.js';
import { User } from '../../modules/users/users.model.js';

interface FakeRes {
  body?: unknown;
  statusCode?: number;
  headers: Record<string, string>;
  status: (code: number) => FakeRes;
  json: (body: unknown) => FakeRes;
  setHeader: (k: string, v: string) => FakeRes;
  /** `requireAuth` releases the account work lease on `finish`/`close`. */
  once: (event: string, listener: () => void) => FakeRes;
}

function mockRes(): FakeRes & Response {
  const res: FakeRes = {
    headers: {},
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
    setHeader(k: string, v: string) {
      res.headers[k] = v;
      return res;
    },
    once() {
      return res;
    },
  };
  return res as unknown as FakeRes & Response;
}

describe('requestId middleware', () => {
  it('reuses a short incoming id', () => {
    const req = { header: () => 'abc123' } as unknown as Request;
    const res = mockRes();
    const next = vi.fn();
    requestId(req, res, next);
    expect(req.id).toBe('abc123');
    expect(next).toHaveBeenCalled();
  });

  it('generates a uuid when the incoming id is missing or too long', () => {
    for (const incoming of [undefined, 'x'.repeat(200)]) {
      const req = { header: () => incoming } as unknown as Request;
      const res = mockRes();
      requestId(req, res, vi.fn());
      expect(req.id).toBeDefined();
      expect(req.id).not.toBe(incoming);
    }
  });

  it('regenerates when the incoming id contains disallowed characters', () => {
    // Newlines/quotes could be reflected into headers and downstream logs —
    // treat as invalid and mint a fresh uuid.
    for (const incoming of ['abc\ndef', 'has spaces', 'quote"here', 'ok/nope', '']) {
      const req = { header: () => incoming } as unknown as Request;
      const res = mockRes();
      requestId(req, res, vi.fn());
      expect(req.id).toBeDefined();
      expect(req.id).not.toBe(incoming);
      // The response header always carries a value.
      expect(res.headers['x-request-id']).toBeDefined();
    }
  });
});

describe('language middleware', () => {
  const run = (headers: Record<string, unknown>) => {
    const req = { headers } as unknown as Request;
    const res = mockRes();
    language(req, res, vi.fn());
    return { req, res };
  };

  it('resolves from a valid language cookie', () => {
    const { req, res } = run({ cookie: 'lang=fr' });
    expect(req.language).toBe('fr');
    expect(res.headers['Content-Language']).toBe('fr');
  });

  it('falls back to raw value when the cookie is malformed', () => {
    const { req } = run({ cookie: 'lang=%E0%A4%A' });
    expect(req.language).toBeDefined();
  });

  it('ignores a cookie header without the language cookie', () => {
    const { req } = run({ cookie: 'other=1; more=2' });
    expect(req.language).toBeDefined();
  });

  it('reads the first value of array-valued headers', () => {
    const { req, res } = run({
      'x-lang': ['de', 'fr'],
      'accept-language': ['es', 'en'],
    });
    expect(req.language).toBe('de');
    expect(res.headers['Content-Language']).toBe('de');
  });
});

describe('requireCsrf middleware', () => {
  const call = (req: Partial<Request>) => {
    const next = vi.fn();
    requireCsrf(req as Request, mockRes(), next);
    return next;
  };

  it('passes safe methods through', () => {
    expect(call({ method: 'GET', headers: {} }).mock.calls[0]?.[0]).toBeUndefined();
  });

  it('exempts a well-formed public-API bearer key (Bearer rmf_…)', () => {
    const next = call({ method: 'POST', headers: { authorization: 'Bearer rmf_abc123DEF-_' } });
    expect(next.mock.calls[0]?.[0]).toBeUndefined();
  });

  it('does NOT exempt a non-api-key Authorization header (no CSRF bypass)', () => {
    const next = call({ method: 'POST', headers: { authorization: 'JWT x' } });
    expect(next.mock.calls[0]?.[0]).toMatchObject({ status: 403 });
  });

  it('rejects when tokens are missing', () => {
    const next = call({ method: 'POST', headers: {} });
    expect(next.mock.calls[0]?.[0]).toMatchObject({ status: 403 });
  });

  it('rejects when a cookie header is present but has no CSRF cookie', () => {
    const next = call({
      method: 'POST',
      headers: {
        cookie: 'other=1; more=2',
        [env.CSRF_HEADER_NAME.toLowerCase()]: 'sometoken',
      },
    });
    expect(next.mock.calls[0]?.[0]).toMatchObject({ status: 403 });
  });

  it('rejects when cookie and header tokens differ in length', () => {
    const next = call({
      method: 'POST',
      headers: {
        cookie: `${env.CSRF_COOKIE_NAME}=short`,
        [env.CSRF_HEADER_NAME.toLowerCase()]: 'muchlongertoken',
      },
    });
    expect(next.mock.calls[0]?.[0]).toMatchObject({ status: 403 });
  });

  it('accepts a matching double-submit token (malformed-encoding cookie path)', () => {
    const next = call({
      method: 'POST',
      headers: {
        cookie: `${env.CSRF_COOKIE_NAME}=%E0%A4%A`,
        [env.CSRF_HEADER_NAME.toLowerCase()]: '%E0%A4%A',
      },
    });
    expect(next.mock.calls[0]?.[0]).toBeUndefined();
  });

  it('reads the first element when the CSRF header is array-valued', () => {
    const next = call({
      method: 'POST',
      headers: {
        cookie: `${env.CSRF_COOKIE_NAME}=abc`,
        [env.CSRF_HEADER_NAME.toLowerCase()]: ['abc', 'other'],
      },
    });
    expect(next.mock.calls[0]?.[0]).toBeUndefined();
  });

  it('rejects with the typed CSRF descriptor rather than pre-translated prose', () => {
    const next = call({ method: 'POST', headers: {} });
    expect(next.mock.calls[0]?.[0]).toMatchObject({
      status: 403,
      message: 'security.error.csrfInvalid',
      messageKey: 'security.error.csrfInvalid',
      code: 'CSRF_INVALID',
    });
  });

  it('skips cookie segments that contain no "=" (idx === -1)', () => {
    const next = call({
      method: 'POST',
      headers: {
        cookie: `flagonly; ${env.CSRF_COOKIE_NAME}=abc`,
        [env.CSRF_HEADER_NAME.toLowerCase()]: 'abc',
      },
    });
    expect(next.mock.calls[0]?.[0]).toBeUndefined();
  });
});

describe('rateLimitHandler', () => {
  it('keeps the legacy string envelope and adds sibling errorInfo metadata', () => {
    const res = mockRes();
    rateLimitHandler({ language: 'fr' } as unknown as Request, res);
    const body = res.body as {
      error: string;
      errorInfo: { code: string; messageKey: string; message: string };
    };
    // The legacy family stays a plain string — a caller parsing `error` as
    // copy keeps working.
    expect(body.error).toBe(translate('fr', 'security.error.rateLimited'));
    expect(body.errorInfo).toEqual({
      code: 'SECURITY_ERROR_RATE_LIMITED',
      messageKey: 'security.error.rateLimited',
      message: translate('fr', 'security.error.rateLimited'),
    });
    expect(res.headers['Content-Language']).toBe('fr');
  });

  it('falls back to the default locale when the request carries none', () => {
    const res = mockRes();
    rateLimitHandler({} as Request, res);
    expect((res.body as { error: string }).error).toMatch(/Too many/);
    expect(res.headers['Content-Language']).toBe('en');
  });
});

describe('errorHandler development stack branch', () => {
  const original = env.NODE_ENV;
  afterEach(() => {
    (env as { NODE_ENV: string }).NODE_ENV = original;
  });

  it('includes the stack for a plain error in development, beside the localized metadata', () => {
    (env as { NODE_ENV: string }).NODE_ENV = 'development';
    const res = mockRes();
    const req = { language: 'en' } as unknown as Request;
    errorHandler(new Error('kaboom'), req, res, vi.fn());
    expect(res.statusCode).toBe(500);
    const body = res.body as {
      error: { stack?: string; message: string; code: string; messageKey: string };
    };
    expect(body.error.stack).toContain('kaboom');
    expect(body.error.message).toBe(translate('en', 'errors.internal'));
    expect(body.error.code).toBe('INTERNAL');
    expect(body.error.messageKey).toBe('errors.internal');
  });

  it('omits the stack in production and logs only safe metadata', () => {
    (env as { NODE_ENV: string }).NODE_ENV = 'production';
    const error = vi.spyOn(logger, 'error').mockImplementation(() => logger);
    const res = mockRes();
    errorHandler(new Error('kaboom'), {} as Request, res, vi.fn());
    expect((res.body as { error: { stack?: string } }).error.stack).toBeUndefined();
    expect(error).toHaveBeenCalledWith(
      {
        reqId: undefined,
        status: 500,
        code: 'INTERNAL',
        messageKey: 'errors.internal',
        causeName: 'Error',
      },
      'unhandled error',
    );
    expect(JSON.stringify(error.mock.calls[0]?.[0])).not.toContain('kaboom');
    error.mockRestore();
  });

  it('tolerates a thrown non-Error value without a cause name', () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => logger);
    const res = mockRes();
    errorHandler('just a string', {} as Request, res, vi.fn());
    expect(res.statusCode).toBe(500);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ causeName: undefined }),
      'unhandled error',
    );
    error.mockRestore();
  });

  it('has no stack to attach when development throws a non-Error value', () => {
    (env as { NODE_ENV: string }).NODE_ENV = 'development';
    const res = mockRes();
    errorHandler({ nope: true }, {} as Request, res, vi.fn());
    expect(res.statusCode).toBe(500);
    expect((res.body as { error: { stack?: string } }).error.stack).toBeUndefined();
  });
});

describe('errorHandler cause logging', () => {
  it('logs the cause class name only — never the upstream message', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    const vendorErr = new Error('DataForSEO 40104: verify your account');
    vendorErr.name = 'VendorAuthError';
    const res = mockRes();
    errorHandler(
      new HttpError(503, { code: 'COMPETITORS_ERRORS_UNAVAILABLE', messageKey: 'competitors.errors.unavailable' }, undefined, { cause: vendorErr }),
      {} as Request,
      res,
      vi.fn(),
    );
    expect(res.statusCode).toBe(503);
    expect(warn).toHaveBeenCalledWith(
      {
        reqId: undefined,
        status: 503,
        code: 'COMPETITORS_ERRORS_UNAVAILABLE',
        messageKey: 'competitors.errors.unavailable',
        causeName: 'VendorAuthError',
      },
      'http error',
    );
    // The vendor's own prose reaches neither the log nor the response.
    const logged = JSON.stringify(warn.mock.calls[0]?.[0]);
    expect(logged).not.toContain('40104');
    expect(JSON.stringify(res.body)).not.toContain('40104');
    warn.mockRestore();
  });

  it('omits causeName from the log payload when the HttpError has none', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    const res = mockRes();
    errorHandler(HttpError.notFound({ code: 'ERRORS_PROJECT_NOT_FOUND', messageKey: 'errors.projectNotFound' }), {} as Request, res, vi.fn());
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ status: 404, causeName: undefined }),
      'http error',
    );
    warn.mockRestore();
  });

  it('drops a non-Error cause rather than serializing it', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    const res = mockRes();
    errorHandler(
      new HttpError(500, { code: 'ERRORS_INTERNAL', messageKey: 'errors.internal' }, undefined, { cause: 'raw upstream text' }),
      {} as Request,
      res,
      vi.fn(),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ causeName: undefined }),
      'http error',
    );
    warn.mockRestore();
  });
});

describe('errorHandler localized metadata contract', () => {
  const envelope = (res: FakeRes) =>
    (res.body as { error: { message: string; code: string; messageKey: string } }).error;

  it('fails closed to the status family when the key is missing from the dictionary', () => {
    const res = mockRes();
    errorHandler(
      HttpError.badRequest({ code: 'NOPE_MISSING', messageKey: 'nope.missing' } as never),
      {} as Request,
      res,
      vi.fn(),
    );
    expect(res.statusCode).toBe(400);
    expect(envelope(res)).toEqual({
      message: translate('en', 'errors.badRequest'),
      code: 'BAD_REQUEST',
      messageKey: 'errors.badRequest',
    });
  });

  it('fails closed when a segment overshoots a string leaf', () => {
    const res = mockRes();
    errorHandler(
      HttpError.badRequest({
        code: 'ERRORS_NOT_FOUND_DEEPER',
        messageKey: 'errors.notFound.deeper',
      } as never),
      {} as Request,
      res,
      vi.fn(),
    );
    expect(res.statusCode).toBe(400);
    expect(envelope(res).messageKey).toBe('errors.badRequest');
    expect(envelope(res).message).not.toContain('deeper');
  });

  it('fails closed for a legacy literal message instead of leaking it', () => {
    const res = mockRes();
    errorHandler(
      HttpError.notFound({
        code: 'SITE_507F1F77BCF86CD799439012_IS_GONE',
        messageKey: 'Site 507f1f77bcf86cd799439012 is gone',
      } as never),
      {} as Request,
      res,
      vi.fn(),
    );
    expect(res.statusCode).toBe(404);
    expect(envelope(res)).toEqual({
      message: translate('en', 'errors.notFound'),
      code: 'NOT_FOUND',
      messageKey: 'errors.notFound',
    });
  });

  it('renders a real key in the request locale and sets Content-Language', () => {
    const res = mockRes();
    errorHandler(
      HttpError.notFound({ code: 'ERRORS_PROJECT_NOT_FOUND', messageKey: 'errors.projectNotFound' }),
      { language: 'de' } as unknown as Request,
      res,
      vi.fn(),
    );
    expect(res.statusCode).toBe(404);
    expect(envelope(res).message).toBe(translate('de', 'errors.projectNotFound'));
    expect(envelope(res).message).not.toBe('errors.projectNotFound');
    expect(res.headers['Content-Language']).toBe('de');
  });

  it('renders a typed descriptor with its stable code and bounded vars', () => {
    const res = mockRes();
    errorHandler(
      new HttpError(402, {
        code: 'CAP_EXCEEDED',
        messageKey: 'billing.errors.capExceeded',
        vars: { metric: 'audits' },
        details: { metric: 'audits' },
      }),
      { language: 'en' } as unknown as Request,
      res,
      vi.fn(),
    );
    expect(res.statusCode).toBe(402);
    const body = res.body as { error: { message: string; code: string; details: unknown } };
    expect(body.error.code).toBe('CAP_EXCEEDED');
    expect(body.error.message).toContain('audits');
    expect(body.error.details).toEqual({ metric: 'audits' });
  });

  it('strips an unresolved placeholder instead of shipping it', () => {
    const res = mockRes();
    errorHandler(
      HttpError.forbidden({ code: 'BILLING_ERRORS_UPGRADE_REQUIRED', messageKey: 'billing.errors.upgradeRequired' }),
      {} as Request,
      res,
      vi.fn(),
    );
    expect(envelope(res).message).not.toContain('{{');
  });

  it('localizes Zod issues while preserving the flatten topology', () => {
    const schema = z.object({ email: z.string().email(), age: z.number().min(18) });
    const parsed = schema.safeParse({ email: 'nope', age: 3 });
    expect(parsed.success).toBe(false);
    const res = mockRes();
    errorHandler(
      (parsed as { error: unknown }).error,
      { language: 'es' } as unknown as Request,
      res,
      vi.fn(),
    );
    expect(res.statusCode).toBe(400);
    const body = res.body as {
      error: {
        message: string;
        code: string;
        messageKey: string;
        details: {
          formErrors: string[];
          fieldErrors: Record<string, string[]>;
          issues: Array<{ code: string; path: (string | number)[]; messageKey: string; message: string }>;
        };
      };
    };
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.messageKey).toBe('errors.validationFailed');
    expect(body.error.message).toBe(translate('es', 'errors.validationFailed'));
    expect(body.error.details.formErrors).toEqual([]);
    expect(body.error.details.fieldErrors.email).toEqual([
      translate('es', 'validation.issue.invalidEmail'),
    ]);
    expect(body.error.details.issues).toEqual([
      {
        code: 'invalid_string',
        path: ['email'],
        messageKey: 'validation.issue.invalidEmail',
        message: translate('es', 'validation.issue.invalidEmail'),
      },
      {
        code: 'too_small',
        path: ['age'],
        messageKey: 'validation.issue.tooSmallNumber',
        message: translate('es', 'validation.issue.tooSmallNumber', { minimum: 18 }),
      },
    ]);
    expect(res.headers['Content-Language']).toBe('es');
  });
});

describe('requireAuth (Better Auth session guard)', () => {
  // Minimal user shape the middleware reads off the Better Auth session.
  // `role` stays `unknown` on purpose: the middleware must tolerate whatever
  // the additionalField deserializes to.
  interface StubSessionUser {
    id: string;
    email: string;
    emailVerified: boolean;
    role?: unknown;
  }

  /** Typed stub over the `setAuth` test seam — only `api.getSession` is real. */
  function stubAuth(
    getSession: () => Promise<{
      user: StubSessionUser;
      session?: { createdAt?: unknown };
    } | null>,
  ): Auth {
    const stub: { api: { getSession: typeof getSession } } = { api: { getSession } };
    return stub as unknown as Auth;
  }

  /** Stub the Mongo mirror lookup — returns whatever the caller wants for
   *  the `mirror?.suspended` check. Default is no doc (unsuspended). */
  function stubMirror(value: { suspended?: boolean } | null): void {
    vi.spyOn(User, 'findById').mockReturnValue({
      select: () => ({ lean: () => Promise.resolve(value) }),
    } as never);
  }

  /**
   * A mirrored account continues under the Mongo account work lease, so a
   * middleware-only unit test must also satisfy the acquire. Both calls are
   * awaited and only truthiness of the second matters.
   */
  function stubAccountLease(accountId: string): void {
    vi.spyOn(User, 'updateOne').mockReturnValue({} as never);
    vi.spyOn(User, 'findOneAndUpdate').mockReturnValue({ _id: accountId } as never);
  }

  /** Runs the async middleware and resolves with the args `next` received. */
  function callRequireAuth(req: Request): Promise<unknown[]> {
    return new Promise((resolve) => {
      requireAuth(req, mockRes(), (...args: unknown[]) => {
        resolve(args);
      });
    });
  }

  afterEach(() => {
    setAuth(null);
    vi.restoreAllMocks();
  });

  it('forwards an unexpected getSession fault to next(err)', async () => {
    const boom = new Error('session backend down');
    setAuth(
      stubAuth(() => {
        throw boom;
      }),
    );
    const [err] = await callRequireAuth({ headers: {} } as unknown as Request);
    expect(err).toBe(boom);
  });

  it('rejects with a localized 401 HttpError when no session resolves', async () => {
    setAuth(stubAuth(async () => null));
    const [err] = await callRequireAuth({ headers: {} } as unknown as Request);
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ status: 401, message: 'errors.unauthorized' });
  });

  it('attaches the session identity to req.user and calls next() bare', async () => {
    // A real ObjectId: the account work lease acquire rejects anything else
    // before it ever reaches Mongo.
    const accountId = '64b7f2a1c3d4e5f6a7b8c9d0';
    setAuth(
      stubAuth(async () => ({
        user: {
          id: accountId,
          email: 'ada@example.com',
          emailVerified: true,
          role: 'admin',
        },
      })),
    );
    stubMirror({ suspended: false });
    stubAccountLease(accountId);
    const req = { headers: {} } as unknown as Request;
    const args = await callRequireAuth(req);
    expect(args).toEqual([]);
    expect(req.user).toEqual({
      id: accountId,
      email: 'ada@example.com',
      role: 'admin',
      emailVerified: true,
      mustChangePassword: false,
      provisionalAccount: false,
      twoFactorEnabled: false,
    });
  });

  it('reads twoFactorEnabled off the session when true', async () => {
    setAuth(
      stubAuth(async () => ({
        user: {
          id: 'u3',
          email: 'carol@example.com',
          emailVerified: true,
          role: 'Member',
          twoFactorEnabled: true,
        },
      })),
    );
    stubMirror({ suspended: false });
    const req = { headers: {} } as unknown as Request;
    await callRequireAuth(req);
    expect(req.user?.twoFactorEnabled).toBe(true);
  });

  it('copies a string session creation time into recentAuthAt', async () => {
    const createdAt = '2026-07-16T08:30:00.000Z';
    setAuth(
      stubAuth(async () => ({
        user: { id: 'u-time', email: 'time@example.com', emailVerified: true },
        session: { createdAt },
      })),
    );
    stubMirror(null);
    const req = { headers: {} } as unknown as Request;
    await callRequireAuth(req);
    expect(req.user?.recentAuthAt).toBe(createdAt);
  });

  it('normalizes a non-string role to undefined', async () => {
    setAuth(
      stubAuth(async () => ({
        user: { id: 'u2', email: 'bob@example.com', emailVerified: false, role: 42 },
      })),
    );
    stubMirror({ suspended: false });
    const req = { headers: {} } as unknown as Request;
    await callRequireAuth(req);
    expect(req.user?.role).toBeUndefined();
    expect(req.user?.emailVerified).toBe(false);
  });

  it('rejects a suspended mirror doc with a localized 403 auth.suspended', async () => {
    setAuth(
      stubAuth(async () => ({
        user: { id: 'u4', email: 'ban@example.com', emailVerified: true, role: 'Member' },
      })),
    );
    stubMirror({ suspended: true });
    const req = { headers: {} } as unknown as Request;
    const [err] = await callRequireAuth(req);
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ status: 403, message: 'auth.suspended' });
    // Suspension check happens BEFORE req.user is populated — a suspended
    // caller must not leak identity to downstream handlers.
    expect(req.user).toBeUndefined();
  });

  it('a missing mirror doc (mirror-lag on brand-new signup) still passes', async () => {
    setAuth(
      stubAuth(async () => ({
        user: { id: 'u5', email: 'new@example.com', emailVerified: true, role: 'Member' },
      })),
    );
    stubMirror(null);
    const req = { headers: {} } as unknown as Request;
    const args = await callRequireAuth(req);
    expect(args).toEqual([]);
    expect(req.user?.id).toBe('u5');
  });
});


describe('requireVerified email gate', () => {
  const call = (user: Express.User | undefined) => {
    const next = vi.fn();
    requireVerified({ user } as unknown as Request, mockRes(), next);
    return next;
  };

  it('401s when requireAuth has not populated req.user', () => {
    expect(call(undefined).mock.calls[0]?.[0]).toMatchObject({
      status: 401,
      message: 'errors.unauthorized',
    });
  });

  it('403s with a machine-readable code when the email is unverified', () => {
    expect(call({ id: 'u1', emailVerified: false }).mock.calls[0]?.[0]).toMatchObject({
      status: 403,
      message: 'errors.emailNotVerified',
      details: { code: 'EMAIL_NOT_VERIFIED' },
    });
  });

  it('passes a verified user through', () => {
    expect(call({ id: 'u1', emailVerified: true }).mock.calls[0]?.[0]).toBeUndefined();
  });
});

describe('errorHandler body-parser branch', () => {
  it('maps entity.parse.failed to a localized 400 errors.malformedJson', () => {
    const err = Object.assign(new Error('Unexpected token'), {
      type: 'entity.parse.failed',
      status: 400,
    });
    const res = mockRes();
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    errorHandler(err, { language: 'ru' } as unknown as Request, res, vi.fn());
    expect(res.statusCode).toBe(400);
    const body = res.body as { error: { message: string; code: string; messageKey: string } };
    expect(body.error).toEqual({
      message: translate('ru', 'errors.malformedJson'),
      code: 'ERRORS_MALFORMED_JSON',
      messageKey: 'errors.malformedJson',
    });
    expect(res.headers['Content-Language']).toBe('ru');
    // The parser's own English prose stays out of the log line.
    expect(JSON.stringify(warn.mock.calls[0]?.[0])).not.toContain('Unexpected token');
    warn.mockRestore();
  });

  it('honors a 413 entity.too.large from body-parser with a generic message', () => {
    const err = Object.assign(new Error('request entity too large'), {
      type: 'entity.too.large',
      status: 413,
    });
    const res = mockRes();
    errorHandler(err, {} as Request, res, vi.fn());
    expect(res.statusCode).toBe(413);
    expect((res.body as { error: { message: string } }).error.message).toBe(
      translate('en', 'errors.badRequest'),
    );
  });

  it('a plain thrown Error still falls through to 500', () => {
    const res = mockRes();
    errorHandler(new Error('kaboom'), {} as Request, res, vi.fn());
    expect(res.statusCode).toBe(500);
  });

  it('uses statusCode when status is missing', () => {
    const err = Object.assign(new Error('bad body'), {
      type: 'entity.parse.failed',
      statusCode: 400,
    });
    const res = mockRes();
    errorHandler(err, {} as Request, res, vi.fn());
    expect(res.statusCode).toBe(400);
    expect((res.body as { error: { message: string } }).error.message).toBe(
      translate('en', 'errors.malformedJson'),
    );
  });

  it('non-4xx status with a body-parser type is not downgraded (falls through to 500)', () => {
    const err = Object.assign(new Error('weird'), {
      type: 'entity.parse.failed',
      status: 500,
    });
    const res = mockRes();
    errorHandler(err, {} as Request, res, vi.fn());
    expect(res.statusCode).toBe(500);
  });
});

describe('notFound handler', () => {
  it('emits the localized errors.notFound key without logging customer-controlled URL content', async () => {
    const infos: Array<{ ctx: Record<string, unknown>; msg: string }> = [];
    const { notFound } = await import('./not-found.js');
    const info = vi
      .spyOn(logger, 'info')
      .mockImplementation((ctx: unknown, msg?: unknown) => {
        infos.push({ ctx: ctx as Record<string, unknown>, msg: String(msg) });
        return logger;
      });
    const req = {
      id: 'req-1',
      method: 'GET',
      originalUrl: '/api/no-such-route?evil=<script>',
    } as unknown as Request;
    const next = vi.fn();
    notFound(req, mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0]?.[0] as HttpError;
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(404);
    expect(err.message).toBe('errors.notFound');
    // Correlation metadata is retained, but the arbitrary URL/query is not.
    const hit = infos.find((r) => r.msg === 'route not found');
    expect(hit?.ctx).toMatchObject({
      reqId: 'req-1',
      method: 'GET',
    });
    expect(hit?.ctx).not.toHaveProperty('url');
    info.mockRestore();
  });
});

function sourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(target));
    } else if (
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.spec.ts') &&
      !entry.name.endsWith('.d.ts')
    ) {
      files.push(target);
    }
  }
  return files;
}

function propertyName(node: ts.PropertyName | undefined): string | undefined {
  if (!node) return undefined;
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text;
  return undefined;
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function englishTemplate(key: string): string | undefined {
  let cursor: unknown = DICTIONARIES.en;
  for (const segment of key.split('.')) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return typeof cursor === 'string' ? cursor : undefined;
}

describe('authored browser-response copy scanner', () => {
  it('requires explicit typed HttpError descriptors, keyed request refinements, and no direct JSON literals', () => {
    const srcRoot = path.resolve(process.cwd(), 'src');
    const failures: string[] = [];
    const httpFactories = new Set([
      'badRequest',
      'unauthorized',
      'forbidden',
      'notFound',
      'conflict',
      'tooMany',
      'internal',
    ]);

    for (const file of sourceFiles(srcRoot)) {
      if (file.endsWith('/scripts/migrate-prompt03-http-errors.ts')) continue;
      const relative = path.relative(srcRoot, file);
      const source = ts.createSourceFile(
        file,
        fs.readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );
      const requestSchema =
        /(?:^|\/)[^/]+(?:\.api)?\.schemas?\.ts$/u.test(relative) ||
        relative === 'shared/security/input-guards.ts';

      const visit = (node: ts.Node): void => {
        let descriptor: ts.Expression | undefined;
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          node.expression.expression.text === 'HttpError' &&
          httpFactories.has(node.expression.name.text)
        ) {
          descriptor = node.arguments[0];
        } else if (
          ts.isNewExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === 'HttpError'
        ) {
          descriptor = node.arguments?.[1];
        }
        if (descriptor && relative !== 'shared/utils/http-error.ts') {
          if (!ts.isObjectLiteralExpression(descriptor)) {
            failures.push(`${relative}:${lineOf(source, node)} HttpError needs an inline descriptor`);
          } else {
            const properties = new Map(
              descriptor.properties
                .filter(ts.isPropertyAssignment)
                .map((property) => [propertyName(property.name), property.initializer]),
            );
            for (const required of ['code', 'messageKey']) {
              if (!properties.has(required)) {
                failures.push(
                  `${relative}:${lineOf(source, node)} HttpError is missing ${required}`,
                );
              }
            }
            const code = properties.get('code');
            if (
              code &&
              ts.isStringLiteral(code) &&
              !/^[A-Z][A-Z0-9_]{0,95}$/u.test(code.text)
            ) {
              failures.push(
                `${relative}:${lineOf(source, code)} invalid stable HttpError code`,
              );
            }
            const key = properties.get('messageKey');
            if (key && ts.isStringLiteral(key) && !hasTranslationKey(key.text)) {
              failures.push(
                `${relative}:${lineOf(source, key)} unknown HttpError key ${key.text}`,
              );
            }
            if (
              key &&
              ts.isStringLiteral(key) &&
              englishTemplate(key.text)?.includes('{{') &&
              !properties.has('vars')
            ) {
              failures.push(
                `${relative}:${lineOf(source, key)} placeholder key needs explicit safe vars`,
              );
            }
          }
        }

        if (requestSchema) {
          if (
            ts.isPropertyAssignment(node) &&
            propertyName(node.name) === 'message' &&
            ts.isStringLiteral(node.initializer) &&
            !hasTranslationKey(node.initializer.text)
          ) {
            failures.push(
              `${relative}:${lineOf(source, node)} literal Zod message ${node.initializer.text}`,
            );
          }
          if (
            ts.isCallExpression(node) &&
            ts.isPropertyAccessExpression(node.expression) &&
            new Set(['regex', 'min', 'max', 'refine']).has(node.expression.name.text)
          ) {
            const custom = node.arguments[1];
            if (custom && ts.isStringLiteral(custom) && !hasTranslationKey(custom.text)) {
              failures.push(
                `${relative}:${lineOf(source, custom)} literal Zod message ${custom.text}`,
              );
            }
          }
        }

        if (
          relative !== 'modules/auth/auth.ts' &&
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === 'json'
        ) {
          const body = node.arguments[0];
          if (body && ts.isObjectLiteralExpression(body)) {
            for (const property of body.properties) {
              if (!ts.isPropertyAssignment(property)) continue;
              const name = propertyName(property.name);
              if (
                (name === 'message' || name === 'error') &&
                (ts.isStringLiteral(property.initializer) ||
                  ts.isNoSubstitutionTemplateLiteral(property.initializer))
              ) {
                failures.push(
                  `${relative}:${lineOf(source, property)} authored JSON ${name} literal`,
                );
              }
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }

    expect(failures).toEqual([]);
  });
});
