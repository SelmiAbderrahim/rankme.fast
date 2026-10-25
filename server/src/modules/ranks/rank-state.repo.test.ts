import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { keywords, rankings } from '../../db/schema/index.js';
import { getTestDb, startTestPostgres, stopTestPostgres, truncateAllTables } from '../../shared/testing/postgres.js';
import { readKeywordRankStates, summarizeSiteRankStates } from './rank-state.repo.js';
import { readRankMovementForSite } from './rank-movement.service.js';

beforeAll(startTestPostgres);
afterAll(stopTestPostgres);
beforeEach(truncateAllTables);

describe('stored keyword rank state', () => {
  it('scopes active rows to the account and counts failed attempts separately from movement', async () => {
    const db = getTestDb();
    const siteId = '507f1f77bcf86cd799439011';
    const [first, second] = await db.insert(keywords).values([
      { accountId: 'owner', siteId, phrase: 'alpha', locationCode: 2840, languageCode: 'en',
        lastFailedCheckAt: new Date('2026-10-03T00:00:00.000Z') },
      { accountId: 'owner', siteId, phrase: 'beta', locationCode: 2840, languageCode: 'en' },
    ]).returning();
    await db.insert(keywords).values({ accountId: 'other', siteId, phrase: 'hidden',
      locationCode: 2840, languageCode: 'en' });
    await db.insert(rankings).values([
      { keywordId: first!.id, position: 8, checkedAt: new Date('2026-10-01T00:00:00.000Z'), source: 'fresh' },
      { keywordId: first!.id, position: 4, checkedAt: new Date('2026-10-02T00:00:00.000Z'), source: 'fresh' },
      { keywordId: second!.id, position: null, checkedAt: new Date('2026-10-02T00:00:00.000Z'), source: 'fresh' },
    ]);
    const rows = await readKeywordRankStates(db as never, { accountId: 'owner', siteId });
    expect(rows.map((row) => [row.phrase, row.rankState.state])).toEqual([
      ['alpha', 'failed_last_check'], ['beta', 'not_in_top_100'],
    ]);
    const summary = await summarizeSiteRankStates(db as never, { accountId: 'owner', siteId });
    expect(summary).toMatchObject({ total: 2, movement: { failed: 1, noPair: 1, compared: 0 } });
  });

  it('includes tracked keywords beyond one bounded read page in summaries', async () => {
    const db = getTestDb();
    const siteId = '507f1f77bcf86cd799439011';
    await db.insert(keywords).values(Array.from({ length: 2_001 }, (_, index) => ({
      accountId: 'owner', siteId, phrase: `term ${String(index).padStart(4, '0')}`,
      locationCode: 2840, languageCode: 'en',
    })));
    const summary = await summarizeSiteRankStates(db as never, { accountId: 'owner', siteId });
    expect(summary.total).toBe(2_001);
    expect(summary.counts.never_checked).toBe(2_001);
    const movement = await readRankMovementForSite(db as never, { accountId: 'owner', siteId });
    expect(movement.tracked).toBe(2_001);
    expect(movement.notCompared.noPair).toBe(2_001);
  });
});
