/**
 * Injectable gsc-sync queue holder.
 *
 * The api process wires the `gsc-sync` producer queue at boot when Redis is
 * configured. Site binding changes and background matching read it through
 * this setter/getter (mirrors `setGoogleGscProvider` / `setAuditsQueue`) so
 * tests can inject the same queue handle.
 */
import type { Queue } from 'bullmq';
let currentQueue: Queue | null = null;
export function setGscSyncQueue(queue: Queue | null): void {
    currentQueue = queue;
}
export function getGscSyncQueue(): Queue | null {
    return currentQueue;
}
