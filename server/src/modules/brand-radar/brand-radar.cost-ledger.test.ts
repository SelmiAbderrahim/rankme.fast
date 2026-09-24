/**
 * `brand_radar_events` cost bookkeeping.
 *
 * One row per stage per call, cost in bigint micros USD, summed per stage.
 * The `(scan_id, stage, event)` unique index is what makes a replayed job
 * write nothing new.
 */
import { eq, sql } from 'drizzle-orm';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../db/client.js';
import { brandRadarEvents } from '../../db/schema/brand-radar-events.js';
import {
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import {
  readBrandRadarCostByStage,
  recordBrandRadarEvent,
} from './brand-radar.events.js';

let db: Db;

const ACCOUNT = new mongoose.Types.ObjectId().toString();
const SCAN = new mongoose.Types.ObjectId().toString();

beforeAll(async () => {
  db = (await startTestPostgres()) as unknown as Db;
});
afterAll(stopTestPostgres);
beforeEach(truncateAllTables);

describe('recordBrandRadarEvent', () => {
  it('writes one row per stage per call and defaults cost + metadata', async () => {
    const write = await recordBrandRadarEvent(db, {
      accountId: ACCOUNT,
      scanId: SCAN,
      stage: 'search',
      event: 'started',
    });
    expect(write.inserted).toBe(true);
    const rows = await db
      .select()
      .from(brandRadarEvents)
      .where(eq(brandRadarEvents.id, write.id));
    expect(rows[0]).toMatchObject({ costMicros: 0, metadata: {} });
  });

  it('clamps a negative or fractional cost to a non-negative integer', async () => {
    const negative = await recordBrandRadarEvent(db, {
      accountId: ACCOUNT,
      scanId: SCAN,
      stage: 'search',
      event: 'failed',
      costMicros: -25,
    });
    const fractional = await recordBrandRadarEvent(db, {
      accountId: ACCOUNT,
      scanId: SCAN,
      stage: 'summary',
      event: 'succeeded',
      costMicros: 1_234.6,
    });
    const rows = await db
      .select()
      .from(brandRadarEvents)
      .where(eq(brandRadarEvents.scanId, SCAN));
    const byStage = Object.fromEntries(rows.map((r) => [r.stage, Number(r.costMicros)]));
    expect(byStage).toEqual({ search: 0, summary: 1_235 });
    expect(negative.inserted).toBe(true);
    expect(fractional.inserted).toBe(true);
  });

  it('is idempotent on (scan_id, stage, event)', async () => {
    const first = await recordBrandRadarEvent(db, {
      accountId: ACCOUNT,
      scanId: SCAN,
      stage: 'summary',
      event: 'succeeded',
      costMicros: 45_000,
    });
    const replay = await recordBrandRadarEvent(db, {
      accountId: ACCOUNT,
      scanId: SCAN,
      stage: 'summary',
      event: 'succeeded',
      costMicros: 45_000,
    });
    expect(first.inserted).toBe(true);
    expect(replay).toEqual({ id: first.id, inserted: false });
    const rows = await db
      .select()
      .from(brandRadarEvents)
      .where(eq(brandRadarEvents.scanId, SCAN));
    expect(rows).toHaveLength(1);
  });
});

describe('per-stage cost rollup', () => {
  it('sums the deterministic 60_000 / 45_000 scenario per stage', async () => {
    const events = [
      { stage: 'scan', event: 'started', costMicros: 0 },
      { stage: 'search', event: 'started', costMicros: 0 },
      { stage: 'search', event: 'succeeded', costMicros: 60_000 },
      { stage: 'summary', event: 'started', costMicros: 0 },
      { stage: 'summary', event: 'succeeded', costMicros: 45_000 },
      { stage: 'scan', event: 'consumed', costMicros: 105_000 },
    ] as const;
    for (const event of events) {
      await recordBrandRadarEvent(db, { accountId: ACCOUNT, scanId: SCAN, ...event });
    }

    expect(await readBrandRadarCostByStage(db, SCAN)).toEqual({
      scan: 105_000,
      search: 60_000,
      summary: 45_000,
      brand_digest: 0,
    });

    const total = await db
      .select({ sum: sql<string>`sum(${brandRadarEvents.costMicros})` })
      .from(brandRadarEvents)
      .where(eq(brandRadarEvents.scanId, SCAN));
    expect(Number(total[0]?.sum)).toBe(210_000);
  });

  it('reports zeros for a scan with no rows', async () => {
    expect(await readBrandRadarCostByStage(db, SCAN)).toEqual({
      scan: 0,
      search: 0,
      summary: 0,
      brand_digest: 0,
    });
  });
});
