import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { gscSearchAnalytics } from '../../db/schema/gsc.js';
import { getTestDb, startTestPostgres, stopTestPostgres, truncateAllTables } from '../../shared/testing/postgres.js';
import {
  finishGscSyncRun,
  readLatestGscSyncRun,
  readLatestPagesGscSnapshot,
  readPagesGscHistory,
  readPagesGscSnapshotAtDate,
  readPreviousPagesGscSnapshot,
  readPreviousSnapshotTotalsForAccount,
  startGscSyncRun,
  upsertSearchAnalytics,
} from './gsc-snapshots.service.js';

beforeAll(startTestPostgres);
afterAll(stopTestPostgres);
beforeEach(truncateAllTables);

const accountId = 'account-a';
const siteId = 'site-a';

async function write(account: string, date: string, url: string) {
  await upsertSearchAnalytics(getTestDb() as never, {
    accountId: account,
    siteId,
    snapshotDate: date,
    dimensionSet: 'page',
    windowDays: 28,
    rows: [{ keys: [url], clicks: 1, impressions: 2, ctr: 0.5, position: 3 }],
  });
}

describe('Pages GSC repositories', () => {
  it('rejects missing tenant scope before issuing a Pages read', async () => {
    await expect(readLatestPagesGscSnapshot(getTestDb() as never, {
      accountId: '', siteId, dimensionSet: 'page', windowDays: 28,
    })).rejects.toThrow('tenant scope');
    await expect(readPreviousSnapshotTotalsForAccount(
      getTestDb() as never, accountId, '', 'page', '2026-08-02',
    )).rejects.toThrow('tenant scope');
  });

  it('fails closed if a sync-run insert unexpectedly returns no row', async () => {
    const tx = {
      execute: vi.fn().mockResolvedValue(undefined),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ generation: 0 }]) }),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
      }),
    };
    const db = { transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)) };
    await expect(startGscSyncRun(db as never, {
      accountId, siteId, propertyUrlHash: 'a'.repeat(64), startedAt: new Date('2026-08-01'),
    })).rejects.toThrow('could not be started');
  });

  it('keeps replacement writes and latest/previous/history reads account scoped', async () => {
    await write(accountId, '2026-08-01', 'https://a.test/old');
    await write(accountId, '2026-08-02', 'https://a.test/current');
    await write('account-b', '2026-08-03', 'https://b.test/leak');
    await write(accountId, '2026-08-02', 'https://a.test/replaced');
    const key = { accountId, siteId, dimensionSet: 'page' as const, windowDays: 28 as const };
    const latest = await readLatestPagesGscSnapshot(getTestDb() as never, key);
    expect(latest?.snapshotDate).toBe('2026-08-02');
    expect(latest?.rows.map((row) => row.dimensionKey)).toEqual(['https://a.test/replaced']);
    expect((await readPreviousPagesGscSnapshot(getTestDb() as never, { ...key, beforeDate: '2026-08-02' }))?.snapshotDate).toBe('2026-08-01');
    expect((await readPagesGscSnapshotAtDate(getTestDb() as never, key, '2026-08-01')).rows.map((row) => row.dimensionKey)).toEqual(['https://a.test/old']);
    expect(await readPagesGscSnapshotAtDate(getTestDb() as never, key, '1999-01-01')).toEqual({ snapshotDate: '1999-01-01', fetchedAt: new Date(0), rows: [] });
    expect(await readPreviousSnapshotTotalsForAccount(getTestDb() as never, accountId, siteId, 'page', '2026-08-02')).toMatchObject({ snapshotDate: '2026-08-01', clicks: 1, impressions: 2 });
    expect(await readPreviousSnapshotTotalsForAccount(getTestDb() as never, 'account-b', siteId, 'page', '2026-08-03')).toBeNull();
    expect((await readPagesGscHistory(getTestDb() as never, { ...key, since: '2026-08-01', until: '2026-08-31', limit: 90 })).map((row) => row.snapshotDate)).toEqual(['2026-08-01', '2026-08-02']);
    expect((await readPagesGscHistory(getTestDb() as never, { ...key, since: '2026-08-01', until: '2026-08-31' })).map((row) => row.snapshotDate)).toEqual(['2026-08-01', '2026-08-02']);
    expect(await readLatestPagesGscSnapshot(getTestDb() as never, { ...key, accountId: 'missing' })).toBeNull();
    expect(await readPreviousPagesGscSnapshot(getTestDb() as never, { ...key, beforeDate: '2026-08-01' })).toBeNull();
    expect(await getTestDb().select().from(gscSearchAnalytics)).toHaveLength(3);
  });

  it('uses the latest fetchedAt across rows in one materialized date', async () => {
    await getTestDb().insert(gscSearchAnalytics).values([
      { accountId, siteId, bindingGenerationId: 'legacy', snapshotDate: '2026-08-10', dimensionSet: 'page', windowDays: 28, dimensionKey: 'https://a.test/first', clicks: 2, impressions: 2, ctr: 1, position: 1, fetchedAt: new Date('2026-08-10T01:00:00Z') },
      { accountId, siteId, bindingGenerationId: 'legacy', snapshotDate: '2026-08-10', dimensionSet: 'page', windowDays: 28, dimensionKey: 'https://a.test/second', clicks: 1, impressions: 1, ctr: 1, position: 1, fetchedAt: new Date('2026-08-10T02:00:00Z') },
    ]);
    const snapshot = await readPagesGscSnapshotAtDate(getTestDb() as never, { accountId, siteId, dimensionSet: 'page', windowDays: 28 }, '2026-08-10');
    expect(snapshot.fetchedAt).toEqual(new Date('2026-08-10T02:00:00Z'));
  });

  it('records monotonic property-scoped sync health and tenant-scoped terminal updates', async () => {
    const first = await startGscSyncRun(getTestDb() as never, { accountId, siteId, propertyUrlHash: 'a'.repeat(64), startedAt: new Date('2026-08-01') });
    const second = await startGscSyncRun(getTestDb() as never, { accountId, siteId, propertyUrlHash: 'b'.repeat(64), startedAt: new Date('2026-08-02') });
    expect([first.generation, second.generation]).toEqual([1, 2]);
    await finishGscSyncRun(getTestDb() as never, { id: first.id, accountId: 'wrong', siteId, status: 'failed', completedAt: new Date('2026-08-03'), snapshotDate: null, failureClass: 'wrong' });
    await finishGscSyncRun(getTestDb() as never, { id: first.id, accountId, siteId, status: 'succeeded', completedAt: new Date('2026-08-03'), snapshotDate: '2026-07-31', failureClass: null });
    await finishGscSyncRun(getTestDb() as never, { id: second.id, accountId, siteId, status: 'failed', completedAt: new Date('2026-08-03'), snapshotDate: null, failureClass: 'unavailable' });
    expect(await readLatestGscSyncRun(getTestDb() as never, { accountId, siteId, propertyUrlHash: 'a'.repeat(64) })).toMatchObject({ status: 'succeeded', snapshotDate: '2026-07-31' });
    expect(await readLatestGscSyncRun(getTestDb() as never, { accountId, siteId, propertyUrlHash: 'b'.repeat(64) })).toMatchObject({ status: 'failed', lastSuccessAt: null, failureClass: 'unavailable' });
    expect(await readLatestGscSyncRun(getTestDb() as never, { accountId: 'other', siteId, propertyUrlHash: 'a'.repeat(64) })).toBeNull();

    const expired = await startGscSyncRun(getTestDb() as never, { accountId, siteId, propertyUrlHash: 'c'.repeat(64), startedAt: new Date('2020-01-01') });
    const current = await startGscSyncRun(getTestDb() as never, { accountId, siteId, propertyUrlHash: 'd'.repeat(64), startedAt: new Date('2026-08-04') });
    await finishGscSyncRun(getTestDb() as never, { id: current.id, accountId, siteId, status: 'empty', completedAt: new Date('2026-08-05'), snapshotDate: '2026-08-02', failureClass: null });
    expect(await readLatestGscSyncRun(getTestDb() as never, { accountId, siteId, propertyUrlHash: expired.propertyUrlHash })).toBeNull();
    expect(await readLatestGscSyncRun(getTestDb() as never, { accountId, siteId, propertyUrlHash: current.propertyUrlHash })).toMatchObject({ status: 'empty' });
  });
});
