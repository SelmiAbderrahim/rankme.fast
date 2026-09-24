import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
/**
 * Durable cross-store deletion barrier.
 *
 * Mongo owns the live Site document, so Postgres cannot point its site-scoped
 * rows at a conventional FK. A permanent, non-personal tombstone closes that
 * gap: site-scoped table triggers take the same advisory transaction lock as
 * the deletion barrier and reject every later INSERT/UPDATE for this site id.
 */
export const siteDeletionTombstones = pgTable('site_deletion_tombstones', {
    siteId: text('site_id').primaryKey(),
    deletionStartedAt: timestamp('deletion_started_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
});
export type SiteDeletionTombstone = typeof siteDeletionTombstones.$inferSelect;
export type NewSiteDeletionTombstone = typeof siteDeletionTombstones.$inferInsert;
