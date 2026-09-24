import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { vendorCache, vendorResponses } from '../../db/schema/index.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../testing/postgres.js';
import { createVendorArchiver } from './archiver.js';
import { createVendorCacheRepo } from './vendor-cache.repo.js';

beforeAll(async () => {
  await startTestPostgres();
});
afterAll(async () => {
  await stopTestPostgres();
});
beforeEach(async () => {
  await truncateAllTables();
});

const now = new Date('2026-07-01T00:00:00.000Z');

describe('createVendorArchiver', () => {
  it('appends an archive row with a derived cache key and the owning accountId', async () => {
    const db = getTestDb();
    const archive = createVendorArchiver(createVendorCacheRepo(db as never));
    await archive({
      capability: 'gsc',
      operation: 'inspect-url',
      params: { accountId: 'acc-1', inspectionUrl: 'https://example.com/' },
      payload: { indexVerdict: 'PASS' },
      accountId: 'acc-1',
      fetchedAt: now,
    });
    const rows = await db.select().from(vendorResponses);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.capability).toBe('gsc');
    expect(rows[0]?.operation).toBe('inspect-url');
    expect(rows[0]?.cacheKey).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]?.accountId).toBe('acc-1');
    expect(rows[0]?.payload).toEqual({ indexVerdict: 'PASS' });
  });

  it('is archive-ONLY — never writes a cross-user vendor_cache row', async () => {
    const db = getTestDb();
    const archive = createVendorArchiver(createVendorCacheRepo(db as never));
    await archive({
      capability: 'summary',
      operation: 'summarize',
      params: { accountId: 'acc-2', runId: 'r1' },
      payload: { summary: 'text' },
      accountId: 'acc-2',
      fetchedAt: now,
    });
    await expect(db.select().from(vendorCache)).resolves.toHaveLength(0);
  });

  it('defaults accountId to null for shared capabilities', async () => {
    const db = getTestDb();
    const archive = createVendorArchiver(createVendorCacheRepo(db as never));
    await archive({
      capability: 'audit',
      operation: 'crawl-result',
      params: { domain: 'example.com' },
      payload: { pages: [] },
      fetchedAt: now,
    });
    const rows = await db.select().from(vendorResponses);
    expect(rows[0]?.accountId).toBeNull();
    // costMicros was not supplied either — persists as "not reported".
    expect(rows[0]?.costMicros).toBeNull();
  });

  it('forwards the captured vendor cost onto the archive row', async () => {
    const db = getTestDb();
    const archive = createVendorArchiver(createVendorCacheRepo(db as never));
    await archive({
      capability: 'audit',
      operation: 'crawl-result',
      params: { domain: 'example.com' },
      payload: { pages: [] },
      accountId: 'acc-3',
      costMicros: 750_000n,
      fetchedAt: now,
    });
    const rows = await db.select().from(vendorResponses);
    expect(rows[0]?.costMicros).toBe(750_000n);
  });
});
