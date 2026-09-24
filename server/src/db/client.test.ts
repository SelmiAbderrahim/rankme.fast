import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { closeDb, db } from './client.js';

describe('db client', () => {
  it('exposes a drizzle database wired to the schema', () => {
    expect(typeof db.select).toBe('function');
    expect(typeof db.transaction).toBe('function');
    expect(db.query.teamMembers).toBeDefined();
    expect(db.query.alertRules).toBeDefined();
  });

  it('closeDb ends the postgres-js pool (lazy pool — no connection was opened)', async () => {
    await expect(closeDb()).resolves.toBeUndefined();
  });

  // CODEBASE-REVIEW §4.4 — connection tuning is a bootable choice: it lives in
  // the module-level `postgres(...)` call. The postgres-js client does not
  // re-expose the options object, so we assert on the source directly.
  it('tunes the postgres-js pool for §4.4 (max, connect_timeout, idle_timeout)', () => {
    const source = readFileSync(new URL('./client.ts', import.meta.url), 'utf8');
    expect(source).toMatch(/max:\s*env\.PG_POOL_MAX/);
    expect(source).toMatch(/connect_timeout:\s*10/);
    expect(source).toMatch(/idle_timeout:\s*30/);
  });
});
