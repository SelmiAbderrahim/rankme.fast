/**
 * Real-Redis access for queue tests.
 *
 * DECISION: queue suites run against a REAL Redis, never a mock — BullMQ is
 * Lua scripts + blocking stream reads, and mocks (ioredis-mock) drift from
 * real semantics exactly where these tests matter (retries, schedulers,
 * events). The instance comes from `vitest.global-setup.ts`: CI provides a
 * redis service via TEST_REDIS_URL; dev hosts get a throwaway docker
 * container. Suites isolate in Redis db 15 and flush it per run.
 */
import { Redis } from 'ioredis';
/** Dedicated logical db for tests so a mis-pointed URL can't eat real data. */
export const TEST_REDIS_DB = 15;
export function getTestRedisUrl(): string {
    const url = process.env.TEST_REDIS_URL;
    if (!url) {
        throw new Error('TEST_REDIS_URL is not set — vitest.global-setup.ts should have provided it ' +
            '(is the Docker CLI available, or is TEST_REDIS_URL exported in CI?)');
    }
    return `${url}/${TEST_REDIS_DB}`;
}
/** BullMQ-compatible connection (maxRetriesPerRequest: null) to the test db. */
export function createTestQueueConnection(): Redis {
    return new Redis(getTestRedisUrl(), { maxRetriesPerRequest: null });
}
/** Wipes the test db — call in beforeEach of every queue suite. */
export async function flushTestRedis(connection: Redis): Promise<void> {
    await connection.flushdb();
}
