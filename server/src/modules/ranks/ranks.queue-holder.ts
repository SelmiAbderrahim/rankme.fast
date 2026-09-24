/**
 * Injectable ranks-queue + db holder. Mirrors audits.queue-holder.ts —
 * the API process owns the singleton BullMQ Queue; the ranks router reads
 * through this holder so unit tests can inject a fake. The db holder mirrors
 * the auth pattern: tests swap in the PGlite handle after createApp().
 */
import type { Queue } from 'bullmq';
import type { Db } from '../../db/client.js';
let currentQueue: Queue | null = null;
export function setRanksQueue(queue: Queue | null): void {
    currentQueue = queue;
}
export function getRanksQueue(): Queue | null {
    return currentQueue;
}
let currentDb: Db | null = null;
export function setRanksDb(db: Db | null): void {
    currentDb = db;
}
export function getRanksDb(): Db {
    if (currentDb)
        return currentDb;
    throw new Error('ranks db not configured — call setRanksDb() at boot');
}
