/**
 * Competitor content intelligence — ordered event log.
 *
 * One row per lifecycle transition that affects billing or the per-run cost
 * rollup. Every mutating write is idempotent by `(reservationKey, kind)` so a
 * worker replay never doubles a reservation, refund, completion, or
 * cancellation entry.
 *
 * `units` is always non-negative; the SIGN is implied by `kind` (reserved =
 * +1 run unit, refunded = -1 run unit, completed/failed/cancelled = 0-unit
 * book-keeping rows). Money is bigint micros USD.
 *
 * The paid unit itself lives on `usage_counters.competitor_content_runs` +
 * `credit_ledger` — this table is an append-only archive alongside those
 * authoritative counters, never the source of truth for what was paid.
 */
import { sql } from 'drizzle-orm';
import { bigint, check, index, pgTable, text, timestamp, uniqueIndex, uuid, } from 'drizzle-orm/pg-core';
export const COMPETITOR_CONTENT_EVENT_KINDS = [
    'reserved',
    'refunded',
    'completed',
    'failed',
    'cancelled',
] as const;
export type CompetitorContentEventKind = (typeof COMPETITOR_CONTENT_EVENT_KINDS)[number];
export const competitorContentEvents = pgTable('competitor_content_events', {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    siteId: text('site_id').notNull(),
    runId: text('run_id').notNull(),
    reservationKey: text('reservation_key').notNull(),
    kind: text('kind', { enum: COMPETITOR_CONTENT_EVENT_KINDS }).notNull(),
    units: bigint('units', { mode: 'number' }).notNull().default(0),
    costMicros: bigint('cost_micros', { mode: 'number' }).notNull().default(0),
    aiCostMicros: bigint('ai_cost_micros', { mode: 'number' }).notNull().default(0),
    errorCategory: text('error_category'),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    uniqueIndex('competitor_content_events_reservation_kind_uidx').on(table.reservationKey, table.kind),
    index('competitor_content_events_account_recorded_idx').on(table.accountId, table.recordedAt),
    index('competitor_content_events_site_recorded_idx').on(table.siteId, table.recordedAt),
    index('competitor_content_events_run_idx').on(table.runId),
    check('competitor_content_events_kind_check', sql `${table.kind} in ('reserved', 'refunded', 'completed', 'failed', 'cancelled')`),
    check('competitor_content_events_units_nonneg_check', sql `${table.units} >= 0`),
    check('competitor_content_events_cost_nonneg_check', sql `${table.costMicros} >= 0 and ${table.aiCostMicros} >= 0`),
]);
export type CompetitorContentEventRow = typeof competitorContentEvents.$inferSelect;
export type NewCompetitorContentEventRow = typeof competitorContentEvents.$inferInsert;
