/**
 * Local SEO snapshots — NAP/reviews/Q&A + local-pack rank.
 *
 * Relational, per-day/per-check time series → Postgres per
 * `drizzle-postgres-scope.md`. Three tables:
 *   - `local_listing_snapshots` — one row per (site, day, directory source).
 *   - `local_reviews_snapshots` — one row per (site, day) — reviews + Q&A
 *     rollup (Q&A is small enough to fold into the reviews row rather than
 *     spin up a fourth table).
 *   - `local_pack_rank_snapshots` — one row per local-pack rank check,
 *     mirroring the shape of `rankings` (keywords.ts) but for the map-pack
 *     surface instead of organic.
 *
 * `siteId` / `accountId` are TEXT for the same cross-store reason as
 * `keywords.ts` — Site is a Mongoose document (24-char hex ObjectId), joined
 * by id only, never by SQL FK.
 */
import { boolean, date, index, integer, pgTable, real, text, timestamp, uniqueIndex, uuid, } from 'drizzle-orm/pg-core';
export const localListingSnapshots = pgTable('local_listing_snapshots', {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    siteId: text('site_id').notNull(),
    snapshotDate: date('snapshot_date').notNull(),
    /** Directory/source, e.g. 'google', 'yelp', 'bing-places'. Vendor-reported string. */
    source: text('source').notNull(),
    name: text('name').notNull(),
    address: text('address'),
    phone: text('phone'),
    /** True when name/address/phone match the canonical (Google) listing. */
    consistent: boolean('consistent').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    uniqueIndex('local_listing_snapshots_site_date_source_idx').on(table.siteId, table.snapshotDate, table.source),
]);
export const localReviewsSnapshots = pgTable('local_reviews_snapshots', {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    siteId: text('site_id').notNull(),
    snapshotDate: date('snapshot_date').notNull(),
    averageRating: real('average_rating'),
    reviewCount: integer('review_count').notNull(),
    unansweredQuestionCount: integer('unanswered_question_count').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    uniqueIndex('local_reviews_snapshots_site_date_idx').on(table.siteId, table.snapshotDate),
]);
export const localPackRankSnapshots = pgTable('local_pack_rank_snapshots', {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    siteId: text('site_id').notNull(),
    keywordId: text('keyword_id').notNull(),
    // null = the domain's business listing did not appear in the map pack —
    // distinct from "no check ran" (absence of a row).
    position: integer('position'),
    totalPackSize: integer('total_pack_size').notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
}, (table) => [
    index('local_pack_rank_snapshots_site_keyword_idx').on(table.siteId, table.keywordId, table.capturedAt),
]);
export type LocalListingSnapshotRow = typeof localListingSnapshots.$inferSelect;
export type NewLocalListingSnapshotRow = typeof localListingSnapshots.$inferInsert;
export type LocalReviewsSnapshotRow = typeof localReviewsSnapshots.$inferSelect;
export type NewLocalReviewsSnapshotRow = typeof localReviewsSnapshots.$inferInsert;
export type LocalPackRankSnapshotRow = typeof localPackRankSnapshots.$inferSelect;
export type NewLocalPackRankSnapshotRow = typeof localPackRankSnapshots.$inferInsert;
