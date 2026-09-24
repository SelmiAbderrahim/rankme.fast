/**
 * Competitor content event-log tests (spec 09) against real PGlite Postgres.
 * The `(reservation_key, kind)` unique index keeps every write idempotent
 * (the column holds the run's idempotency key).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import { competitorContentEvents } from '../../db/schema/competitor-content-events.js';
import { recordCompetitorContentEvent } from './competitor-content.events.js';

const ACCOUNT = '000000000000000000000abc';
const db = (): ApplicationDb => getTestDb() as unknown as ApplicationDb;

beforeAll(async () => {
  await startTestPostgres();
});
afterAll(async () => {
  await stopTestPostgres();
});
afterEach(async () => {
  await truncateAllTables();
});

describe('recordCompetitorContentEvent', () => {
  it('inserts a terminal row with defaults and is idempotent on (reservationKey, kind)', async () => {
    const base = {
      accountId: ACCOUNT,
      siteId: 'site1',
      runId: 'run1',
      reservationKey: 'run-key-1',
      kind: 'failed' as const,
    };
    expect(await recordCompetitorContentEvent(db(), base)).toBe(true);
    // A replay is a no-op.
    expect(await recordCompetitorContentEvent(db(), base)).toBe(false);
    const rows = await db()
      .select()
      .from(competitorContentEvents)
      .where(eq(competitorContentEvents.accountId, ACCOUNT));
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.units)).toBe(0);
    expect(Number(rows[0]!.costMicros)).toBe(0);
    expect(rows[0]!.errorCategory).toBeNull();
  });

  it('records distinct kinds for the same run key and carries costs', async () => {
    const key = 'run-key-2';
    await recordCompetitorContentEvent(db(), { accountId: ACCOUNT, siteId: 's', runId: 'r', reservationKey: key, kind: 'cancelled', units: 0 });
    await recordCompetitorContentEvent(db(), {
      accountId: ACCOUNT, siteId: 's', runId: 'r', reservationKey: key, kind: 'completed',
      costMicros: 50_000, aiCostMicros: 20_000, errorCategory: null,
    });
    const rows = await db()
      .select()
      .from(competitorContentEvents)
      .where(eq(competitorContentEvents.reservationKey, key));
    expect(rows.map((r) => r.kind).sort()).toEqual(['cancelled', 'completed']);
    const completed = rows.find((r) => r.kind === 'completed')!;
    expect(Number(completed.costMicros)).toBe(50_000);
    expect(Number(completed.aiCostMicros)).toBe(20_000);
  });
});
