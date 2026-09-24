/**
 * Brand Radar — append-only per-scan lifecycle/cost event log.
 *
 * One row per stage transition that affects billing or the per-scan cost
 * rollup. Mirrors the shipped intelligence event-row shape
 * (`audience_research_events`, `content_analysis_events`): the paid unit
 * itself lives on `usage_counters.brand_mention_scans` +
 * `credit_ledger.brand_mention_scans` — this table is an APPEND-ONLY
 * archive alongside those authoritative counters, never the source of
 * truth for what the customer paid.
 *
 * `scan_id` is text because the paired Mongo document uses an ObjectId
 * (24-hex) `_id`; a Postgres `uuid` column would reject that form.
 * `account_id` is text for the same reason — every shipped table in this
 * repo stores the Better Auth / Mongo ObjectId-hex account id as text,
 * so the spec's "uuid" wording is honoured as "the shipped account-id
 * column type" rather than a literal `uuid()` that could never hold a
 * real account id.
 *
 * Money is bigint micros USD, matching the 150_000-micro per-run budget
 * pinned numeric contracts.
 */
import { sql } from 'drizzle-orm';
import { bigint, check, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, } from 'drizzle-orm/pg-core';
/** Ordered pipeline stages. `scan` is the run-level (non-vendor) stage. */
export const BRAND_RADAR_EVENT_STAGES = [
    'scan',
    'search',
    'summary',
    'brand_digest',
] as const;
export type BrandRadarEventStage = (typeof BRAND_RADAR_EVENT_STAGES)[number];
/**
 * Lifecycle events. `reserved` / `consumed` / `refunded` mirror the billing
 * counters; `started` / `succeeded` / `failed` / `halted` record stage
 * progress and the rolling-ceiling halt.
 */
export const BRAND_RADAR_EVENT_KINDS = [
    'reserved',
    'consumed',
    'refunded',
    'started',
    'succeeded',
    'failed',
    'halted',
] as const;
export type BrandRadarEventKind = (typeof BRAND_RADAR_EVENT_KINDS)[number];
export const brandRadarEvents = pgTable('brand_radar_events', {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    /** Mongo ObjectId hex of the paired `BrandRadarScan` document. */
    scanId: text('scan_id').notNull(),
    stage: text('stage', { enum: BRAND_RADAR_EVENT_STAGES }).notNull(),
    event: text('event', { enum: BRAND_RADAR_EVENT_KINDS }).notNull(),
    /** Running direct cost in micros USD at the moment of the event. */
    costMicros: bigint('cost_micros', { mode: 'number' }).notNull().default(0),
    /**
     * Localized-key friendly, non-identifying context (reason codes, row
     * counts, halted-stage names). NEVER the brand query, a mention
     * snippet, or a vendor envelope — those are redacted content.
     */
    metadata: jsonb('metadata')
        .$type<Record<string, unknown>>()
        .notNull()
        .default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
}, (table) => [
    index('brand_radar_events_scan_occurred_idx').on(table.scanId, table.occurredAt),
    index('brand_radar_events_account_occurred_idx').on(table.accountId, table.occurredAt.desc()),
    check('brand_radar_events_cost_nonneg_check', sql `${table.costMicros} >= 0`),
    // Idempotency. One scan runs one call per stage, so
    // `(scan_id, stage, event)` is the natural replay key: a re-delivered
    // BullMQ job, a reconciliation re-enqueue, and a duplicate refund attempt
    // all collide here instead of doubling rows. The refund row
    // `(scan_id, 'scan', 'refunded')` is the Postgres-enforced guard the
    // refund authority relies on — the metric is constant for this table
    // (`brand_mention_scans`), so the spec's `(runId, metric, kind='refund')`
    // key is exactly this index.
    uniqueIndex('brand_radar_events_scan_stage_event_uidx').on(table.scanId, table.stage, table.event),
]);
export type BrandRadarEventRow = typeof brandRadarEvents.$inferSelect;
export type NewBrandRadarEventRow = typeof brandRadarEvents.$inferInsert;
