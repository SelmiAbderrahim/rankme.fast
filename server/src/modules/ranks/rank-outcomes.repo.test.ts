import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { keywords } from '../../db/schema/index.js';
import { getTestDb, startTestPostgres, stopTestPostgres, truncateAllTables } from '../../shared/testing/postgres.js';
import { isBatchWideReason, isRetryableReason, nextPeriodStart, planRetry,
  readLatestOutcomes, readSitePeriodOutcomes, recordOutcome, retryDeadlineFor, retryDueAt } from './rank-outcomes.repo.js';

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

  it('classifies vendor failures and computes daily and weekly retry windows', () => {
    expect(isRetryableReason(null)).toBe(false);
    expect(isRetryableReason('vendor_timeout')).toBe(true);
    expect(isRetryableReason('vendor_auth')).toBe(false);
    expect(isBatchWideReason(null)).toBe(false);
    expect(isBatchWideReason('vendor_auth')).toBe(true);
    expect(isBatchWideReason('vendor_quota')).toBe(true);
    const saturday = new Date('2026-10-24T12:00:00.000Z');
    expect(nextPeriodStart('weekly', saturday).toISOString()).toBe('2026-10-26T00:00:00.000Z');
    expect(nextPeriodStart('weekly', new Date('2026-10-25T12:00:00.000Z')).toISOString())
      .toBe('2026-10-26T00:00:00.000Z');
    expect(nextPeriodStart('daily', saturday).toISOString()).toBe('2026-10-25T00:00:00.000Z');
    expect(retryDueAt({ firstAttemptAt: saturday,
      retryDeadline: new Date('2026-10-26T00:00:00.000Z') }, 1)?.toISOString())
      .toBe('2026-10-24T12:30:00.000Z');
    expect(retryDueAt({ firstAttemptAt: saturday,
      retryDeadline: new Date('2026-10-26T00:00:00.000Z') }, 3)).toBeNull();
    expect(retryDeadlineFor(saturday, 'weekly').toISOString()).toBe('2026-10-25T12:00:00.000Z');
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
    await recordOutcome(db as never, { accountId, siteId, keywordId: keyword!.id,
      periodKey: 'weekly:2026-10-19', status: 'skipped', reason: null,
      at: new Date(first.getTime() + 60 * 60_000), cadence: 'weekly', countAttempt: false });
    const latest = await readLatestOutcomes(db as never, { accountId, siteId, keywordIds: [keyword!.id] });
    expect(latest.get(keyword!.id)).toMatchObject({ status: 'skipped', attempts: 2,
      at: new Date(first.getTime() + 30 * 60_000).toISOString() });
    expect(await readSitePeriodOutcomes(db as never, { accountId, siteId,
      periodKey: 'weekly:2026-10-19' })).toHaveLength(1);
    expect(await readSitePeriodOutcomes(db as never, { accountId: 'foreign', siteId,
      periodKey: 'weekly:2026-10-19' })).toEqual([]);
    expect(await readLatestOutcomes(db as never, { accountId: 'foreign', siteId,
      keywordIds: [keyword!.id] })).toEqual(new Map());
  });

  it('plans only open outcomes and returns the newest period per keyword', async () => {
    const db = getTestDb() as never;
    const accountId = 'owner';
    const siteId = '507f1f77bcf86cd799439011';
    const [keyword] = await getTestDb().insert(keywords).values({ accountId, siteId, phrase: 'beta',
      locationCode: 2840, languageCode: 'en' }).returning();
    const at = new Date('2026-10-20T12:00:00.000Z');
    const later = new Date('2026-10-21T12:00:00.000Z');
    await recordOutcome(db, { accountId, siteId, keywordId: keyword!.id, periodKey: 'old',
      status: 'failed', reason: 'vendor_timeout', at, cadence: 'weekly' });
    await recordOutcome(db, { accountId, siteId, keywordId: keyword!.id, periodKey: 'new',
      status: 'failed', reason: 'vendor_quota', at: later, cadence: 'weekly' });
    await planRetry(db, { keywordIds: [], periodKey: 'new', nextRetryAt: later, at: later });
    const due = new Date('2026-10-21T14:00:00.000Z');
    await planRetry(db, { keywordIds: [keyword!.id], periodKey: 'new', nextRetryAt: due, at: later });
    expect((await readLatestOutcomes(db, { accountId, siteId, keywordIds: [] })).size).toBe(0);
    expect((await readLatestOutcomes(db, { accountId, siteId, keywordIds: [keyword!.id] }))
      .get(keyword!.id)).toMatchObject({ periodKey: 'new', nextRetryAt: due.toISOString() });
    await planRetry(db, { keywordIds: [keyword!.id], periodKey: 'new', nextRetryAt: null, at: later });
    expect((await readLatestOutcomes(db, { accountId, siteId, keywordIds: [keyword!.id] }))
      .get(keyword!.id)).toMatchObject({ periodKey: 'new', nextRetryAt: null });
  });
});
