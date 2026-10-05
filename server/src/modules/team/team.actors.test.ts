import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import { user } from '../../db/schema/auth.js';
import { resolveWorkspaceActors } from './team.actors.js';

beforeAll(async () => {
  await startTestPostgres();
});
afterEach(async () => {
  await truncateAllTables();
});
afterAll(async () => {
  await stopTestPostgres();
});

describe('resolveWorkspaceActors', () => {
  it('returns an empty map without touching the db for no ids', async () => {
    expect((await resolveWorkspaceActors(getTestDb(), 'acct', [])).size).toBe(0);
  });

  it('returns nothing when no requested id belongs to the workspace', async () => {
    expect((await resolveWorkspaceActors(getTestDb(), 'acct', ['someone-else'])).size).toBe(0);
  });

  it('resolves the owner without a team row (deduplicating ids)', async () => {
    await getTestDb().insert(user).values({ id: 'acct', name: ' Owner ', email: 'o@example.com' });
    const result = await resolveWorkspaceActors(getTestDb(), 'acct', ['acct', 'acct']);
    expect(result.get('acct')).toEqual({ name: 'Owner', email: 'o@example.com' });
  });
});
