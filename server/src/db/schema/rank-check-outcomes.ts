import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { RANK_CHECK_FAILURE_REASONS, keywords } from './keywords.js';

/** The latest attempt in a period, including failures that wrote no ranking. */
export const RANK_CHECK_OUTCOME_STATUSES = ['checked', 'failed', 'skipped'] as const;
export type RankCheckOutcomeStatus = (typeof RANK_CHECK_OUTCOME_STATUSES)[number];

export const RANK_CHECK_OUTCOME_REASONS = [
    ...RANK_CHECK_FAILURE_REASONS,
    'cap_reached',
    'site_paused',
] as const;
export type RankCheckOutcomeReason = (typeof RANK_CHECK_OUTCOME_REASONS)[number];

export const rankCheckOutcomes = pgTable('rank_check_outcomes', {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    siteId: text('site_id').notNull(),
    keywordId: uuid('keyword_id').notNull().references(() => keywords.id, { onDelete: 'cascade' }),
    periodKey: text('period_key').notNull(),
    status: text('status', { enum: RANK_CHECK_OUTCOME_STATUSES }).notNull(),
    reason: text('reason', { enum: RANK_CHECK_OUTCOME_REASONS }),
    attempts: integer('attempts').notNull().default(1),
    firstAttemptAt: timestamp('first_attempt_at', { withTimezone: true }).notNull(),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
    retryDeadline: timestamp('retry_deadline', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    uniqueIndex('rank_check_outcomes_keyword_period_uq').on(table.keywordId, table.periodKey),
    index('rank_check_outcomes_site_period_idx').on(table.siteId, table.periodKey),
    check('rank_check_outcomes_status_check', sql`${table.status} in ('checked', 'failed', 'skipped')`),
    check('rank_check_outcomes_attempts_check', sql`${table.attempts} between 1 and 10`),
]);

export type RankCheckOutcomeRow = typeof rankCheckOutcomes.$inferSelect;
export type NewRankCheckOutcomeRow = typeof rankCheckOutcomes.$inferInsert;
