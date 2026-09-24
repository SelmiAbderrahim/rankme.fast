/**
 * In-process Postgres test backend (mirrors mongo.ts).
 *
 * Why PGlite and not Testcontainers: CI runs the vitest suite INSIDE a
 * node:20-bookworm container (.github/workflows/ci.yml) with no Docker socket
 * mounted, so Testcontainers cannot start sibling containers there. PGlite is
 * real Postgres compiled to WASM, runs fully in-process (like
 * mongodb-memory-server backs mongo.ts), and drizzle ships a first-class
 * driver + migrator for it. The SAME generated SQL migrations from
 * server/drizzle/ are applied here, so schema drift is still caught by tests.
 */
import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import * as schema from '../../db/schema/index.js';
// Test commands run from both the repository root and server/. Resolve from
// this module so the real generated migrations are used in either case.
const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../../drizzle', import.meta.url));
export type TestDb = PgliteDatabase<typeof schema>;
let client: PGlite | null = null;
let db: TestDb | null = null;
export async function startTestPostgres(): Promise<TestDb> {
    client = new PGlite();
    db = drizzle({ client, schema });
    await applyTestMigrations();
    return db;
}
export function getTestDb(): TestDb {
    if (!db) {
        throw new Error('test postgres not started — call startTestPostgres() first');
    }
    return db;
}
/** Exposed separately so tests can assert the migration set is idempotent. */
export async function applyTestMigrations(): Promise<void> {
    await migrate(getTestDb(), { migrationsFolder: MIGRATIONS_FOLDER });
}
export async function stopTestPostgres(): Promise<void> {
    if (client) {
        await client.close();
    }
    client = null;
    db = null;
}
/**
 * Truncates every public table between tests. Drizzle's migration journal
 * lives in the `drizzle` schema, so it survives truncation.
 */
export async function truncateAllTables(): Promise<void> {
    const database = getTestDb();
    const result = await database.execute(sql `select tablename from pg_tables where schemaname = 'public'`);
    const names = result.rows
        .map((row) => `"${(row as {
        tablename: string;
    }).tablename}"`)
        .join(', ');
    await database.execute(sql.raw(`truncate table ${names} restart identity cascade`));
}
