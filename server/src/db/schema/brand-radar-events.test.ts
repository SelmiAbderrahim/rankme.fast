/**
 * `brand_radar_events` schema + migration 0059.
 *
 * Runs the real generated SQL against PGlite, so a schema/migration drift
 * fails here rather than at boot.
 */
import { sql } from 'drizzle-orm';
import { readFileSync, readdirSync } from 'node:fs';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
} from 'vitest';
import {
  BRAND_RADAR_EVENT_KINDS,
  BRAND_RADAR_EVENT_STAGES,
  brandRadarEvents,
  type BrandRadarEventKind,
  type BrandRadarEventRow,
  type BrandRadarEventStage,
  type NewBrandRadarEventRow,
} from './index.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';

const ACCOUNT = 'a'.repeat(24);
const SCAN = 'b'.repeat(24);

beforeAll(startTestPostgres);
afterAll(stopTestPostgres);
beforeEach(truncateAllTables);

describe('brand_radar_events schema', () => {
  it('registers migration 0059 monotonically after 0058', () => {
    const metadataUrl = new URL('../../../drizzle/meta/', import.meta.url);
    const journal = JSON.parse(
      readFileSync(new URL('_journal.json', metadataUrl), 'utf8'),
    ) as { entries: Array<{ idx: number; tag: string; when: number }> };
    const previous = journal.entries.find((entry) => entry.idx === 58);
    const current = journal.entries.find((entry) => entry.idx === 59);
    expect(current?.tag).toBe('0059_tranquil_miracleman');
    expect(current?.when).toBeGreaterThan(previous?.when ?? 0);

    const files = readdirSync(new URL('../../../drizzle/', import.meta.url)).filter(
      (name) => name.startsWith('0059_') && name.endsWith('.sql'),
    );
    expect(files).toEqual(['0059_tranquil_miracleman.sql']);

    const previousSnapshot = JSON.parse(
      readFileSync(new URL('0058_snapshot.json', metadataUrl), 'utf8'),
    ) as { id: string };
    const currentSnapshot = JSON.parse(
      readFileSync(new URL('0059_snapshot.json', metadataUrl), 'utf8'),
    ) as { prevId: string };
    expect(currentSnapshot.prevId).toBe(previousSnapshot.id);
  });

  it('pins the stage and event enums', () => {
    expect([...BRAND_RADAR_EVENT_STAGES]).toEqual([
      'scan',
      'search',
      'summary',
      'brand_digest',
    ]);
    expect([...BRAND_RADAR_EVENT_KINDS]).toEqual([
      'reserved',
      'consumed',
      'refunded',
      'started',
      'succeeded',
      'failed',
      'halted',
    ]);
    expectTypeOf<BrandRadarEventRow['stage']>().toEqualTypeOf<BrandRadarEventStage>();
    expectTypeOf<BrandRadarEventRow['event']>().toEqualTypeOf<BrandRadarEventKind>();
    expectTypeOf<BrandRadarEventRow['occurredAt']>().toEqualTypeOf<Date>();
    expectTypeOf<NewBrandRadarEventRow['accountId']>().toEqualTypeOf<string>();
  });

  it('defaults cost, metadata, and occurredAt, and reads back timezone-aware', async () => {
    const db = getTestDb();
    await db.insert(brandRadarEvents).values({
      accountId: ACCOUNT,
      scanId: SCAN,
      stage: 'scan',
      event: 'reserved',
    });
    const rows = await db.select().from(brandRadarEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      accountId: ACCOUNT,
      scanId: SCAN,
      stage: 'scan',
      event: 'reserved',
      costMicros: 0,
      metadata: {},
    });
    expect(rows[0]?.occurredAt).toBeInstanceOf(Date);
  });

  it('stores per-stage cost in micros with non-identifying metadata', async () => {
    const db = getTestDb();
    await db.insert(brandRadarEvents).values([
      {
        accountId: ACCOUNT,
        scanId: SCAN,
        stage: 'search',
        event: 'succeeded',
        costMicros: 60_000,
        metadata: { retainedRows: 42 },
      },
      {
        accountId: ACCOUNT,
        scanId: SCAN,
        stage: 'brand_digest',
        event: 'halted',
        costMicros: 20_000,
        metadata: { reason: 'cost_ceiling' },
      },
    ]);
    const total = await db
      .select({ sum: sql<string>`sum(${brandRadarEvents.costMicros})` })
      .from(brandRadarEvents);
    expect(Number(total[0]?.sum)).toBe(80_000);
  });

  it('rejects a negative cost via the check constraint', async () => {
    const db = getTestDb();
    await expect(
      db.insert(brandRadarEvents).values({
        accountId: ACCOUNT,
        scanId: SCAN,
        stage: 'summary',
        event: 'failed',
        costMicros: -1,
      }),
    ).rejects.toThrow();
  });
});
