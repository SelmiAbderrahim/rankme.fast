import { relations, sql } from 'drizzle-orm';
import { boolean, check, doublePrecision, foreignKey, index, integer, pgTable, text, timestamp, uniqueIndex, uuid, } from 'drizzle-orm/pg-core';
export const PAGE_PERFORMANCE_SOURCES = ['dataforseo', 'demo'] as const;
export type PagePerformanceSource = (typeof PAGE_PERFORMANCE_SOURCES)[number];
export const PAGE_PERFORMANCE_CACHE_STATUSES = ['hit', 'miss'] as const;
export type PagePerformanceCacheStatus = (typeof PAGE_PERFORMANCE_CACHE_STATUSES)[number];
/**
 * Successful, provider-neutral point-in-time collections for the Pages
 * fallback. Raw vendor payloads, task ids, and credentials never enter this
 * table; `cache_fetched_at` is the observation/freshness authority.
 */
export const pagePerformanceSnapshots = pgTable('page_performance_snapshots', {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    siteId: text('site_id').notNull(),
    source: text('source', { enum: PAGE_PERFORMANCE_SOURCES }).notNull(),
    locationCode: integer('location_code').notNull(),
    languageCode: text('language_code').notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    cacheFetchedAt: timestamp('cache_fetched_at', { withTimezone: true }).notNull(),
    cacheStatus: text('cache_status', {
        enum: PAGE_PERFORMANCE_CACHE_STATUSES,
    }).notNull(),
    successfulEmpty: boolean('successful_empty').notNull().default(false),
    payloadFingerprint: text('payload_fingerprint').notNull(),
    sourceRowsFetched: integer('source_rows_fetched').notNull(),
    acceptedCount: integer('accepted_count').notNull(),
    droppedCount: integer('dropped_count').notNull(),
    malformedUrlCount: integer('malformed_url_count').notNull().default(0),
    offsiteUrlCount: integer('offsite_url_count').notNull().default(0),
    duplicateUrlCount: integer('duplicate_url_count').notNull().default(0),
    invalidMetricCount: integer('invalid_metric_count').notNull().default(0),
    sourceTruncated: boolean('source_truncated').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    uniqueIndex('page_performance_snapshots_parent_tenant_uidx').on(table.id, table.accountId, table.siteId),
    uniqueIndex('page_performance_snapshots_payload_uidx').on(table.accountId, table.siteId, table.source, table.locationCode, table.languageCode, table.observedAt, table.payloadFingerprint),
    index('page_performance_snapshots_context_time_idx').on(table.accountId, table.siteId, table.source, table.locationCode, table.languageCode, table.observedAt.desc(), table.id.desc()),
    index('page_performance_snapshots_account_site_idx').on(table.accountId, table.siteId),
    check('page_performance_snapshots_source_check', sql `${table.source} in ('dataforseo', 'demo')`),
    check('page_performance_snapshots_market_check', sql `${table.locationCode} > 0 and ${table.languageCode} ~ '^[a-z][a-z0-9-]{1,9}$'`),
    check('page_performance_snapshots_fingerprint_check', sql `${table.payloadFingerprint} ~ '^[0-9a-f]{64}$'`),
    check('page_performance_snapshots_counts_check', sql `${table.sourceRowsFetched} >= 0 and ${table.acceptedCount} >= 0 and ${table.droppedCount} >= 0 and ${table.malformedUrlCount} >= 0 and ${table.offsiteUrlCount} >= 0 and ${table.duplicateUrlCount} >= 0 and ${table.invalidMetricCount} >= 0 and ${table.acceptedCount} + ${table.droppedCount} = ${table.sourceRowsFetched} and ${table.droppedCount} = ${table.malformedUrlCount} + ${table.offsiteUrlCount} + ${table.duplicateUrlCount} + ${table.invalidMetricCount}`),
    check('page_performance_snapshots_empty_check', sql `${table.successfulEmpty} = (${table.acceptedCount} = 0)`),
]);
/** Normalized ranked-keyword facts belonging to one successful snapshot. */
export const pagePerformanceKeywords = pgTable('page_performance_keywords', {
    id: uuid('id').primaryKey().defaultRandom(),
    snapshotId: uuid('snapshot_id').notNull(),
    accountId: text('account_id').notNull(),
    siteId: text('site_id').notNull(),
    pageHash: text('page_hash').notNull(),
    canonicalUrl: text('canonical_url').notNull(),
    displayUrl: text('display_url').notNull(),
    keyword: text('keyword').notNull(),
    position: doublePrecision('position').notNull(),
    searchVolume: integer('search_volume'),
    difficulty: doublePrecision('difficulty'),
    estimatedTraffic: doublePrecision('estimated_traffic'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    foreignKey({
        name: 'page_performance_keywords_snapshot_tenant_fk',
        columns: [table.snapshotId, table.accountId, table.siteId],
        foreignColumns: [
            pagePerformanceSnapshots.id,
            pagePerformanceSnapshots.accountId,
            pagePerformanceSnapshots.siteId,
        ],
    }).onDelete('cascade'),
    uniqueIndex('page_performance_keywords_snapshot_page_keyword_uidx').on(table.snapshotId, table.pageHash, table.keyword),
    index('page_performance_keywords_tenant_snapshot_idx').on(table.accountId, table.siteId, table.snapshotId),
    index('page_performance_keywords_page_detail_idx').on(table.accountId, table.siteId, table.snapshotId, table.pageHash, table.keyword),
    check('page_performance_keywords_page_hash_check', sql `${table.pageHash} ~ '^[A-Za-z0-9_-]{43}$'`),
    check('page_performance_keywords_url_check', sql `length(${table.canonicalUrl}) between 8 and 2048 and ${table.canonicalUrl} ~ '^https?://' and position('#' in ${table.canonicalUrl}) = 0 and length(${table.displayUrl}) between 1 and 2048`),
    check('page_performance_keywords_keyword_check', sql `length(btrim(${table.keyword})) between 1 and 700`),
    check('page_performance_keywords_position_check', sql `${table.position} > 0 and ${table.position} < 'Infinity'::double precision`),
    check('page_performance_keywords_metrics_check', sql `(${table.searchVolume} is null or ${table.searchVolume} >= 0) and (${table.difficulty} is null or (${table.difficulty} >= 0 and ${table.difficulty} <= 100 and ${table.difficulty} < 'Infinity'::double precision)) and (${table.estimatedTraffic} is null or (${table.estimatedTraffic} >= 0 and ${table.estimatedTraffic} < 'Infinity'::double precision))`),
]);
export const pagePerformanceSnapshotRelations = relations(pagePerformanceSnapshots, ({ many }) => ({ keywords: many(pagePerformanceKeywords) }));
export const pagePerformanceKeywordRelations = relations(pagePerformanceKeywords, ({ one }) => ({
    snapshot: one(pagePerformanceSnapshots, {
        fields: [
            pagePerformanceKeywords.snapshotId,
            pagePerformanceKeywords.accountId,
            pagePerformanceKeywords.siteId,
        ],
        references: [
            pagePerformanceSnapshots.id,
            pagePerformanceSnapshots.accountId,
            pagePerformanceSnapshots.siteId,
        ],
    }),
}));
export type PagePerformanceSnapshot = typeof pagePerformanceSnapshots.$inferSelect;
export type NewPagePerformanceSnapshot = typeof pagePerformanceSnapshots.$inferInsert;
export type PagePerformanceKeyword = typeof pagePerformanceKeywords.$inferSelect;
export type NewPagePerformanceKeyword = typeof pagePerformanceKeywords.$inferInsert;
