import type { Queues } from '../../shared/queue/index.js';
let currentQueues: Queues | null = null;
export function setSiteLifecycleQueues(queues: Queues | null): void {
    currentQueues = queues;
}
export function getSiteLifecycleQueues(): Queues | null {
    return currentQueues;
}
