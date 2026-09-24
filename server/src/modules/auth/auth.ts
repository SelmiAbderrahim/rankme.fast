import { Types } from 'mongoose';
import { eq } from 'drizzle-orm';
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware, getAuthoritativeSessionFromCtx, } from 'better-auth/api';
import { twoFactor } from 'better-auth/plugins';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import type { Logger } from 'pino';
import { env } from '../../config/env.js';
import { logger as appLogger } from '../../config/logger.js';
import { db } from '../../db/client.js';
import * as authSchema from '../../db/schema/auth.js';
import { teamProvisionedAccounts } from '../../db/schema/team-members.js';
import { localeFromFetchRequest } from '../../shared/i18n/request-locale.js';
import { deliverEmailChangeVerification, deliverPasswordChangedEmail, deliverPasswordResetEmail, deliverVerificationEmail, resolveRecipientLocale, } from '../communication/index.js';
// Import the model + role constant directly (not via ../users/index.js) so
// this file does NOT sit in a cycle with users.routes → require-auth → auth.
// The router in users/index.js pulls require-auth (this module's downstream
// consumer) — importing through the barrel would form a cycle whose bundle
// ordering breaks users.routes.ts's Route.get() with an undefined middleware.
import { ROLE_MEMBER, User } from '../users/users.model.js';
import { hardenOAuthAccountMutation } from './oauth-token.js';
// Any Postgres-dialect drizzle database (postgres-js in prod, PGlite in tests).
export type AuthDatabase = Parameters<typeof drizzleAdapter>[0];
export interface CreateAuthOptions {
    /** Test harnesses may opt out; production always uses the secure default. */
    sendVerificationOnSignUp?: boolean;
}
type BetterAuthLogLevel = 'debug' | 'info' | 'warn' | 'error';
function safeDiagnosticValue(value: unknown): string | null {
    if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(value)) {
        return null;
    }
    return value;
}
/**
 * Better Auth's default logger forwards raw provider errors and variadic
 * arguments to console. Route it through the application logger while
 * retaining only bounded error names/codes — never upstream messages,
 * response payloads, token values, or ciphertext.
 */
export function createBetterAuthLogger(sink: Logger = appLogger) {
    return {
        level: 'warn' as const,
        log(level: BetterAuthLogLevel, _message: string, ...args: unknown[]): void {
            const errorNames = new Set<string>();
            const codes = new Set<string>();
            for (const arg of args) {
                if (arg instanceof Error) {
                    const name = safeDiagnosticValue(arg.name);
                    if (name)
                        errorNames.add(name);
                }
                if (arg && typeof arg === 'object') {
                    const code = safeDiagnosticValue((arg as {
                        code?: unknown;
                    }).code);
                    if (code)
                        codes.add(code);
                    const name = safeDiagnosticValue((arg as {
                        name?: unknown;
                    }).name);
                    if (name)
                        errorNames.add(name);
                }
            }
            sink[level]({
                component: 'better-auth',
                upstreamLevel: level,
                errorNames: [...errorNames].sort(),
                codes: [...codes].sort(),
            }, 'better-auth event');
        },
    };
}
/**
 * The installed direct ID-token endpoints accept caller-supplied access and
 * refresh tokens without binding them to the verified ID-token subject.
 * RankMeFast uses redirect OAuth exclusively, so reject both direct-token
 * sign-in and linking before Better Auth can persist an unrelated credential.
 */
export function rejectUnboundDirectOAuthTokens(path: string, body: unknown): void {
    if (path !== '/link-social' && path !== '/sign-in/social')
        return;
    if (!body || typeof body !== 'object' || !Object.hasOwn(body, 'idToken'))
        return;
    throw new APIError('BAD_REQUEST', {
        code: 'DIRECT_ID_TOKEN_OAUTH_DISABLED',
        message: 'DIRECT_ID_TOKEN_OAUTH_DISABLED',
    });
}
/**
 * Peek at a Better Auth verification token's payload without verifying its
 * signature. Better Auth signs with HS256 and validates on the receiving
 * endpoint; we only need to read `updateTo` here to route the outgoing mail
 * through the right localized template. Returns `null` if the shape is not
 * a JWT — the caller falls back to the signup-verification copy.
 */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
    const segments = token.split('.');
    /* c8 ignore next -- guardrail for a malformed token shape */
    if (segments.length !== 3)
        return null;
    // Segments length is 3, so [1] is always a string; the `?? ''` fallback
    // exists only to satisfy noUncheckedIndexedAccess.
    /* c8 ignore next */
    const raw = segments[1] ?? '';
    try {
        // The payload segment is base64url-encoded; Node's Buffer accepts
        // padded base64, so add padding before decoding.
        const padded = raw + '='.repeat((4 - (raw.length % 4)) % 4);
        const json = Buffer.from(padded, 'base64').toString('utf-8');
        const parsed: unknown = JSON.parse(json);
        /* c8 ignore next 2 -- defensive: JSON.parse yielded a non-object primitive */
        if (!parsed || typeof parsed !== 'object')
            return null;
        return parsed as Record<string, unknown>;
    }
    catch {
        /* c8 ignore next 2 -- unreachable in practice; Better Auth issues valid JWTs */
        return null;
    }
}
/** "Ada Lovelace" → { firstName: 'Ada', lastName: 'Lovelace' }. */
export function splitName(name: string): {
    firstName: string;
    lastName: string;
} {
    const trimmed = name.trim();
    if (!trimmed)
        return { firstName: '', lastName: '' };
    const [first, ...rest] = trimmed.split(/\s+/);
    /* c8 ignore next -- `split` on a non-empty string always yields a first element */
    return { firstName: first ?? '', lastName: rest.join(' ') };
}
type MirrorUser = {
    id: string;
    email: string;
    name: string;
    emailVerified: boolean;
    role?: string | null;
};
/**
 * Better Auth owns identity (Postgres). The Mongo `users` collection remains
 * the domain-profile store (GDPR lifecycle, crypto escrow), so
 * every Better Auth user gets a Mongo mirror document under the SAME id —
 * `generateId` below emits ObjectId-compatible hex, and the one-shot migration
 * script reuses legacy Mongo ids, so `User.findById(req.user.id)` keeps
 * working across every module.
 */
export async function mirrorUserCreate(user: MirrorUser, request?: Request): Promise<void> {
    await User.updateOne({ _id: new Types.ObjectId(user.id) }, {
        $setOnInsert: {
            email: user.email,
            profile: splitName(user.name),
            role: typeof user.role === 'string' && user.role ? user.role : ROLE_MEMBER,
            emailVerified: user.emailVerified,
            language: localeFromFetchRequest(request),
        },
    }, { upsert: true });
}
/**
 * Keeps the Mongo mirror in step with Better Auth. Syncs email/verified AND
 * the display name: `POST /api/auth/update-user` rewrites `user.name`, so the
 * mirror's `profile.firstName/lastName` (read by `GET /api/users/:userId` and
 * used for email personalization) must follow — otherwise a rename leaves the
 * domain profile stale. `splitName` is idempotent, so re-running it on an
 * email-change or 2FA update is a harmless no-op.
 */
export async function mirrorUserUpdate(user: MirrorUser): Promise<void> {
    await User.updateOne({ _id: new Types.ObjectId(user.id) }, {
        $set: {
            email: user.email,
            emailVerified: user.emailVerified,
            profile: splitName(user.name),
        },
    });
}
/**
 * Build the Better Auth instance over the given drizzle database.
 *
 * Security posture:
 * - Sessions, password hashing (scrypt), CSRF (Origin / trusted-origins
 *   validation) and cookie flags are vetted library code — never hand-rolled.
 * - Cookies keep the library defaults: httpOnly, sameSite=lax, `secure`
 *   auto-on in production. The SPA is served same-origin behind the web
 *   proxy, so no `advanced.defaultCookieAttributes` override is needed.
 * - `role` is an additionalField with `input: false` — clients can NEVER set
 *   their own role at signup.
 *
 * Note: the Google Search Console scope is requested later via
 * `authClient.linkSocial({ provider: "google", scopes:
 * ["https://www.googleapis.com/auth/webmasters.readonly"] })` — do NOT
 * request it at login.
 */
export function createAuth(database: AuthDatabase, options: CreateAuthOptions = {}) {
    const googleConfigured = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
    const clientHostname = new URL(env.CLIENT_URL).hostname;
    const appHostname = new URL(env.APP_URL).hostname;
    return betterAuth({
        database: drizzleAdapter(database, { provider: 'pg', schema: authSchema }),
        baseURL: env.SERVER_URL,
        basePath: '/api/auth',
        secret: env.BETTER_AUTH_SECRET,
        trustedOrigins: [...new Set([env.CLIENT_URL, env.APP_URL])],
        logger: createBetterAuthLogger(),
        // Better Auth ships its own per-IP limiter (100 requests / 60s) that
        // counts EVERY /api/auth/* call, including the read-only `get-session`
        // that fires on every page load, SSR hydration and guard remount. That
        // silently defeated the exemption our own limiter documents
        // (`shared/middleware/rate-limit.ts` → `skip: req.method === 'GET'`):
        // behind a shared egress IP (office NAT, mobile carrier, corporate
        // proxy) a normal browsing population exhausts the bucket and Better
        // Auth answers 429, which the client reads as "no session" and bounces
        // the user to /login. `get-session` returns only the caller's own
        // session from their own cookie — there is nothing to brute-force — so
        // it is exempted here while every credential mutation keeps both the
        // Better Auth global bucket and our stricter outer limiter.
        rateLimit: {
            customRules: {
                '/get-session': false,
            },
        },
        emailAndPassword: {
            enabled: true,
            sendResetPassword: async ({ user, url }, request) => {
                await deliverPasswordResetEmail(user.email, url, localeFromFetchRequest(request));
            },
            onPasswordReset: async ({ user }) => {
                const recipient = await User.findById(user.id).select('language').lean();
                const locale = resolveRecipientLocale({ recipientLocale: recipient?.language });
                await deliverPasswordChangedEmail(user.email, locale);
            },
        },
        emailVerification: {
            sendOnSignUp: options.sendVerificationOnSignUp ?? true,
            autoSignInAfterVerification: true,
            sendVerificationEmail: async ({ user, url, token }, request) => {
                // Better Auth funnels signup verification AND the change-email
                // re-verification through this ONE callback. The token payload's
                // `updateTo` field distinguishes them — present ⇒ change-email flow
                // (send to the NEW address with the change-email copy); absent ⇒
                // signup verification. The token is a JWT; peek at the payload
                // segment without verifying (the endpoint has already validated it).
                const payload = decodeJwtPayload(token);
                if (payload && typeof payload.updateTo === 'string' && payload.updateTo) {
                    await deliverEmailChangeVerification(payload.updateTo, url, localeFromFetchRequest(request));
                    return;
                }
                await deliverVerificationEmail(user.email, url, localeFromFetchRequest(request));
            },
        },
        user: {
            additionalFields: {
                role: { type: 'string', defaultValue: ROLE_MEMBER, input: false },
                mustChangePassword: { type: 'boolean', defaultValue: false, input: false },
                provisionalAccount: { type: 'boolean', defaultValue: false, input: false },
            },
            // Better Auth owns email-change re-verification: it stashes the new
            // address, mails a signed link to it, and only rolls the account email
            // (and fires the update database hook, which syncs the Mongo mirror)
            // after the recipient follows the link. The old address stays the
            // active login until then. We intentionally do NOT set
            // `sendChangeEmailConfirmation` — that would enqueue a SECOND email
            // (the confirmation flow at email-verification.mjs:195 re-dispatches
            // through `sendVerificationEmail`); the fallback branch of the
            // change-email endpoint routes directly through
            // `emailVerification.sendVerificationEmail` with a `updateTo` JWT
            // payload, which our unified sender detects and forwards to the
            // change-email mailer.
            changeEmail: { enabled: true },
        },
        // Google Search Console linking re-runs the Google OAuth flow
        // on an ALREADY-linked account to request the extra `webmasters.readonly`
        // scope (`authClient.linkSocial({ provider: 'google', scopes: [...] })`).
        // Better Auth only completes that re-link — and honors the GSC
        // `callbackURL` — when account linking is enabled and Google is trusted;
        // without this block the re-link silently bounces back to the default
        // post-auth page and the GSC connection is never persisted.
        // `allowDifferentEmails` stays at its secure default (false): the GSC
        // account must match the login identity, and a mismatch surfaces via the
        // client `errorCallbackURL` instead of a silent no-op.
        account: {
            // Better Auth encrypts access + refresh tokens on its normal redirect
            // flow. The account database hooks below close its direct-link write
            // gap and deliberately discard ID tokens instead of retaining them.
            encryptOAuthTokens: true,
            accountLinking: {
                enabled: true,
                trustedProviders: ['google'],
            },
        },
        // Free / self-host boots without Google credentials; the provider is only
        // registered when both halves are configured. `accessType: "offline"` +
        // consent prompt make Google return a refresh_token for later GSC use.
        ...(googleConfigured
            ? {
                socialProviders: {
                    google: {
                        clientId: env.GOOGLE_CLIENT_ID as string,
                        clientSecret: env.GOOGLE_CLIENT_SECRET as string,
                        accessType: 'offline',
                        prompt: 'select_account consent',
                    },
                },
            }
            : {}),
        advanced: {
            // Better Auth silently disables its Origin/CSRF validation under
            // NODE_ENV=test unless this is set explicitly. Pin it on so the test
            // suite exercises the SAME check production runs.
            disableOriginCheck: false,
            ...(appHostname !== clientHostname
                ? {
                    crossSubDomainCookies: {
                        enabled: true,
                        domain: clientHostname,
                    },
                }
                : {}),
            database: {
                // ObjectId-compatible hex so the Mongo mirror shares the same id.
                generateId: () => new Types.ObjectId().toHexString(),
            },
        },
        hooks: {
            before: createAuthMiddleware(async (ctx) => {
                rejectUnboundDirectOAuthTokens(ctx.path, ctx.body);
                // Global before hooks run before endpoint middleware has hydrated
                // `ctx.context.session`. Read the authoritative server-side session
                // here so a provisional user cannot bypass the restriction merely by
                // choosing an endpoint whose own session middleware runs later.
                // Server-side `auth.api.getSession()` does not always carry an HTTP
                // method through Better Auth's internal dispatch context. The route is
                // intrinsically read-only, so allow it by path while treating every
                // other absent/unknown method as unsafe.
                const safeRead = ctx.path === '/get-session' ||
                    new Set(['GET', 'HEAD', 'OPTIONS']).has(ctx.method);
                const unsafeMethod = !safeRead;
                const currentSession = unsafeMethod
                    ? await getAuthoritativeSessionFromCtx(ctx)
                    : null;
                const provisionalUserId = currentSession?.user.id;
                // The auth flag and relational provenance are deliberately checked
                // independently. A successful invitation decision commits the
                // relational row first and projects the claimed state into Better
                // Auth afterwards. If that projection fails, the durable auth flag
                // must continue to keep every unrelated mutation fail-closed until
                // reconciliation repairs it.
                let provisional = (currentSession?.user as {
                    provisionalAccount?: unknown;
                } | undefined)
                    ?.provisionalAccount === true;
                if (provisionalUserId) {
                    const authDb = database as AuthDatabase & {
                        select: () => {
                            from: (table: typeof teamProvisionedAccounts) => {
                                where: (condition: unknown) => {
                                    limit: (limit: number) => Promise<Array<{
                                        status: string;
                                    }>>;
                                };
                            };
                        };
                    };
                    const rows = await authDb.select().from(teamProvisionedAccounts)
                        .where(eq(teamProvisionedAccounts.userId, provisionalUserId)).limit(1);
                    provisional ||= rows[0]?.status === 'pending';
                }
                if (provisional &&
                    unsafeMethod &&
                    !(ctx.method === 'POST' &&
                        new Set([
                            '/change-password',
                            '/sign-out',
                            '/revoke-session',
                            '/revoke-other-sessions',
                            '/revoke-sessions',
                        ]).has(ctx.path))) {
                    // Better Auth's before-hook dispatcher does not normalize an
                    // APIError thrown after asynchronous session/provenance reads. A
                    // concrete hook response keeps this denial inside the auth handler
                    // (403) instead of leaking into Express as an unrelated 500.
                    return ctx.json({
                        code: 'PROVISIONAL_ACCOUNT_RESTRICTED',
                        message: 'PROVISIONAL_ACCOUNT_RESTRICTED',
                    }, { status: 403 });
                }
            }),
            after: createAuthMiddleware(async (ctx) => {
                // A successful password change from an authenticated session fires
                // the confirmation email server-side. Better Auth returns 200 with a
                // `user` payload on success; a wrong current password throws before
                // this branch, so the email only goes out on real rotations. The
                // reset-token flow has its own `onPasswordReset` mailer — this hook
                // is scoped to authenticated changes only.
                if (ctx.path !== '/change-password')
                    return;
                const returned = ctx.context.returned as {
                    user?: {
                        email?: string;
                    };
                } | undefined;
                const email = returned?.user?.email;
                if (!email)
                    return;
                const userId = ctx.context.session?.user.id;
                if (userId) {
                    await ctx.context.internalAdapter.updateUser(userId, { mustChangePassword: false });
                    const authDb = database as AuthDatabase & {
                        update: (table: typeof teamProvisionedAccounts) => {
                            set: (value: Record<string, unknown>) => {
                                where: (condition: unknown) => Promise<unknown>;
                            };
                        };
                    };
                    await authDb
                        .update(teamProvisionedAccounts)
                        .set({
                        mustChangePassword: false,
                        temporaryPasswordEncrypted: null,
                        updatedAt: new Date(),
                    })
                        .where(eq(teamProvisionedAccounts.userId, userId));
                }
                await deliverPasswordChangedEmail(email, localeFromFetchRequest(ctx.request));
            }),
        },
        databaseHooks: {
            account: {
                create: {
                    before: hardenOAuthAccountMutation,
                },
                update: {
                    before: hardenOAuthAccountMutation,
                },
            },
            user: {
                create: {
                    after: async (user, ctx) => {
                        await mirrorUserCreate(user as MirrorUser, ctx?.request);
                    },
                },
                update: {
                    after: async (user) => {
                        await mirrorUserUpdate(user as MirrorUser);
                    },
                },
            },
        },
        // Two-factor authentication (TOTP + backup codes). Better Auth owns the
        // secret storage (hashed backup codes, per-account lockout, TOTP window
        // tolerance) — never hand-roll TOTP math. Registered here so a user can
        // enrol via `authClient.twoFactor.enable`; sign-in returns
        // `twoFactorRedirect: true` when the account has a verified factor,
        // steering the client to `/two-factor` for the challenge step. `issuer`
        // is what appears in the authenticator app label — the product name.
        // Docs: /docs "Two-factor authentication".
        plugins: [twoFactor({ issuer: 'RankMeFast' })],
    });
}
export type Auth = ReturnType<typeof createAuth>;
let instance: Auth | null = null;
/**
 * Lazy singleton over the production drizzle client. Constructing the
 * instance opens no connections (postgres-js dials on first query), so this
 * is safe to call at wiring time.
 */
export function getAuth(): Auth {
    if (!instance)
        instance = createAuth(db);
    return instance;
}
/** Test seam: swap in an instance built over PGlite. */
export function setAuth(auth: Auth | null): void {
    instance = auth;
}
