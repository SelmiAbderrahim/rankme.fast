import { sql } from 'drizzle-orm';
import { bigint, check, index, pgTable, text, timestamp, uniqueIndex, uuid, } from 'drizzle-orm/pg-core';
// Append-only history of user-initiated state transitions for a
// unified Next Action. Only the four non-content sources persist events here;
// content recommendation transitions delegate to the shipped
// `content-recommendation.service`.
export const ACTION_SOURCE_TYPES = [
    'audit_finding',
    'confirmed_rank_drop',
    'gsc_decline',
    'ga4_decline',
    'content_recommendation',
    'citation_gap',
    'audience_research',
    'competitor_opportunity',
] as const;
export type ActionSourceType = (typeof ACTION_SOURCE_TYPES)[number];
export const ACTION_STATES = [
    'open',
    'planned',
    'dismissed',
    'completed',
] as const;
export type ActionState = (typeof ACTION_STATES)[number];
export const ACTION_EVENT_KINDS = [
    'plan',
    'dismiss',
    'complete',
    'reopen',
    'note',
] as const;
export type ActionEventKind = (typeof ACTION_EVENT_KINDS)[number];
export const actionEvents = pgTable('action_events', {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    siteId: text('site_id').notNull(),
    // 64-char sha256 hex — never a caller-provided preimage.
    actionId: text('action_id').notNull(),
    sourceType: text('source_type', { enum: ACTION_SOURCE_TYPES }).notNull(),
    // Hash-only reference — the source's own store stays authoritative.
    sourceIdRef: text('source_id_ref').notNull(),
    priorState: text('prior_state', { enum: ACTION_STATES }),
    newState: text('new_state', { enum: ACTION_STATES }).notNull(),
    eventKind: text('event_kind', { enum: ACTION_EVENT_KINDS }).notNull(),
    actorUserId: text('actor_user_id').notNull(),
    // zod-bounded 0..2000 chars.
    note: text('note'),
    // 1-based, monotonically increasing per action.
    ordinal: bigint('ordinal', { mode: 'number' }).notNull(),
    // Account-scoped idempotency: same key on same account = cached replay.
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
}, (table) => [
    uniqueIndex('action_events_ordinal_uq').on(table.accountId, table.actionId, table.ordinal),
    uniqueIndex('action_events_idempotency_uq').on(table.accountId, table.idempotencyKey),
    index('action_events_action_lookup_idx').on(table.accountId, table.actionId, table.ordinal),
    index('action_events_site_history_idx').on(table.accountId, table.siteId, table.createdAt),
    index('action_events_site_action_idx').on(table.accountId, table.siteId, table.actionId),
    check('action_events_new_state_check', sql `${table.newState} in ('open','planned','dismissed','completed')`),
    check('action_events_prior_state_check', sql `${table.priorState} IS NULL OR ${table.priorState} in ('open','planned','dismissed','completed')`),
    check('action_events_kind_check', sql `${table.eventKind} in ('plan','dismiss','complete','reopen','note')`),
    check('action_events_ordinal_positive', sql `${table.ordinal} >= 1`),
    check('action_events_note_len', sql `${table.note} IS NULL OR char_length(${table.note}) <= 2000`),
]);
export type ActionEventRow = typeof actionEvents.$inferSelect;
export type NewActionEventRow = typeof actionEvents.$inferInsert;
