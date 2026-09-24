import type { Db } from '../../db/client.js';
let clientReportsDb: Db | null = null;
export function setClientReportsDb(db: Db | null): void {
    clientReportsDb = db;
}
export function getClientReportsDb(): Db | null {
    return clientReportsDb;
}
export function resolveClientReportsDb(fallback: Db): Db {
    return clientReportsDb ?? fallback;
}
