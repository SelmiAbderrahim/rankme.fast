/** Injectable HTTP-side dependencies; production composition wires the queue. */
import type { Queue } from 'bullmq';
import type { Db } from '../../db/client.js';
let currentDb: Db | null = null;
let currentQueue: Queue | null = null;
export function setKeywordClustersDb(db: Db | null): void {
    currentDb = db;
}
export function getKeywordClustersDb(): Db | null {
    return currentDb;
}
export function setKeywordClustersQueue(queue: Queue | null): void {
    currentQueue = queue;
}
export function getKeywordClustersQueue(): Queue | null {
    return currentQueue;
}
