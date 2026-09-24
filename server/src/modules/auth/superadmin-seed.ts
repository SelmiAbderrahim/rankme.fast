/**
 * SuperAdmin bootstrap seeder (superadmin).
 *
 * Runs fire-and-forget on every api container start (see server.ts main()).
 * Idempotency is the normalized SUPERADMIN_EMAIL in Better Auth's Postgres
 * `user` table:
 *
 *   - either env var missing            → no-op ('unconfigured')
 *   - a converged row exists            → skip, NEVER mutate it ('exists')
 *   - a bootstrap promotion was partial → repair its Mongo mirror ('repaired')
 *   - no row                             → create + promote to SuperAdmin ('created')
 *   - anything throws                    → swallow, return 'error' (boot unaffected)
 *
 * The account is created via `getAuth().api.signUpEmail` so Better Auth owns
 * scrypt hashing (never hash by hand) and the Mongo mirror is written by the
 * `databaseHooks.user.create.after` → `mirrorUserCreate` hook. We then dual-write
 * the role + verified flag to Postgres and the Mongo mirror.
 *
 * Bootstrap credentials and the configured operator email are never logged;
 * secret fields are also redacted in config/logger.ts.
 */
import { eq } from 'drizzle-orm';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { user as authUserTable } from '../../db/schema/auth.js';
// Import the model + role constant DIRECTLY (not via ../users/index.js) — the
// barrel pulls users.routes → require-auth → auth, and this module is re-exported
// from auth/index.js, so the barrel path would form an init-order cycle that
// leaves require-auth undefined. auth.ts imports the model the same way.
import { ROLE_SUPERADMIN, User } from '../users/users.model.js';
import { getAuth } from './auth.js';
import type { ApplicationDb } from '../../shared/types/application-db.js';
export type SeedReason = 'created' | 'repaired' | 'exists' | 'unconfigured' | 'error';
export interface SeedResult {
    created: boolean;
    skipped: boolean;
    reason: SeedReason;
}
async function loadSeedUser(db: ApplicationDb, email: string): Promise<{
    id: string;
    role: string | null;
    emailVerified: boolean;
} | null> {
    const rows = await db
        .select({
        id: authUserTable.id,
        role: authUserTable.role,
        emailVerified: authUserTable.emailVerified,
    })
        .from(authUserTable)
        .where(eq(authUserTable.email, email))
        .limit(1);
    return rows[0] ?? null;
}
async function promoteBootstrapUser(db: ApplicationDb, userId: string): Promise<void> {
    const promoted = await db
        .update(authUserTable)
        .set({ role: ROLE_SUPERADMIN, emailVerified: true })
        .where(eq(authUserTable.id, userId))
        .returning({ id: authUserTable.id });
    if (promoted.length !== 1) {
        throw new Error('superadmin bootstrap Better Auth identity disappeared');
    }
    const mirror = await User.findOneAndUpdate({ _id: userId }, { $set: { role: ROLE_SUPERADMIN, emailVerified: true } }, { new: true }).lean();
    if (!mirror) {
        throw new Error('superadmin bootstrap Mongo mirror is missing');
    }
    const [authReadback] = await db
        .select({ role: authUserTable.role, emailVerified: authUserTable.emailVerified })
        .from(authUserTable)
        .where(eq(authUserTable.id, userId))
        .limit(1);
    if (authReadback?.role !== ROLE_SUPERADMIN ||
        authReadback.emailVerified !== true) {
        throw new Error('superadmin bootstrap Better Auth readback did not converge');
    }
}
export const superadminSeedTestables = { promoteBootstrapUser };
export async function seedSuperadmin(db: ApplicationDb): Promise<SeedResult> {
    if (!env.SUPERADMIN_EMAIL || !env.SUPERADMIN_PASSWORD) {
        logger.info('superadmin seed: unconfigured (SUPERADMIN_EMAIL/PASSWORD unset) — skipping');
        return { created: false, skipped: true, reason: 'unconfigured' };
    }
    const email = env.SUPERADMIN_EMAIL.toLowerCase();
    const password = env.SUPERADMIN_PASSWORD;
    try {
        const existing = await loadSeedUser(db, email);
        if (existing) {
            // Better Auth is the identity authority. If the original bootstrap
            // reached its Postgres promotion but its Mongo dual-write failed, the
            // authoritative SuperAdmin+verified state is an unambiguous partial
            // seed and is safe to converge. A later operator demotion changes the
            // Postgres role, so it still takes the normal immutable `exists` path.
            if (existing.role === ROLE_SUPERADMIN && existing.emailVerified) {
                const mirror = await User.findById(existing.id)
                    .select({ role: 1, emailVerified: 1 })
                    .lean();
                if (mirror?.role !== ROLE_SUPERADMIN || mirror.emailVerified !== true) {
                    await promoteBootstrapUser(db, existing.id);
                    logger.info('superadmin seed: repaired partial platform-owner mirror');
                    return { created: false, skipped: false, reason: 'repaired' };
                }
            }
            // Bootstrap-only: an operator may have deliberately demoted this account,
            // so never reset its password or bump its role. Just report and move on.
            logger.info('superadmin seed: account already exists — skipping');
            return { created: false, skipped: true, reason: 'exists' };
        }
        const signUp = await getAuth().api.signUpEmail({
            body: { email, password, name: 'Super Admin' },
        });
        const userId = (signUp as {
            user?: {
                id?: string;
            };
        }).user?.id;
        if (!userId) {
            throw new Error('signUpEmail returned no user id');
        }
        await promoteBootstrapUser(db, userId);
        logger.info('superadmin seed: created platform-owner account');
        return { created: true, skipped: false, reason: 'created' };
    }
    catch (err) {
        logger.error({ err }, 'superadmin seed: failed');
        return { created: false, skipped: false, reason: 'error' };
    }
}
