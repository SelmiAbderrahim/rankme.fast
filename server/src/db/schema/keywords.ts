import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, } from 'drizzle-orm/pg-core';
import type { ObservationMeta } from '../../shared/observations/types.js';
// Rank tracking storage.
// `siteId` / `accountId` are TEXT because the Site model still lives in Mongoose
// (24-char hex ObjectId); the ranks module joins across the two stores by id
// only, never by SQL FK. keywords.id / rankings.id are uuid.
export const SERP_DEVICES = ['desktop', 'mobile'] as const;
export type SerpDeviceKind = (typeof SERP_DEVICES)[number];
export const RANK_CADENCES = ['weekly', 'daily'] as const;
export type RankCadenceKind = (typeof RANK_CADENCES)[number];
export const RANKING_SOURCES = ['fresh', 'cache'] as const;
export type RankingSource = (typeof RANKING_SOURCES)[number];
// The search surface a keyword is tracked on.
// `google` is the shipped behaviour and the column default, so the forward
// migration never rewrites an existing row.
export const RANK_ENGINES = ['google', 'bing', 'youtube', 'amazon'] as const;
export type RankEngineKind = (typeof RANK_ENGINES)[number];
// Why the most recent rank check errored. Stored as a stable, non-localized
// key so the API can stay honest about the cause without ever leaking raw
// vendor text: each value maps 1:1 to a `ProviderError` subclass in
// `shared/providers/errors.ts`, and the client renders it through i18n.
// `vendor_error` is the honest catch-all for a `ProviderError` that is none of
// the five named subclasses — it claims only "the provider failed", never a
// cause we did not observe.
export const RANK_CHECK_FAILURE_REASONS = [
    'vendor_auth',
    'vendor_quota',
    'vendor_timeout',
    'vendor_unavailable',
    'vendor_malformed',
    'vendor_error',
] as const;
export type RankCheckFailureReason = (typeof RANK_CHECK_FAILURE_REASONS)[number];
/** The metered non-Google subset (`alt_engine_checks`, weekly cadence). */
export const ALT_RANK_ENGINES = ['bing', 'youtube', 'amazon'] as const;
export function isAltRankEngine(engine: string): engine is 'bing' | 'youtube' | 'amazon' {
    return (ALT_RANK_ENGINES as readonly string[]).includes(engine);
}
export const keywords = pgTable('keywords', {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    siteId: text('site_id').notNull(),
    phrase: text('phrase').notNull(),
    locationCode: integer('location_code').notNull(),
    languageCode: text('language_code').notNull(),
    device: text('device', { enum: SERP_DEVICES }).notNull().default('desktop'),
    // The engine this keyword is tracked on.
    // Defaults to 'google' so every pre-existing row keeps its exact prior
    // meaning without a backfill UPDATE.
    engine: text('engine', { enum: RANK_ENGINES }).notNull().default('google'),
    // Exact-equality match token for the engines whose results all live on the
    // engine's own host: a YouTube channel handle (lower-case, no leading `@`)
    // or an Amazon ASIN. NULL for google/bing, which match the site domain.
    engineTarget: text('engine_target'),
    active: boolean('active').notNull().default(true),
    // Opt-in per-keyword local-pack (map pack) tracking. When
    // true, the rank processor issues an ADDITIONAL `checkLocalPackRank`
    // call alongside the normal organic check on this keyword's existing
    // cadence — organic and local-pack are parallel signals, not a
    // replacement. Rides the same `serp_checks` budget (see rank.processor.ts);
    // no separate metric.
    trackLocalPack: boolean('track_local_pack').notNull().default(false),
    // Timestamp of the most recent rank check that ERRORED (vendor malformed /
    // timeout / quota / auth) and therefore wrote no `rankings` row. Lets the
    // UI distinguish "check failed" from the never-checked "unavailable"
    // state. Only consulted when the keyword has NO ranking row — a successful
    // row (including a null "not in top N" position) always wins by presence,
    // so this is never cleared on success.
    lastFailedCheckAt: timestamp('last_failed_check_at', { withTimezone: true }),
    // Why that most recent check errored, as one of RANK_CHECK_FAILURE_REASONS.
    // NULL for rows stamped before this column existed, so every read treats an
    // absent reason as "failed, cause not recorded" rather than inventing one.
    // Written in the SAME statement as `lastFailedCheckAt` — the two are never
    // allowed to disagree — and, like it, never cleared on success.
    lastFailedReason: text('last_failed_reason', {
        enum: RANK_CHECK_FAILURE_REASONS,
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    // `engine` joins the uniqueness tuple so the same phrase can be
    // tracked on Google AND an alt engine. Every legacy row carries
    // engine='google', so the Google projection of this index is identical to
    // the earlier index it replaces.
    uniqueIndex('keywords_site_engine_phrase_loc_lang_device_idx').on(table.siteId, table.engine, table.phrase, table.locationCode, table.languageCode, table.device),
    index('keywords_site_active_idx').on(table.siteId, table.active),
    // Serves `countActiveKeywords` (account-scoped
    // filter on `active=true`) without a per-account partial index.
    index('keywords_account_active_idx').on(table.accountId, table.active),
    check('keywords_device_check', sql `${table.device} in ('desktop', 'mobile')`),
    check('keywords_engine_check', sql `${table.engine} in ('google', 'bing', 'youtube', 'amazon')`),
    // An alt engine that matches on a token MUST carry one, and google/bing
    // MUST NOT — the database refuses a half-configured keyword outright.
    check('keywords_engine_target_check', sql `(${table.engine} in ('youtube', 'amazon')) = (${table.engineTarget} is not null)`),
    // NULL passes (the value is unknown, not false), which is exactly what
    // pre-existing rows and never-failed keywords need.
    check('keywords_last_failed_reason_check', sql `${table.lastFailedReason} in ('vendor_auth', 'vendor_quota', 'vendor_timeout', 'vendor_unavailable', 'vendor_malformed', 'vendor_error')`),
]);
export type Keyword = typeof keywords.$inferSelect;
export type NewKeyword = typeof keywords.$inferInsert;
export const rankings = pgTable('rankings', {
    id: uuid('id').primaryKey().defaultRandom(),
    keywordId: uuid('keyword_id')
        .notNull()
        .references(
    /* c8 ignore next -- drizzle-orm invokes the FK resolver only during migration/SQL emission, not at import time. */
    () => keywords.id, { onDelete: 'cascade' }),
    // null = domain not found in the vendor's depth. Absence of a row = check
    // was unavailable (vendor error) — the two are distinct on purpose.
    position: integer('position'),
    rankAbsolute: integer('rank_absolute'),
    foundUrl: text('found_url'),
    // Google AI Overview signal (nullable — null = pre-feature row or the
    // SERP payload carried no AI-overview data, DISTINCT from false =
    // "overview shown, domain not cited").
    aiOverviewPresent: boolean('ai_overview_present'),
    aiCited: boolean('ai_cited'),
    aiCitedUrl: text('ai_cited_url'),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull(),
    source: text('source', { enum: RANKING_SOURCES }).notNull(),
    // Denormalized from the parent keyword so alert detection
    // and exports can filter by engine without a
    // join. Defaults to 'google'; no backfill rewrites existing rows.
    engine: text('engine', { enum: RANK_ENGINES }).notNull().default('google'),
    /**
     * Provider provenance for non-Google observations. Nullable keeps every
     * legacy/Google row unchanged; Amazon writes the provider-index coverage
     * note returned by the capability adapter all the way to client DTOs.
     */
    observationMeta: jsonb('observation_meta').$type<ObservationMeta>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    // The unique `(keyword_id, checked_at)` index
    // serves DESC queries via backward scan; the separate DESC index was
    // redundant and dropped.
    uniqueIndex('rankings_keyword_checkedAt_idx').on(table.keywordId, table.checkedAt),
    check('rankings_source_check', sql `${table.source} in ('fresh', 'cache')`),
    check('rankings_engine_check', sql `${table.engine} in ('google', 'bing', 'youtube', 'amazon')`),
]);
export type Ranking = typeof rankings.$inferSelect;
export type NewRanking = typeof rankings.$inferInsert;
export const domainStates = pgTable('domain_states', {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: text('site_id').notNull().unique(),
    lastRankCheckAt: timestamp('last_rank_check_at', { withTimezone: true }),
    cadence: text('cadence', { enum: RANK_CADENCES }).notNull().default('weekly'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    check('domain_states_cadence_check', sql `${table.cadence} in ('weekly', 'daily')`),
]);
export type DomainState = typeof domainStates.$inferSelect;
export type NewDomainState = typeof domainStates.$inferInsert;
// The cross-user SERP cache lives in the generic `vendor_cache` table
// (capability='rank', operation='serp') — see `db/schema/vendor-cache.ts` and
// `modules/ranks/serp-cache.service.ts`. The shapes below describe its jsonb
// payload: key is sha256(phrase|locationCode|languageCode|device),
// domain-independent by design — one recorded SERP serves every user tracking
// this keyword; the caller derives each user's position by scanning
// `topResults` for their domain.
export interface SerpTopResult {
    domain: string;
    url: string;
    rankGroup: number;
    rankAbsolute: number;
    /**
     * Alt-engine exact-match token (YouTube
     * channel handle / Amazon ASIN). OPTIONAL on purpose: Google and Bing never
     * set it, so a Google cache payload serializes byte-identically to the rows
     * recorded before this field was added.
     */
    matchToken?: string | null;
}
/** AI Overview block stored alongside `topResults` in the cached SERP payload. */
export interface SerpAiOverview {
    present: boolean;
    references: Array<{
        domain: string;
        url: string | null;
        title: string | null;
    }>;
}
