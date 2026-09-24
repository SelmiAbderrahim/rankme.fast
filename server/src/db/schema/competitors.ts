/**
 * Competitor snapshots (Agency tier).
 *
 * One row per (site, competitor domain, UTC day). The `snapshot_day` DATE
 * column carries the calendar day and backs a composite unique index —
 * `(site_id, competitor_domain, snapshot_day)` — that closes the TOCTOU
 * gap on concurrent same-day fetches (fix 12). The service composes a
 * batched INSERT with `ON CONFLICT DO NOTHING` on that index.
 */
import { sql } from 'drizzle-orm';
import { check, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid, } from 'drizzle-orm/pg-core';
// Which vendor signal produced the snapshot rows: 'domain' =
// competitors_domain (target's own ranked-keyword footprint),
// 'tracked_keywords' = serp_competitors over the site's tracked keywords
// (fallback for targets with no footprint in the Labs index).
export const COMPETITOR_SOURCES = ['domain', 'tracked_keywords'] as const;
export type CompetitorSource = (typeof COMPETITOR_SOURCES)[number];
export const competitors = pgTable('competitors', {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: text('site_id').notNull(),
    accountId: text('account_id').notNull(),
    competitorDomain: text('competitor_domain').notNull(),
    // Average SERP position across intersecting keywords. `null` when the
    // vendor could not compute one.
    avgPosition: numeric('avg_position'),
    intersections: integer('intersections').notNull().default(0),
    // Estimated organic traffic value ($). `null` when the vendor omits it.
    estimatedTraffic: numeric('estimated_traffic'),
    source: text('source', { enum: COMPETITOR_SOURCES })
        .notNull()
        .default('domain'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
    // UTC calendar day of `fetchedAt`. Populated by the service on every insert
    // and the axis of the composite unique index below.
    snapshotDay: date('snapshot_day').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
}, (table) => [
    index('competitors_site_fetched_at_idx').on(table.siteId, table.fetchedAt),
    index('competitors_account_idx').on(table.accountId),
    uniqueIndex('competitors_site_domain_day_uq').on(table.siteId, table.competitorDomain, table.snapshotDay),
    check('competitors_source_check', sql `${table.source} in ('domain', 'tracked_keywords')`),
]);
export type CompetitorRow = typeof competitors.$inferSelect;
export type NewCompetitorRow = typeof competitors.$inferInsert;
/**
 * Domain-intersection (gap-analysis) cache. One row per
 * (site, competitor domain, fetch time); the service serves a same-UTC-day
 * row without a fresh DataForSEO Labs call. The intersecting-keyword rows are
 * stored verbatim as jsonb — the shape is the provider's `DomainIntersectionRow[]`.
 */
export const competitorIntersections = pgTable('competitor_intersections', {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: text('site_id').notNull(),
    accountId: text('account_id').notNull(),
    competitorDomain: text('competitor_domain').notNull(),
    keywords: jsonb('keywords').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
}, (table) => [
    index('competitor_intersections_lookup_idx').on(table.siteId, table.competitorDomain, table.fetchedAt),
    index('competitor_intersections_account_idx').on(table.accountId),
]);
export type CompetitorIntersectionRow = typeof competitorIntersections.$inferSelect;
export type NewCompetitorIntersectionRow = typeof competitorIntersections.$inferInsert;
