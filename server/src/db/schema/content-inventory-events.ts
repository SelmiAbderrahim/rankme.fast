/**
 * Content inventory + cannibalization — ordered event log.
 *
 * One row per lifecycle transition that affects billing or the per-run cost
 * rollup. Every mutating write is idempotent by `(reservationKey, kind)` so a
 * worker replay never doubles a reservation, refund, completion, or
 * cancellation entry.
 *
 * `units` is always non-negative; the SIGN is implied by `kind` (reserved =
 * +blocks, refunded = -blocks, completed/failed/cancelled = 0-unit
 * book-keeping rows). Money is bigint micros USD.
 *
 * The paid unit itself lives on `usage_counters.content_inventory_page_blocks`
 * + `credit_ledger` — this table is an append-only archive alongside those
 * authoritative counters, never the source of truth for what was paid.
 */
import { sql } from 'drizzle-orm';
import { bigint, check, index, pgTable, text, timestamp, uniqueIndex, uuid, } from 'drizzle-orm/pg-core';
export const CONTENT_INVENTORY_EVENT_KINDS = [
    'reserved',
    'refunded',
    'completed',
    'failed',
    'cancelled',
] as const;
export type ContentInventoryEventKind = (typeof CONTENT_INVENTORY_EVENT_KINDS)[number];
export const contentInventoryEvents = pgTable('content_inventory_events', {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    siteId: text('site_id').notNull(),
    runId: text('run_id').notNull(),
    reservationKey: text('reservation_key').notNull(),
    kind: text('kind', { enum: CONTENT_INVENTORY_EVENT_KINDS }).notNull(),
    units: bigint('units', { mode: 'number' }).notNull().default(0),
    costMicros: bigint('cost_micros', { mode: 'number' }).notNull().default(0),
    aiCostMicros: bigint('ai_cost_micros', { mode: 'number' }).notNull().default(0),
    errorCategory: text('error_category'),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    uniqueIndex('content_inventory_events_reservation_kind_uidx').on(table.reservationKey, table.kind),
    index('content_inventory_events_account_recorded_idx').on(table.accountId, table.recordedAt),
    index('content_inventory_events_site_recorded_idx').on(table.siteId, table.recordedAt),
    index('content_inventory_events_run_idx').on(table.runId),
    check('content_inventory_events_kind_check', sql `${table.kind} in ('reserved', 'refunded', 'completed', 'failed', 'cancelled')`),
    check('content_inventory_events_units_nonneg_check', sql `${table.units} >= 0`),
    check('content_inventory_events_cost_nonneg_check', sql `${table.costMicros} >= 0 and ${table.aiCostMicros} >= 0`),
]);
export type ContentInventoryEventRow = typeof contentInventoryEvents.$inferSelect;
export type NewContentInventoryEventRow = typeof contentInventoryEvents.$inferInsert;
