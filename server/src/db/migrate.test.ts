import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../config/env.js';
import { runMigrations } from './migrate.js';

const { postgresMock, endMock, drizzleMock, migrateMock } = vi.hoisted(() => {
  const endMock = vi.fn().mockResolvedValue(undefined);
  return {
    endMock,
    postgresMock: vi.fn(() => ({ end: endMock })),
    drizzleMock: vi.fn(() => ({ marker: 'drizzle-db' })),
    migrateMock: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('postgres', () => ({ default: postgresMock }));
vi.mock('drizzle-orm/postgres-js', () => ({ drizzle: drizzleMock }));
vi.mock('drizzle-orm/postgres-js/migrator', () => ({ migrate: migrateMock }));

beforeEach(() => {
  vi.clearAllMocks();
  migrateMock.mockResolvedValue(undefined);
  endMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('runMigrations', () => {
  it('applies migrations on the first attempt with a dedicated max:1 connection', async () => {
    await expect(runMigrations()).resolves.toBeUndefined();
    expect(postgresMock).toHaveBeenCalledTimes(1);
    expect(postgresMock).toHaveBeenCalledWith(env.DATABASE_URL, { max: 1 });
    expect(migrateMock).toHaveBeenCalledWith(
      { marker: 'drizzle-db' },
      { migrationsFolder: 'drizzle' },
    );
    expect(endMock).toHaveBeenCalledTimes(1);
  });

  it('closes the migration connection even when the migrator throws', async () => {
    migrateMock.mockRejectedValue(new Error('relation is locked'));
    await expect(runMigrations({ attempts: 1 })).rejects.toThrow('relation is locked');
    expect(endMock).toHaveBeenCalledTimes(1);
  });

  it('retries with exponential backoff until an attempt succeeds (fake timers)', async () => {
    vi.useFakeTimers();
    migrateMock
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(undefined);

    const promise = runMigrations({ attempts: 3, baseBackoffMs: 100 });
    await vi.advanceTimersByTimeAsync(100); // after attempt 1
    await vi.advanceTimersByTimeAsync(200); // after attempt 2
    await expect(promise).resolves.toBeUndefined();
    expect(migrateMock).toHaveBeenCalledTimes(3);
  });

  it('aborts with the last error after exhausting bounded retries (fake timers)', async () => {
    vi.useFakeTimers();
    migrateMock.mockRejectedValue(new Error('ECONNREFUSED postgres:5432'));

    const expectation = expect(
      runMigrations({ attempts: 3, baseBackoffMs: 100 }),
    ).rejects.toThrow('ECONNREFUSED postgres:5432');
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(200);
    await expectation;
    // Bounded: exactly `attempts` tries, no sleep after the final failure.
    expect(migrateMock).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('caps the backoff at 10s (fake timers)', async () => {
    vi.useFakeTimers();
    migrateMock
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(undefined);

    const promise = runMigrations({ attempts: 2, baseBackoffMs: 60_000 });
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(promise).resolves.toBeUndefined();
    expect(migrateMock).toHaveBeenCalledTimes(2);
  });

  it('honours injected applyOnce and sleep seams', async () => {
    const applyOnce = vi
      .fn()
      .mockRejectedValueOnce(new Error('not yet'))
      .mockResolvedValueOnce(undefined);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(runMigrations({ attempts: 2, applyOnce, sleep })).resolves.toBeUndefined();
    expect(applyOnce).toHaveBeenCalledTimes(2);
    expect(applyOnce).toHaveBeenCalledWith(env.DATABASE_URL);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(500); // default base backoff, attempt 1
    expect(postgresMock).not.toHaveBeenCalled();
  });
});

describe('migration journal ordering', () => {
  // Regression guard for the drizzle out-of-order-timestamp drift that skipped
  // 0006/0007/0009 in production (team_members never created → GET /api/team 500).
  // The postgres-js migrator (drizzle-orm/pg-core/dialect.cjs) applies a migration
  // only when its `when` (folderMillis) exceeds the single MAX `created_at` already
  // recorded — it reads that max ONCE, never revisits earlier files. So a migration
  // authored with a `when` smaller than any prior entry is silently skipped forever
  // on an existing DB. Strictly-increasing `when` by idx is the invariant that keeps
  // incremental applies correct; a fresh DB (PGlite tests) applies all in idx order
  // regardless, which is why this drift never surfaced in coverage.
  const journalPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../drizzle/meta/_journal.json',
  );
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: { idx: number; when: number; tag: string }[];
  };

  it('lists entries with strictly-increasing idx starting at 0', () => {
    journal.entries.forEach((entry, i) => {
      expect(entry.idx).toBe(i);
    });
  });

  it('has strictly-increasing `when` timestamps in idx order (drift guard)', () => {
    const ordered = [...journal.entries].sort((a, b) => a.idx - b.idx);
    for (let i = 1; i < ordered.length; i += 1) {
      const prev = ordered[i - 1]!;
      const curr = ordered[i]!;
      expect(
        curr.when,
        `migration ${curr.tag} has when=${curr.when} which is not greater than ` +
          `the preceding ${prev.tag} (when=${prev.when}); the boot migrator would ` +
          `silently skip it on an already-migrated database`,
      ).toBeGreaterThan(prev.when);
    }
  });
});
