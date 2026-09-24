import { db as productionDb } from '../../db/client.js';
let currentDb: ApplicationDb | null = null;
/** Test seam for relational App SEO storage and cascade assertions. */
export function setAppSeoDb(db: ApplicationDb | null): void {
    currentDb = db;
}
export function getAppSeoDb(): ApplicationDb {
    return currentDb ?? (productionDb as ApplicationDb);
}
