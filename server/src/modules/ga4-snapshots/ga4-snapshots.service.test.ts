/**
 * GA4 snapshot repository tests — real generated migrations against PGlite,
 * per the drizzle-postgres-scope rule. Mirrors the gsc-snapshots suite.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../db/client.js';
import {
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import {
  GA4_DIMENSION_SETS,
  readGa4Metrics,
  readLatestGa4SnapshotDate,
  readPreviousGa4Totals,
  upsertGa4Metrics,
  type Ga4MetricRowInput,
} from './ga4-snapshots.service.js';

let db: Db;

beforeAll(async () => {
  db = (await startTestPostgres()) as unknown as Db;
});

afterAll(async () => {
  await stopTestPostgres();
});

beforeEach(async () => {
  await truncateAllTables();
});

const SITE_A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const SITE_B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const ACCOUNT_A = '111111111111111111111111';

function row(key: string, sessions: number): Ga4MetricRowInput {
  return {
    key,
    sessions,
    activeUsers: Math.round(sessions * 0.9),
    engagedSessions: Math.round(sessions * 0.7),
    keyEvents: Math.round(sessions * 0.1),
  };
}

describe('GA4_DIMENSION_SETS', () => {
  it('covers the five product dimension sets', () => {
    expect(GA4_DIMENSION_SETS).toEqual([
      'date',
      'channel',
      'page',
      'country',
      'device',
    ]);
  });
});

describe('upsertGa4Metrics', () => {
  it('persists rows with the window and metric columns', async () => {
    await upsertGa4Metrics(db, {
      siteId: SITE_A,
      accountId: ACCOUNT_A,
      snapshotDate: '2026-07-12',
      dimensionSet: 'channel',
      windowDays: 28,
      rows: [row('Organic Search', 70), row('Direct', 30)],
    });
    const rows = await readGa4Metrics(db, SITE_A, 'channel', 28);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      accountId: ACCOUNT_A,
      siteId: SITE_A,
      snapshotDate: '2026-07-12',
      dimensionSet: 'channel',
      windowDays: 28,
      dimensionKey: 'Organic Search',
      sessions: 70,
      activeUsers: 63,
      engagedSessions: 49,
      keyEvents: 7,
    });
  });

  it('REPLACE-on-conflict: a re-run replaces the same (site, date, dim, window) set', async () => {
    const base = {
      siteId: SITE_A,
      accountId: ACCOUNT_A,
      snapshotDate: '2026-07-12',
      dimensionSet: 'page',
      windowDays: 28,
    };
    await upsertGa4Metrics(db, { ...base, rows: [row('/', 50), row('/pricing', 20)] });
    await upsertGa4Metrics(db, { ...base, rows: [row('/', 55)] });
    const rows = await readGa4Metrics(db, SITE_A, 'page', 28);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ dimensionKey: '/', sessions: 55 });
  });

  it('keeps windows independent: 7d and 28d snapshots coexist on one date', async () => {
    const base = {
      siteId: SITE_A,
      accountId: ACCOUNT_A,
      snapshotDate: '2026-07-12',
      dimensionSet: 'device',
    };
    await upsertGa4Metrics(db, { ...base, windowDays: 7, rows: [row('desktop', 10)] });
    await upsertGa4Metrics(db, { ...base, windowDays: 28, rows: [row('desktop', 40)] });
    expect(await readGa4Metrics(db, SITE_A, 'device', 7)).toHaveLength(1);
    expect((await readGa4Metrics(db, SITE_A, 'device', 28))[0]).toMatchObject({
      sessions: 40,
    });
  });

  it('dedupes duplicate keys inside one batch (last write wins)', async () => {
    await upsertGa4Metrics(db, {
      siteId: SITE_A,
      accountId: ACCOUNT_A,
      snapshotDate: '2026-07-12',
      dimensionSet: 'country',
      windowDays: 28,
      rows: [row('United States', 10), row('United States', 12)],
    });
    const rows = await readGa4Metrics(db, SITE_A, 'country', 28);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sessions).toBe(12);
  });

  it('an empty batch clears the prior set and inserts nothing', async () => {
    const base = {
      siteId: SITE_A,
      accountId: ACCOUNT_A,
      snapshotDate: '2026-07-12',
      dimensionSet: 'date',
      windowDays: 90,
    };
    await upsertGa4Metrics(db, { ...base, rows: [row('20260711', 5)] });
    await upsertGa4Metrics(db, { ...base, rows: [] });
    expect(await readGa4Metrics(db, SITE_A, 'date', 90)).toEqual([]);
  });
});

describe('readGa4Metrics', () => {
  it('orders snapshotDate ASC then sessions DESC and honours since/until', async () => {
    const base = {
      siteId: SITE_A,
      accountId: ACCOUNT_A,
      dimensionSet: 'channel',
      windowDays: 28,
    };
    await upsertGa4Metrics(db, {
      ...base,
      snapshotDate: '2026-07-05',
      rows: [row('Direct', 9)],
    });
    await upsertGa4Metrics(db, {
      ...base,
      snapshotDate: '2026-07-12',
      rows: [row('Direct', 30), row('Organic Search', 70)],
    });
    const all = await readGa4Metrics(db, SITE_A, 'channel', 28);
    expect(all.map((r) => [r.snapshotDate, r.dimensionKey])).toEqual([
      ['2026-07-05', 'Direct'],
      ['2026-07-12', 'Organic Search'],
      ['2026-07-12', 'Direct'],
    ]);
    const windowed = await readGa4Metrics(db, SITE_A, 'channel', 28, {
      since: '2026-07-06',
      until: '2026-07-12',
    });
    expect(windowed).toHaveLength(2);
  });

  it('never leaks another site’s rows', async () => {
    await upsertGa4Metrics(db, {
      siteId: SITE_B,
      accountId: ACCOUNT_A,
      snapshotDate: '2026-07-12',
      dimensionSet: 'channel',
      windowDays: 28,
      rows: [row('Direct', 5)],
    });
    expect(await readGa4Metrics(db, SITE_A, 'channel', 28)).toEqual([]);
  });
});

describe('readLatestGa4SnapshotDate', () => {
  it('returns the newest date for the window, null when none', async () => {
    expect(await readLatestGa4SnapshotDate(db, SITE_A, 'date', 28)).toBeNull();
    const base = {
      siteId: SITE_A,
      accountId: ACCOUNT_A,
      dimensionSet: 'date',
      windowDays: 28,
    };
    await upsertGa4Metrics(db, {
      ...base,
      snapshotDate: '2026-07-05',
      rows: [row('20260704', 3)],
    });
    await upsertGa4Metrics(db, {
      ...base,
      snapshotDate: '2026-07-12',
      rows: [row('20260711', 4)],
    });
    expect(await readLatestGa4SnapshotDate(db, SITE_A, 'date', 28)).toBe(
      '2026-07-12',
    );
    // A different window has its own latest date.
    expect(await readLatestGa4SnapshotDate(db, SITE_A, 'date', 7)).toBeNull();
  });
});

describe('readPreviousGa4Totals', () => {
  it('sums the newest same-window snapshot strictly before the date', async () => {
    const base = {
      siteId: SITE_A,
      accountId: ACCOUNT_A,
      dimensionSet: 'channel',
      windowDays: 28,
    };
    await upsertGa4Metrics(db, {
      ...base,
      snapshotDate: '2026-06-14',
      rows: [row('Organic Search', 40), row('Direct', 20)],
    });
    await upsertGa4Metrics(db, {
      ...base,
      snapshotDate: '2026-07-12',
      rows: [row('Organic Search', 70)],
    });
    const totals = await readPreviousGa4Totals(
      db,
      SITE_A,
      'channel',
      28,
      '2026-07-12',
    );
    expect(totals).toEqual({
      snapshotDate: '2026-06-14',
      sessions: 60,
      activeUsers: 54,
      engagedSessions: 42,
      keyEvents: 6,
    });
  });

  it('null when no earlier snapshot exists (or only in another window)', async () => {
    await upsertGa4Metrics(db, {
      siteId: SITE_A,
      accountId: ACCOUNT_A,
      snapshotDate: '2026-06-14',
      dimensionSet: 'channel',
      windowDays: 7,
      rows: [row('Direct', 5)],
    });
    expect(
      await readPreviousGa4Totals(db, SITE_A, 'channel', 28, '2026-07-12'),
    ).toBeNull();
  });
});
