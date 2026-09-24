/**
 * Content-monitor event-log tests (spec 10) against real PGlite Postgres.
 * The `(monitor_id, event_key)` unique index keeps every write idempotent.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import { contentMonitorEvents } from '../../db/schema/content-monitor-events.js';
import { recordContentMonitorEvent } from './monitoring.events.js';

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

describe('recordContentMonitorEvent', () => {
  it('inserts a check row and is idempotent on (monitorId, eventKey)', async () => {
    const base = {
      accountId: ACCOUNT,
      siteId: 'site1',
      monitorId: 'mon1',
      eventKey: 'check:2026-W30',
      kind: 'check_failed' as const,
      isoWeek: '2026-W30',
      units: 1,
    };
    expect(await recordContentMonitorEvent(db(), base)).toBe(true);
    // A replay is a no-op.
    expect(await recordContentMonitorEvent(db(), base)).toBe(false);
    const rows = await db()
      .select()
      .from(contentMonitorEvents)
      .where(eq(contentMonitorEvents.monitorId, 'mon1'));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe('check_failed');
    expect(Number(rows[0]!.units)).toBe(1);
    expect(rows[0]!.isoWeek).toBe('2026-W30');
    // Defaults applied.
    expect(rows[0]!.checkId).toBeNull();
    expect(Number(rows[0]!.costMicros)).toBe(0);
  });

  it('records distinct kinds for the same monitor and carries checkId/cost', async () => {
    await recordContentMonitorEvent(db(), {
      accountId: ACCOUNT,
      siteId: 's',
      monitorId: 'm',
      eventKey: 'chk-1',
      kind: 'check_completed',
      checkId: 'chk-1',
      isoWeek: '2026-W30',
      costMicros: 5_000,
    });
    await recordContentMonitorEvent(db(), {
      accountId: ACCOUNT,
      siteId: 's',
      monitorId: 'm',
      eventKey: 'evt-key-1',
      kind: 'change_detected',
      checkId: 'chk-1',
    });
    const rows = await db()
      .select()
      .from(contentMonitorEvents)
      .where(eq(contentMonitorEvents.monitorId, 'm'));
    expect(rows.map((r) => r.kind).sort()).toEqual(['change_detected', 'check_completed']);
    const completed = rows.find((r) => r.kind === 'check_completed')!;
    expect(completed.checkId).toBe('chk-1');
    expect(Number(completed.costMicros)).toBe(5_000);
  });

  it('lets two monitors share an eventKey (uniqueness is per-monitor)', async () => {
    const shared = {
      accountId: ACCOUNT,
      siteId: 's',
      eventKey: 'check:2026-W31',
      kind: 'check_completed' as const,
      isoWeek: '2026-W31',
      units: 1,
    };
    expect(await recordContentMonitorEvent(db(), { ...shared, monitorId: 'a' })).toBe(true);
    expect(await recordContentMonitorEvent(db(), { ...shared, monitorId: 'b' })).toBe(true);
    const rows = await db().select().from(contentMonitorEvents);
    expect(rows).toHaveLength(2);
  });
});
