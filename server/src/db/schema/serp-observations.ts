/**
 * `serp_observations` — durable SERP-feature + top-100 history.
 *
 * Why a table and not the cache: `vendor_cache` is a COGS cache with a 24 h
 * TTL. After the TTL the observation is gone, so nothing downstream can ask
 * "which features did this keyword hold last month". Keyword clustering (by
 * stored top-10 overlap) and content briefs (reading stored PAA) have no
 * producer without this table. The cache read-through path is untouched.
 *
 * One row per COMPLETED rank check. `checked_at` carries the exact value the
 * sibling `rankings` row carries, so the two stores line up without a join
 * key beyond `(keyword_id, checked_at)`.
 *
 * `engine` is the seam that support for Bing / YouTube / Amazon widens: it is a
 * plain text column with an app-level default of `'google'` and NO database
 * CHECK, so adding an engine is a code change, not a data migration.
 *
 * Retention (`SERP_OBSERVATION_RETENTION_DAYS` = 90) and the per-keyword row
 * bound (`SERP_OBSERVATION_MAX_PER_KEYWORD` = 30) are enforced in
 * `modules/ranks/serp-observations.repo.ts` after every insert; both arms are
 * tested. `top_results` is clamped to 100 rows and `features.paa` to 10
 * entries at write time (SEC-BOUND).
 */
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { SerpFeatureSnapshot } from '../../shared/providers/types.js';
import { keywords, RANKING_SOURCES, type SerpTopResult } from './keywords.js';
/** Engine discriminator. Alt-engine support appends; today only Google is produced. */
export const SERP_OBSERVATION_ENGINES = ['google'] as const;
export type SerpObservationEngine = (typeof SERP_OBSERVATION_ENGINES)[number];
/** Rows older than this are pruned after every insert. */
export const SERP_OBSERVATION_RETENTION_DAYS = 90;
/** Newest-N rows kept per (keyword, engine). */
export const SERP_OBSERVATION_MAX_PER_KEYWORD = 30;
export const serpObservations = pgTable('serp_observations', {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    siteId: text('site_id').notNull(),
    keywordId: uuid('keyword_id')
        .notNull()
        // The FK resolver is a lazy callback drizzle only invokes when the table
        // config is materialized (migration / SQL emission), so it is NOT run by
        // merely importing this module. `serp-features.test.ts` calls
        // `getTableConfig()` and dereferences the reference to execute it — no
        // coverage-ignore pragma is needed or allowed here.
        .references(() => keywords.id, { onDelete: 'cascade' }),
    engine: text('engine').notNull().default('google'),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull(),
    source: text('source', { enum: RANKING_SOURCES }).notNull(),
    features: jsonb('features').$type<SerpFeatureSnapshot>().notNull(),
    topResults: jsonb('top_results').$type<SerpTopResult[]>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
        .notNull()
        .default(sql `now()`),
}, (table) => [
    // Idempotent on a BullMQ retry — the same conflict-target discipline the
    // sibling `rankings` insert already uses.
    uniqueIndex('serp_observations_keyword_engine_checkedAt_uq').on(table.keywordId, table.engine, table.checkedAt),
    index('serp_observations_site_checkedAt_idx').on(table.siteId, table.checkedAt),
    index('serp_observations_account_checkedAt_idx').on(table.accountId, table.checkedAt),
]);
export type SerpObservation = typeof serpObservations.$inferSelect;
export type NewSerpObservation = typeof serpObservations.$inferInsert;
