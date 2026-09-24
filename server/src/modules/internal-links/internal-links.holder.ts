/** Injectable HTTP-side dependencies; production composition wires the queue. */
import type { Queue } from 'bullmq';
import type { Db } from '../../db/client.js';
let currentDb: Db | null = null;
let currentQueue: Queue | null = null;
export function setInternalLinksDb(db: Db | null): void {
    currentDb = db;
}
export function getInternalLinksDb(): Db | null {
    return currentDb;
}
export function setInternalLinksQueue(queue: Queue | null): void {
    currentQueue = queue;
}
export function getInternalLinksQueue(): Queue | null {
    return currentQueue;
}
