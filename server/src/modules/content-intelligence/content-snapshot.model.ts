/**
 * Content Intelligence — sanitized snapshot store.
 *
 * One row per fetched source (owned page, competitor page, SERP result,
 * structured-data probe). Stores ONLY:
 *   - the source URL,
 *   - a length-capped, control-char-stripped, HTML-marker-free excerpt,
 *   - derived facts (headings, links, wordCount, hasSchemaOrgArticle),
 *   - a content hash,
 *   - retrieval metadata + cost,
 *   - an `expiryAt` timestamp that Mongo TTLs (default 7 days).
 *
 * The excerpt field is bounded at 8 000 chars and MUST NOT contain raw HTML
 * markers (checked in the schema pre-validate hook, so a regression cannot
 * silently regress the SEC-OUT / no-raw-HTML boundary). Full
 * competitor prose never lives here — only bounded evidence fragments the
 * scorer / brief / draft cite by source id.
 */
import mongoose, { type HydratedDocument, type InferSchemaType, } from 'mongoose';
export const CONTENT_SNAPSHOT_ROLES = [
    'owned',
    'competitor',
    'serp',
    'structured_data',
] as const;
export type ContentSnapshotRole = (typeof CONTENT_SNAPSHOT_ROLES)[number];
export const CONTENT_SNAPSHOT_MAX_EXCERPT_CHARS = 8000;
const HTML_MARKER_PATTERN = /(<\/?script\b|<\/?iframe\b|<!doctype)/i;
const derivedFactsSchema = new mongoose.Schema({
    headings: { type: [String], default: [], required: true },
    links: { type: [String], default: [], required: true },
    wordCount: { type: Number, default: 0, required: true },
    hasSchemaOrgArticle: { type: Boolean, default: false, required: true },
    canonical: { type: String, default: null },
}, { _id: false });
const retrievalCostSchema = new mongoose.Schema({
    micros: { type: Number, default: 0, required: true },
    provider: { type: String, required: true },
    credits: { type: Number, default: null },
}, { _id: false });
const contentSnapshotSchema = new mongoose.Schema({
    analysisId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ContentAnalysis',
        required: true,
        index: true,
    },
    role: {
        type: String,
        enum: CONTENT_SNAPSHOT_ROLES,
        required: true,
    },
    sourceUrl: { type: String, required: true },
    excerpt: {
        type: String,
        required: true,
        // Bounded via Mongoose maxlength — a downstream prompt sending a
        // longer excerpt fails validation loudly.
        maxlength: CONTENT_SNAPSHOT_MAX_EXCERPT_CHARS,
    },
    derivedFacts: { type: derivedFactsSchema, required: true },
    contentHash: { type: String, required: true },
    retrievedAt: { type: Date, required: true },
    retrievalCost: { type: retrievalCostSchema, required: true },
    // Mongo TTL — one Mongo `expireAfterSeconds: 0` index below reaps
    // documents whose `expiryAt` has passed. `expiryAt` is set by the
    // caller to (retrievedAt + CONTENT_ANALYSIS_SNAPSHOT_TTL_DAYS).
    expiryAt: { type: Date, required: true },
}, { timestamps: { createdAt: true, updatedAt: false } });
contentSnapshotSchema.pre('validate', function pre() {
    const doc = this as ContentSnapshotHydrated;
    if (typeof doc.excerpt === 'string' && HTML_MARKER_PATTERN.test(doc.excerpt)) {
        doc.invalidate('excerpt', 'contentSnapshot.excerpt must not contain raw HTML markers');
    }
});
// TTL — automatic cleanup at `expiryAt`. `expireAfterSeconds: 0` means the
// server reaps the doc as soon as `expiryAt` is in the past.
contentSnapshotSchema.index({ expiryAt: 1 }, { expireAfterSeconds: 0 });
contentSnapshotSchema.index({ analysisId: 1, role: 1 });
export type ContentSnapshotDocument = InferSchemaType<typeof contentSnapshotSchema> & {
    createdAt: Date;
};
export type ContentSnapshotHydrated = HydratedDocument<ContentSnapshotDocument>;
export const ContentSnapshot = mongoose.model('ContentSnapshot', contentSnapshotSchema);
