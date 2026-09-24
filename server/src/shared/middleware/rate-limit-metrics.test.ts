import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { pino } from 'pino';
import type { Logger } from 'pino';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../testing/postgres.js';
import { RATE_LIMIT_ROUTES, rateLimitHits } from '../../db/schema/rate-limit-hits.js';
import {
  createRateLimitPruneProcessor,
  loadRateLimitPressure,
  pruneOldRateLimitHits,
  recordRateLimitHit,
  setRateLimitMetricsDb,
  setRateLimitMetricsLogger,
  RATE_LIMIT_PRUNE_RETENTION_MS,
} from './rate-limit-metrics.js';
import { getRateLimitMetricsWindowMs } from './rate-limit-metrics-window.js';

beforeAll(async () => {
  const db = await startTestPostgres();
  setRateLimitMetricsDb(db as unknown as never);
  setRateLimitMetricsLogger(pino({ level: 'silent' }));
});

afterAll(async () => {
  setRateLimitMetricsDb(null);
  setRateLimitMetricsLogger(null);
  await stopTestPostgres();
});

beforeEach(async () => {
  await truncateAllTables();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('recordRateLimitHit', () => {
  it('inserts a row with the route + optional ip / accountId', async () => {
    await recordRateLimitHit({ route: 'auth', ip: '203.0.113.5', accountId: 'acct-1' });
    const rows = await getTestDb().select().from(rateLimitHits);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.route).toBe('auth');
    expect(rows[0]?.ip).toBe('203.0.113.5');
    expect(rows[0]?.accountId).toBe('acct-1');
    expect(rows[0]?.hitAt).toBeInstanceOf(Date);
  });

  it('nulls out ip/accountId when not provided', async () => {
    await recordRateLimitHit({ route: 'webhook' });
    const rows = await getTestDb().select().from(rateLimitHits);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ip).toBeNull();
    expect(rows[0]?.accountId).toBeNull();
  });

  it('silently no-ops when the db holder is not set', async () => {
    setRateLimitMetricsDb(null);
    await expect(
      recordRateLimitHit({ route: 'auth' }),
    ).resolves.toBeUndefined();
    setRateLimitMetricsDb(getTestDb() as unknown as never);
  });

  it('swallows insert failures — never throws into the request', async () => {
    const brokenDb = {
      insert: () => ({
        values: () => Promise.reject(new Error('connection reset')),
      }),
    };
    const warnSpy = vi.fn();
    setRateLimitMetricsLogger({ warn: warnSpy } as never);
    setRateLimitMetricsDb(brokenDb as never);
    await expect(recordRateLimitHit({ route: 'auth' })).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    // Restore
    setRateLimitMetricsDb(getTestDb() as unknown as never);
    setRateLimitMetricsLogger(pino({ level: 'silent' }));
  });

  it('logger is optional — a broken insert with no logger still resolves', async () => {
    const brokenDb = {
      insert: () => ({ values: () => Promise.reject(new Error('nope')) }),
    };
    setRateLimitMetricsLogger(null);
    setRateLimitMetricsDb(brokenDb as never);
    await expect(recordRateLimitHit({ route: 'auth' })).resolves.toBeUndefined();
    setRateLimitMetricsDb(getTestDb() as unknown as never);
    setRateLimitMetricsLogger(pino({ level: 'silent' }));
  });
});

describe('loadRateLimitPressure', () => {
  it('returns zero-filled rows when no hits have been recorded', async () => {
    const rows = await loadRateLimitPressure(60_000);
    expect(rows).toEqual(RATE_LIMIT_ROUTES.map((route) => ({ route, count: 0 })));
  });

  it('counts hits within the rolling window, per route', async () => {
    await recordRateLimitHit({ route: 'auth' });
    await recordRateLimitHit({ route: 'auth' });
    await recordRateLimitHit({ route: 'webhook' });
    const rows = await loadRateLimitPressure(60_000);
    const auth = rows.find((r) => r.route === 'auth');
    const webhook = rows.find((r) => r.route === 'webhook');
    expect(auth?.count).toBe(2);
    expect(webhook?.count).toBe(1);
  });

  it('excludes hits older than the window', async () => {
    const db = getTestDb();
    await db.insert(rateLimitHits).values({
      route: 'auth',
      hitAt: new Date(Date.now() - 5 * 60 * 60 * 1000),
    });
    await recordRateLimitHit({ route: 'auth' });
    const rows = await loadRateLimitPressure(60 * 60 * 1000);
    expect(rows.find((r) => r.route === 'auth')?.count).toBe(1);
  });

  it('returns zero-filled rows when the db holder is unset', async () => {
    const rows = await loadRateLimitPressure(60_000, null);
    expect(rows).toEqual(RATE_LIMIT_ROUTES.map((route) => ({ route, count: 0 })));
  });
});

describe('getRateLimitMetricsWindowMs', () => {
  it('reads the env value at call time', () => {
    const ms = getRateLimitMetricsWindowMs();
    expect(typeof ms).toBe('number');
    expect(ms).toBeGreaterThan(0);
  });
});

describe('PruneOldRateLimitHits', () => {
  it('deletes rows older than the retention window and leaves fresh rows intact', async () => {
    const db = getTestDb();
    const now = new Date('2026-07-15T00:00:00Z');
    await db.insert(rateLimitHits).values([
      { route: 'auth', hitAt: new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000) },
      { route: 'auth', hitAt: new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000) },
      { route: 'webhook', hitAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000) },
    ]);
    const pruned = await pruneOldRateLimitHits({
      db: db as unknown as never,
      now: () => now,
    });
    expect(pruned).toBe(2);
    const remaining = await db.select().from(rateLimitHits);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.route).toBe('webhook');
  });

  it('honours an explicit retentionMs override', async () => {
    const db = getTestDb();
    const now = new Date('2026-07-15T00:00:00Z');
    await db.insert(rateLimitHits).values([
      { route: 'auth', hitAt: new Date(now.getTime() - 2 * 60 * 60 * 1000) },
    ]);
    const pruned = await pruneOldRateLimitHits({
      db: db as unknown as never,
      now: () => now,
      retentionMs: 60 * 60 * 1000, // 1h
    });
    expect(pruned).toBe(1);
  });

  it('at the exact retention boundary the row is kept (strict `<` cutoff)', async () => {
    const db = getTestDb();
    const now = new Date('2026-07-15T00:00:00Z');
    const boundary = new Date(now.getTime() - RATE_LIMIT_PRUNE_RETENTION_MS);
    await db.insert(rateLimitHits).values({ route: 'auth', hitAt: boundary });
    const pruned = await pruneOldRateLimitHits({
      db: db as unknown as never,
      now: () => now,
    });
    expect(pruned).toBe(0);
  });

  it('default now() is called when no clock injected', async () => {
    // Freshly-truncated table — no rows, so a real-clock delete returns 0.
    const db = getTestDb();
    const pruned = await pruneOldRateLimitHits({
      db: db as unknown as never,
    });
    expect(pruned).toBe(0);
  });

  it('logs the sweep result when a logger is provided (optional-chain arm)', async () => {
    const db = getTestDb();
    const now = new Date('2026-07-15T00:00:00Z');
    await db.insert(rateLimitHits).values({
      route: 'auth',
      hitAt: new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000),
    });
    const info = vi.fn();
    const logger = { info } as unknown as Logger;
    const pruned = await pruneOldRateLimitHits({
      db: db as unknown as never,
      now: () => now,
      logger,
    });
    expect(pruned).toBe(1);
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ pruned: 1 }),
      'rate-limit-hits pruned',
    );
  });

  it('createRateLimitPruneProcessor returns { pruned } from a single sweep', async () => {
    const db = getTestDb();
    await db.insert(rateLimitHits).values({
      route: 'auth',
      hitAt: new Date('2020-01-01T00:00:00Z'),
    });
    const processor = createRateLimitPruneProcessor({ db: db as unknown as never });
    const result = await processor();
    expect(result.pruned).toBe(1);
  });
});
