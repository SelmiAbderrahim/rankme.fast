import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { keywords } from '../../db/schema/index.js';
import { getTestDb, startTestPostgres, stopTestPostgres, truncateAllTables } from '../../shared/testing/postgres.js';
import { readLatestOutcomes, recordOutcome, retryDeadlineFor, retryDueAt } from './rank-outcomes.repo.js';

beforeAll(startTestPostgres);
afterAll(stopTestPostgres);
beforeEach(truncateAllTables);

describe('rank check outcomes', () => {
  it('bounds retries by the next period and never charges an outcome', () => {
    const first = new Date('2026-10-25T23:45:00.000Z');
    expect(retryDeadlineFor(first, 'daily').toISOString()).toBe('2026-10-26T00:00:00.000Z');
    expect(retryDueAt({ firstAttemptAt: first, retryDeadline: retryDeadlineFor(first, 'daily') }, 1))
      .toBeNull();
  });

  it('keeps one period row and returns the newest account-scoped outcome', async () => {
    const db = getTestDb();
    const accountId = 'owner';
    const siteId = '507f1f77bcf86cd799439011';
    const [keyword] = await db.insert(keywords).values({ accountId, siteId, phrase: 'alpha',
      locationCode: 2840, languageCode: 'en' }).returning();
    const first = new Date('2026-10-20T12:00:00.000Z');
    await recordOutcome(db as never, { accountId, siteId, keywordId: keyword!.id,
      periodKey: 'weekly:2026-10-19', status: 'failed', reason: 'vendor_timeout',
      at: first, cadence: 'weekly' });
    await recordOutcome(db as never, { accountId, siteId, keywordId: keyword!.id,
      periodKey: 'weekly:2026-10-19', status: 'checked', reason: null,
      at: new Date(first.getTime() + 30 * 60_000), cadence: 'weekly' });
    const latest = await readLatestOutcomes(db as never, { accountId, siteId, keywordIds: [keyword!.id] });
    expect(latest.get(keyword!.id)).toMatchObject({ status: 'checked', attempts: 2 });
    expect(await readLatestOutcomes(db as never, { accountId: 'foreign', siteId,
      keywordIds: [keyword!.id] })).toEqual(new Map());
  });
});
