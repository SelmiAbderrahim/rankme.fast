/**
 * Backlink snapshots (Pro tier).
 *
 * ONE row per (site, fetch time) — history for the "vs previous snapshot"
 * deltas the panel renders. Row-level backlink LISTS are NOT stored here
 * because they're metered per row (the `backlink_rows` usage counter); the
 * first-page list cache lives in the generic `vendor_cache` table
 * (capability='backlink', operation='list-first-page') so a page refresh —
 * by ANY account on the same domain — never double-bills the vendor.
 *
 * `accountId` is denormalized for query hygiene: every read is scoped by
 * `(accountId, siteId)`; a cross-account leak would surface a 404, not a 403
 * (see rules/mern-feature-modules.md).
 */
import { bigint, index, integer, pgTable, text, timestamp, uuid, } from 'drizzle-orm/pg-core';
export const backlinkSnapshots = pgTable('backlink_snapshots', {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: text('site_id').notNull(),
    accountId: text('account_id').notNull(),
    // 0..100 domain rating (DataForSEO `rank_scale: "one_hundred"`).
    // `null` = vendor did not report a rank for this domain yet.
    domainRating: integer('domain_rating'),
    backlinks: bigint('backlinks', { mode: 'number' }).notNull().default(0),
    referringDomains: bigint('referring_domains', { mode: 'number' })
        .notNull()
        .default(0),
    brokenBacklinks: bigint('broken_backlinks', { mode: 'number' })
        .notNull()
        .default(0),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
}, (table) => [
    index('backlink_snapshots_site_fetched_at_idx').on(table.siteId, table.fetchedAt),
    index('backlink_snapshots_account_idx').on(table.accountId),
]);
export type BacklinkSnapshotRow = typeof backlinkSnapshots.$inferSelect;
export type NewBacklinkSnapshotRow = typeof backlinkSnapshots.$inferInsert;
/** Snapshot summary cache TTL (24h) — a refresh before this uses the cache. */
export const DEFAULT_BACKLINK_SUMMARY_TTL_HOURS = 24;
