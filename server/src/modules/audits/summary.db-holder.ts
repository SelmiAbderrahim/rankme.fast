/**
 * Injectable Postgres holder for the AI summary service.
 *
 * Mirrors backlinks/ranks holders: the api boots and calls
 * `setSummaryDb(productionDb)`, tests swap in PGlite. `null` means the
 * production `db` client will be used (avoids a required test bootstrap
 * when nothing is injected).
 */
import { db as productionDb, type Db } from '../../db/client.js';
let currentDb: Db | null = null;
export function setSummaryDb(db: Db | null): void {
    currentDb = db;
}
export function getSummaryDb(): Db | null {
    return currentDb;
}
/** The injected db, or the production client when nothing was injected. */
export function resolveSummaryDb(): Db {
    return currentDb ?? productionDb;
}
