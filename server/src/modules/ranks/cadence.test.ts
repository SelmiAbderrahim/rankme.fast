import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import { domainStates } from '../../db/schema/keywords.js';
import { getSiteCadence } from './cadence.js';

describe('getSiteCadence', () => {
  beforeAll(async () => {
    await startTestPostgres();
  });

  afterAll(async () => {
    await stopTestPostgres();
  });

  beforeEach(async () => {
    await truncateAllTables();
  });

  it('returns the stored cadence', async () => {
    const db = getTestDb();
    const siteId = new Types.ObjectId().toHexString();
    await db.insert(domainStates).values({ siteId, cadence: 'daily' });
    expect(await getSiteCadence(db, siteId)).toBe('daily');
  });

  it('falls back to weekly when no domain_states row exists', async () => {
    const db = getTestDb();
    expect(await getSiteCadence(db, new Types.ObjectId().toHexString())).toBe('weekly');
  });
});
