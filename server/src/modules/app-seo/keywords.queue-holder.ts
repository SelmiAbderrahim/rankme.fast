import type { Queue } from 'bullmq';
let currentQueue: Queue | null = null;
/** API-process holder for the dedicated App SEO keyword tracking queue. */
export function setAppSeoTrackingQueue(queue: Queue | null): void {
    currentQueue = queue;
}
export function getAppSeoTrackingQueue(): Queue | null {
    return currentQueue;
}
