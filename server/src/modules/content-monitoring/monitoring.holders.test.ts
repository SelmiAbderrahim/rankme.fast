/**
 * Content-monitoring holder tests (spec 10). The setters/getters are the
 * process-local injection seam for the queue, db, and provider.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Queue } from 'bullmq';
import type { ContentMonitorProvider } from '../../shared/providers/index.js';
import {
  getContentMonitorDb,
  getContentMonitorProvider,
  getContentMonitorQueue,
  setContentMonitorDb,
  setContentMonitorProvider,
  setContentMonitorQueue,
} from './monitoring.holders.js';

afterEach(() => {
  setContentMonitorQueue(null);
  setContentMonitorDb(null);
  setContentMonitorProvider(null);
});

describe('content-monitoring holders', () => {
  it('defaults to null before injection', () => {
    expect(getContentMonitorQueue()).toBeNull();
    expect(getContentMonitorDb()).toBeNull();
    expect(getContentMonitorProvider()).toBeNull();
  });

  it('round-trips injected instances', () => {
    const queue = { name: 'content-monitor' } as unknown as Queue;
    const db = {} as ApplicationDb;
    const provider = {} as ContentMonitorProvider;
    setContentMonitorQueue(queue);
    setContentMonitorDb(db);
    setContentMonitorProvider(provider);
    expect(getContentMonitorQueue()).toBe(queue);
    expect(getContentMonitorDb()).toBe(db);
    expect(getContentMonitorProvider()).toBe(provider);
  });
});
