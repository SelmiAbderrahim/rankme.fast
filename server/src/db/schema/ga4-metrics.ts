import { date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid, } from 'drizzle-orm/pg-core';
// GA4 daily snapshots — mirrors `gsc_search_analytics` (same REPLACE-on-
// conflict granularity, same TEXT 24-hex Mongo ids, no SQL FK). One snapshot
// per `(siteId, snapshotDate, dimensionSet, windowDays)`; metric columns are
// the fixed product set (sessions / active users / engaged sessions / key
// events) — engagement rate is derived on read, never stored.
//
// GA4 is PRIVATE per-account data: rows carry the owning `account_id` and
// are never served cross-user (vendor-cache archive-only precedent).
export const ga4Metrics = pgTable('ga4_metrics', {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    siteId: text('site_id').notNull(),
    bindingGenerationId: text('binding_generation_id').notNull(),
    /** The lag-adjusted endDate of the queried window (today - GA4_LAG_DAYS). */
    snapshotDate: date('snapshot_date').notNull(),
    /** Length in days of the window ending at snapshot_date (7 | 28 | 90). */
    windowDays: integer('window_days').notNull().default(28),
    /** date | channel | page | country | device (product-side names). */
    dimensionSet: text('dimension_set').notNull(),
    dimensionKey: text('dimension_key').notNull(),
    sessions: integer('sessions').notNull(),
    activeUsers: integer('active_users').notNull(),
    engagedSessions: integer('engaged_sessions').notNull(),
    keyEvents: integer('key_events').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    uniqueIndex('ga4_metrics_site_date_dim_window_key_idx').on(table.siteId, table.bindingGenerationId, table.snapshotDate, table.dimensionSet, table.windowDays, table.dimensionKey),
    index('ga4_metrics_site_dim_date_idx').on(table.siteId, table.bindingGenerationId, table.dimensionSet, table.snapshotDate),
]);
export type Ga4MetricsSnapshotRow = typeof ga4Metrics.$inferSelect;
export type NewGa4MetricsSnapshotRow = typeof ga4Metrics.$inferInsert;
