/**
 * Safe AI metering ledger. One ordered row per attempted provider call.
 * Costs use bigint micro-dollars throughout ($1 = 1_000_000 micros).
 * No prompt, system instruction, page content, output, vendor prose, key,
 * header, or stack field exists in this schema by design.
 */
import { bigint, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, } from 'drizzle-orm/pg-core';
export const AI_USAGE_EVENT_STATUSES = [
    'success',
    'budget_skipped',
    'budget_circuit_open',
    'availability',
    'quota',
    'timeout',
    'malformed_output',
    'auth',
    'safety',
    'invalid_input',
    'budget_refusal',
] as const;
export const aiUsageEvents = pgTable('ai_usage_events', {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    siteId: text('site_id'),
    jobId: text('job_id'),
    task: text('task').notNull(),
    correlationId: text('correlation_id').notNull(),
    profileName: text('profile_name'),
    profileVersion: text('profile_version'),
    outputSchemaVersion: text('output_schema_version'),
    promptTemplateId: text('prompt_template_id'),
    promptTemplateVersion: text('prompt_template_version'),
    qualityFlags: jsonb('quality_flags').$type<readonly string[]>(),
    provider: text('provider'),
    model: text('model'),
    attemptOrdinal: integer('attempt_ordinal').notNull(),
    status: text('status', { enum: AI_USAGE_EVENT_STATUSES }).notNull(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    cachedInputTokens: integer('cached_input_tokens'),
    reasoningTokens: integer('reasoning_tokens'),
    latencyMs: integer('latency_ms').notNull(),
    configuredEstimateCostMicros: bigint('configured_estimate_cost_micros', {
        mode: 'bigint',
    }).notNull(),
    actualCostMicros: bigint('actual_cost_micros', { mode: 'bigint' }),
    actualOrEstimatedCostMicros: bigint('actual_or_estimated_cost_micros', {
        mode: 'bigint',
    }).notNull(),
    costSource: text('cost_source', { enum: ['actual', 'estimated'] }).notNull(),
    errorCategory: text('error_category'),
    errorCode: text('error_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    uniqueIndex('ai_usage_events_account_correlation_ordinal_uidx').on(table.accountId, table.correlationId, table.attemptOrdinal),
    index('ai_usage_events_account_created_idx').on(table.accountId, table.createdAt),
    index('ai_usage_events_provider_created_idx').on(table.provider, table.createdAt),
    index('ai_usage_events_task_created_idx').on(table.task, table.createdAt),
    index('ai_usage_events_correlation_idx').on(table.correlationId),
]);
export type AiUsageEventRow = typeof aiUsageEvents.$inferSelect;
export type NewAiUsageEventRow = typeof aiUsageEvents.$inferInsert;
