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

  it('filters by engine and IDs, pages rows, and uses all checks for the best-ever baseline', async () => {
    const db = getTestDb();
    const siteId = '507f1f77bcf86cd799439011';
    const [alpha, beta, inactive, video] = await db.insert(keywords).values([
      { accountId: 'owner', siteId, phrase: 'alpha', engine: 'google', locationCode: 2840, languageCode: 'en' },
      { accountId: 'owner', siteId, phrase: 'beta', engine: 'google', locationCode: 2840, languageCode: 'en' },
      { accountId: 'owner', siteId, phrase: 'inactive', engine: 'google', active: false,
        locationCode: 2840, languageCode: 'en' },
      { accountId: 'owner', siteId, phrase: 'video', engine: 'youtube', engineTarget: 'channel-id',
        locationCode: 2840, languageCode: 'en' },
    ]).returning();
    await db.insert(rankings).values([
      { keywordId: alpha!.id, position: 2, checkedAt: new Date('2026-10-01T00:00:00.000Z'), source: 'fresh' },
      { keywordId: alpha!.id, position: 9, checkedAt: new Date('2026-10-02T00:00:00.000Z'), source: 'fresh' },
      { keywordId: alpha!.id, position: 5, checkedAt: new Date('2026-10-03T00:00:00.000Z'), source: 'fresh' },
    ]);
    const matching = await readKeywordRankStates(db as never, { siteId, engine: 'google',
      keywordIds: [alpha!.id, inactive!.id, video!.id], baseline: 'best_ever' });
    expect(matching).toHaveLength(1);
    expect(matching[0]!.rankState).toMatchObject({ state: 'declined', baselinePosition: 2, change: 3 });
    const previous = await readKeywordRankStates(db as never, { siteId, keywordIds: [alpha!.id] });
    expect(previous[0]!.rankState).toMatchObject({ state: 'improved', baselinePosition: 9, change: 4 });
    const page = await readKeywordRankStates(db as never, { siteId, engine: 'google', limit: 1, offset: 1 });
    expect(page.map((row) => row.keywordId)).toEqual([beta!.id]);
    expect(await readKeywordRankStates(db as never, { siteId, engine: 'google', offset: 3 })).toEqual([]);
  });
});
