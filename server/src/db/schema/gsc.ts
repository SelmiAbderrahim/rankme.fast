import { bigint, boolean, date, index, integer, pgTable, real, text, timestamp, uniqueIndex, uuid, } from 'drizzle-orm/pg-core';
export const GSC_SYNC_RUN_STATUSES = [
    'queued',
    'running',
    'succeeded',
    'empty',
    'failed',
] as const;
export type GscSyncRunStatus = (typeof GSC_SYNC_RUN_STATUSES)[number];
// Google Search Console daily snapshots.
// `siteId` / `accountId` are TEXT (24-char hex Mongo ObjectId) like keywords —
// joins across the two stores happen by id only, never by SQL FK.
//
// Clicks/impressions are plain integers: per-site daily totals sit far under
// INT max (Search Analytics caps rows at ~50k and samples above that).
/** Separator joining a row's `keys[]` into `dimension_key` — U+001F (unit
 * separator) can never appear in a query string or URL. */
export const GSC_DIMENSION_KEY_SEPARATOR = '';
export const gscSearchAnalytics = pgTable('gsc_search_analytics', {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    siteId: text('site_id').notNull(),
    bindingGenerationId: text('binding_generation_id').notNull(),
    /** The endDate of the queried window (already lag-adjusted: today - 3). */
    snapshotDate: date('snapshot_date').notNull(),
    /** "query" | "page" | "query,page" — the requested dimensions[] joined. */
    dimensionSet: text('dimension_set').notNull(),
    /** Length in days of the aggregated window ending at snapshot_date
     * (7 | 28 | 90). Pre-range rows carry the historical default 28. */
    windowDays: integer('window_days').notNull().default(28),
    /** Row keys[] joined with GSC_DIMENSION_KEY_SEPARATOR. */
    dimensionKey: text('dimension_key').notNull(),
    clicks: integer('clicks').notNull(),
    impressions: integer('impressions').notNull(),
    ctr: real('ctr').notNull(),
    position: real('position').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    uniqueIndex('gsc_search_analytics_account_site_date_dim_key_idx').on(table.accountId, table.siteId, table.bindingGenerationId, table.snapshotDate, table.dimensionSet, table.windowDays, table.dimensionKey),
    index('gsc_search_analytics_account_site_dim_date_idx').on(table.accountId, table.siteId, table.bindingGenerationId, table.dimensionSet, table.snapshotDate),
]);
export type GscSearchAnalyticsSnapshotRow = typeof gscSearchAnalytics.$inferSelect;
export type NewGscSearchAnalyticsSnapshotRow = typeof gscSearchAnalytics.$inferInsert;
/** Durable, token-free Pages health for an account/site/property sync. */
export const gscSyncRuns = pgTable('gsc_sync_runs', {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    siteId: text('site_id').notNull(),
    bindingGenerationId: text('binding_generation_id').notNull(),
    generation: bigint('generation', { mode: 'number' }).notNull(),
    propertyUrlHash: text('property_url_hash').notNull(),
    status: text('status', { enum: GSC_SYNC_RUN_STATUSES }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    snapshotDate: date('snapshot_date'),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    failureClass: text('failure_class'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    uniqueIndex('gsc_sync_runs_tenant_generation_uidx').on(table.accountId, table.siteId, table.bindingGenerationId, table.generation),
    index('gsc_sync_runs_tenant_property_generation_idx').on(table.accountId, table.siteId, table.bindingGenerationId, table.propertyUrlHash, table.generation.desc()),
]);
export type GscSyncRun = typeof gscSyncRuns.$inferSelect;
export type NewGscSyncRun = typeof gscSyncRuns.$inferInsert;
export const gscSitemaps = pgTable('gsc_sitemaps', {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    siteId: text('site_id').notNull(),
    bindingGenerationId: text('binding_generation_id').notNull(),
    snapshotDate: date('snapshot_date').notNull(),
    path: text('path').notNull(),
    type: text('type').notNull(),
    lastSubmitted: timestamp('last_submitted', { withTimezone: true }),
    lastDownloaded: timestamp('last_downloaded', { withTimezone: true }),
    isPending: boolean('is_pending').notNull(),
    isSitemapsIndex: boolean('is_sitemaps_index').notNull(),
    errors: integer('errors').notNull(),
    warnings: integer('warnings').notNull(),
    processed: integer('processed').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    uniqueIndex('gsc_sitemaps_site_date_path_idx').on(table.siteId, table.bindingGenerationId, table.snapshotDate, table.path),
    index('gsc_sitemaps_site_date_idx').on(table.siteId, table.bindingGenerationId, table.snapshotDate),
]);
export type GscSitemapSnapshotRow = typeof gscSitemaps.$inferSelect;
export type NewGscSitemapSnapshotRow = typeof gscSitemaps.$inferInsert;
