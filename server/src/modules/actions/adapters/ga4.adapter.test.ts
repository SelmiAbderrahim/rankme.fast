/**
 * GA4-decline Next Actions source adapter tests.
 *
 * Locked contract under test: organic sessions emit at baseline ≥ 20 and
 * decline ≥ 20%; key events emit at baseline ≥ 5 and decline ≥ 20%; missing
 * data (including a missing organic channel row) never becomes a zero;
 * key-event decline confidence is high.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../../shared/testing/postgres.js';
import { ga4Metrics } from '../../../db/schema/index.js';
import { ga4ActionAdapter } from './ga4.adapter.js';

const siteBinding = vi.hoisted(() => ({ generationId: 'legacy' as string | undefined }));

vi.mock('../../sites/index.js', () => ({
  Site: {
    findOne: vi.fn(() => ({
      select: () => ({
        lean: async () => ({
          ga4PropertyId: 'properties/123',
          ga4BindingGenerationId: siteBinding.generationId,
        }),
      }),
    })),
  },
}));

function hex24(): string {
  return randomUUID().replaceAll('-', '').slice(0, 24);
}

async function seedGa4Snapshot(input: {
  accountId: string;
  siteId: string;
  snapshotDate: string;
  rows: Array<{ key: string; sessions: number; keyEvents?: number }>;
  dimensionSet?: string;
  windowDays?: number;
}) {
  await getTestDb()
    .insert(ga4Metrics)
    .values(
      input.rows.map((row) => ({
        accountId: input.accountId,
        siteId: input.siteId,
        bindingGenerationId: 'legacy',
        snapshotDate: input.snapshotDate,
        dimensionSet: input.dimensionSet ?? 'channel',
        windowDays: input.windowDays ?? 28,
        dimensionKey: row.key,
        sessions: row.sessions,
        activeUsers: row.sessions,
        engagedSessions: Math.floor(row.sessions / 2),
        keyEvents: row.keyEvents ?? 0,
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
  siteBinding.generationId = 'legacy';
  await truncateAllTables();
});

afterEach(async () => {
  await truncateAllTables();
});

describe('ga4ActionAdapter', () => {
  it('uses the legacy binding generation when an older bound site has no generation id', async () => {
    siteBinding.generationId = undefined;
    const accountId = hex24();
    const siteId = hex24();
    await seedGa4Snapshot({
      accountId,
      siteId,
      snapshotDate: '2026-07-01',
      rows: [{ key: 'Organic Search', sessions: 100 }],
    });
    await expect(ga4ActionAdapter({ accountId, siteId, db: getTestDb() }))
      .resolves.toMatchObject({ lastObservedAt: '2026-07-01T00:00:00.000Z' });
  });

  it('returns empty available when no snapshot exists', async () => {
    const result = await ga4ActionAdapter({
      accountId: hex24(),
      siteId: hex24(),
      db: getTestDb(),
    });
    expect(result).toEqual({ actions: [], status: 'available' });
  });

  it('emits nothing on the first snapshot (no baseline yet)', async () => {
    const accountId = hex24();
    const siteId = hex24();
    await seedGa4Snapshot({
      accountId,
      siteId,
      snapshotDate: '2026-07-01',
      rows: [{ key: 'Organic Search', sessions: 100 }],
    });
    const result = await ga4ActionAdapter({ accountId, siteId, db: getTestDb() });
    expect(result.actions).toEqual([]);
    expect(result.lastObservedAt).toBe('2026-07-01T00:00:00.000Z');
  });

  it('emits an organic-sessions decline at exactly the locked thresholds', async () => {
    const accountId = hex24();
    const siteId = hex24();
    await seedGa4Snapshot({
      accountId,
      siteId,
      snapshotDate: '2026-06-03',
      rows: [
        { key: 'Organic Search', sessions: 20 },
        { key: 'Direct', sessions: 500 },
      ],
    });
    await seedGa4Snapshot({
      accountId,
      siteId,
      snapshotDate: '2026-07-01',
      rows: [
        { key: 'Organic Search', sessions: 16 },
        { key: 'Direct', sessions: 500 },
      ],
    });

    const result = await ga4ActionAdapter({ accountId, siteId, db: getTestDb() });
    expect(result.actions).toHaveLength(1);
    const action = result.actions[0]!;
    expect(action.sourceType).toBe('ga4_decline');
    expect(action.sourceId).toBe('channel:2026-07-01:2026-06-03:organic_sessions');
    // Exactly 20% → warning severity, low band confidence, low impact.
    expect(action.severity).toBe('warning');
    expect(action.confidence).toBe('low');
    expect(action.firstPartyImpact).toBe('low');
    expect(action.effort).toBe('medium');
    expect(action.affectedUrls).toEqual([]);
    expect(action.retestAvailable).toBe(false);
    expect(action.copyVars).toEqual({
      declinePct: 20,
      currentSessions: 16,
      baselineSessions: 20,
    });
    expect(action.copyKeys.problem).toBe('actions.ga4Decline.organic.problem');
    expect(action.evidence).toEqual([
      {
        sourceRef: 'channel:2026-07-01:2026-06-03:organic_sessions',
        observation: expect.objectContaining({ sourceKind: 'first_party' }),
      },
    ]);
  });

  it('does not infer a missing organic row as zero', async () => {
    const accountId = hex24();
    const siteId = hex24();
    await seedGa4Snapshot({
      accountId,
      siteId,
      snapshotDate: '2026-06-03',
      rows: [{ key: 'Organic Search', sessions: 500 }],
    });
    // Current snapshot lacks the organic row entirely.
    await seedGa4Snapshot({
      accountId,
      siteId,
      snapshotDate: '2026-07-01',
      rows: [{ key: 'Direct', sessions: 500 }],
    });

    const result = await ga4ActionAdapter({ accountId, siteId, db: getTestDb() });
    expect(result.actions).toEqual([]);
  });

  it('excludes organic baselines below 20 and declines below 20%', async () => {
    const accountId = hex24();
    const siteId = hex24();
    await seedGa4Snapshot({
      accountId,
      siteId,
      snapshotDate: '2026-06-03',
      rows: [{ key: 'Organic Search', sessions: 19 }],
    });
    await seedGa4Snapshot({
      accountId,
      siteId,
      snapshotDate: '2026-07-01',
      rows: [{ key: 'Organic Search', sessions: 0 }],
    });
    const smallBaseline = await ga4ActionAdapter({ accountId, siteId, db: getTestDb() });
    expect(smallBaseline.actions).toEqual([]);

    const a2 = hex24();
    const s2 = hex24();
    await seedGa4Snapshot({
      accountId: a2,
      siteId: s2,
      snapshotDate: '2026-06-03',
      rows: [{ key: 'Organic Search', sessions: 100 }],
    });
    await seedGa4Snapshot({
      accountId: a2,
      siteId: s2,
      snapshotDate: '2026-07-01',
      rows: [{ key: 'Organic Search', sessions: 81 }],
    });
    const smallDecline = await ga4ActionAdapter({
      accountId: a2,
      siteId: s2,
      db: getTestDb(),
    });
    expect(smallDecline.actions).toEqual([]);
  });

  it('emits a key-events decline with fixed high confidence at baseline ≥ 5', async () => {
    const accountId = hex24();
    const siteId = hex24();
    await seedGa4Snapshot({
      accountId,
      siteId,
      snapshotDate: '2026-06-03',
      rows: [
        { key: 'Organic Search', sessions: 10, keyEvents: 3 },
        { key: 'Direct', sessions: 10, keyEvents: 2 },
      ],
    });
    await seedGa4Snapshot({
      accountId,
      siteId,
      snapshotDate: '2026-07-01',
      rows: [
        { key: 'Organic Search', sessions: 10, keyEvents: 2 },
        { key: 'Direct', sessions: 10, keyEvents: 2 },
      ],
    });

    const result = await ga4ActionAdapter({ accountId, siteId, db: getTestDb() });
    expect(result.actions).toHaveLength(1);
    const action = result.actions[0]!;
    expect(action.sourceId).toBe('channel:2026-07-01:2026-06-03:key_events');
    // 5 → 4 = 20% decline: warning severity but HIGH confidence (locked).
    expect(action.severity).toBe('warning');
    expect(action.confidence).toBe('high');
    expect(action.firstPartyImpact).toBe('none');
    expect(action.copyVars).toEqual({
      declinePct: 20,
      currentKeyEvents: 4,
      baselineKeyEvents: 5,
    });
    expect(action.copyKeys.problem).toBe('actions.ga4Decline.keyEvents.problem');
  });

  it('excludes key-event baselines below 5 and marks 40%+ declines critical', async () => {
    const accountId = hex24();
    const siteId = hex24();
    await seedGa4Snapshot({
      accountId,
      siteId,
      snapshotDate: '2026-06-03',
      rows: [{ key: 'Direct', sessions: 10, keyEvents: 4 }],
    });
    await seedGa4Snapshot({
      accountId,
      siteId,
      snapshotDate: '2026-07-01',
      rows: [{ key: 'Direct', sessions: 10, keyEvents: 0 }],
    });
    const below = await ga4ActionAdapter({ accountId, siteId, db: getTestDb() });
    expect(below.actions).toEqual([]);

    const a2 = hex24();
    const s2 = hex24();
    await seedGa4Snapshot({
      accountId: a2,
      siteId: s2,
      snapshotDate: '2026-06-03',
      rows: [{ key: 'Direct', sessions: 10, keyEvents: 5 }],
    });
    await seedGa4Snapshot({
      accountId: a2,
      siteId: s2,
      snapshotDate: '2026-07-01',
      rows: [{ key: 'Direct', sessions: 10, keyEvents: 3 }],
    });
    const critical = await ga4ActionAdapter({ accountId: a2, siteId: s2, db: getTestDb() });
    expect(critical.actions[0]!.severity).toBe('critical');
  });

  it('emits organic and key-event declines together from one snapshot pair', async () => {
    const accountId = hex24();
    const siteId = hex24();
    await seedGa4Snapshot({
      accountId,
      siteId,
      snapshotDate: '2026-06-03',
      rows: [{ key: 'Organic Search', sessions: 200, keyEvents: 50 }],
    });
    await seedGa4Snapshot({
      accountId,
      siteId,
      snapshotDate: '2026-07-01',
      rows: [{ key: 'Organic Search', sessions: 100, keyEvents: 20 }],
    });

    const result = await ga4ActionAdapter({ accountId, siteId, db: getTestDb() });
    expect(result.actions.map((a) => a.sourceId)).toEqual([
      'channel:2026-07-01:2026-06-03:organic_sessions',
      'channel:2026-07-01:2026-06-03:key_events',
    ]);
    // 50% organic decline → critical + high band; impact medium (baseline 200).
    expect(result.actions[0]!.severity).toBe('critical');
    expect(result.actions[0]!.confidence).toBe('high');
    expect(result.actions[0]!.firstPartyImpact).toBe('medium');
    // 60% key-event decline → critical, impact low (baseline 50 ≥ 20).
    expect(result.actions[1]!.severity).toBe('critical');
    expect(result.actions[1]!.firstPartyImpact).toBe('low');
  });

  it('emits no key-events action when the baseline qualifies but the decline is under the threshold', async () => {
    const accountId = hex24();
    const siteId = hex24();
    // Key-events baseline 10 (>= the locked minimum of 5) but only a 10%
    // decline — under the locked 20% bar, so absence is the honest answer.
    // Organic sessions stay flat so only the key-events arm is exercised.
    await seedGa4Snapshot({
      accountId,
      siteId,
      snapshotDate: '2026-06-03',
      rows: [{ key: 'Organic Search', sessions: 100, keyEvents: 10 }],
    });
    await seedGa4Snapshot({
      accountId,
      siteId,
      snapshotDate: '2026-07-01',
      rows: [{ key: 'Organic Search', sessions: 100, keyEvents: 9 }],
    });

    const result = await ga4ActionAdapter({ accountId, siteId, db: getTestDb() });

    expect(result.actions).toEqual([]);
    expect(result.status).toBe('available');
    expect(result.lastObservedAt).toBe('2026-07-01T00:00:00.000Z');
  });

  it('ignores other dimension sets and windows, and never leaks other tenants', async () => {
    const accountId = hex24();
    const siteId = hex24();
    await seedGa4Snapshot({
      accountId,
      siteId,
      snapshotDate: '2026-06-03',
      dimensionSet: 'page',
      rows: [{ key: 'https://ex.test/a', sessions: 100 }],
    });
    await seedGa4Snapshot({
      accountId,
      siteId,
      snapshotDate: '2026-07-01',
      windowDays: 7,
      rows: [{ key: 'Organic Search', sessions: 1 }],
    });
    const wrongDims = await ga4ActionAdapter({ accountId, siteId, db: getTestDb() });
    expect(wrongDims).toEqual({ actions: [], status: 'available' });

    const owner = hex24();
    const ownedSite = hex24();
    await seedGa4Snapshot({
      accountId: owner,
      siteId: ownedSite,
      snapshotDate: '2026-06-03',
      rows: [{ key: 'Organic Search', sessions: 100 }],
    });
    await seedGa4Snapshot({
      accountId: owner,
      siteId: ownedSite,
      snapshotDate: '2026-07-01',
      rows: [{ key: 'Organic Search', sessions: 10 }],
    });
    const otherAccount = await ga4ActionAdapter({
      accountId: hex24(),
      siteId: ownedSite,
      db: getTestDb(),
    });
    expect(otherAccount.actions).toEqual([]);
    const otherSite = await ga4ActionAdapter({
      accountId: owner,
      siteId: hex24(),
      db: getTestDb(),
    });
    expect(otherSite.actions).toEqual([]);
  });
});
