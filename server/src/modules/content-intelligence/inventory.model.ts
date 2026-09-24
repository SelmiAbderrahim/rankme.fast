/**
 * Content inventory + cannibalization — Mongo documents.
 *
 * Three collections:
 *   - `ContentInventoryRun` — the workflow state for one inventory run
 *     (sized in blocks of four owned pages). Embeds the
 *     portfolio-level findings as a Mixed field, zod-validated at the pipeline
 *     seam (`inventory.schemas.ts`).
 *   - `ContentInventoryPage` — one row per crawled owned page, DERIVED FACTS
 *     AND HASHES ONLY. Never raw HTML, never full prose.
 *   - `ContentInventorySnapshot` — sanitized, length-capped excerpts on a 7-day
 *     Mongo TTL (mirrors `content-snapshot.model.ts`). The durable page doc
 *     holds no excerpt; the reusable fragment lives here and expires.
 *
 * Every derived text field is checked for raw-HTML markers in a pre-validate
 * hook so a downstream regression cannot land a `<script>`/`<iframe>` in
 * workflow state (SEC-OUT / no-raw-HTML).
 */
import mongoose, { type HydratedDocument, type InferSchemaType, } from 'mongoose';
import { SUPPORTED_LOCALES } from '../../shared/i18n/locales.js';
export const CONTENT_INVENTORY_STATUSES = [
    'queued',
    'crawling',
    'analyzing',
    'completed',
    'partial',
    'failed',
    'cancelled',
] as const;
export type ContentInventoryStatus = (typeof CONTENT_INVENTORY_STATUSES)[number];
export const CONTENT_INVENTORY_TERMINAL_STATUSES = [
    'completed',
    'partial',
    'failed',
    'cancelled',
] as const satisfies readonly ContentInventoryStatus[];
export const CONTENT_INVENTORY_ERROR_CATEGORIES = [
    'no_pages_crawled',
    'crawl_failed',
    'analysis_failed',
    'cost_ceiling_exceeded',
    'cancelled',
    'unexpected',
] as const;
export type ContentInventoryErrorCategory = (typeof CONTENT_INVENTORY_ERROR_CATEGORIES)[number];
const HTML_MARKER_PATTERN = /(<\/?script\b|<\/?iframe\b|<!doctype)/i;
const stageSchema = new mongoose.Schema({
    name: { type: String, enum: CONTENT_INVENTORY_STATUSES, required: true },
    startedAt: { type: Date, required: true },
    completedAt: { type: Date, default: null },
    error: { type: String, default: null },
}, { _id: false });
const inputSchema = new mongoose.Schema({
    pageLimit: { type: Number, required: true, min: 1 },
    allowedPaths: { type: [String], default: [], required: true },
    excludedPaths: { type: [String], default: [], required: true },
    sitemapSeeds: { type: [String], default: [], required: true },
}, { _id: false });
const progressSchema = new mongoose.Schema({
    pagesRequested: { type: Number, default: 0, required: true },
    pagesProcessed: { type: Number, default: 0, required: true },
    pagesFailed: { type: Number, default: 0, required: true },
    blocksReserved: { type: Number, default: 0, required: true },
}, { _id: false });
const warningEntrySchema = new mongoose.Schema({
    code: { type: String, required: true },
    messageKey: { type: String, required: true },
}, { _id: false });
const errorInfoSchema = new mongoose.Schema({
    category: {
        type: String,
        enum: CONTENT_INVENTORY_ERROR_CATEGORIES,
        required: true,
    },
    messageKey: { type: String, required: true },
    retryable: { type: Boolean, default: false, required: true },
    terminal: { type: Boolean, default: true, required: true },
}, { _id: false });
const contentInventoryRunSchema = new mongoose.Schema({
    accountId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    ownerUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    siteId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Site',
        required: true,
        index: true,
    },
    origin: { type: String, required: true },
    locale: { type: String, enum: SUPPORTED_LOCALES, required: true },
    status: {
        type: String,
        enum: CONTENT_INVENTORY_STATUSES,
        default: 'queued',
        required: true,
    },
    input: { type: inputSchema, required: true },
    progress: { type: progressSchema, default: () => ({}), required: true },
    stages: { type: [stageSchema], default: [], required: true },
    warnings: { type: [warningEntrySchema], default: [], required: true },
    error: { type: errorInfoSchema, default: null },
    inputFingerprint: { type: String, required: true },
    idempotencyKey: { type: String, required: true },
    thresholdsVersion: { type: String, default: null },
    // Portfolio findings — Mixed because the concrete shape is versioned by
    // `inventory.schemas.ts` and zod-validated at the pipeline seam.
    findings: { type: mongoose.Schema.Types.Mixed, default: null },
    costMicros: { type: Number, default: 0, required: true },
    aiCostMicros: { type: Number, default: 0, required: true },
    requestedAt: { type: Date, required: true },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
}, { timestamps: true });
// One active run per (account, site) at a time is enforced in the service; this
// unique index makes a duplicate start for the same input idempotent.
contentInventoryRunSchema.index({ accountId: 1, siteId: 1, idempotencyKey: 1 }, { unique: true });
contentInventoryRunSchema.index({ accountId: 1, siteId: 1, requestedAt: -1 });
contentInventoryRunSchema.index({ status: 1, requestedAt: 1 });
contentInventoryRunSchema.pre('validate', function pre() {
    const doc = this as ContentInventoryRunHydrated;
    if (typeof doc.origin === 'string' && HTML_MARKER_PATTERN.test(doc.origin)) {
        doc.invalidate('origin', 'contentInventoryRun.origin must not contain raw HTML markers');
    }
});
export type ContentInventoryRunDocument = InferSchemaType<typeof contentInventoryRunSchema> & {
    createdAt: Date;
    updatedAt: Date;
};
export type ContentInventoryRunHydrated = HydratedDocument<ContentInventoryRunDocument>;
export const ContentInventoryRun = mongoose.model('ContentInventoryRun', contentInventoryRunSchema);
// ---------------------------------------------------------------------------
// Per-page derived facts — NO raw HTML.
// ---------------------------------------------------------------------------
const contentInventoryPageSchema = new mongoose.Schema({
    runId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ContentInventoryRun',
        required: true,
        index: true,
    },
    accountId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site', required: true },
    // Derived facts (zod shape `inventoryPageFactsSchema`) — Mixed for the same
    // versioned-at-the-seam reason as the run findings.
    facts: { type: mongoose.Schema.Types.Mixed, required: true },
    url: { type: String, required: true },
    contentHash: { type: String, required: true },
    createdAtMs: { type: Number, required: true },
}, { timestamps: { createdAt: true, updatedAt: false } });
// One page row per (run, url) — a replayed crawl upserts instead of duplicating.
contentInventoryPageSchema.index({ runId: 1, url: 1 }, { unique: true });
contentInventoryPageSchema.pre('validate', function pre() {
    const doc = this as ContentInventoryPageHydrated;
    if (typeof doc.url === 'string' && HTML_MARKER_PATTERN.test(doc.url)) {
        doc.invalidate('url', 'contentInventoryPage.url must not contain raw HTML markers');
    }
});
export type ContentInventoryPageDocument = InferSchemaType<typeof contentInventoryPageSchema> & {
    createdAt: Date;
};
export type ContentInventoryPageHydrated = HydratedDocument<ContentInventoryPageDocument>;
export const ContentInventoryPage = mongoose.model('ContentInventoryPage', contentInventoryPageSchema);
// ---------------------------------------------------------------------------
// Sanitized excerpt snapshot — 7-day Mongo TTL (mirrors content-snapshot).
// ---------------------------------------------------------------------------
export const CONTENT_INVENTORY_SNAPSHOT_MAX_EXCERPT_CHARS = 8000;
const inventorySnapshotSchema = new mongoose.Schema({
    runId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ContentInventoryRun',
        required: true,
        index: true,
    },
    sourceUrl: { type: String, required: true },
    excerpt: {
        type: String,
        required: true,
        maxlength: CONTENT_INVENTORY_SNAPSHOT_MAX_EXCERPT_CHARS,
    },
    contentHash: { type: String, required: true },
    retrievedAt: { type: Date, required: true },
    // Mongo TTL — reaped as soon as `expiryAt` is in the past.
    expiryAt: { type: Date, required: true },
}, { timestamps: { createdAt: true, updatedAt: false } });
inventorySnapshotSchema.pre('validate', function pre() {
    const doc = this as ContentInventorySnapshotHydrated;
    if (typeof doc.excerpt === 'string' && HTML_MARKER_PATTERN.test(doc.excerpt)) {
        doc.invalidate('excerpt', 'contentInventorySnapshot.excerpt must not contain raw HTML markers');
    }
});
inventorySnapshotSchema.index({ expiryAt: 1 }, { expireAfterSeconds: 0 });
inventorySnapshotSchema.index({ runId: 1, sourceUrl: 1 });
export type ContentInventorySnapshotDocument = InferSchemaType<typeof inventorySnapshotSchema> & {
    createdAt: Date;
};
export type ContentInventorySnapshotHydrated = HydratedDocument<ContentInventorySnapshotDocument>;
export const ContentInventorySnapshot = mongoose.model('ContentInventorySnapshot', inventorySnapshotSchema);
