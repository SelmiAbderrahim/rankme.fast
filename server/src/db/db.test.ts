import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  applyTestMigrations,
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
  type TestDb,
} from '../shared/testing/postgres.js';
import { alertRules, teamMembers } from './schema/index.js';

let db: TestDb;

beforeAll(async () => {
  db = await startTestPostgres();
});

afterAll(async () => {
  await stopTestPostgres();
});

beforeEach(async () => {
  await truncateAllTables();
});

describe('migrations', () => {
  it('applied cleanly on an empty database (tables exist)', async () => {
    expect(await db.select().from(teamMembers)).toEqual([]);
    expect(await db.select().from(alertRules)).toEqual([]);
  });

  it('is idempotent — a second run is a no-op', async () => {
    await expect(applyTestMigrations()).resolves.toBeUndefined();
    expect(await db.select().from(teamMembers)).toEqual([]);
  });

  it('migration chain applies from scratch and is idempotent (repeat runs)', async () => {
    // First run happened in beforeAll; two more consecutive runs must be no-ops.
    await expect(applyTestMigrations()).resolves.toBeUndefined();
    await expect(applyTestMigrations()).resolves.toBeUndefined();
  });
});

describe('test helper lifecycle', () => {
  it('getTestDb returns the live handle while started', () => {
    expect(getTestDb()).toBe(db);
  });

  it('getTestDb throws after stop, and stop is safe to call twice', async () => {
    await stopTestPostgres();
    expect(() => getTestDb()).toThrow(/not started/);
    await expect(stopTestPostgres()).resolves.toBeUndefined();
    // Restart so afterAll and any later hooks see a live instance.
    db = await startTestPostgres();
  });
});
