/**
 * Injectable holder (mirrors competitors.holder / local-seo.holder). The api
 * composition root wires the Drizzle client and the Brand Radar queue at
 * boot; tests inject fakes.
 */
import type { Queue } from 'bullmq';
import type { Db } from '../../db/client.js';
let currentDb: Db | null = null;
export function setBrandRadarDb(db: Db | null): void {
    currentDb = db;
}
export function getBrandRadarDb(): Db {
    if (currentDb)
        return currentDb;
    throw new Error('brand-radar db not configured — call setBrandRadarDb() at boot');
}
let currentQueue: Queue | null = null;
export function setBrandRadarQueue(queue: Queue | null): void {
    currentQueue = queue;
}
/** Null until the queue is wired — the service degrades to 503, never 500. */
export function getBrandRadarQueue(): Queue | null {
    return currentQueue;
}
