import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, real, text, timestamp, uniqueIndex, uuid, } from 'drizzle-orm/pg-core';
export const CONTENT_RECOMMENDATION_STATES = [
    'suggested',
    'accepted',
    'dismissed',
    'applied',
] as const;
export type ContentRecommendationState = (typeof CONTENT_RECOMMENDATION_STATES)[number];
export const CONTENT_RECOMMENDATION_EVENT_KINDS = [
    'accepted',
    'dismissed',
    'applied',
    'undo_applied',
] as const;
export type ContentRecommendationEventKind = (typeof CONTENT_RECOMMENDATION_EVENT_KINDS)[number];
/**
 * Append-only recommendation history. There is intentionally no service or
 * endpoint that updates/deletes these rows; undo is another ordered event.
 */
export const contentRecommendationEvents = pgTable('content_recommendation_events', {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    siteId: text('site_id').notNull(),
    analysisId: text('analysis_id').notNull(),
    recommendationId: text('recommendation_id').notNull(),
    analysisVersion: text('analysis_version').notNull(),
    eventKind: text('event_kind', {
        enum: CONTENT_RECOMMENDATION_EVENT_KINDS,
    }).notNull(),
    priorState: text('prior_state', {
        enum: CONTENT_RECOMMENDATION_STATES,
    }).notNull(),
    newState: text('new_state', {
        enum: CONTENT_RECOMMENDATION_STATES,
    }).notNull(),
    stateVersion: integer('state_version').notNull(),
    actorUserId: text('actor_user_id').notNull(),
    note: text('note'),
    contentHash: text('content_hash'),
    analysisContentHash: text('analysis_content_hash'),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    baselineAnchorAt: timestamp('baseline_anchor_at', { withTimezone: true }),
    idempotencyKey: text('idempotency_key').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    uniqueIndex('content_rec_events_idempotency_uidx').on(table.idempotencyKey),
    uniqueIndex('content_rec_events_state_version_uidx').on(table.analysisId, table.recommendationId, table.stateVersion),
    index('content_rec_events_account_recorded_idx').on(table.accountId, table.recordedAt),
    index('content_rec_events_analysis_rec_recorded_idx').on(table.analysisId, table.recommendationId, table.recordedAt),
    check('content_rec_events_state_version_check', sql `${table.stateVersion} > 0`),
    check('content_rec_events_state_check', sql `${table.priorState} in ('suggested','accepted','dismissed','applied') and ${table.newState} in ('suggested','accepted','dismissed','applied')`),
    check('content_rec_events_kind_check', sql `${table.eventKind} in ('accepted','dismissed','applied','undo_applied')`),
]);
export type ContentRecommendationEventRow = typeof contentRecommendationEvents.$inferSelect;
export type NewContentRecommendationEventRow = typeof contentRecommendationEvents.$inferInsert;
export const CONTENT_OUTCOME_SOURCES = ['gsc', 'rank'] as const;
export type ContentOutcomeSource = (typeof CONTENT_OUTCOME_SOURCES)[number];
export const CONTENT_OUTCOME_PHASES = ['baseline', 'following'] as const;
export type ContentOutcomePhase = (typeof CONTENT_OUTCOME_PHASES)[number];
/**
 * Versioned daily observations copied only from already-synced GSC/rank
 * history. Missing days remain absent; the API reports coverage instead of
 * manufacturing zeroes.
 */
export const contentRecommendationOutcomes = pgTable('content_recommendation_outcomes', {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    siteId: text('site_id').notNull(),
    analysisId: text('analysis_id').notNull(),
    recommendationId: text('recommendation_id').notNull(),
    appliedEventId: uuid('applied_event_id').notNull(),
    aggregationVersion: text('aggregation_version').notNull(),
    source: text('source', { enum: CONTENT_OUTCOME_SOURCES }).notNull(),
    phase: text('phase', { enum: CONTENT_OUTCOME_PHASES }).notNull(),
    observedDate: timestamp('observed_date', { withTimezone: true }).notNull(),
    clicks: integer('clicks'),
    impressions: integer('impressions'),
    ctr: real('ctr'),
    averagePosition: real('average_position'),
    rankPosition: integer('rank_position'),
    laterEdit: integer('later_edit').notNull().default(0),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    uniqueIndex('content_rec_outcomes_observation_uidx').on(table.appliedEventId, table.aggregationVersion, table.source, table.observedDate),
    index('content_rec_outcomes_analysis_rec_date_idx').on(table.analysisId, table.recommendationId, table.observedDate),
    index('content_rec_outcomes_account_date_idx').on(table.accountId, table.observedDate),
    check('content_rec_outcomes_source_check', sql `${table.source} in ('gsc','rank')`),
    check('content_rec_outcomes_phase_check', sql `${table.phase} in ('baseline','following')`),
    check('content_rec_outcomes_later_edit_check', sql `${table.laterEdit} in (0,1)`),
]);
export type ContentRecommendationOutcomeRow = typeof contentRecommendationOutcomes.$inferSelect;
export type NewContentRecommendationOutcomeRow = typeof contentRecommendationOutcomes.$inferInsert;
