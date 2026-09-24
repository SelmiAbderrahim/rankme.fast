import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import { contentInventoryEvents } from '../../db/schema/content-inventory-events.js';
import { recordContentInventoryEvent } from './inventory.events.js';

let db: ApplicationDb;

beforeAll(async () => {
  db = (await startTestPostgres()) as unknown as ApplicationDb;
});
afterAll(async () => {
  await stopTestPostgres();
});
beforeEach(async () => {
  await truncateAllTables();
});

describe('recordContentInventoryEvent', () => {
  it('inserts a new event and reports it landed', async () => {
    const reservationKey = `run-key-${randomUUID()}`;
    const wrote = await recordContentInventoryEvent(db, {
      accountId: 'acc-1',
      siteId: 'site-1',
      runId: 'run-1',
      reservationKey,
      kind: 'failed',
      units: 5,
      costMicros: 4_000,
    });
    expect(wrote).toBe(true);
    const rows = await db.select().from(contentInventoryEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe('failed');
    expect(rows[0]?.units).toBe(5);
    expect(rows[0]?.aiCostMicros).toBe(0);
    expect(rows[0]?.errorCategory).toBeNull();
  });

  it('is idempotent by (reservationKey, kind) — a replay is a no-op', async () => {
    const reservationKey = `run-key-${randomUUID()}`;
    const input = {
      accountId: 'acc-1',
      siteId: 'site-1',
      runId: 'run-1',
      reservationKey,
      kind: 'cancelled' as const,
      units: 2,
      errorCategory: 'cancelled',
    };
    expect(await recordContentInventoryEvent(db, input)).toBe(true);
    expect(await recordContentInventoryEvent(db, input)).toBe(false);
    const rows = await db.select().from(contentInventoryEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.errorCategory).toBe('cancelled');
  });

  it('defaults omitted units/costs while keeping a provided ai cost', async () => {
    const reservationKey = `run-key-${randomUUID()}`;
    const wrote = await recordContentInventoryEvent(db, {
      accountId: 'acc-1',
      siteId: 'site-1',
      runId: 'run-1',
      reservationKey,
      kind: 'completed',
      aiCostMicros: 7,
    });
    expect(wrote).toBe(true);
    const rows = await db.select().from(contentInventoryEvents);
    const row = rows.find((r) => r.reservationKey === reservationKey);
    expect(row?.units).toBe(0);
    expect(row?.costMicros).toBe(0);
    expect(row?.aiCostMicros).toBe(7);
    expect(row?.errorCategory).toBeNull();
  });
});
