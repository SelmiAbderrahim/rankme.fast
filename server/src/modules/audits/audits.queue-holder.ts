/**
 * Injectable audits-queue holder.
 *
 * The api process owns exactly one `audits` BullMQ Queue instance (created
 * at boot when REDIS_URL is set). The audits router reads it through this
 * holder — a setter pattern mirroring `modules/auth/auth.ts` (setAuth /
 * getAuth) — so unit tests can inject a fake queue.
 */
import type { Queue } from 'bullmq';
let currentQueue: Queue | null = null;
export function setAuditsQueue(queue: Queue | null): void {
    currentQueue = queue;
}
export function getAuditsQueue(): Queue | null {
    return currentQueue;
}
