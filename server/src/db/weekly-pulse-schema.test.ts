/**
 * Weekly Pulse — relational schema foreign-key contract.
 *
 * `server/src/db/schema/weekly-pulse.ts` documents four load-bearing referential
 * invariants in its file header:
 *
 *   • citations / citation_changes / digest projection / delivery events all
 *     hang off `weekly_pulse_runs` with ON DELETE CASCADE — deleting a run
 *     must never leave orphaned per-run rows (the delivery service relies on
 *     this: a vanished run also takes its projection).
 *   • `citation_changes.prior_pulse_run_id` is ON DELETE SET NULL — retiring an
 *     old pulse must NOT delete the derived change rows of a newer pulse.
 *   • `citation_changes.citation_id` is ON DELETE SET NULL for the same reason.
 *
 * The Drizzle table declarations are the source the app queries through, and
 * the generated SQL under `server/drizzle/` is what actually runs. This suite
 * asserts BOTH agree, so a schema edit that silently flips a cascade to a
 * restrict (or drops the FK) fails here instead of in production.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import {
  startTestPostgres,
  stopTestPostgres,
  type TestDb,
} from '../shared/testing/postgres.js';
import {
  weeklyPulseCitationChanges,
  weeklyPulseCitations,
  weeklyPulseDeliveryEvents,
  weeklyPulseDigestProjections,
  weeklyPulseRuns,
} from './schema/weekly-pulse.js';

interface DeclaredForeignKey {
  columns: string[];
  foreignTable: string;
  foreignColumns: string[];
  onDelete: string | undefined;
}

/**
 * Resolves each declared foreign key of `table`. Drizzle stores the reference
 * target behind a lazy callback (`references(() => other.id)`) so circular
 * table imports stay possible; calling `reference()` is what materializes it.
 */
function declaredForeignKeys(table: PgTable): DeclaredForeignKey[] {
  return getTableConfig(table).foreignKeys.map((fk) => {
    const reference = fk.reference();
    return {
      columns: reference.columns.map((c) => c.name),
      foreignTable: getTableConfig(reference.foreignTable).name,
      foreignColumns: reference.foreignColumns.map((c) => c.name),
      onDelete: fk.onDelete,
    };
  });
}

let db: TestDb;

beforeAll(async () => {
  db = await startTestPostgres();
});

afterAll(async () => {
  await stopTestPostgres();
});

describe('weekly-pulse schema — declared foreign keys', () => {
  it('cascades every per-run child table off weekly_pulse_runs', () => {
    expect(declaredForeignKeys(weeklyPulseCitations)).toEqual([
      {
        columns: ['pulse_run_id'],
        foreignTable: 'weekly_pulse_runs',
        foreignColumns: ['id'],
        onDelete: 'cascade',
      },
    ]);
    expect(declaredForeignKeys(weeklyPulseDigestProjections)).toEqual([
      {
        columns: ['pulse_run_id'],
        foreignTable: 'weekly_pulse_runs',
        foreignColumns: ['id'],
        onDelete: 'cascade',
      },
    ]);
    expect(declaredForeignKeys(weeklyPulseDeliveryEvents)).toEqual([
      {
        columns: ['pulse_run_id'],
        foreignTable: 'weekly_pulse_runs',
        foreignColumns: ['id'],
        onDelete: 'cascade',
      },
    ]);
  });

  it('keeps the prior-run and citation back-references nullable, not cascading', () => {
    // A change row belongs to its OWN run (cascade) but only *points at* the
    // prior run and the concrete citation — retiring either must blank the
    // pointer, never delete the newer run's derived row.
    expect(declaredForeignKeys(weeklyPulseCitationChanges)).toEqual([
      {
        columns: ['pulse_run_id'],
        foreignTable: 'weekly_pulse_runs',
        foreignColumns: ['id'],
        onDelete: 'cascade',
      },
      {
        columns: ['prior_pulse_run_id'],
        foreignTable: 'weekly_pulse_runs',
        foreignColumns: ['id'],
        onDelete: 'set null',
      },
      {
        columns: ['citation_id'],
        foreignTable: 'weekly_pulse_citations',
        foreignColumns: ['id'],
        onDelete: 'set null',
      },
    ]);
  });

  it('declares no foreign key on the two account-scoped root tables', () => {
    // `account_id` / `site_id` are upstream Mongo ObjectId hex strings — there
    // is deliberately no relational FK for them (see the file header).
    expect(declaredForeignKeys(weeklyPulseRuns)).toEqual([]);
  });
});

describe('weekly-pulse schema — generated SQL matches the declarations', () => {
  it('applies the same ON DELETE actions in the migrated database', async () => {
    // `confdeltype`: 'c' = cascade, 'n' = set null.
    const result = await db.execute(sql`
      select
        rel.relname                as table_name,
        att.attname                as column_name,
        con.confdeltype            as delete_action
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join unnest(con.conkey) as k(attnum) on true
      join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k.attnum
      where con.contype = 'f'
        and rel.relname in (
          'weekly_pulse_citations',
          'weekly_pulse_citation_changes',
          'weekly_pulse_digest_projection',
          'weekly_pulse_delivery_events'
        )
    `);
    const actual = (
      result.rows as Array<{
        table_name: string;
        column_name: string;
        delete_action: string;
      }>
    )
      .map((r) => `${r.table_name}.${r.column_name}=${r.delete_action}`)
      .sort();

    expect(actual).toEqual(
      [
        'weekly_pulse_citations.pulse_run_id=c',
        'weekly_pulse_citation_changes.pulse_run_id=c',
        'weekly_pulse_citation_changes.prior_pulse_run_id=n',
        'weekly_pulse_citation_changes.citation_id=n',
        'weekly_pulse_digest_projection.pulse_run_id=c',
        'weekly_pulse_delivery_events.pulse_run_id=c',
      ].sort(),
    );
  });

  it('nulls the prior-run pointer instead of deleting the newer change row', async () => {
    const [priorRun] = await db
      .insert(weeklyPulseRuns)
      .values({
        accountId: 'acct-fk',
        siteId: 'site-fk',
        isoWeek: '2026-W10',
        status: 'completed',
        marketSnapshot: {},
        promptCohortId: 'c',
        promptCohortVersion: 1,
        engineSurfaceSet: [],
        observationMeta: {},
        usageReference: {},
        counts: {},
      })
      .returning({ id: weeklyPulseRuns.id });
    const [currentRun] = await db
      .insert(weeklyPulseRuns)
      .values({
        accountId: 'acct-fk',
        siteId: 'site-fk',
        isoWeek: '2026-W11',
        status: 'completed',
        marketSnapshot: {},
        promptCohortId: 'c',
        promptCohortVersion: 1,
        engineSurfaceSet: [],
        observationMeta: {},
        usageReference: {},
        counts: {},
      })
      .returning({ id: weeklyPulseRuns.id });

    const [citation] = await db
      .insert(weeklyPulseCitations)
      .values({
        pulseRunId: currentRun!.id,
        engine: 'chatgpt',
        surface: 'mentions',
        promptCohortId: 'c',
        promptCohortVersion: 1,
        canonicalUrl: 'https://a.example/x',
        host: 'a.example',
      })
      .returning({ id: weeklyPulseCitations.id });

    await db.insert(weeklyPulseCitationChanges).values({
      pulseRunId: currentRun!.id,
      priorPulseRunId: priorRun!.id,
      change: 'new',
      engine: 'chatgpt',
      surface: 'mentions',
      promptCohortId: 'c',
      promptCohortVersion: 1,
      canonicalUrl: 'https://a.example/x',
      host: 'a.example',
      citationId: citation!.id,
    });

    // Retiring the prior run must keep the newer run's change row alive.
    await db.execute(
      sql`delete from weekly_pulse_runs where id = ${priorRun!.id}::uuid`,
    );
    const afterPriorDelete = await db.select().from(weeklyPulseCitationChanges);
    expect(afterPriorDelete).toHaveLength(1);
    expect(afterPriorDelete[0]!.priorPulseRunId).toBeNull();
    expect(afterPriorDelete[0]!.citationId).toBe(citation!.id);

    // Deleting the owning run cascades the child rows away.
    await db.execute(
      sql`delete from weekly_pulse_runs where id = ${currentRun!.id}::uuid`,
    );
    expect(await db.select().from(weeklyPulseCitationChanges)).toHaveLength(0);
    expect(await db.select().from(weeklyPulseCitations)).toHaveLength(0);
  });
});
