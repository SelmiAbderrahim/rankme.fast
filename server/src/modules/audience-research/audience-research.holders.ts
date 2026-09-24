/**
 * Injectable holders for the Audience Research module.
 *
 * Mirrors the content-intelligence + audits pattern: production boot calls
 * the setters once with the real BullMQ Queue / Postgres client; unit tests
 * inject fakes. Reading a nulled queue is legal — the service surfaces a
 * 503 when the queue is missing.
 */
import type { Queue } from 'bullmq';
let currentQueue: Queue | null = null;
let currentDb: ApplicationDb | null = null;
export function setAudienceResearchQueue(queue: Queue | null): void {
    currentQueue = queue;
}
export function getAudienceResearchQueue(): Queue | null {
    return currentQueue;
}
export function setAudienceResearchDb(db: ApplicationDb | null): void {
    currentDb = db;
}
export function getAudienceResearchDb(): ApplicationDb | null {
    return currentDb;
}
