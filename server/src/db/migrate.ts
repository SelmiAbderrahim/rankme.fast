import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
// Relative to the process cwd: server/ in dev, /app in the runtime image
// (the Dockerfile copies server/drizzle/ next to dist/).
const MIGRATIONS_FOLDER = 'drizzle';
const DEFAULT_ATTEMPTS = 5;
const DEFAULT_BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 10000;
export interface RunMigrationsOptions {
    attempts?: number;
    baseBackoffMs?: number;
    /** Test seam — a single migration attempt. Defaults to the real postgres-js migrator. */
    applyOnce?: (databaseUrl: string) => Promise<void>;
    /** Test seam — backoff sleep. Defaults to setTimeout. */
    sleep?: (ms: number) => Promise<void>;
}
async function applyMigrationsOnce(databaseUrl: string): Promise<void> {
    // Dedicated single-connection client: the migrator takes advisory locks and
    // must not share the app pool.
    const client = postgres(databaseUrl, { max: 1 });
    try {
        await migrate(drizzle({ client }), { migrationsFolder: MIGRATIONS_FOLDER });
    }
    finally {
        await client.end({ timeout: 5 });
    }
}
const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
// Bounded retry: container start order can race even with compose
// healthchecks. Exhausting the attempts rethrows so server.ts exits non-zero.
export async function runMigrations(options: RunMigrationsOptions = {}): Promise<void> {
    const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
    const baseBackoffMs = options.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;
    const applyOnce = options.applyOnce ?? applyMigrationsOnce;
    const sleep = options.sleep ?? defaultSleep;
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            await applyOnce(env.DATABASE_URL);
            logger.info({ attempt }, 'postgres migrations applied');
            return;
        }
        catch (err) {
            lastError = err;
            const backoff = Math.min(baseBackoffMs * 2 ** (attempt - 1), MAX_BACKOFF_MS);
            logger.warn({ err, attempt, attempts, backoff }, 'postgres migration attempt failed');
            if (attempt < attempts) {
                await sleep(backoff);
            }
        }
    }
    logger.error({ err: lastError }, 'postgres migrations failed after retries');
    throw lastError;
}
