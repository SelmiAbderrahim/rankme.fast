/**
 * App Store Optimization relational storage.
 *
 * AppProfile remains a Mongo document. These four tables hold relational,
 * ordered observations and join across stores with TEXT `account_id`,
 * `site_id`, and `profile_id` values containing Mongo ObjectId hex strings.
 * There are deliberately no SQL foreign keys to Mongo-owned ids.
 */
import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, } from 'drizzle-orm/pg-core';
import type { ObservationMeta } from '../../shared/observations/types.js';
import { APP_STORE_KINDS, type AppInfo, type AppStoreKind, } from '../../shared/providers/app-data.js';
export const APP_SEO_STORES = APP_STORE_KINDS;
export type AppSeoStore = AppStoreKind;
export type AppListingFindings = Record<string, unknown>;
export const appKeywords = pgTable('app_keywords', {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    siteId: text('site_id').notNull(),
    profileId: text('profile_id').notNull(),
    store: text('store', { enum: APP_SEO_STORES }).notNull(),
    phrase: text('phrase').notNull(),
    locationCode: integer('location_code').notNull(),
    languageCode: text('language_code').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    uniqueIndex('app_keywords_profile_store_phrase_location_language_idx').on(table.profileId, table.store, table.phrase, table.locationCode, table.languageCode),
    index('app_keywords_account_active_idx').on(table.accountId, table.active),
    index('app_keywords_site_profile_active_idx').on(table.siteId, table.profileId, table.active),
    check('app_keywords_store_check', sql `${table.store} in ('google_play', 'app_store')`),
]);
export const appRankSnapshots = pgTable('app_rank_snapshots', {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    siteId: text('site_id').notNull(),
    keywordId: uuid('keyword_id')
        .notNull()
        .references(() => appKeywords.id, { onDelete: 'cascade' }),
    // NULL means the registered app was not observed in the requested depth.
    position: integer('position'),
    rankAbsolute: integer('rank_absolute'),
    foundAppId: text('found_app_id'),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull(),
    observationMeta: jsonb('observation_meta').$type<ObservationMeta>().notNull(),
}, (table) => [
    // The unique btree serves newest-first history through a backward scan.
    uniqueIndex('app_rank_snapshots_keyword_checked_at_idx').on(table.keywordId, table.checkedAt),
    index('app_rank_snapshots_site_checked_at_idx').on(table.siteId, table.checkedAt),
]);
export const appChartSnapshots = pgTable('app_chart_snapshots', {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    siteId: text('site_id').notNull(),
    profileId: text('profile_id').notNull(),
    store: text('store', { enum: APP_SEO_STORES }).notNull(),
    chartId: text('chart_id').notNull(),
    categoryId: text('category_id'),
    // NULL means the app was not observed on the bounded chart page.
    position: integer('position'),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull(),
    observationMeta: jsonb('observation_meta').$type<ObservationMeta>().notNull(),
}, (table) => [
    index('app_chart_snapshots_profile_history_idx').on(table.profileId, table.store, table.chartId, table.categoryId, table.checkedAt),
    index('app_chart_snapshots_site_checked_at_idx').on(table.siteId, table.checkedAt),
    check('app_chart_snapshots_store_check', sql `${table.store} in ('google_play', 'app_store')`),
]);
export const appListingSnapshots = pgTable('app_listing_snapshots', {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    siteId: text('site_id').notNull(),
    profileId: text('profile_id').notNull(),
    store: text('store', { enum: APP_SEO_STORES }).notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
    listing: jsonb('listing').$type<AppInfo>().notNull(),
    findings: jsonb('findings').$type<AppListingFindings>().notNull(),
    observationMeta: jsonb('observation_meta').$type<ObservationMeta>().notNull(),
}, (table) => [
    index('app_listing_snapshots_profile_history_idx').on(table.profileId, table.store, table.capturedAt),
    index('app_listing_snapshots_site_captured_at_idx').on(table.siteId, table.capturedAt),
    check('app_listing_snapshots_store_check', sql `${table.store} in ('google_play', 'app_store')`),
]);
export type AppKeywordRow = typeof appKeywords.$inferSelect;
export type NewAppKeywordRow = typeof appKeywords.$inferInsert;
export type AppRankSnapshotRow = typeof appRankSnapshots.$inferSelect;
export type NewAppRankSnapshotRow = typeof appRankSnapshots.$inferInsert;
export type AppChartSnapshotRow = typeof appChartSnapshots.$inferSelect;
export type NewAppChartSnapshotRow = typeof appChartSnapshots.$inferInsert;
export type AppListingSnapshotRow = typeof appListingSnapshots.$inferSelect;
export type NewAppListingSnapshotRow = typeof appListingSnapshots.$inferInsert;
