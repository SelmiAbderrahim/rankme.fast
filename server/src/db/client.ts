import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../config/env.js';
import * as schema from './schema/index.js';
// postgres-js is lazy: no TCP connection is opened until the first query, so
// importing this module is side-effect free (safe in tests). Pool + timeout
// tuning matches bounded concurrency, fail-fast connect,
// idle sockets released back to Postgres.
const client = postgres(env.DATABASE_URL, {
    max: env.PG_POOL_MAX,
    connect_timeout: 10,
    idle_timeout: 30,
});
export const db = drizzle({ client, schema });
export type Db = typeof db;
export async function closeDb(): Promise<void> {
    await client.end({ timeout: 5 });
}
