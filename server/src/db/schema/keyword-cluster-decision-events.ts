import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid, } from 'drizzle-orm/pg-core';
// Correction recorded 2026-07-18: `site_id` was
// originally declared `uuid`. The rankme.fast Site model persists a
// 24-char Mongo ObjectId hex, which is NOT a Postgres UUID (8-4-4-4-12).
// Attempts to insert an ObjectId hex into a UUID column fail with an
// invalid-uuid cast at the driver boundary — cross-account 404 would never
// be reachable because every accepted-path insert would 500 first. The
// column is now `text` so the row stores the ObjectId hex verbatim. All
// other constraints (uniqueness, cross-kind check, note length) are
// unchanged.
// Append-only decision-routing events for AI keyword clusters. One row per
// (account, run, cluster, idempotencyKey);
// `accepted` decisions link an owned site + Content Intelligence recommendation
// downstream, `dismissed` decisions record intent only. The Mongo cluster-run
// document remains the immutable source-of-truth for cluster contents; this
// Postgres table is the ordered event log the API and observability layers
// read.
//
// `accountId` is text because Better Auth ids are 24-char ObjectId hex
// mirrored from Mongo — no SQL FK across the Mongo/Postgres boundary. `runId`
// is text because it references the sha256-derived deterministic identity of
// the Mongo run document.
export const KEYWORD_CLUSTER_DECISION_KINDS = ['accepted', 'dismissed'] as const;
export type KeywordClusterDecisionKind = (typeof KEYWORD_CLUSTER_DECISION_KINDS)[number];
/** Bounded free-text length for the operator-supplied decision note. */
export const KEYWORD_CLUSTER_DECISION_NOTE_MAX_LEN = 500;
export const keywordClusterDecisionEvents = pgTable('keyword_cluster_decision_events', {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    // Deterministic run identity (sha256 hex) — matches the Mongo run doc.
    runId: text('run_id').notNull(),
    clusterId: text('cluster_id').notNull(),
    kind: text('kind', { enum: KEYWORD_CLUSTER_DECISION_KINDS }).notNull(),
    // Nullable in the schema; the API layer requires it for `accepted` per
    // 2 (cross-account 404 check runs there). `text` because
    // Site ids are 24-char Mongo ObjectId hex (see file header note).
    siteId: text('site_id'),
    // Set when `accepted` delegates to Content Intelligence; free-form so it
    // survives future recommendation-id shape changes without a migration.
    recommendationId: text('recommendation_id'),
    idempotencyKey: text('idempotency_key').notNull(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    // Database-enforced idempotency guard. Repeats with the
    // same key + kind are no-ops; a different kind with the same key surfaces
    // as a 409 in the API layer, the underlying INSERT here
    // still fails on the unique constraint so nothing slips through.
    uniqueIndex('kcde_account_run_cluster_idem_uq').on(table.accountId, table.runId, table.clusterId, table.idempotencyKey),
    // Ordered read pattern: newest-first per (account, run) — mirrors the
    // keyword_research_history index shape.
    index('kcde_account_run_created_idx').on(table.accountId, table.runId, table.createdAt, table.id),
    check('kcde_kind_check', sql `${table.kind} in ('accepted', 'dismissed')`),
    // App-layer already enforces "siteId REQUIRED when kind='accepted'"
    //. The DB guard belt-and-braces catches direct writes
    // that bypass the router — dismissed rows must NOT carry a siteId either
    // (their `accepted` counterpart is where the site link belongs).
    check('kcde_accepted_requires_site', sql `(${table.kind} = 'accepted' and ${table.siteId} is not null) or (${table.kind} = 'dismissed' and ${table.siteId} is null)`),
    check('kcde_note_length_check', sql `${table.note} is null or char_length(${table.note}) <= ${sql.raw(String(KEYWORD_CLUSTER_DECISION_NOTE_MAX_LEN))}`),
]);
export type KeywordClusterDecisionEventRow = typeof keywordClusterDecisionEvents.$inferSelect;
export type NewKeywordClusterDecisionEventRow = typeof keywordClusterDecisionEvents.$inferInsert;
