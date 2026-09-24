import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid, } from 'drizzle-orm/pg-core';
import { keywords, rankings, SERP_DEVICES } from './keywords.js';
// Durable evidence for the "confirm a rank drop with a fresh
// vendor observation before alerting" contract.
//
// Ordered, relational, per-candidate-ranking → Postgres (scoped exception per
// `.claude/rules/drizzle-postgres-scope.md`). One row per candidate ranking
// that triggered `detectRankDrop`; the ranking itself stays in `rankings`
// unchanged (never mutated, never a second cache row).
//
// The `rankingId` UNIQUE constraint is the idempotency guarantee: a BullMQ
// replay of the same candidate cannot create a second attempt row and thus
// cannot spend a second `serp_checks` unit.
export const RANK_DROP_CONFIRMATION_STATES = [
    'confirmed',
    'volatile',
    'unconfirmed',
] as const;
export type RankDropConfirmationState = (typeof RANK_DROP_CONFIRMATION_STATES)[number];
/** Closed allowlist of localization keys for `unconfirmed` reasons. */
export const RANK_DROP_CONFIRMATION_REASONS = [
    'capacity_unavailable',
    'provider_timeout',
    'provider_quota',
    'provider_malformed',
    'provider_unavailable',
    'provider_unsupported',
    'market_unsupported',
    'interrupted',
] as const;
export type RankDropConfirmationReason = (typeof RANK_DROP_CONFIRMATION_REASONS)[number];
export const rankDropConfirmations = pgTable('rank_drop_confirmations', {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    siteId: text('site_id').notNull(),
    keywordId: uuid('keyword_id')
        .notNull()
        .references(
    /* c8 ignore next -- FK resolver runs at SQL emission, not at import time. */
    () => keywords.id, { onDelete: 'cascade' }),
    // Candidate ranking — the ONE `rankings` row whose detection triggered
    // this attempt. UNIQUE = idempotency: one candidate → at most one row.
    rankingId: uuid('ranking_id')
        .notNull()
        .references(
    /* c8 ignore next -- FK resolver runs at SQL emission, not at import time. */
    () => rankings.id, { onDelete: 'cascade' }),
    state: text('state', { enum: RANK_DROP_CONFIRMATION_STATES }).notNull(),
    reason: text('reason', { enum: RANK_DROP_CONFIRMATION_REASONS }),
    previousPosition: integer('previous_position'),
    candidatePosition: integer('candidate_position'),
    confirmationPosition: integer('confirmation_position'),
    candidateObservedAt: timestamp('candidate_observed_at', {
        withTimezone: true,
    }).notNull(),
    // Present iff the provider returned a valid observation (numeric OR valid
    // "not ranked" null). NULL = provider failure / capacity refused / not
    // yet called.
    confirmationObservedAt: timestamp('confirmation_observed_at', {
        withTimezone: true,
    }),
    locationCode: integer('location_code').notNull(),
    languageCode: text('language_code').notNull(),
    device: text('device', { enum: SERP_DEVICES }).notNull(),
    attemptReservedAt: timestamp('attempt_reserved_at', {
        withTimezone: true,
    }).notNull(),
    providerCalledAt: timestamp('provider_called_at', { withTimezone: true }),
    settledAt: timestamp('settled_at', { withTimezone: true }).notNull(),
    // NULL until an atomic single-winner UPDATE flips it — the at-most-one
    // dispatch guarantee. Only ever set when `state='confirmed'`.
    alertClaimedAt: timestamp('alert_claimed_at', { withTimezone: true }),
    alertDeliveredAt: timestamp('alert_delivered_at', { withTimezone: true }),
    alertError: text('alert_error'),
    createdAt: timestamp('created_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
}, (table) => [
    uniqueIndex('rank_drop_confirmations_ranking_uq').on(table.rankingId),
    index('rank_drop_confirmations_lookup_idx').on(table.accountId, table.siteId, table.keywordId, table.candidateObservedAt),
    check('rank_drop_confirmations_state_check', sql `${table.state} in ('confirmed', 'volatile', 'unconfirmed')`),
    check('rank_drop_confirmations_reason_when_unconfirmed', sql `(${table.state} = 'unconfirmed' AND ${table.reason} IS NOT NULL) OR (${table.state} <> 'unconfirmed' AND ${table.reason} IS NULL)`),
    check('rank_drop_confirmations_obs_when_settled', sql `(${table.state} = 'unconfirmed') OR (${table.confirmationObservedAt} IS NOT NULL)`),
    check('rank_drop_confirmations_positions_positive', sql `(${table.candidatePosition} IS NULL OR ${table.candidatePosition} >= 1) AND (${table.confirmationPosition} IS NULL OR ${table.confirmationPosition} >= 1) AND (${table.previousPosition} IS NULL OR ${table.previousPosition} >= 1)`),
    check('rank_drop_confirmations_alert_only_confirmed', sql `${table.alertClaimedAt} IS NULL OR ${table.state} = 'confirmed'`),
]);
export type RankDropConfirmationRow = typeof rankDropConfirmations.$inferSelect;
export type NewRankDropConfirmationRow = typeof rankDropConfirmations.$inferInsert;
