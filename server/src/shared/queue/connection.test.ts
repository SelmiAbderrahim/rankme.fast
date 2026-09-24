import { describe, expect, it } from 'vitest';
import { getTestRedisUrl } from '../testing/redis.js';
import { createQueueConnection } from './index.js';

describe('createQueueConnection', () => {
  it('connects and pins maxRetriesPerRequest to null (BullMQ v5 worker requirement)', async () => {
    const connection = createQueueConnection(getTestRedisUrl());
    try {
      expect(connection.options.maxRetriesPerRequest).toBeNull();
      expect(await connection.ping()).toBe('PONG');
    } finally {
      await connection.quit();
    }
  });
});
