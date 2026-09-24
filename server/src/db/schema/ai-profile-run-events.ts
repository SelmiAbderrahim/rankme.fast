/**
 * Content-free task-profile observability. One row per profile runner call.
 * Generated text, sanitized input, prompt bodies, source excerpts, and vendor
 * prose have no columns in this table.
 */
import { bigint, boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, } from 'drizzle-orm/pg-core';
export const AI_PROFILE_RUN_STATUSES = [
    'success',
    'partial',
    'validation_failed',
    'generation_failed',
] as const;
export const aiProfileRunEvents = pgTable('ai_profile_run_events', {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    siteId: text('site_id'),
    jobId: text('job_id'),
    correlationId: text('correlation_id').notNull(),
    task: text('task').notNull(),
    profileVersion: text('profile_version').notNull(),
    outputSchemaVersion: text('output_schema_version').notNull(),
    promptTemplateId: text('prompt_template_id').notNull(),
    promptTemplateVersion: text('prompt_template_version').notNull(),
    status: text('status', { enum: AI_PROFILE_RUN_STATUSES }).notNull(),
    provider: text('provider'),
    model: text('model'),
    attempts: integer('attempts').notNull(),
    fallbackUsed: boolean('fallback_used').notNull(),
    latencyMs: integer('latency_ms').notNull(),
    costMicros: bigint('cost_micros', { mode: 'bigint' }).notNull(),
    qualityFlags: jsonb('quality_flags').$type<readonly string[]>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    uniqueIndex('ai_profile_run_events_account_correlation_uidx').on(table.accountId, table.correlationId),
    index('ai_profile_run_events_account_created_idx').on(table.accountId, table.createdAt),
    index('ai_profile_run_events_task_created_idx').on(table.task, table.createdAt),
    index('ai_profile_run_events_provider_created_idx').on(table.provider, table.createdAt),
    index('ai_profile_run_events_status_created_idx').on(table.status, table.createdAt),
]);
export type AiProfileRunEventRow = typeof aiProfileRunEvents.$inferSelect;
export type NewAiProfileRunEventRow = typeof aiProfileRunEvents.$inferInsert;
