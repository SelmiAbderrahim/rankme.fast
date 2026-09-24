import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid, } from 'drizzle-orm/pg-core';
// Append-only decision events for audience-research signals
//. Row-per-terminal-decision (`accepted` | `dismissed`) keyed
// by an account-scoped idempotency token, with a partial unique index that
// enforces exactly one terminal decision per signal. The immutable Mongo
// run/result document is NEVER mutated to carry current decision state.
//
// Text (not uuid) for account/site/run/signal ids because they are 24-char
// Mongo ObjectId hex (accounts/sites) or nanoid-shaped opaque strings that
// don't parse as Postgres UUIDs. See the header note on
// keyword-cluster-decision-events for the identical rationale.
export const AUDIENCE_RESEARCH_DECISION_KINDS = ['accepted', 'dismissed'] as const;
export type AudienceResearchDecisionKind = (typeof AUDIENCE_RESEARCH_DECISION_KINDS)[number];
export const AUDIENCE_RESEARCH_DECISION_DESTINATIONS = [
    'content',
    'comparison_page',
    'product',
    'seo',
] as const;
export type AudienceResearchDecisionDestination = (typeof AUDIENCE_RESEARCH_DECISION_DESTINATIONS)[number];
export const AUDIENCE_RESEARCH_DISMISS_REASONS = [
    'not_relevant',
    'already_addressed',
    'low_confidence',
    'duplicate',
    'other',
] as const;
export type AudienceResearchDismissReason = (typeof AUDIENCE_RESEARCH_DISMISS_REASONS)[number];
export const audienceResearchSignalDecisionEvents = pgTable('audience_research_signal_decision_events', {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    siteId: text('site_id').notNull(),
    runId: text('run_id').notNull(),
    signalId: text('signal_id').notNull(),
    decision: text('decision', { enum: AUDIENCE_RESEARCH_DECISION_KINDS }).notNull(),
    destination: text('destination', {
        enum: AUDIENCE_RESEARCH_DECISION_DESTINATIONS,
    }),
    dismissReason: text('dismiss_reason', {
        enum: AUDIENCE_RESEARCH_DISMISS_REASONS,
    }),
    // Content Intelligence recommendation id (content/comparison_page path) or
    // Next Actions source id (product/seo path). Null for dismissals.
    downstreamId: text('downstream_id'),
    // Free-form so it survives future deep-link shape changes.
    deepLinkPath: text('deep_link_path'),
    idempotencyKey: text('idempotency_key').notNull(),
    decidedByUserId: text('decided_by_user_id').notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
}, (table) => [
    // Account-scoped idempotency: same key on same account = cached replay.
    uniqueIndex('arsde_account_idem_uq').on(table.accountId, table.idempotencyKey),
    // One terminal decision per signal PER ACCOUNT — the unique index makes
    // the "accept-after-dismiss" / "dismiss-after-accept" collision
    // race-safe. Scoped by account: the previous global `signal_id`-only
    // uniqueness let ANY account's decision block (409) every other
    // account's decision on a colliding signal id — a cross-account
    // isolation defect (decision terminality is an account-local contract:
    // "append-only per (accountId, signalId)").
    uniqueIndex('arsde_signal_terminal_uq').on(table.accountId, table.signalId),
    // Ordered owned-read pattern for the workspace.
    index('arsde_owner_ordered_idx').on(table.accountId, table.siteId, table.runId, table.decidedAt),
    check('arsde_decision_check', sql `${table.decision} in ('accepted','dismissed')`),
    // Accepted rows carry destination + downstreamId; dismissed rows carry a
    // reason and neither destination nor downstreamId. Belt-and-braces DB
    // guard mirroring the API layer.
    check('arsde_accepted_shape_check', sql `(${table.decision} = 'accepted' and ${table.destination} is not null and ${table.downstreamId} is not null and ${table.dismissReason} is null) or (${table.decision} = 'dismissed' and ${table.destination} is null and ${table.downstreamId} is null)`),
]);
export type AudienceResearchSignalDecisionEventRow = typeof audienceResearchSignalDecisionEvents.$inferSelect;
export type NewAudienceResearchSignalDecisionEventRow = typeof audienceResearchSignalDecisionEvents.$inferInsert;
