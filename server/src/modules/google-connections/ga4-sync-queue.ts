/**
 * Injectable ga4-sync queue holder.
 *
 * The api process wires the `ga4-sync` producer queue at boot when Redis is
 * configured. `enqueueGa4SyncForAccount` reads it through this setter/getter
 * (mirrors `gsc-sync-queue.ts`) so tests inject a fake queue and the enqueue
 * path no-ops cleanly when Redis is absent.
 */
import type { Queue } from 'bullmq';
let currentQueue: Queue | null = null;
export function setGa4SyncQueue(queue: Queue | null): void {
    currentQueue = queue;
}
export function getGa4SyncQueue(): Queue | null {
    return currentQueue;
}
