/**
 * One-shot, idempotent migration of legacy Mongo `users` documents into the
 * Better Auth Postgres tables (`user` + credential `account`).
 *
 * Strategy:
 * - **Reuse-id mapping.** The Better Auth user id IS the legacy Mongo `_id`
 *   hex string, so every domain collection keyed by the old id keeps working
 *   unchanged (`User.findById(req.user.id)`, billing refs, audit logs, …).
 * - **Passwords cannot be ported.** Legacy hashes are bcrypt; Better Auth
 *   hashes with scrypt. Each migrated user gets a credential account seeded
 *   with the scrypt hash of a freshly random, never-stored secret — so
 *   email+password login ALWAYS fails until the user completes the
 *   forgot-password flow. That reset requirement is the documented,
 *   deliberate consequence of the hash change.
 * - **Idempotent.** A user whose id already exists in Postgres is skipped;
 *   re-running the script never duplicates or overwrites.
 *
 * Run inside the api container:
 *   node --import tsx src/scripts/run-user-migration.ts
 */
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { hashPassword } from 'better-auth/crypto';
import { Types } from 'mongoose';
import type * as schema from '../db/schema/index.js';
import { account, user } from '../db/schema/index.js';
import { User } from '../modules/users/index.js';
// Any Postgres-dialect drizzle database (postgres-js in prod, PGlite in tests).
export type MigrationDb = PgDatabase<PgQueryResultHKT, typeof schema>;
export interface MigrationResult {
    migrated: number;
    skipped: number;
}
export async function migrateUsersToBetterAuth(db: MigrationDb): Promise<MigrationResult> {
    const legacyUsers = await User.find().sort({ _id: 1 });
    let migrated = 0;
    let skipped = 0;
    for (const legacy of legacyUsers) {
        const id = legacy._id.toString();
        const existing = await db.select({ id: user.id }).from(user).where(eq(user.id, id));
        if (existing.length > 0) {
            skipped += 1;
            continue;
        }
        const now = new Date();
        /* c8 ignore next 2 -- schema defaults profile.firstName/lastName to '' so the optional chains never short-circuit */
        const name = [legacy.profile?.firstName, legacy.profile?.lastName]
            .filter(Boolean)
            .join(' ')
            .trim();
        // `role` / `emailVerified` carry schema defaults — always present on a
        // hydrated document, so no fallback branches here.
        await db.insert(user).values({
            id,
            name,
            email: legacy.email,
            emailVerified: legacy.emailVerified,
            role: legacy.role,
            createdAt: now,
            updatedAt: now,
        });
        // Unguessable placeholder credential: login always fails, but the account
        // row exists so the forgot-password flow can rotate it.
        const placeholder = await hashPassword(randomBytes(48).toString('hex'));
        await db.insert(account).values({
            id: new Types.ObjectId().toHexString(),
            accountId: id,
            providerId: 'credential',
            userId: id,
            password: placeholder,
            createdAt: now,
            updatedAt: now,
        });
        migrated += 1;
    }
    return { migrated, skipped };
}
