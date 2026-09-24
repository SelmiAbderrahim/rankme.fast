/**
 * GSC-decline Next Actions source adapter tests.
 *
 * Locked contract under test: an action exists only when comparable 28-day
 * `page` snapshots show a baseline of at least 20 clicks AND a decline of at
 * least 20 percent; missing/incomparable data emits no action (never a
 * zero); severity/confidence/impact come from the locked helpers.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../../shared/testing/postgres.js';
import { gscSearchAnalytics } from '../../../db/schema/index.js';
import { gscActionAdapter } from './gsc.adapter.js';

vi.mock('../../sites/index.js', () => ({
  Site: {
    findOne: vi.fn(() => ({
      select: () => ({
        lean: async () => ({
          gscPropertyUrl: 'sc-domain:ex.test',
          gscBindingGenerationId: 'legacy',
        }),
      }),
    })),
  },
}));

function hex24(): string {
  return randomUUID().replaceAll('-', '').slice(0, 24);
}

async function seedSnapshot(input: {
  accountId: string;
  siteId: string;
  snapshotDate: string;
  rows: Array<{ key: string; clicks: number }>;
  dimensionSet?: string;
  windowDays?: number;
}) {
  await getTestDb()
    .insert(gscSearchAnalytics)
    .values(
      input.rows.map((row) => ({
        accountId: input.accountId,
        siteId: input.siteId,
        bindingGenerationId: 'legacy',
        snapshotDate: input.snapshotDate,
        dimensionSet: input.dimensionSet ?? 'page',
        windowDays: input.windowDays ?? 28,
        dimensionKey: row.key,
        clicks: row.clicks,
        impressions: row.clicks * 10,
        ctr: 0.1,
        position: 5,
      })),
    );
}

beforeAll(async () => {
  await startTestPostgres();
});

afterAll(async () => {
  await stopTestPostgres();
});

beforeEach(async () => {
  await truncateAllTables();
});

afterEach(async () => {
  await truncateAllTables();
});

describe('gscActionAdapter', () => {
  it('returns empty available when no snapshot exists', async () => {
    const result = await gscActionAdapter({
      accountId: hex24(),
      siteId: hex24(),
      db: getTestDb(),
    });
    expect(result).toEqual({ actions: [], status: 'available' });
  });

  it('emits nothing on the first snapshot (no baseline yet)', async () => {
    const accountId = hex24();
    const siteId = hex24();
    await seedSnapshot({
      accountId,
      siteId,
      snapshotDate: '2026-07-01',
      rows: [{ key: 'https://ex.test/a', clicks: 100 }],
    });
    const result = await gscActionAdapter({ accountId, siteId, db: getTestDb() });
    expect(result.actions).toEqual([]);
    expect(result.status).toBe('available');
    expect(result.lastObservedAt).toBe('2026-07-01T00:00:00.000Z');
  });

  it('emits a decline action at exactly the locked thresholds (baseline 20, decline 20%)', async () => {
    const accountId = hex24();
    const siteId = hex24();
    await seedSnapshot({
      accountId,
      siteId,
      snapshotDate: '2026-06-03',
      rows: [{ key: 'https://ex.test/a', clicks: 20 }],
    });
    await seedSnapshot({
      accountId,
      siteId,
      snapshotDate: '2026-07-01',
      rows: [{ key: 'https://ex.test/a', clicks: 16 }],
    });

    const result = await gscActionAdapter({ accountId, siteId, db: getTestDb() });
    expect(result.actions).toHaveLength(1);
    const action = result.actions[0]!;
    expect(action.sourceType).toBe('gsc_decline');
    expect(action.sourceId).toBe('page:2026-07-01:2026-06-03:clicks');
    // 20% decline → warning severity, low band confidence, low impact (baseline 20).
    expect(action.severity).toBe('warning');
    expect(action.confidence).toBe('low');
    expect(action.firstPartyImpact).toBe('low');
    expect(action.effort).toBe('medium');
    expect(action.retestAvailable).toBe(false);
    expect(action.retestReasonKey).toBe('actions.errors.retestUnsupported');
    expect(action.copyVars).toEqual({
      declinePct: 20,
      currentClicks: 16,
      baselineClicks: 20,
    });
    expect(action.observedAt).toBe('2026-07-01T00:00:00.000Z');
    expect(action.affectedUrls).toEqual(['https://ex.test/a']);
    expect(action.evidence).toEqual([
      {
        sourceRef: 'page:2026-07-01:2026-06-03:clicks',
        observation: expect.objectContaining({ sourceKind: 'first_party' }),
      },
    ]);
  });

  it('excludes declines below 20% and baselines below 20 clicks', async () => {
    const accountId = hex24();
    const siteId = hex24();
    // Baseline 100 → current 81 = 19% decline: excluded.
    await seedSnapshot({
      accountId,
      siteId,
      snapshotDate: '2026-06-03',
      rows: [{ key: 'https://ex.test/a', clicks: 100 }],
    });
    await seedSnapshot({
      accountId,
      siteId,
      snapshotDate: '2026-07-01',
      rows: [{ key: 'https://ex.test/a', clicks: 81 }],
    });
    const below = await gscActionAdapter({ accountId, siteId, db: getTestDb() });
    expect(below.actions).toEqual([]);
    expect(below.lastObservedAt).toBe('2026-07-01T00:00:00.000Z');

    // Baseline 19 → current 0 = 100% decline but baseline under 20: excluded.
    const account2 = hex24();
    const site2 = hex24();
    await seedSnapshot({
      accountId: account2,
      siteId: site2,
      snapshotDate: '2026-06-03',
      rows: [{ key: 'https://ex.test/a', clicks: 19 }],
    });
    await seedSnapshot({
      accountId: account2,
      siteId: site2,
      snapshotDate: '2026-07-01',
      rows: [{ key: 'https://ex.test/a', clicks: 0 }],
    });
    const smallBaseline = await gscActionAdapter({
      accountId: account2,
      siteId: site2,
      db: getTestDb(),
    });
    expect(smallBaseline.actions).toEqual([]);
  });

  it('bands severity and confidence by decline percent', async () => {
    // 30% decline → warning + medium band.
    const a = hex24();
    const s = hex24();
    await seedSnapshot({
      accountId: a,
      siteId: s,
      snapshotDate: '2026-06-03',
      rows: [{ key: 'https://ex.test/a', clicks: 100 }],
    });
    await seedSnapshot({
      accountId: a,
      siteId: s,
      snapshotDate: '2026-07-01',
      rows: [{ key: 'https://ex.test/a', clicks: 70 }],
    });
    const medium = await gscActionAdapter({ accountId: a, siteId: s, db: getTestDb() });
    expect(medium.actions[0]!.severity).toBe('warning');
    expect(medium.actions[0]!.confidence).toBe('medium');

    // 40% decline → critical + high band; baseline 500 → high impact.
    const a2 = hex24();
    const s2 = hex24();
    await seedSnapshot({
      accountId: a2,
      siteId: s2,
      snapshotDate: '2026-06-03',
      rows: [{ key: 'https://ex.test/a', clicks: 500 }],
    });
    await seedSnapshot({
      accountId: a2,
      siteId: s2,
      snapshotDate: '2026-07-01',
      rows: [{ key: 'https://ex.test/a', clicks: 300 }],
    });
    const high = await gscActionAdapter({ accountId: a2, siteId: s2, db: getTestDb() });
    expect(high.actions[0]!.severity).toBe('critical');
    expect(high.actions[0]!.confidence).toBe('high');
    expect(high.actions[0]!.firstPartyImpact).toBe('high');
  });

  it('lists declining pages by loss, counts vanished pages as fully declined, and skips gainers', async () => {
    const accountId = hex24();
    const siteId = hex24();
    await seedSnapshot({
      accountId,
      siteId,
      snapshotDate: '2026-06-03',
      rows: [
        { key: 'https://ex.test/big-loss', clicks: 60 },
        { key: 'https://ex.test/vanished', clicks: 30 },
        { key: 'https://ex.test/small-loss', clicks: 20 },
        { key: 'https://ex.test/gainer', clicks: 10 },
        { key: 'not a url', clicks: 9 },
      ],
    });
    await seedSnapshot({
      accountId,
      siteId,
      snapshotDate: '2026-07-01',
      rows: [
        { key: 'https://ex.test/big-loss', clicks: 5 },
        { key: 'https://ex.test/small-loss', clicks: 10 },
        { key: 'https://ex.test/gainer', clicks: 30 },
        { key: 'not a url', clicks: 0 },
      ],
    });

    const result = await gscActionAdapter({ accountId, siteId, db: getTestDb() });
    expect(result.actions).toHaveLength(1);
    // Losses: big-loss 55, vanished 30, small-loss 10, hostile key dropped by
    // the canonicalizer, gainer excluded.
    expect(result.actions[0]!.affectedUrls).toEqual([
      'https://ex.test/big-loss',
      'https://ex.test/vanished',
      'https://ex.test/small-loss',
    ]);
  });

  it('breaks equal-loss ties by URL ascending', async () => {
    const accountId = hex24();
    const siteId = hex24();
    await seedSnapshot({
      accountId,
      siteId,
      snapshotDate: '2026-06-03',
      rows: [
        { key: 'https://ex.test/b', clicks: 50 },
        { key: 'https://ex.test/a', clicks: 50 },
      ],
    });
    await seedSnapshot({
      accountId,
      siteId,
      snapshotDate: '2026-07-01',
      rows: [
        { key: 'https://ex.test/b', clicks: 25 },
        { key: 'https://ex.test/a', clicks: 25 },
      ],
    });
    const result = await gscActionAdapter({ accountId, siteId, db: getTestDb() });
    expect(result.actions[0]!.affectedUrls).toEqual([
      'https://ex.test/a',
      'https://ex.test/b',
    ]);
  });

  it('compares only the two newest snapshots and only page/28-day rows', async () => {
    const accountId = hex24();
    const siteId = hex24();
    // Oldest snapshot would produce a huge decline — must be ignored.
    await seedSnapshot({
      accountId,
      siteId,
      snapshotDate: '2026-05-06',
      rows: [{ key: 'https://ex.test/a', clicks: 1000 }],
    });
    await seedSnapshot({
      accountId,
      siteId,
      snapshotDate: '2026-06-03',
      rows: [{ key: 'https://ex.test/a', clicks: 100 }],
    });
    await seedSnapshot({
      accountId,
      siteId,
      snapshotDate: '2026-07-01',
      rows: [{ key: 'https://ex.test/a', clicks: 95 }],
    });
    // Different dimension set / window rows that would otherwise trip the
    // threshold — must be invisible to the adapter.
    await seedSnapshot({
      accountId,
      siteId,
      snapshotDate: '2026-07-02',
      dimensionSet: 'query',
      rows: [{ key: 'keyword', clicks: 0 }],
    });
    await seedSnapshot({
      accountId,
      siteId,
      snapshotDate: '2026-07-03',
      windowDays: 7,
      rows: [{ key: 'https://ex.test/a', clicks: 0 }],
    });

    const result = await gscActionAdapter({ accountId, siteId, db: getTestDb() });
    // 100 → 95 = 5% decline between the two newest page/28 snapshots.
    expect(result.actions).toEqual([]);
    expect(result.lastObservedAt).toBe('2026-07-01T00:00:00.000Z');
  });

  it('breaks ties between equally declining pages by URL, ascending', async () => {
    const accountId = hex24();
    const siteId = hex24();
    // Four pages that each lost exactly 10 clicks, inserted out of URL order.
    // Total: baseline 80 -> current 40 = a 50% decline, well past both bars.
    await seedSnapshot({
      accountId,
      siteId,
      snapshotDate: '2026-06-03',
      rows: [
        { key: 'https://ex.test/delta', clicks: 20 },
        { key: 'https://ex.test/bravo', clicks: 20 },
        { key: 'https://ex.test/charlie', clicks: 20 },
        { key: 'https://ex.test/alpha', clicks: 20 },
      ],
    });
    await seedSnapshot({
      accountId,
      siteId,
      snapshotDate: '2026-07-01',
      rows: [
        { key: 'https://ex.test/delta', clicks: 10 },
        { key: 'https://ex.test/bravo', clicks: 10 },
        { key: 'https://ex.test/charlie', clicks: 10 },
        { key: 'https://ex.test/alpha', clicks: 10 },
      ],
    });

    const result = await gscActionAdapter({ accountId, siteId, db: getTestDb() });

    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]!.affectedUrls).toEqual([
      'https://ex.test/alpha',
      'https://ex.test/bravo',
      'https://ex.test/charlie',
      'https://ex.test/delta',
    ]);
  });

  it('orders bigger losses ahead of ties on the tie-break URL', async () => {
    const accountId = hex24();
    const siteId = hex24();
    await seedSnapshot({
      accountId,
      siteId,
      snapshotDate: '2026-06-03',
      rows: [
        { key: 'https://ex.test/zulu', clicks: 60 },
        { key: 'https://ex.test/alpha', clicks: 20 },
        { key: 'https://ex.test/bravo', clicks: 20 },
      ],
    });
    await seedSnapshot({
      accountId,
      siteId,
      snapshotDate: '2026-07-01',
      rows: [
        { key: 'https://ex.test/zulu', clicks: 10 },
        { key: 'https://ex.test/alpha', clicks: 10 },
        { key: 'https://ex.test/bravo', clicks: 10 },
      ],
    });

    const result = await gscActionAdapter({ accountId, siteId, db: getTestDb() });

    // zulu lost 50; alpha and bravo each lost 10 and tie-break alphabetically.
    expect(result.actions[0]!.affectedUrls).toEqual([
      'https://ex.test/zulu',
      'https://ex.test/alpha',
      'https://ex.test/bravo',
    ]);
  });

  // The read query carries no ORDER BY, so SQL makes no ordering promise —
  // today's plan happens to return rows dimension-key ascending, but the
  // adapter must not depend on it. A duck-typed drizzle stub feeds the rows
  // back in DESCENDING url order to prove the comparator does the sorting.
  function stubGscDb(input: {
    latestDate: string;
    baselineDate: string;
    currentRows: Array<{ dimensionKey: string; clicks: number }>;
    baselineRows: Array<{ dimensionKey: string; clicks: number }>;
  }) {
    const dateReads = [
      [{ snapshotDate: input.latestDate }],
      [{ snapshotDate: input.baselineDate }],
    ];
    // Promise.all issues the current read before the baseline read.
    const rowReads = [input.currentRows, input.baselineRows];
    return {
      select: () => ({
        from: () => ({
          where: () => ({
            then: (resolve: (rows: unknown) => void) => resolve(rowReads.shift()),
            orderBy: () => ({
              limit: async () => dateReads.shift(),
            }),
          }),
        }),
      }),
    } as never;
  }

  it('sorts tied declines by URL regardless of the order rows arrive in', async () => {
    const rows = (clicks: number) => [
      { dimensionKey: 'https://ex.test/delta', clicks },
      { dimensionKey: 'https://ex.test/charlie', clicks },
      { dimensionKey: 'https://ex.test/bravo', clicks },
      { dimensionKey: 'https://ex.test/alpha', clicks },
    ];

    const result = await gscActionAdapter({
      accountId: hex24(),
      siteId: hex24(),
      db: stubGscDb({
        latestDate: '2026-07-01',
        baselineDate: '2026-06-03',
        currentRows: rows(10),
        baselineRows: rows(20),
      }),
    });

    expect(result.actions).toHaveLength(1);
    // Every page lost exactly 10 clicks; the tie-break must re-order the
    // descending input into ascending URL order.
    expect(result.actions[0]!.affectedUrls).toEqual([
      'https://ex.test/alpha',
      'https://ex.test/bravo',
      'https://ex.test/charlie',
      'https://ex.test/delta',
    ]);
    expect(result.actions[0]!.copyVars).toEqual({
      declinePct: 50,
      currentClicks: 40,
      baselineClicks: 80,
    });
  });

  it('never leaks another account or site', async () => {
    const accountId = hex24();
    const siteId = hex24();
    await seedSnapshot({
      accountId,
      siteId,
      snapshotDate: '2026-06-03',
      rows: [{ key: 'https://ex.test/a', clicks: 100 }],
    });
    await seedSnapshot({
      accountId,
      siteId,
      snapshotDate: '2026-07-01',
      rows: [{ key: 'https://ex.test/a', clicks: 10 }],
    });

    const otherAccount = await gscActionAdapter({
      accountId: hex24(),
      siteId,
      db: getTestDb(),
    });
    expect(otherAccount.actions).toEqual([]);
    expect(otherAccount).toEqual({ actions: [], status: 'available' });

    const otherSite = await gscActionAdapter({
      accountId,
      siteId: hex24(),
      db: getTestDb(),
    });
    expect(otherSite.actions).toEqual([]);
  });
});
