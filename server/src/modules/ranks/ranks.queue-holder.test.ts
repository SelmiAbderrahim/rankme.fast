import { describe, expect, it } from 'vitest';
import type { Queue } from 'bullmq';
import type { Db } from '../../db/client.js';
import { getRanksDb, getRanksQueue, setRanksDb, setRanksQueue } from './ranks.queue-holder.js';

describe('ranks queue-holder', () => {
  it('starts with a null queue and null db (until boot wires them)', () => {
    setRanksQueue(null);
    setRanksDb(null);
    expect(getRanksQueue()).toBeNull();
    expect(() => getRanksDb()).toThrow('ranks db not configured');
  });

  it('setRanksQueue swaps the current queue in and out', () => {
    const fake = { name: 'fake' } as unknown as Queue;
    setRanksQueue(fake);
    expect(getRanksQueue()).toBe(fake);
    setRanksQueue(null);
    expect(getRanksQueue()).toBeNull();
  });

  it('setRanksDb swaps the current handle in and out', () => {
    const fake = { fake: true } as unknown as Db;
    setRanksDb(fake);
    expect(getRanksDb()).toBe(fake);
    setRanksDb(null);
    expect(() => getRanksDb()).toThrow('ranks db not configured');
  });
});
