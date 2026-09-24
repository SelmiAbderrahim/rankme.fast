/**
 * Brand Radar composition-root holder.
 *
 * Mirrors `competitors.holder.test.ts`. The db accessor throws when the api
 * boot wiring is missing (a programming error), while the queue accessor
 * returns `null` so the service can degrade to a localized 503 instead of a
 * 500 when the worker seam is absent.
 */
import type { Queue } from 'bullmq';
import { afterEach, describe, expect, it } from 'vitest';
import type { Db } from '../../db/client.js';
import {
  getBrandRadarDb,
  getBrandRadarQueue,
  setBrandRadarDb,
  setBrandRadarQueue,
} from './brand-radar.holder.js';

afterEach(() => {
  setBrandRadarDb(null);
  setBrandRadarQueue(null);
});

describe('brand-radar holder', () => {
  it('throws when db not configured', () => {
    expect(() => getBrandRadarDb()).toThrow(/not configured/);
  });

  it('returns db once set', () => {
    const db = { probe: 'db' } as unknown as Db;
    setBrandRadarDb(db);
    expect(getBrandRadarDb()).toBe(db);
  });

  it('returns null queue until wired, then the queue once set', () => {
    expect(getBrandRadarQueue()).toBeNull();
    const queue = { name: 'brand-radar' } as unknown as Queue;
    setBrandRadarQueue(queue);
    expect(getBrandRadarQueue()).toBe(queue);
  });
});
