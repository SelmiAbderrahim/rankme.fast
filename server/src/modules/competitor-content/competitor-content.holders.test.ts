/**
 * Holder get/set unit tests (spec 09). Reading a nulled holder is legal.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Queue } from 'bullmq';
import {
  getCompetitorContentDb,
  getCompetitorContentQueue,
  setCompetitorContentDb,
  setCompetitorContentQueue,
} from './competitor-content.holders.js';

afterEach(() => {
  setCompetitorContentQueue(null);
  setCompetitorContentDb(null);
});

describe('competitor content holders', () => {
  it('round-trips the queue holder and defaults to null', () => {
    expect(getCompetitorContentQueue()).toBeNull();
    const queue = {} as Queue;
    setCompetitorContentQueue(queue);
    expect(getCompetitorContentQueue()).toBe(queue);
  });

  it('round-trips the db holder and defaults to null', () => {
    expect(getCompetitorContentDb()).toBeNull();
    const db = {} as ApplicationDb;
    setCompetitorContentDb(db);
    expect(getCompetitorContentDb()).toBe(db);
  });
});
