import type { ApplicationDb } from '../../shared/types/application-db.js';
let currentDb: ApplicationDb | null = null;
export function setSitesDb(db: ApplicationDb | null): void {
    currentDb = db;
}
export function getSitesDb(): ApplicationDb {
    if (currentDb)
        return currentDb;
    throw new Error('sites db not configured — call setSitesDb() at boot');
}
