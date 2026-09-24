import { afterEach, describe, expect, it } from 'vitest';
import {
  TEST_REDIS_DB,
  createTestQueueConnection,
  flushTestRedis,
  getTestRedisUrl,
} from './redis.js';

const originalUrl = process.env.TEST_REDIS_URL;

afterEach(() => {
  process.env.TEST_REDIS_URL = originalUrl;
});

describe('test redis helper', () => {
  it('returns the global-setup URL pinned to the test db', () => {
    expect(getTestRedisUrl()).toBe(`${originalUrl}/${TEST_REDIS_DB}`);
  });

  it('throws a setup hint when TEST_REDIS_URL is missing', () => {
    delete process.env.TEST_REDIS_URL;
    expect(() => getTestRedisUrl()).toThrow(/TEST_REDIS_URL is not set/);
  });

  it('creates a BullMQ-compatible connection and can flush the test db', async () => {
    const connection = createTestQueueConnection();
    try {
      expect(connection.options.maxRetriesPerRequest).toBeNull();
      await connection.set('probe', '1');
      await flushTestRedis(connection);
      expect(await connection.get('probe')).toBeNull();
    } finally {
      await connection.quit();
    }
  });
});
