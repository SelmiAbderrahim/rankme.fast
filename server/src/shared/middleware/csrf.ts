import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { env } from '../../config/env.js';
import { HttpError } from '../utils/http-error.js';
import { readCookie } from '../utils/cookies.js';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
// The ONLY Authorization shape that legitimately bypasses double-submit CSRF:
// a public-API bearer key (`Bearer rmf_…`). Must mirror the api-key-auth
// parser exactly. Any other Authorization value (garbage, Basic, empty scheme)
// falls through to the cookie CSRF check instead of skipping it — a positive
// match, not "any header present", so a forged Authorization can't disable CSRF.
const API_BEARER_PATTERN = /^Bearer\s+rmf_[A-Za-z0-9_-]+$/;
/**
 * Test-only bypass. When `installTestAuth()` runs it flips this to `true` so
 * the ~25 supertest suites that mutate through the `verified` chain do not
 * each need to fetch + echo a CSRF token. Tests that specifically prove the
 * CSRF chain (see `sites.test.ts` / `coverage.test.ts`) toggle it off with
 * `__setCsrfBypassForTests(false)` around the assertion, then restore.
 * Production code NEVER touches this flag.
 */
let csrfBypassForTests = false;
export function __setCsrfBypassForTests(v: boolean): void {
    csrfBypassForTests = v;
}
/**
 * Double-submit CSRF for cookie-borne sessions.
 *
 * The rankme app is a Better Auth cookie session on the product chain plus a
 * bearer-token public API at `/api/v1`. Every cookie-authenticated mutation
 * (`app.ts` `verified` chain) is guarded by this middleware, and the client
 * MUST call `GET /api/security/csrf-token` first (which sets the matching
 * cookie) and echo it in the `x-csrf-token` header on the mutating request.
 *
 * Safe methods (GET/HEAD/OPTIONS) pass through. `/api/auth/*` is NOT behind
 * this guard — Better Auth's own Origin / trusted-origins check handles CSRF
 * for those routes. The public `/api/v1` bearer surface is exempt too, but the
 * exemption is a POSITIVE match on the api-key bearer shape (`Bearer rmf_…`),
 * not "any Authorization header present": a forged/garbage Authorization value
 * no longer disables the cookie CSRF check, so the guard never depends solely
 * on the CORS origin lock.
 *
 * Missing or mismatched tokens surface as a localized 403
 * (`security.error.csrfInvalid`).
 */
export const requireCsrf: RequestHandler = (req, _res, next) => {
    if (csrfBypassForTests)
        return next();
    if (SAFE_METHODS.has(req.method))
        return next();
    // Public-API bearer-key requests are exempt — but only on a positive match
    // of the `Bearer rmf_…` shape, never on any Authorization header. Documented
    // in the security model.
    const authHeader = req.headers.authorization;
    if (typeof authHeader === 'string' && API_BEARER_PATTERN.test(authHeader)) {
        return next();
    }
    const cookieToken = readCookie(req.headers.cookie, env.CSRF_COOKIE_NAME);
    const headerRaw = req.headers[env.CSRF_HEADER_NAME.toLowerCase()];
    const headerToken = Array.isArray(headerRaw) ? headerRaw[0] : headerRaw;
    if (!cookieToken || !headerToken || !constantTimeEquals(cookieToken, String(headerToken))) {
        next(HttpError.forbidden({
            code: 'CSRF_INVALID',
            messageKey: 'security.error.csrfInvalid',
        }));
        return;
    }
    next();
};
/** Issue a fresh CSRF token cookie + echo it in the response body. */
export const issueCsrfToken: RequestHandler = (req, res) => {
    const token = randomBytes(32).toString('base64url');
    res.cookie(env.CSRF_COOKIE_NAME, token, {
        httpOnly: false,
        sameSite: 'strict',
        // Mirror the ACTUAL request protocol (`trust proxy: 1` is set in app.ts,
        // so a TLS-terminating proxy's X-Forwarded-Proto marks req.secure) the
        // same way Better Auth flags its session cookie. Keying this on NODE_ENV
        // instead marked the cookie Secure on plain-HTTP production self-hosts,
        // where RFC 6265 clients then refuse to return it — every cookie-session
        // mutation 403s even though the session cookie itself flows fine.
        secure: req.secure,
        path: '/',
    });
    res.status(200).json({ csrfToken: token });
};
function constantTimeEquals(a: string, b: string): boolean {
    const buf1 = Buffer.from(a, 'utf8');
    const buf2 = Buffer.from(b, 'utf8');
    if (buf1.length !== buf2.length)
        return false;
    return timingSafeEqual(buf1, buf2);
}
