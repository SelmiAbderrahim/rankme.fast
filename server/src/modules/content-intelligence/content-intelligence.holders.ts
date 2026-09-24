/**
 * Injectable holders for the Content Intelligence module.
 *
 * Mirrors the audits pattern: production boot calls the setters
 * once with the real Queue / Postgres client; unit tests inject fakes.
 * Reading a nulled holder is legal — the service surfaces a 503 for the
 * queue and short-circuits for the db (used only for event recording).
 */
import type { Queue } from 'bullmq';
let currentQueue: Queue | null = null;
let currentInventoryQueue: Queue | null = null;
let currentDb: ApplicationDb | null = null;
export function setContentAnalysisQueue(queue: Queue | null): void {
    currentQueue = queue;
}
export function getContentAnalysisQueue(): Queue | null {
    return currentQueue;
}
export function setContentInventoryQueue(queue: Queue | null): void {
    currentInventoryQueue = queue;
}
export function getContentInventoryQueue(): Queue | null {
    return currentInventoryQueue;
}
export function setContentIntelligenceDb(db: ApplicationDb | null): void {
    currentDb = db;
}
export function getContentIntelligenceDb(): ApplicationDb | null {
    return currentDb;
}
