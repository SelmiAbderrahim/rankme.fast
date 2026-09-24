/**
 * Public SERP Volatility Sensor time series.
 *
 * This is global operator data: no account/site/user columns exist. Public
 * reads select only `volatility_indices`; ordered result identities remain in
 * `volatility_serp_snapshots` and normalized provider payloads remain in the
 * shared vendor archive.
 */
import { sql } from 'drizzle-orm';
import { bigint, check, date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid, } from 'drizzle-orm/pg-core';
export const VOLATILITY_CATEGORY_KEYS = [
    'finance',
    'health',
    'travel',
    'technology',
    'retail',
    'entertainment',
    'local_services',
    'education',
    'real_estate',
    'automotive',
] as const;
export type VolatilityCategory = (typeof VOLATILITY_CATEGORY_KEYS)[number];
export const VOLATILITY_INDEX_CATEGORIES = [
    ...VOLATILITY_CATEGORY_KEYS,
    'composite',
] as const;
export type VolatilityIndexCategory = (typeof VOLATILITY_INDEX_CATEGORIES)[number];
export const VOLATILITY_RUN_STATUSES = [
    'running',
    'completed',
    'partial',
    'skipped_budget',
    'failed',
] as const;
export type VolatilityRunStatus = (typeof VOLATILITY_RUN_STATUSES)[number];
export const VOLATILITY_HALT_REASONS = [
    'pre_dispatch',
    'mid_run_projected',
    'mid_run_actual',
] as const;
export type VolatilityHaltReason = (typeof VOLATILITY_HALT_REASONS)[number];
export const VOLATILITY_INDEX_STATES = [
    'published',
    'partial',
    'baseline',
    'skipped_budget',
    'failed',
] as const;
export type VolatilityIndexState = (typeof VOLATILITY_INDEX_STATES)[number];
export const volatilityRuns = pgTable('volatility_runs', {
    id: uuid('id').primaryKey().defaultRandom(),
    observationDate: date('observation_date').notNull(),
    status: text('status', { enum: VOLATILITY_RUN_STATUSES })
        .notNull()
        .default('running'),
    spentMicros: bigint('spent_micros', { mode: 'bigint' })
        .notNull()
        .default(sql `0`),
    budgetMicros: bigint('budget_micros', { mode: 'bigint' }).notNull(),
    haltReason: text('halt_reason', { enum: VOLATILITY_HALT_REASONS }),
    startedAt: timestamp('started_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
    observedAt: timestamp('observed_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
}, (table) => [
    uniqueIndex('volatility_runs_observation_date_uidx').on(table.observationDate),
    check('volatility_runs_status_check', sql `${table.status} in ('running', 'completed', 'partial', 'skipped_budget', 'failed')`),
    check('volatility_runs_halt_reason_check', sql `${table.haltReason} is null or ${table.haltReason} in ('pre_dispatch', 'mid_run_projected', 'mid_run_actual')`),
    check('volatility_runs_spent_nonnegative_check', sql `${table.spentMicros} >= 0`),
    check('volatility_runs_budget_positive_check', sql `${table.budgetMicros} > 0`),
]);
export const volatilitySerpSnapshots = pgTable('volatility_serp_snapshots', {
    id: uuid('id').primaryKey().defaultRandom(),
    observationDate: date('observation_date').notNull(),
    category: text('category', { enum: VOLATILITY_CATEGORY_KEYS }).notNull(),
    keywordOrdinal: integer('keyword_ordinal').notNull(),
    resultKey: text('result_key').notNull(),
    position: integer('position').notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
}, (table) => [
    uniqueIndex('volatility_snapshots_day_category_keyword_position_uidx').on(table.observationDate, table.category, table.keywordOrdinal, table.position),
    index('volatility_snapshots_day_category_keyword_position_idx').on(table.observationDate, table.category, table.keywordOrdinal, table.position),
    check('volatility_snapshots_category_check', sql `${table.category} in ('finance', 'health', 'travel', 'technology', 'retail', 'entertainment', 'local_services', 'education', 'real_estate', 'automotive')`),
    check('volatility_snapshots_keyword_ordinal_check', sql `${table.keywordOrdinal} between 0 and 19`),
    check('volatility_snapshots_position_check', sql `${table.position} between 1 and 20`),
    check('volatility_snapshots_result_key_check', sql `length(${table.resultKey}) between 1 and 2048`),
]);
export const volatilityIndices = pgTable('volatility_indices', {
    id: uuid('id').primaryKey().defaultRandom(),
    observationDate: date('observation_date').notNull(),
    category: text('category', { enum: VOLATILITY_INDEX_CATEGORIES }).notNull(),
    valueTenths: integer('value_tenths'),
    state: text('state', { enum: VOLATILITY_INDEX_STATES }).notNull(),
    spentMicros: bigint('spent_micros', { mode: 'bigint' })
        .notNull()
        .default(sql `0`),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
}, (table) => [
    uniqueIndex('volatility_indices_day_category_uidx').on(table.observationDate, table.category),
    index('volatility_indices_category_day_idx').on(table.category, table.observationDate),
    check('volatility_indices_category_check', sql `${table.category} in ('finance', 'health', 'travel', 'technology', 'retail', 'entertainment', 'local_services', 'education', 'real_estate', 'automotive', 'composite')`),
    check('volatility_indices_state_check', sql `${table.state} in ('published', 'partial', 'baseline', 'skipped_budget', 'failed')`),
    check('volatility_indices_value_check', sql `${table.valueTenths} is null or ${table.valueTenths} between 0 and 100`),
    check('volatility_indices_spent_nonnegative_check', sql `${table.spentMicros} >= 0`),
]);
export type VolatilityRunRow = typeof volatilityRuns.$inferSelect;
export type NewVolatilityRunRow = typeof volatilityRuns.$inferInsert;
export type VolatilitySerpSnapshotRow = typeof volatilitySerpSnapshots.$inferSelect;
export type NewVolatilitySerpSnapshotRow = typeof volatilitySerpSnapshots.$inferInsert;
export type VolatilityIndexRow = typeof volatilityIndices.$inferSelect;
export type NewVolatilityIndexRow = typeof volatilityIndices.$inferInsert;
