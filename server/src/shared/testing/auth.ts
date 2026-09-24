/**
 * Better Auth test harness (mirrors mongo.ts / postgres.ts).
 *
 * `installTestAuth()` swaps the app-wide auth singleton for one built over
 * the in-process PGlite database, so supertest suites exercise the REAL
 * Better Auth handler (session issue/verify, scrypt hashing, origin CSRF)
 * with zero external services.
 */
import type { Express } from 'express';
import { eq } from 'drizzle-orm';
import request, { type Response } from 'supertest';
import { env } from '../../config/env.js';
import { user as userTable } from '../../db/schema/index.js';
import { createAuth, setAuth, type Auth } from '../../modules/auth/index.js';
import { User } from '../../modules/users/index.js';
import { __setCsrfBypassForTests } from '../middleware/csrf.js';
import { getTestDb } from './postgres.js';
export interface InstallTestAuthOptions {
    /** Enable only in suites that assert the signup-verification delivery path. */
    sendVerificationOnSignUp?: boolean;
}
export function installTestAuth(options: InstallTestAuthOptions = {}): Auth {
    const auth = createAuth(getTestDb(), {
        sendVerificationOnSignUp: options.sendVerificationOnSignUp ?? false,
    });
    setAuth(auth);
    // Product routes are now behind requireCsrf (app.ts `verified` chain).
    // Existing supertest suites hit those routes through the session cookie
    // alone — flip the bypass so they keep working. CSRF-specific tests
    // toggle it off around the assertion.
    __setCsrfBypassForTests(true);
    return auth;
}
export function uninstallTestAuth(): void {
    setAuth(null);
    __setCsrfBypassForTests(false);
}
/** Collapse a supertest response's Set-Cookie headers into a Cookie header. */
export function cookieFrom(res: Response): string {
    const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
    return (raw ?? [])
        // `split(';')` always yields at least one element; the cast avoids the
        // `?? ''` nullish branch under noUncheckedIndexedAccess.
        .map((entry) => entry.split(';')[0] as string)
        .filter((pair) => pair && !pair.endsWith('='))
        .join('; ');
}
export interface TestUser {
    id: string;
    email: string;
    password: string;
    cookie: string;
}
export interface SignupOptions {
    email: string;
    password?: string;
    name?: string;
}
/** Sign up through the real endpoint; returns the session cookie. */
export async function signupTestUser(app: Express, options: SignupOptions): Promise<TestUser> {
    const password = options.password ?? 'correct-horse-battery';
    const res = await request(app)
        .post('/api/auth/sign-up/email')
        .set('Origin', env.CLIENT_URL)
        .send({ email: options.email, password, name: options.name ?? 'Test User' });
    if (res.status !== 200) {
        throw new Error(`test signup failed (${res.status}): ${JSON.stringify(res.body)}`);
    }
    return {
        id: (res.body as {
            user: {
                id: string;
            };
        }).user.id,
        email: options.email,
        password,
        cookie: cookieFrom(res),
    };
}
/** Sign in through the real endpoint; returns the fresh session cookie. */
export async function loginTestUser(app: Express, email: string, password: string): Promise<string> {
    const res = await request(app)
        .post('/api/auth/sign-in/email')
        .set('Origin', env.CLIENT_URL)
        .send({ email, password });
    if (res.status !== 200) {
        throw new Error(`test login failed (${res.status}): ${JSON.stringify(res.body)}`);
    }
    return cookieFrom(res);
}
/** Flip emailVerified in Postgres + the Mongo mirror (skips the email loop). */
export async function markEmailVerified(userId: string): Promise<void> {
    await getTestDb()
        .update(userTable)
        .set({ emailVerified: true })
        .where(eq(userTable.id, userId));
    await User.updateOne({ _id: userId }, { $set: { emailVerified: true } });
}
/** Signup + mark verified in one step — the common fixture for product routes. */
export async function signupVerifiedUser(app: Express, options: SignupOptions): Promise<TestUser> {
    const created = await signupTestUser(app, options);
    await markEmailVerified(created.id);
    return created;
}
