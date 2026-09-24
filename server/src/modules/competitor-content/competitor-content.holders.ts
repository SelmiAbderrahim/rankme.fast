/**
 * Injectable holders for the competitor content intelligence module.
 *
 * Mirrors the content-intelligence pattern: production boot calls the setters
 * once with the real Queue / Postgres client; unit tests inject fakes. Reading
 * a nulled holder is legal — the service surfaces a 503 for the queue and the
 * controllers fall back to the production db.
 */
import type { Queue } from 'bullmq';
let currentQueue: Queue | null = null;
let currentDb: ApplicationDb | null = null;
export function setCompetitorContentQueue(queue: Queue | null): void {
    currentQueue = queue;
}
export function getCompetitorContentQueue(): Queue | null {
    return currentQueue;
}
export function setCompetitorContentDb(db: ApplicationDb | null): void {
    currentDb = db;
}
export function getCompetitorContentDb(): ApplicationDb | null {
    return currentDb;
}
