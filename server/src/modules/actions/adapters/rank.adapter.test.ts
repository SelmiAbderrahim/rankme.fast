/**
 * Confirmed-rank-drop Next Actions source adapter tests.
 *
 * Locked contract under test: ONLY `confirmed` drops become
 * candidates; `volatile` and `unconfirmed` rows are suppressed; sourceId is
 * the confirmation-event row id; retest is unsupported.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../../shared/testing/postgres.js';
import { keywords, rankDropConfirmations, rankings } from '../../../db/schema/index.js';
import { rankActionAdapter } from './rank.adapter.js';

function hex24(): string {
  return randomUUID().replaceAll('-', '').slice(0, 24);
}

async function seedConfirmation(input: {
  accountId: string;
  siteId: string;
  phrase?: string;
  state?: 'confirmed' | 'volatile' | 'unconfirmed';
  candidateObservedAt?: Date;
  confirmationObservedAt?: Date | null;
}) {
  const db = getTestDb();
  const [keyword] = await db
    .insert(keywords)
    .values({
      accountId: input.accountId,
      siteId: input.siteId,
      phrase: input.phrase ?? 'best running shoes',
      locationCode: 2840,
      languageCode: 'en',
      device: 'desktop',
    })
    .returning({ id: keywords.id });
  const [ranking] = await db
    .insert(rankings)
    .values({
      keywordId: keyword!.id,
      position: 14,
      checkedAt: input.candidateObservedAt ?? new Date('2026-07-02T00:00:00Z'),
      source: 'fresh',
    })
    .returning({ id: rankings.id });
  const state = input.state ?? 'confirmed';
  const [row] = await db
    .insert(rankDropConfirmations)
    .values({
      accountId: input.accountId,
      siteId: input.siteId,
      keywordId: keyword!.id,
      rankingId: ranking!.id,
      state,
      reason: state === 'unconfirmed' ? 'provider_timeout' : null,
      previousPosition: 3,
      candidatePosition: 14,
      confirmationPosition: state === 'unconfirmed' ? null : 15,
      candidateObservedAt:
        input.candidateObservedAt ?? new Date('2026-07-02T00:00:00Z'),
      confirmationObservedAt:
        input.confirmationObservedAt === undefined
          ? state === 'unconfirmed'
            ? null
            : new Date('2026-07-02T06:00:00Z')
          : input.confirmationObservedAt,
      locationCode: 2840,
      languageCode: 'en',
      device: 'desktop',
      attemptReservedAt: new Date('2026-07-02T01:00:00Z'),
      settledAt: new Date('2026-07-02T06:00:00Z'),
    })
    .returning();
  return row!;
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

describe('rankActionAdapter', () => {
  it('returns empty available when no confirmation exists', async () => {
    const result = await rankActionAdapter({
      accountId: hex24(),
      siteId: hex24(),
      db: getTestDb(),
    });
    expect(result).toEqual({ actions: [], status: 'available' });
  });

  it('emits confirmed drops with the locked deterministic mapping', async () => {
    const accountId = hex24();
    const siteId = hex24();
    const row = await seedConfirmation({ accountId, siteId, phrase: 'seo audit tool' });

    const result = await rankActionAdapter({ accountId, siteId, db: getTestDb() });
    expect(result.status).toBe('available');
    expect(result.lastObservedAt).toBe(row.candidateObservedAt.toISOString());
    expect(result.actions).toHaveLength(1);

    const action = result.actions[0]!;
    expect(action.sourceType).toBe('confirmed_rank_drop');
    expect(action.sourceId).toBe(row.id);
    expect(action.severity).toBe('warning');
    expect(action.confidence).toBe('high');
    expect(action.firstPartyImpact).toBe('none');
    expect(action.effort).toBe('low');
    expect(action.sourceState).toBe('open');
    expect(action.affectedUrls).toEqual([]);
    expect(action.retestAvailable).toBe(false);
    expect(action.retestReasonKey).toBe('actions.errors.retestUnsupported');
    expect(action.copyVars).toEqual({ keyword: 'seo audit tool' });
    expect(action.observedAt).toBe(row.confirmationObservedAt!.toISOString());
    expect(action.lastVerifiedAt).toBe(row.confirmationObservedAt!.toISOString());
    expect(action.evidence).toEqual([
      {
        sourceRef: row.id,
        observation: expect.objectContaining({
          sourceKind: 'provider_observation',
          freshness: 'fresh',
        }),
      },
    ]);
  });

  it('suppresses volatile and unconfirmed rows', async () => {
    const accountId = hex24();
    const siteId = hex24();
    await seedConfirmation({ accountId, siteId, state: 'volatile', phrase: 'kw-a' });
    await seedConfirmation({ accountId, siteId, state: 'unconfirmed', phrase: 'kw-b' });

    const result = await rankActionAdapter({ accountId, siteId, db: getTestDb() });
    expect(result.actions).toEqual([]);
    expect(result.status).toBe('available');
  });

  it('orders newest candidateObservedAt first and batches phrase lookups', async () => {
    const accountId = hex24();
    const siteId = hex24();
    const older = await seedConfirmation({
      accountId,
      siteId,
      phrase: 'older keyword',
      candidateObservedAt: new Date('2026-06-01T00:00:00Z'),
      confirmationObservedAt: new Date('2026-06-01T06:00:00Z'),
    });
    const newer = await seedConfirmation({
      accountId,
      siteId,
      phrase: 'newer keyword',
      candidateObservedAt: new Date('2026-07-10T00:00:00Z'),
      confirmationObservedAt: new Date('2026-07-10T06:00:00Z'),
    });

    const result = await rankActionAdapter({ accountId, siteId, db: getTestDb() });
    expect(result.actions.map((a) => a.sourceId)).toEqual([newer.id, older.id]);
    expect(result.lastObservedAt).toBe(newer.candidateObservedAt.toISOString());
    expect(result.actions.map((a) => a.copyVars?.keyword)).toEqual([
      'newer keyword',
      'older keyword',
    ]);
  });

  it('never leaks another account or site', async () => {
    const accountId = hex24();
    const siteId = hex24();
    await seedConfirmation({ accountId, siteId });

    const otherAccount = await rankActionAdapter({
      accountId: hex24(),
      siteId,
      db: getTestDb(),
    });
    expect(otherAccount.actions).toEqual([]);

    const otherSite = await rankActionAdapter({
      accountId,
      siteId: hex24(),
      db: getTestDb(),
    });
    expect(otherSite.actions).toEqual([]);
  });

  it('skips rows without a phrase and falls back to candidateObservedAt defensively', async () => {
    // Duck-typed drizzle stub — these row shapes are unreachable through the
    // real write path (FK cascade + DB checks) but must not crash the adapter.
    const confirmedAt = new Date('2026-07-03T00:00:00.000Z');
    const results: unknown[][] = [
      [
        {
          id: 'row-no-phrase',
          keywordId: 'kw-missing',
          candidateObservedAt: confirmedAt,
          confirmationObservedAt: null,
        },
        {
          id: 'row-null-confirmation',
          keywordId: 'kw-present',
          candidateObservedAt: confirmedAt,
          confirmationObservedAt: null,
        },
      ],
      [{ id: 'kw-present', phrase: 'surviving keyword' }],
    ];
    const stubDb = {
      select: () => ({
        from: () => {
          const rows = results.shift() ?? [];
          const chain = {
            where: () => ({
              orderBy: () => ({ limit: async () => rows }),
              then: (resolve: (v: unknown[]) => void) => resolve(rows),
            }),
          };
          return chain;
        },
      }),
    } as never;

    const result = await rankActionAdapter({
      accountId: hex24(),
      siteId: hex24(),
      db: stubDb,
    });
    expect(result.actions).toHaveLength(1);
    const action = result.actions[0]!;
    expect(action.sourceId).toBe('row-null-confirmation');
    // No confirmation observation → observedAt falls back to the candidate.
    expect(action.observedAt).toBe(confirmedAt.toISOString());
    expect(action.lastVerifiedAt).toBeNull();
    expect(action.copyVars).toEqual({ keyword: 'surviving keyword' });
  });
});
