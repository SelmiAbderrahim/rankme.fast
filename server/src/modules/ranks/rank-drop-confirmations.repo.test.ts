/**
 * Confirmation evidence repository tests.
 *
 * The repo is the ONLY writer for `rank_drop_confirmations`, so every
 * primitive is exercised against real Postgres (PGlite runs the generated
 * migrations, so the CHECK constraints, the `ranking_id` UNIQUE index, and
 * the FK cascades all participate). The service suite covers the orchestration
 * on top; this file pins the storage contract itself: idempotent claims,
 * single-winner updates, owner-scoped reads, ordered range scans, purge, and
 * export projection.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import { keywords, rankings } from '../../db/schema/keywords.js';
import {
  rankDropConfirmations,
  type NewRankDropConfirmationRow,
} from '../../db/schema/rank-drop-confirmations.js';
import {
  claimAlertDispatch,
  claimAttempt,
  claimProviderCall,
  countByState,
  exportForAccount,
  findByRankingId,
  listForKeyword,
  purgeForAccount,
  readForRankings,
  recordAlertDelivery,
  recordAlertError,
  settle,
} from './rank-drop-confirmations.repo.js';

const ACCOUNT_A = '507f1f77bcf86cd799439011';
const ACCOUNT_B = '507f1f77bcf86cd799439021';
const SITE_A = '507f1f77bcf86cd799439012';
const SITE_B = '507f1f77bcf86cd799439022';

const OBSERVED = new Date('2026-07-01T12:00:00.000Z');

function asDb(): Db {
  return getTestDb() as unknown as Db;
}

/** Insert a keyword + a ranking so the two FKs resolve. */
async function seedRanking(input: {
  accountId?: string;
  siteId?: string;
  phrase?: string;
  observedAt?: Date;
}): Promise<{ keywordId: string; rankingId: string }> {
  const [kw] = await getTestDb()
    .insert(keywords)
    .values({
      accountId: input.accountId ?? ACCOUNT_A,
      siteId: input.siteId ?? SITE_A,
      phrase: input.phrase ?? `phrase-${randomUUID()}`,
      locationCode: 2840,
      languageCode: 'en',
      device: 'desktop',
    })
    .returning();
  if (!kw) throw new Error('seed keyword missing');
  const [rank] = await getTestDb()
    .insert(rankings)
    .values({
      keywordId: kw.id,
      position: 15,
      checkedAt: input.observedAt ?? OBSERVED,
      source: 'fresh',
    })
    .returning();
  if (!rank) throw new Error('seed ranking missing');
  return { keywordId: kw.id, rankingId: rank.id };
}

function attemptRow(input: {
  accountId?: string;
  siteId?: string;
  keywordId: string;
  rankingId: string;
  observedAt?: Date;
}): NewRankDropConfirmationRow {
  const observedAt = input.observedAt ?? OBSERVED;
  return {
    accountId: input.accountId ?? ACCOUNT_A,
    siteId: input.siteId ?? SITE_A,
    keywordId: input.keywordId,
    rankingId: input.rankingId,
    state: 'unconfirmed',
    reason: 'interrupted',
    previousPosition: 7,
    candidatePosition: 15,
    confirmationPosition: null,
    candidateObservedAt: observedAt,
    confirmationObservedAt: null,
    locationCode: 2840,
    languageCode: 'en',
    device: 'desktop',
    attemptReservedAt: observedAt,
    providerCalledAt: null,
    settledAt: observedAt,
  };
}

/** Seed an attempt row and return it. */
async function seedAttempt(input: {
  accountId?: string;
  siteId?: string;
  phrase?: string;
  observedAt?: Date;
}) {
  const seeded = await seedRanking(input);
  const row = await claimAttempt(asDb(), attemptRow({ ...input, ...seeded }));
  if (!row) throw new Error('seed attempt missing');
  return { ...seeded, row };
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

describe('claimAttempt', () => {
  it('inserts the first attempt and returns the stored row', async () => {
    const { keywordId, rankingId } = await seedRanking({});
    const row = await claimAttempt(
      asDb(),
      attemptRow({ keywordId, rankingId }),
    );

    expect(row).not.toBeNull();
    expect(row!.rankingId).toBe(rankingId);
    expect(row!.state).toBe('unconfirmed');
    expect(row!.providerCalledAt).toBeNull();
    expect(row!.alertClaimedAt).toBeNull();
  });

  it('returns null for a replay of the same candidate ranking', async () => {
    const { keywordId, rankingId } = await seedRanking({});
    const first = await claimAttempt(
      asDb(),
      attemptRow({ keywordId, rankingId }),
    );
    const replay = await claimAttempt(
      asDb(),
      attemptRow({ keywordId, rankingId }),
    );

    expect(first).not.toBeNull();
    expect(replay).toBeNull();
    expect(
      await countByState(asDb(), { accountId: ACCOUNT_A, state: 'unconfirmed' }),
    ).toBe(1);
  });
});

describe('findByRankingId', () => {
  it('returns the stored row for a known candidate ranking', async () => {
    const { rankingId, row } = await seedAttempt({});

    const found = await findByRankingId(asDb(), rankingId);

    expect(found).not.toBeNull();
    expect(found!.id).toBe(row.id);
    expect(found!.candidatePosition).toBe(15);
    expect(found!.previousPosition).toBe(7);
    expect(found!.locationCode).toBe(2840);
    expect(found!.device).toBe('desktop');
  });

  it('returns null when no attempt exists for the ranking', async () => {
    const { rankingId } = await seedRanking({});

    expect(await findByRankingId(asDb(), rankingId)).toBeNull();
  });
});

describe('claimProviderCall', () => {
  it('lets exactly one caller cross the paid boundary', async () => {
    const { row } = await seedAttempt({});
    const at = new Date('2026-07-01T12:05:00.000Z');

    expect(await claimProviderCall(asDb(), row.id, at)).toBe(true);
    expect(await claimProviderCall(asDb(), row.id, new Date())).toBe(false);

    const stored = await findByRankingId(asDb(), row.rankingId);
    expect(stored!.providerCalledAt?.toISOString()).toBe(at.toISOString());
  });

  it('returns false for an unknown row id', async () => {
    expect(await claimProviderCall(asDb(), randomUUID(), new Date())).toBe(
      false,
    );
  });
});

describe('settle', () => {
  it('writes the terminal state, reason, and evidence fields', async () => {
    const { row } = await seedAttempt({});
    const confirmedAt = new Date('2026-07-01T12:10:00.000Z');

    const settled = await settle(asDb(), {
      id: row.id,
      state: 'confirmed',
      reason: null,
      confirmationPosition: 22,
      confirmationObservedAt: confirmedAt,
      settledAt: confirmedAt,
    });

    expect(settled).not.toBeNull();
    expect(settled!.state).toBe('confirmed');
    expect(settled!.reason).toBeNull();
    expect(settled!.confirmationPosition).toBe(22);
    expect(settled!.confirmationObservedAt?.toISOString()).toBe(
      confirmedAt.toISOString(),
    );
  });

  it('settles to volatile when the fresh observation recovered', async () => {
    const { row } = await seedAttempt({});

    const settled = await settle(asDb(), {
      id: row.id,
      state: 'volatile',
      reason: null,
      confirmationPosition: 6,
      confirmationObservedAt: OBSERVED,
      settledAt: OBSERVED,
    });

    expect(settled!.state).toBe('volatile');
    expect(settled!.confirmationPosition).toBe(6);
  });

  it('returns null when the target row does not exist', async () => {
    const settled = await settle(asDb(), {
      id: randomUUID(),
      state: 'unconfirmed',
      reason: 'capacity_unavailable',
      confirmationPosition: null,
      confirmationObservedAt: null,
      settledAt: OBSERVED,
    });

    expect(settled).toBeNull();
  });

  it('rejects a terminal state that violates the reason invariant', async () => {
    const { row } = await seedAttempt({});

    await expect(
      settle(asDb(), {
        id: row.id,
        state: 'unconfirmed',
        reason: null,
        confirmationPosition: null,
        confirmationObservedAt: null,
        settledAt: OBSERVED,
      }),
    ).rejects.toThrow();
  });
});

describe('claimAlertDispatch', () => {
  it('allows a single winner on a confirmed row', async () => {
    const { row } = await seedAttempt({});
    await settle(asDb(), {
      id: row.id,
      state: 'confirmed',
      reason: null,
      confirmationPosition: 22,
      confirmationObservedAt: OBSERVED,
      settledAt: OBSERVED,
    });
    const at = new Date('2026-07-01T12:20:00.000Z');

    expect(await claimAlertDispatch(asDb(), row.id, at)).toBe(true);
    expect(await claimAlertDispatch(asDb(), row.id, new Date())).toBe(false);

    const stored = await findByRankingId(asDb(), row.rankingId);
    expect(stored!.alertClaimedAt?.toISOString()).toBe(at.toISOString());
  });

  it('refuses to claim a dispatch on a non-confirmed row', async () => {
    const { row } = await seedAttempt({});
    await settle(asDb(), {
      id: row.id,
      state: 'volatile',
      reason: null,
      confirmationPosition: 6,
      confirmationObservedAt: OBSERVED,
      settledAt: OBSERVED,
    });

    expect(await claimAlertDispatch(asDb(), row.id, new Date())).toBe(false);
    const stored = await findByRankingId(asDb(), row.rankingId);
    expect(stored!.alertClaimedAt).toBeNull();
  });
});

describe('recordAlertDelivery / recordAlertError', () => {
  it('stores the delivery timestamp', async () => {
    const { row } = await seedAttempt({});
    const at = new Date('2026-07-01T12:30:00.000Z');

    await recordAlertDelivery(asDb(), row.id, at);

    const stored = await findByRankingId(asDb(), row.rankingId);
    expect(stored!.alertDeliveredAt?.toISOString()).toBe(at.toISOString());
    expect(stored!.alertError).toBeNull();
  });

  it('stores only the category key for a failed delivery', async () => {
    const { row } = await seedAttempt({});

    await recordAlertError(asDb(), row.id, 'alerts.errors.mailerUnavailable');

    const stored = await findByRankingId(asDb(), row.rankingId);
    expect(stored!.alertError).toBe('alerts.errors.mailerUnavailable');
    expect(stored!.alertDeliveredAt).toBeNull();
  });

  it('leaves the table untouched when the row id is unknown', async () => {
    await seedAttempt({});

    await recordAlertError(asDb(), randomUUID(), 'alerts.errors.unknown');

    const rows = await getTestDb().select().from(rankDropConfirmations);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.alertError).toBeNull();
  });
});

describe('readForRankings', () => {
  it('returns an empty map without querying for an empty id list', async () => {
    const map = await readForRankings(asDb(), []);

    expect(map.size).toBe(0);
  });

  it('keys every found confirmation by its ranking id', async () => {
    const a = await seedAttempt({ phrase: 'alpha' });
    const b = await seedAttempt({ phrase: 'bravo' });
    const { rankingId: unconfirmedRankingId } = await seedRanking({
      phrase: 'charlie',
    });

    const map = await readForRankings(asDb(), [
      a.rankingId,
      b.rankingId,
      unconfirmedRankingId,
    ]);

    expect(map.size).toBe(2);
    expect(map.get(a.rankingId)!.id).toBe(a.row.id);
    expect(map.get(b.rankingId)!.id).toBe(b.row.id);
    // Old rank rows with no attempt simply do not appear.
    expect(map.has(unconfirmedRankingId)).toBe(false);
  });
});

describe('listForKeyword', () => {
  it('returns the owner-scoped rows newest candidate first, bounded by limit', async () => {
    const { keywordId } = await seedRanking({ phrase: 'listing' });
    const dates = [
      new Date('2026-07-01T00:00:00.000Z'),
      new Date('2026-07-02T00:00:00.000Z'),
      new Date('2026-07-03T00:00:00.000Z'),
    ];
    for (const observedAt of dates) {
      const [rank] = await getTestDb()
        .insert(rankings)
        .values({
          keywordId,
          position: 15,
          checkedAt: observedAt,
          source: 'fresh',
        })
        .returning();
      await claimAttempt(
        asDb(),
        attemptRow({ keywordId, rankingId: rank!.id, observedAt }),
      );
    }

    const all = await listForKeyword(asDb(), {
      accountId: ACCOUNT_A,
      siteId: SITE_A,
      keywordId,
      limit: 10,
    });
    expect(all.map((r) => r.candidateObservedAt.toISOString())).toEqual([
      '2026-07-03T00:00:00.000Z',
      '2026-07-02T00:00:00.000Z',
      '2026-07-01T00:00:00.000Z',
    ]);

    const capped = await listForKeyword(asDb(), {
      accountId: ACCOUNT_A,
      siteId: SITE_A,
      keywordId,
      limit: 2,
    });
    expect(capped).toHaveLength(2);
    expect(capped[0]!.candidateObservedAt.toISOString()).toBe(
      '2026-07-03T00:00:00.000Z',
    );
  });

  it('never returns another account or another site', async () => {
    const seeded = await seedAttempt({});

    expect(
      await listForKeyword(asDb(), {
        accountId: ACCOUNT_B,
        siteId: SITE_A,
        keywordId: seeded.keywordId,
        limit: 10,
      }),
    ).toEqual([]);
    expect(
      await listForKeyword(asDb(), {
        accountId: ACCOUNT_A,
        siteId: SITE_B,
        keywordId: seeded.keywordId,
        limit: 10,
      }),
    ).toEqual([]);
  });
});

describe('purgeForAccount', () => {
  it('deletes only the target account rows and reports the count', async () => {
    await seedAttempt({ phrase: 'mine-1' });
    await seedAttempt({ phrase: 'mine-2' });
    await seedAttempt({
      accountId: ACCOUNT_B,
      siteId: SITE_B,
      phrase: 'theirs',
    });

    expect(await purgeForAccount(asDb(), ACCOUNT_A)).toBe(2);

    const remaining = await getTestDb().select().from(rankDropConfirmations);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.accountId).toBe(ACCOUNT_B);
  });

  it('reports zero when the account has no rows', async () => {
    expect(await purgeForAccount(asDb(), ACCOUNT_A)).toBe(0);
  });
});

describe('exportForAccount', () => {
  it('projects only the safe evidence fields, newest first', async () => {
    const older = await seedAttempt({
      phrase: 'export-older',
      observedAt: new Date('2026-06-01T00:00:00.000Z'),
    });
    const newer = await seedAttempt({
      phrase: 'export-newer',
      observedAt: new Date('2026-06-02T00:00:00.000Z'),
    });
    await seedAttempt({
      accountId: ACCOUNT_B,
      siteId: SITE_B,
      phrase: 'export-foreign',
    });
    await recordAlertError(asDb(), newer.row.id, 'alerts.errors.internal');

    const rows = await exportForAccount(asDb(), ACCOUNT_A);

    expect(rows.map((r) => r.id)).toEqual([newer.row.id, older.row.id]);
    expect(Object.keys(rows[0]!).sort()).toEqual(
      [
        'candidateObservedAt',
        'candidatePosition',
        'confirmationObservedAt',
        'confirmationPosition',
        'device',
        'id',
        'keywordId',
        'languageCode',
        'locationCode',
        'previousPosition',
        'reason',
        'settledAt',
        'siteId',
        'state',
      ].sort(),
    );
    // Operational fields (alert claim/delivery/error, provider call) stay out
    // of the customer export.
    expect(rows[0]).not.toHaveProperty('alertError');
    expect(rows[0]).not.toHaveProperty('accountId');
    expect(rows[0]!.siteId).toBe(SITE_A);
  });

  it('returns an empty list for an account with no confirmations', async () => {
    expect(await exportForAccount(asDb(), ACCOUNT_A)).toEqual([]);
  });
});

describe('countByState', () => {
  it('counts per state within the account only', async () => {
    const confirmed = await seedAttempt({ phrase: 'count-confirmed' });
    await settle(asDb(), {
      id: confirmed.row.id,
      state: 'confirmed',
      reason: null,
      confirmationPosition: 30,
      confirmationObservedAt: OBSERVED,
      settledAt: OBSERVED,
    });
    await seedAttempt({ phrase: 'count-unconfirmed' });
    const foreign = await seedAttempt({
      accountId: ACCOUNT_B,
      siteId: SITE_B,
      phrase: 'count-foreign',
    });
    await settle(asDb(), {
      id: foreign.row.id,
      state: 'confirmed',
      reason: null,
      confirmationPosition: 30,
      confirmationObservedAt: OBSERVED,
      settledAt: OBSERVED,
    });

    expect(
      await countByState(asDb(), { accountId: ACCOUNT_A, state: 'confirmed' }),
    ).toBe(1);
    expect(
      await countByState(asDb(), { accountId: ACCOUNT_A, state: 'unconfirmed' }),
    ).toBe(1);
    expect(
      await countByState(asDb(), { accountId: ACCOUNT_A, state: 'volatile' }),
    ).toBe(0);
  });

  it('returns zero for an account with no rows at all', async () => {
    expect(
      await countByState(asDb(), { accountId: ACCOUNT_A, state: 'confirmed' }),
    ).toBe(0);
  });
});

describe('FK cascade', () => {
  it('drops the confirmation when its candidate ranking is deleted', async () => {
    const { rankingId } = await seedAttempt({});

    await getTestDb().delete(rankings).where(eq(rankings.id, rankingId));

    expect(await findByRankingId(asDb(), rankingId)).toBeNull();
  });
});
