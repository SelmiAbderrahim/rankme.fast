/**
 * Injectable holder. Mirrors keyword-research.holder.ts: the API process owns
 * the singleton db; the module's router (and the /api/v1 bearer-auth chain)
 * read through this holder so unit tests can swap in PGlite.
 */
import type { Db } from '../../db/client.js';
let currentDb: Db | null = null;
export function setApiKeysDb(db: Db | null): void {
    currentDb = db;
}
export function getApiKeysDb(): Db {
    if (currentDb)
        return currentDb;
    throw new Error('api-keys db not configured — call setApiKeysDb() at boot');
}
