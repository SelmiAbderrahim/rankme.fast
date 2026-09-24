/**
 * Composition-root holder for the geogrid module.
 *
 * `server.ts` (and every integration test harness) injects the Drizzle client
 * and the BullMQ queue; controllers read them here rather than importing a
 * singleton, so a test can boot the router against PGlite with no queue and
 * still exercise the flag-off and enqueue-failure paths.
 */
import type { Queue } from 'bullmq';
import type { Db } from '../../db/client.js';
let currentDb: Db | null = null;
let currentQueue: Queue | null = null;
export function setGeogridDb(db: Db | null): void {
    currentDb = db;
}
export function getGeogridDb(): Db {
    if (!currentDb)
        throw new Error('geogrid db not configured');
    return currentDb;
}
export function setGeogridQueue(queue: Queue | null): void {
    currentQueue = queue;
}
export function getGeogridQueue(): Queue | null {
    return currentQueue;
}
