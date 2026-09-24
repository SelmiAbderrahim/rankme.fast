import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uuid, } from 'drizzle-orm/pg-core';
// Per-account keyword-research history. One row per successful research call
// (cache hits included — history is "what did I search", not vendor
// accounting). `accountId` is TEXT because Better Auth user ids are 24-char
// hex ObjectIds mirrored from Mongo; no SQL FK across stores. The shared
// cross-user cache stays in `vendor_cache` (account-agnostic) — this table is
// the only user-attributable record of research activity.
export const KEYWORD_RESEARCH_KINDS = [
    'metrics',
    'related',
    'intent',
    'ideas',
    'long_tail',
    // New keyword-intelligence operations sharing the
    // `keyword_lookups` metric (gap, overview, trends) plus the AI clustering
    // pass which shares the `ai_summaries` metric.
    'gap',
    'overview',
    'trends',
    'clusters',
] as const;
export type KeywordResearchKind = (typeof KEYWORD_RESEARCH_KINDS)[number];
export const keywordResearchHistory = pgTable('keyword_research_history', {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    kind: text('kind', { enum: KEYWORD_RESEARCH_KINDS }).notNull(),
    // Deduped phrase list for metrics/intent; single-element [seed] for
    // related/ideas/long_tail — one column keeps the client display uniform.
    phrases: jsonb('phrases').$type<string[]>().notNull(),
    locationCode: integer('location_code').notNull(),
    languageCode: text('language_code').notNull(),
    resultCount: integer('result_count').notNull(),
    // true = the request was served without any vendor call.
    cached: boolean('cached').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    // Serves the (account_id, created_at desc, id desc) keyset scan via
    // backward index scan.
    index('krh_account_created_idx').on(table.accountId, table.createdAt, table.id),
    check('krh_kind_check', sql `${table.kind} in ('metrics', 'related', 'intent', 'ideas', 'long_tail', 'gap', 'overview', 'trends', 'clusters')`),
]);
export type KeywordResearchHistoryRow = typeof keywordResearchHistory.$inferSelect;
export type NewKeywordResearchHistoryRow = typeof keywordResearchHistory.$inferInsert;
