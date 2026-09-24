import { describe, expect, it } from 'vitest';
import { clearCollections } from './mongo.js';

describe('clearCollections without an active connection', () => {
  it('is a no-op when the database is not connected', async () => {
    // No startMemoryMongo() here — mongoose.connection.db is undefined, so the
    // early-return branch is exercised without throwing.
    await expect(clearCollections()).resolves.toBeUndefined();
  });
});
