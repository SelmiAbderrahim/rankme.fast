/**
 * Content Intelligence — ordered event log for one analysis's lifecycle
 *. One row per state transition that affects billing or the
 * per-analysis cost rollup. Every mutating write is idempotent by
 * `(reservationKey, kind)` so a webhook / worker replay never doubles a
 * reservation, refund, completion, or cancellation.
 *
 * Money in this table is bigint micros USD (matching the
 * `CONTENT_ANALYSIS_COST_CEILING_MICROS` = 250_000 ceiling). The Polar pack
 * `amount` stays cents on the credit-ledger side because Polar bills in
 * cents; the two units live in their own columns and never do arithmetic
 * across each other.
 *
 * NOTE: the paid unit itself lives on `usage_counters.content_analyses` +
 * `credit_ledger.content_analyses` (the drain-first-then-credits authority).
 * This table is an APPEND-ONLY event archive alongside those authoritative
 * counters — never the source of truth for what the customer paid.
 */
import { sql } from 'drizzle-orm';
import { bigint, check, index, pgTable, text, timestamp, uniqueIndex, uuid, } from 'drizzle-orm/pg-core';
export const CONTENT_ANALYSIS_EVENT_KINDS = [
    'reserved',
    'refunded',
    'completed',
    'failed',
    'cancelled',
] as const;
export type ContentAnalysisEventKind = (typeof CONTENT_ANALYSIS_EVENT_KINDS)[number];
export const contentAnalysisEvents = pgTable('content_analysis_events', {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    siteId: text('site_id').notNull(),
    analysisId: text('analysis_id').notNull(),
    reservationKey: text('reservation_key').notNull(),
    kind: text('kind', { enum: CONTENT_ANALYSIS_EVENT_KINDS }).notNull(),
    // Always positive; the SIGN of the effect is implied by `kind`
    // (reserved / refunded are +/- one paid unit; completed / failed /
    // cancelled are 0-unit book-keeping rows).
    units: bigint('units', { mode: 'number' }).notNull().default(0),
    // Running direct-cost total at the moment the event was recorded.
    costMicros: bigint('cost_micros', { mode: 'number' }).notNull().default(0),
    // Running AI sub-budget total at the moment the event was recorded.
    aiCostMicros: bigint('ai_cost_micros', { mode: 'number' }).notNull().default(0),
    // Optional error category (`owned_page_unusable`, `ai_budget_exceeded`,
    // `cancelled`, …). Written on `failed` / `cancelled` / `refunded` events
    // and NULL otherwise.
    errorCategory: text('error_category'),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    // Idempotent write per (reservation, kind): a webhook or worker replay
    // that repeats the same kind for the same reservation is a no-op.
    uniqueIndex('content_analysis_events_reservation_kind_uidx').on(table.reservationKey, table.kind),
    index('content_analysis_events_account_recorded_idx').on(table.accountId, table.recordedAt),
    index('content_analysis_events_site_recorded_idx').on(table.siteId, table.recordedAt),
    index('content_analysis_events_analysis_idx').on(table.analysisId),
    check('content_analysis_events_kind_check', sql `${table.kind} in ('reserved', 'refunded', 'completed', 'failed', 'cancelled')`),
    check('content_analysis_events_units_nonneg_check', sql `${table.units} >= 0`),
    check('content_analysis_events_cost_nonneg_check', sql `${table.costMicros} >= 0 and ${table.aiCostMicros} >= 0`),
]);
export type ContentAnalysisEventRow = typeof contentAnalysisEvents.$inferSelect;
export type NewContentAnalysisEventRow = typeof contentAnalysisEvents.$inferInsert;
