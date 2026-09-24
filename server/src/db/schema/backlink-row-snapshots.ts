/**
 * Ordered per-row backlink snapshots produced by toxicity reviews.
 * The alerts pipeline diffs consecutive `capturedAt` groups for new/lost-link alerts.
 * Identity/orchestration remains in Mongo; account/site/review ids are text at
 * this cross-store boundary and every query is account-scoped.
 */
import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid, } from 'drizzle-orm/pg-core';
export const TOXICITY_BANDS = ['clean', 'watch', 'toxic'] as const;
export type ToxicityBand = (typeof TOXICITY_BANDS)[number];
export const TOXICITY_RATIONALE_STATUSES = [
    'not_requested',
    'annotated',
    'abstained',
    'failed',
] as const;
export type ToxicityRationaleStatus = (typeof TOXICITY_RATIONALE_STATUSES)[number];
export const BACKLINK_ROW_SNAPSHOT_MAX_PER_REVIEW = 1000;
export const TOXICITY_RATIONALE_MAX_CHARS = 300;
export const backlinkRowSnapshots = pgTable('backlink_row_snapshots', {
    id: uuid('id').primaryKey().defaultRandom(),
    reviewId: text('review_id').notNull(),
    accountId: text('account_id').notNull(),
    siteId: text('site_id').notNull(),
    url: text('url').notNull(),
    domain: text('domain').notNull(),
    spamScore: integer('spam_score').notNull(),
    rubricBand: text('rubric_band', { enum: TOXICITY_BANDS }).notNull(),
    rubricVersion: text('rubric_version').notNull(),
    firstSeen: timestamp('first_seen', { withTimezone: true }),
    lastSeen: timestamp('last_seen', { withTimezone: true }),
    dofollow: boolean('dofollow').notNull(),
    isBroken: boolean('is_broken').notNull(),
    rationale: text('rationale'),
    rationaleStatus: text('rationale_status', {
        enum: TOXICITY_RATIONALE_STATUSES,
    })
        .notNull()
        .default('not_requested'),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
}, (table) => [
    check('backlink_row_snapshots_spam_score_check', sql `${table.spamScore} between 0 and 100`),
    check('backlink_row_snapshots_url_length_check', sql `char_length(${table.url}) between 1 and 2048`),
    check('backlink_row_snapshots_domain_length_check', sql `char_length(${table.domain}) between 1 and 253`),
    check('backlink_row_snapshots_rationale_length_check', sql `${table.rationale} is null or char_length(${table.rationale}) <= ${sql.raw(String(TOXICITY_RATIONALE_MAX_CHARS))}`),
    check('backlink_row_snapshots_rubric_band_check', sql `${table.rubricBand} in ('clean', 'watch', 'toxic')`),
    check('backlink_row_snapshots_rationale_status_check', sql `${table.rationaleStatus} in ('not_requested', 'annotated', 'abstained', 'failed')`),
    uniqueIndex('backlink_row_snapshots_review_url_idx').on(table.reviewId, table.url),
    index('backlink_row_snapshots_site_captured_idx').on(table.accountId, table.siteId, table.capturedAt, table.id),
    index('backlink_row_snapshots_review_band_idx').on(table.accountId, table.reviewId, table.rubricBand, table.id),
]);
export type BacklinkRowSnapshot = typeof backlinkRowSnapshots.$inferSelect;
export type NewBacklinkRowSnapshot = typeof backlinkRowSnapshots.$inferInsert;
