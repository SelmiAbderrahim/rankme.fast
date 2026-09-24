/**
 * GSC generative-AI appearance daily snapshots.
 *
 * Google Search Console returns per-day rows for each search-appearance value
 * observed on a property. Values evolve — Google can introduce new labels
 * without notice — so we store every non-empty row VERBATIM, keyed
 * `(account_id, site_id, property, snapshot_date, raw_appearance)`. A layered
 * classifier maps known labels to a stable slug; unknown labels pass through
 * as `other_unknown` while preserving the raw name for operator review.
 *
 * `is_generative` is `true` only for labels verified from current primary
 * Google documentation. Absence of any recognized generative row for a
 * property/window is `unavailable` at the read layer, NEVER zero-filled.
 *
 * `siteId` / `accountId` follow the `gsc_search_analytics` convention: TEXT
 * (24-char hex Mongo ObjectId) — joins across the two stores go by id only.
 * Numerics use the same shapes as `gsc_search_analytics` (int clicks +
 * impressions, real ctr + position) since Google returns the same fields.
 */
import { boolean, date, index, integer, jsonb, pgTable, real, text, timestamp, uniqueIndex, uuid, } from 'drizzle-orm/pg-core';
export const gscSearchAppearance = pgTable('gsc_search_appearance', {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    siteId: text('site_id').notNull(),
    bindingGenerationId: text('binding_generation_id').notNull(),
    /** The GSC property URL (verbatim: sc-domain:example.com or full URL). */
    property: text('property').notNull(),
    /** endDate of the queried window, already lag-adjusted (today - 3 UTC). */
    snapshotDate: date('snapshot_date').notNull(),
    /** Length in days of the aggregated window ending at snapshot_date. */
    windowDays: integer('window_days').notNull().default(28),
    /** Raw Google-returned appearance name (verbatim). */
    rawAppearance: text('raw_appearance').notNull(),
    /** Stable classifier slug — see searchAppearanceClassification.ts. */
    classificationSlug: text('classification_slug').notNull(),
    /** True only for classifier-recognized generative-AI values. */
    classifiedGenerative: boolean('classified_generative').notNull(),
    clicks: integer('clicks').notNull(),
    impressions: integer('impressions').notNull(),
    ctr: real('ctr').notNull(),
    position: real('position').notNull(),
    /** First-party ObservationMeta echo (window, provider request digest). */
    observationMeta: jsonb('observation_meta').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
}, (table) => [
    uniqueIndex('gsc_search_appearance_site_property_date_raw_idx').on(table.siteId, table.bindingGenerationId, table.property, table.snapshotDate, table.windowDays, table.rawAppearance),
    index('gsc_search_appearance_site_date_idx').on(table.siteId, table.bindingGenerationId, table.snapshotDate),
    index('gsc_search_appearance_site_generative_idx').on(table.siteId, table.bindingGenerationId, table.classifiedGenerative),
]);
export type GscSearchAppearanceSnapshotRow = typeof gscSearchAppearance.$inferSelect;
export type NewGscSearchAppearanceSnapshotRow = typeof gscSearchAppearance.$inferInsert;
