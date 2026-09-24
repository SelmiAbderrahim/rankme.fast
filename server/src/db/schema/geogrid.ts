/**
 * Geogrid local rank tracking.
 *
 * LocalFalcon-style per-coordinate map-pack grids. One scan fans a square
 * grid (3×3 / 5×5 / 7×7, ≤49 cells) of `location_coordinate` Google Maps
 * tasks out from a user-supplied center point, all inside ONE metered
 * `geogrid_scans` unit.
 *
 * Relational, ordered per-cell time series → Postgres per
 * `drizzle-postgres-scope.md`. `site_id` / `account_id` / `keyword_id` are
 * TEXT for the same cross-store reason as `local-seo.ts`.
 *
 * HONESTY INVARIANT — the two stores are disjoint by construction:
 *   - a `geogrid_snapshots` row means the vendor ANSWERED for that cell
 *     (`position` numeric = in the pack, `position` NULL = not in the pack);
 *   - membership in `geogrid_scans.failed_point_indexes` means the vendor did
 *     NOT answer.
 * A failed cell therefore has no row and can never be rendered as a rank or
 * as "not in the pack".
 */
import { sql } from 'drizzle-orm';
import { bigint, boolean, doublePrecision, index, integer, pgTable, text, timestamp, uniqueIndex, uuid, } from 'drizzle-orm/pg-core';
/** Terminal + in-flight scan statuses. */
export const GEOGRID_SCAN_STATUSES = [
    'queued',
    'running',
    'completed',
    'completed_partial',
    'failed',
] as const;
export type GeogridScanStatus = (typeof GEOGRID_SCAN_STATUSES)[number];
/** The only grid sizes the product offers. Odd squares → a center cell always exists. */
export const GEOGRID_SIZES = [3, 5, 7] as const;
export type GeogridSize = (typeof GEOGRID_SIZES)[number];
/** Product ceiling: 7 × 7. The `geogrid_scans` unit price is derived from it. */
export const GEOGRID_MAX_CELLS = 49;
/** Inclusive spacing bounds, in metres. Multiples of 100 (0.1 km … 10 km). */
export const GEOGRID_MIN_SPACING_METERS = 100;
export const GEOGRID_MAX_SPACING_METERS = 10000;
export const GEOGRID_SPACING_STEP_METERS = 100;
/**
 * Latitude is bounded well inside the poles so the `cos(lat)` longitude scale
 * used by the cell derivation stays bounded (`cos 85° = 0.0872`).
 */
export const GEOGRID_MAX_ABS_CENTER_LAT = 85;
/** Vendor-documented zoom range for `location_coordinate`; product default 17. */
export const GEOGRID_MIN_ZOOM = 3;
export const GEOGRID_MAX_ZOOM = 21;
export const GEOGRID_DEFAULT_ZOOM = 17;
export const geogridScans = pgTable('geogrid_scans', {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    siteId: text('site_id').notNull(),
    keywordId: text('keyword_id').notNull(),
    /** Denormalized display text — the keyword row may later be deleted. */
    keyword: text('keyword').notNull(),
    /** Denormalized from the tracked keyword; the vendor needs it per cell. */
    languageCode: text('language_code').notNull(),
    centerLat: doublePrecision('center_lat').notNull(),
    centerLng: doublePrecision('center_lng').notNull(),
    spacingMeters: integer('spacing_meters').notNull(),
    gridSize: integer('grid_size').notNull(),
    zoom: integer('zoom').notNull(),
    status: text('status', { enum: GEOGRID_SCAN_STATUSES }).notNull(),
    totalCells: integer('total_cells').notNull(),
    observedCells: integer('observed_cells').notNull().default(0),
    notInPackCells: integer('not_in_pack_cells').notNull().default(0),
    failedCells: integer('failed_cells').notNull().default(0),
    /** Bounded ≤49 by `total_cells`; the disjoint complement of the snapshot rows. */
    failedPointIndexes: integer('failed_point_indexes')
        .array()
        .notNull()
        .default([]),
    /**
     * Durable pre-dispatch claims. A point is appended before the vendor call;
     * worker replay never sends a second paid request for an attempted cell.
     * Attempted points without a snapshot settle honestly as failed/unknown.
     */
    attemptedPointIndexes: integer('attempted_point_indexes')
        .array()
        .notNull()
        .default([]),
    /** Summed `captureVendorCost` micros across every cell that reported one. */
    // `sql` literal rather than a JS bigint default: drizzle-kit cannot
    // serialize a BigInt into its snapshot JSON.
    costMicros: bigint('cost_micros', { mode: 'bigint' })
        .notNull()
        .default(sql `0`),
    /** One-shot latch — the all-fail refund can never be issued twice. */
    refundIssued: boolean('refund_issued').notNull().default(false),
    /** Localized i18n key, never vendor prose. */
    failureReason: text('failure_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
}, (table) => [
    index('geogrid_scans_site_keyword_created_idx').on(table.siteId, table.keywordId, table.createdAt),
    index('geogrid_scans_account_created_idx').on(table.accountId, table.createdAt),
]);
export const geogridSnapshots = pgTable('geogrid_snapshots', {
    id: uuid('id').primaryKey().defaultRandom(),
    scanId: uuid('scan_id').notNull(),
    accountId: text('account_id').notNull(),
    siteId: text('site_id').notNull(),
    keywordId: text('keyword_id').notNull(),
    /** 0-based, row-major from the NORTH-WEST corner. Stable render key. */
    pointIndex: integer('point_index').notNull(),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    /**
     * NULL = the business is not in the map pack at this coordinate — the
     * SAME semantics as `local_pack_rank_snapshots.position`. Distinct from a
     * failed cell, which has no row at all.
     */
    position: integer('position'),
    totalPackSize: integer('total_pack_size').notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
}, (table) => [
    uniqueIndex('geogrid_snapshots_scan_point_idx').on(table.scanId, table.pointIndex),
    index('geogrid_snapshots_site_keyword_captured_idx').on(table.siteId, table.keywordId, table.capturedAt),
]);
export type GeogridScanRow = typeof geogridScans.$inferSelect;
export type NewGeogridScanRow = typeof geogridScans.$inferInsert;
export type GeogridSnapshotRow = typeof geogridSnapshots.$inferSelect;
export type NewGeogridSnapshotRow = typeof geogridSnapshots.$inferInsert;
