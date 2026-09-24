/**
 * Confirmed competitor portfolio.
 *
 * One row per (site, registrable competitor domain) the customer has confirmed
 * as a competitor — either accepted from a DataForSEO suggestion (`source =
 * 'suggested'`) or added by hand (`source = 'manual'`). Relational + deduped by
 * a composite unique index `(site_id, registrable_domain)` that closes the
 * TOCTOU gap on concurrent adds, so this catalog lives in Postgres (mirrors the
 * `competitors` snapshot table) rather than Mongo.
 *
 * The row NEVER implies the customer owns the domain — it is a confirmed
 * comparison target only. `origin` is the safe normalized `https://host`
 * (validated via `assertPublicUrlSafe` before insert); `registrable_domain` is
 * the eTLD+1 the dedupe key is built from.
 */
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid, } from 'drizzle-orm/pg-core';
export const COMPETITOR_PROFILE_SOURCES = ['suggested', 'manual'] as const;
export type CompetitorProfileSource = (typeof COMPETITOR_PROFILE_SOURCES)[number];
export const COMPETITOR_PROFILE_STATUSES = ['active', 'archived'] as const;
export type CompetitorProfileStatus = (typeof COMPETITOR_PROFILE_STATUSES)[number];
export const competitorProfiles = pgTable('competitor_profiles', {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    siteId: text('site_id').notNull(),
    /** Safe normalized `https://host` origin (assertPublicUrlSafe-validated). */
    origin: text('origin').notNull(),
    /** eTLD+1 the dedupe key is built from. */
    registrableDomain: text('registrable_domain').notNull(),
    source: text('source', { enum: COMPETITOR_PROFILE_SOURCES })
        .notNull()
        .default('manual'),
    status: text('status', { enum: COMPETITOR_PROFILE_STATUSES })
        .notNull()
        .default('active'),
    createdAt: timestamp('created_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
}, (table) => [
    // Dedupe by registrable domain per site — the atomic guard on concurrent
    // adds of the same competitor (canonical-origin normalization happens in
    // the service before the key is built).
    uniqueIndex('competitor_profiles_site_domain_uq').on(table.siteId, table.registrableDomain),
    index('competitor_profiles_account_idx').on(table.accountId),
    index('competitor_profiles_site_status_idx').on(table.siteId, table.status),
    check('competitor_profiles_source_check', sql `${table.source} in ('suggested', 'manual')`),
    check('competitor_profiles_status_check', sql `${table.status} in ('active', 'archived')`),
]);
export type CompetitorProfileRow = typeof competitorProfiles.$inferSelect;
export type NewCompetitorProfileRow = typeof competitorProfiles.$inferInsert;
