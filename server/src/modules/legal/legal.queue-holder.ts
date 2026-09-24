import type { Queue } from 'bullmq';
let currentQueue: Queue | null = null;
export function setAccountPurgeQueue(queue: Queue | null): void {
    currentQueue = queue;
}
export function getAccountPurgeQueue(): Queue | null {
    return currentQueue;
}
