import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { RANK_CHECK_FAILURE_REASONS, keywords } from './keywords.js';

/** Explicit checks have one durable item for every selected keyword. */
export const RANK_CHECK_JOB_SCOPES = ['site', 'keyword', 'retry'] as const;
export type RankCheckJobScope = (typeof RANK_CHECK_JOB_SCOPES)[number];
export const RANK_CHECK_JOB_STATUSES = ['queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled'] as const;
export type RankCheckJobStatus = (typeof RANK_CHECK_JOB_STATUSES)[number];
export const RANK_CHECK_ITEM_STATES = ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'expired'] as const;
export type RankCheckItemState = (typeof RANK_CHECK_ITEM_STATES)[number];
export const RANK_CHECK_ITEM_REASONS = [
    ...RANK_CHECK_FAILURE_REASONS,
    'cap_reached',
    'deadline',
    'not_attempted',
    'enqueue_failed',
    'keyword_removed',
    'site_paused',
    'site_removed',
    'already_checked',
] as const;
export type RankCheckItemReason = (typeof RANK_CHECK_ITEM_REASONS)[number];

export const rankCheckJobs = pgTable('rank_check_jobs', {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    siteId: text('site_id').notNull(),
    scope: text('scope', { enum: RANK_CHECK_JOB_SCOPES }).notNull(),
    idempotencyKey: text('idempotency_key'),
    retryOfJobId: uuid('retry_of_job_id'),
    status: text('status', { enum: RANK_CHECK_JOB_STATUSES }).notNull().default('queued'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    deadlineAt: timestamp('deadline_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    uniqueIndex('rank_check_jobs_idempotency_uq').on(table.accountId, table.siteId, table.idempotencyKey),
    index('rank_check_jobs_site_created_idx').on(table.siteId, table.createdAt),
    index('rank_check_jobs_open_deadline_idx').on(table.deadlineAt).where(sql`${table.finishedAt} is null`),
    check('rank_check_jobs_status_check', sql`${table.status} in ('queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled')`),
    check('rank_check_jobs_scope_check', sql`${table.scope} in ('site', 'keyword', 'retry')`),
]);

export const rankCheckJobItems = pgTable('rank_check_job_items', {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id').notNull().references(() => rankCheckJobs.id, { onDelete: 'cascade' }),
    keywordId: uuid('keyword_id').notNull().references(() => keywords.id, { onDelete: 'cascade' }),
    engine: text('engine').notNull(),
    state: text('state', { enum: RANK_CHECK_ITEM_STATES }).notNull().default('queued'),
    reason: text('reason', { enum: RANK_CHECK_ITEM_REASONS }),
    attempts: integer('attempts').notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    uniqueIndex('rank_check_job_items_job_keyword_uq').on(table.jobId, table.keywordId),
    index('rank_check_job_items_keyword_idx').on(table.keywordId),
    check('rank_check_job_items_state_check', sql`${table.state} in ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'expired')`),
    check('rank_check_job_items_attempts_check', sql`${table.attempts} between 0 and 10`),
]);

export type RankCheckJobRow = typeof rankCheckJobs.$inferSelect;
export type RankCheckJobItemRow = typeof rankCheckJobItems.$inferSelect;
