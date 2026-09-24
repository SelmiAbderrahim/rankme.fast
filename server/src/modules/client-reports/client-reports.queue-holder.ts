import type { Queue } from 'bullmq';
let clientReportsQueue: Queue | null = null;
export function setClientReportsQueue(queue: Queue | null): void {
    clientReportsQueue = queue;
}
export function getClientReportsQueue(): Queue | null {
    return clientReportsQueue;
}
