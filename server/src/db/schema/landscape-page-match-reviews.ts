import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid, } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
/** Mutable reviewed-URL overlay; immutable landscape suggestions stay in Mongo. */
export const landscapePageMatchReviews = pgTable('landscape_page_match_reviews', {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    siteId: text('site_id').notNull(),
    reportId: text('report_id').notNull(),
    suggestionId: text('suggestion_id').notNull(),
    competitorProfileId: uuid('competitor_profile_id').notNull(),
    decision: text('decision', { enum: ['approved', 'rejected'] }).notNull(),
    ownedUrl: text('owned_url'),
    competitorUrl: text('competitor_url'),
    reviewedByUserId: text('reviewed_by_user_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    version: integer('version').notNull().default(1),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
}, (table) => [
    uniqueIndex('landscape_page_match_review_suggestion_uq').on(table.accountId, table.reportId, table.suggestionId),
    uniqueIndex('landscape_page_match_review_idempotency_uq').on(table.accountId, table.idempotencyKey),
    index('landscape_page_match_review_site_idx').on(table.accountId, table.siteId, table.reviewedAt),
    index('landscape_page_match_review_profile_idx').on(table.accountId, table.competitorProfileId),
    check('landscape_page_match_review_decision_check', sql `${table.decision} in ('approved', 'rejected')`),
    check('landscape_page_match_review_urls_check', sql `(${table.decision} = 'approved' and ${table.ownedUrl} is not null and ${table.competitorUrl} is not null) or (${table.decision} = 'rejected' and ${table.ownedUrl} is null and ${table.competitorUrl} is null)`),
    check('landscape_page_match_review_version_check', sql `${table.version} > 0`),
]);
export type LandscapePageMatchReviewRow = typeof landscapePageMatchReviews.$inferSelect;
export type NewLandscapePageMatchReviewRow = typeof landscapePageMatchReviews.$inferInsert;
