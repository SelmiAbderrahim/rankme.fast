/**
 * Audience Research — ordered event log for one Voice-of-Customer run's
 * lifecycle. One row per state transition that affects
 * billing or the per-run cost rollup. Every mutating write is idempotent by
 * `(reservationKey, kind)` so a worker or webhook replay never doubles a
 * reservation, consumption, or refund.
 *
 * Refund exactness — the load-bearing invariant — is
 * guaranteed by the unique constraint on `(reservation_key, kind)`: a
 * duplicate refund attempt is a no-op (an `ON CONFLICT DO NOTHING` write
 * writes zero rows the second time).
 *
 * NOTE: the paid unit itself lives on
 * `usage_counters.audience_research_runs` +
 * `credit_ledger.audience_research_runs` (the drain-first-then-credits
 * authority). This table is an APPEND-ONLY event archive alongside those
 * authoritative counters — never the source of truth for what the customer
 * paid. Money is bigint micros USD (matching the enforced 250_000-micro
 * direct-cost ceiling).
 */
import { sql } from 'drizzle-orm';
import { bigint, check, index, pgTable, text, timestamp, uniqueIndex, uuid, } from 'drizzle-orm/pg-core';
// `run_id` is stored as text because the paired Mongo document uses an
// ObjectId (24-hex) as its `_id` (— "Mongo ObjectId; runId in API").
// A Postgres `uuid` column would reject the ObjectId form; a wider text
// column keeps both representations stable through the seam.
export const AUDIENCE_RESEARCH_EVENT_KINDS = [
    'reserved',
    'consumed',
    'refunded',
] as const;
export type AudienceResearchEventKind = (typeof AUDIENCE_RESEARCH_EVENT_KINDS)[number];
export const audienceResearchEvents = pgTable('audience_research_events', {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    runId: text('run_id').notNull(),
    // sha256(account|site|inputHash|attempt) — the caller supplies the
    // pre-hashed key; DB never sees plaintext inputs or URLs.
    reservationKey: text('reservation_key').notNull(),
    kind: text('kind', { enum: AUDIENCE_RESEARCH_EVENT_KINDS }).notNull(),
    // Always non-negative; the SIGN of the effect is implied by `kind`
    // (reserved / refunded flip one paid unit; consumed is a 0-unit
    // book-keeping row that mirrors the counter increment).
    units: bigint('units', { mode: 'number' }).notNull().default(1),
    // Running direct-cost total at the moment the event was recorded.
    costMicros: bigint('cost_micros', { mode: 'number' }).notNull().default(0),
    // Localized-key friendly enum (e.g. `no_usable_public_evidence`,
    // `cost_ceiling_partial`, `ai_dispatch_indeterminate`). NULL on the
    // initial `reserved` row.
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    // Idempotent write per (reservation, kind): a worker replay that repeats
    // the same kind for the same reservation is a no-op. Duplicate refund
    // attempts under a stable `reservationKey` never post twice — the
    // authority behind the "refunded exactly once" guarantee.
    uniqueIndex('audience_research_events_reservation_kind_uidx').on(table.reservationKey, table.kind),
    index('audience_research_events_run_created_idx').on(table.runId, table.createdAt),
    index('audience_research_events_account_created_idx').on(table.accountId, table.createdAt),
    check('audience_research_events_kind_check', sql `${table.kind} in ('reserved', 'consumed', 'refunded')`),
    check('audience_research_events_units_nonneg_check', sql `${table.units} >= 0`),
    check('audience_research_events_cost_nonneg_check', sql `${table.costMicros} >= 0`),
]);
export type AudienceResearchEventRow = typeof audienceResearchEvents.$inferSelect;
export type NewAudienceResearchEventRow = typeof audienceResearchEvents.$inferInsert;
