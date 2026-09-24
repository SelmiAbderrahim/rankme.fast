import type { ApplicationDb } from '../../shared/types/application-db.js';
let currentDb: ApplicationDb | null = null;
export function setTeamDb(db: ApplicationDb | null): void {
    currentDb = db;
}
export function getTeamDb(): ApplicationDb {
    if (currentDb)
        return currentDb;
    throw new Error('team db not configured — call setTeamDb() at boot');
}
