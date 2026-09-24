/**
 * Injectable weekly-pulse queue holder (pause-site feature). Mirrors
 * ranks.queue-holder.ts — the API process owns the singleton BullMQ Queue;
 * sites.service reads through this holder to tear down / restore the per-site
 * pulse scheduler on pause/resume, and unit tests inject a fake.
 */
import type { Queue } from 'bullmq';
let currentQueue: Queue | null = null;
export function setPulseQueue(queue: Queue | null): void {
    currentQueue = queue;
}
export function getPulseQueue(): Queue | null {
    return currentQueue;
}
