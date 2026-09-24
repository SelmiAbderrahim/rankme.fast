/**
 * Shared ioredis factory for the job layer.
 *
 * Every BullMQ primitive (Queue, Worker, QueueEvents) gets its connection
 * from here so the one non-negotiable BullMQ v5 requirement —
 * `maxRetriesPerRequest: null` on Worker connections — can never be missed
 * at a call site. QueueEvents must NOT share a connection with anything
 * else (it holds a blocking XREAD); callers create a fresh instance per
 * QueueEvents via this same factory.
 */
import { Redis } from 'ioredis';
export function createQueueConnection(redisUrl: string): Redis {
    return new Redis(redisUrl, {
        // Required by BullMQ v5 Workers: a finite retry cap would make ioredis
        // reject in-flight blocking commands during a Redis blip and kill the
        // worker loop instead of letting BullMQ ride out the reconnect.
        maxRetriesPerRequest: null,
    });
}
